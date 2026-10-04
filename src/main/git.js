import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import { toolEnv } from './tool-path.js';
// One definition of the repo-name rule, shared with the workspace validator
// and the renderer's clipboard lines. Re-exported so every main-process
// caller keeps importing it from here.
import { safeRepoName } from '../renderer/workspace-model.js';
export { safeRepoName };

function exec(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    // timeout last: the 10s ceiling on a hung child is a guarantee of this
    // helper, not a default a caller may override.
    execFile(cmd, args, { env: toolEnv(), ...opts, timeout: 10000 }, (err, stdout) => {
      resolve(err ? null : stdout);
    });
  });
}

const countLines = (s) => s ? s.trim().split('\n').filter(l => l.trim()).length : 0;

const STAT_CAP = 200;

/** Paths from `git status --porcelain`: skip deletions, use the new name of a rename. */
export function dirtyPaths(status) {
  return (status || '').split('\n').filter((l) => l.length > 3).flatMap((l) => {
    const code = l.slice(0, 2);
    if (code.includes('D')) return [];
    const p = l.slice(3);
    return [p.includes(' -> ') ? p.split(' -> ').pop() : p];
  });
}

/** Oldest mtime among the dirty paths, ISO, or null when nothing is dirty. */
export async function dirtySince(dir, status) {
  const paths = dirtyPaths(status).slice(0, STAT_CAP);
  const times = await Promise.all(paths.map(async (p) => {
    try { return (await fs.stat(path.join(dir, p))).mtimeMs; } catch { return null; }
  }));
  const valid = times.filter((t) => typeof t === 'number');
  return valid.length ? new Date(Math.min(...valid)).toISOString() : null;
}

/**
 * `git log --format=%cI%x09%D` lines to ascending dates plus the kept
 * branches whose tips are local-only. A branch with any local-only commit
 * has a local-only tip, so tip decorations name every such branch.
 */
export function parseUnpushed(out, keep) {
  const dates = [];
  const branches = new Set();
  for (const line of (out || '').split('\n').filter(Boolean)) {
    const [at, deco = ''] = line.split('\t');
    dates.push(at);
    for (const name of deco.split(', ')) if (keep.has(name)) branches.add(name);
  }
  dates.sort((a, b) => Date.parse(a) - Date.parse(b));
  return { dates, branches: [...branches].sort() };
}

/**
 * Commits only this Mac has, on the branches that can lose work: HEAD, the
 * local default branch, and branches with unique content. A branch whose
 * merge equals the default branch is left out even when its commits were
 * never pushed, because their content already landed. `--decorate-refs` drops
 * the HEAD decoration, so the checked-out branch is passed in by name.
 */
export async function scanUnpushed(dir, { defaultBranch, base }, uniqueBranches = [], headBranch = null) {
  const keep = new Set(uniqueBranches);
  if (headBranch) keep.add(headBranch);
  const refs = ['HEAD', ...uniqueBranches.map((b) => 'refs/heads/' + b)];
  if (defaultBranch && base === defaultBranch) {
    keep.add(defaultBranch);
    refs.push('refs/heads/' + defaultBranch);
  }
  const out = await exec('git', ['-C', dir, 'log', ...refs, '--not', '--remotes',
    '--decorate-refs=refs/heads/', '--format=%cI%x09%D', '--']);
  return parseUnpushed(out, keep);
}

export async function scanOne(repoName, basePath) {
  if (!safeRepoName(repoName)) return null;
  const dir = path.join(basePath, repoName);
  const [status, hash, lastCommitRaw, headRaw, ref, list] = await Promise.all([
    exec('git', ['-C', dir, 'status', '--porcelain']),
    exec('git', ['-C', dir, 'rev-parse', '--short', 'HEAD']),
    exec('git', ['-C', dir, 'log', '-1', '--format=%cI']),
    exec('git', ['-C', dir, 'symbolic-ref', '--short', '-q', 'HEAD']),
    resolveBase(dir),
    listWorktrees(dir),
  ]);
  if (status === null && hash === null) return null;
  // A live session's branch is work in progress, not stranded work.
  const skip = new Set(list.filter((w) => w.inUse && w.branch).map((w) => w.branch));
  const [branchInfo, worktrees] = await Promise.all([
    scanBranches(repoName, basePath, { ref, skip }),
    scanWorktrees(repoName, basePath, { ref, list }),
  ]);
  const [unpushed, dirty] = await Promise.all([
    scanUnpushed(dir, ref, branchInfo.unmergedBranches, headRaw ? headRaw.trim() : null),
    dirtySince(dir, status),
  ]);
  return {
    uncommitted: countLines(status),
    unpushed: unpushed.dates.length,
    unpushedBranches: unpushed.branches,
    hash: hash ? hash.trim() : null,
    lastCommit: lastCommitRaw ? lastCommitRaw.trim() : null,
    defaultBranch: branchInfo.defaultBranch,
    unmergedBranches: branchInfo.unmergedBranches,
    since: { dirty, unpushed: unpushed.dates[0] || null, branches: branchInfo.unmergedSince },
    worktrees,
  };
}

export const BRANCH_CAP = 30;

/**
 * The default branch and the ref to compare against. The upstream default may
 * have no local branch (renamed upstream, local deleted), and falling back to
 * origin/<def> keeps the scan honest instead of letting a git error read as
 * "nothing unmerged".
 */
export async function resolveBase(dir) {
  const localRef = (name) =>
    exec('git', ['-C', dir, 'rev-parse', '--verify', '--quiet', 'refs/heads/' + name]);
  const head = await exec('git', ['-C', dir, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  const def = head ? head.trim().replace(/^origin\//, '') : null;
  if (def) return { defaultBranch: def, base: (await localRef(def)) !== null ? def : 'origin/' + def };
  for (const cand of ['main', 'master']) {
    if (await localRef(cand) !== null) return { defaultBranch: cand, base: cand };
  }
  return { defaultBranch: null, base: null };
}

/**
 * True when merging the branch into base would change base's tree. A squash
 * or rebase merge leaves the branch's commits off main's ancestry, so
 * `--no-merged` lists it, but the merge result equals main and nothing is at
 * risk. A conflict exits 1, exec resolves null, and that counts as unique.
 */
async function hasUniqueContent(dir, base, baseTree, branch) {
  const out = await exec('git', ['-C', dir, 'merge-tree', '--write-tree', base, 'refs/heads/' + branch]);
  return !out || out.split('\n')[0].trim() !== baseTree;
}

/**
 * Default branch plus every local branch holding content the default branch
 * lacks. `%(refname)` rather than `:short`, because `git branch --no-merged`
 * also prints pseudo-entries such as "(no branch, rebasing main)" and only
 * refs/heads entries are branches.
 */
export async function scanBranches(repoName, basePath, { ref, skip = new Set(), cap = BRANCH_CAP } = {}) {
  if (!safeRepoName(repoName)) return null;
  const dir = path.join(basePath, repoName);
  const { defaultBranch: def, base } = ref || await resolveBase(dir);
  if (!base) return { defaultBranch: null, unmergedBranches: [], unmergedSince: {} };
  const [out, treeOut] = await Promise.all([
    exec('git', ['-C', dir, 'branch', '--no-merged', base, '--format=%(refname)%09%(committerdate:iso-strict)']),
    exec('git', ['-C', dir, 'rev-parse', base + '^{tree}']),
  ]);
  const rows = (out || '').split('\n')
    .filter((l) => l.startsWith('refs/heads/'))
    .map((l) => l.slice('refs/heads/'.length).split('\t'))
    .filter(([b]) => b && b !== def && !skip.has(b));
  const baseTree = treeOut ? treeOut.trim() : null;
  const unique = await Promise.all(rows.map(([b], i) =>
    (i >= cap || !baseTree ? true : hasUniqueContent(dir, base, baseTree, b))));
  const kept = rows.filter((_, i) => unique[i]);
  return { defaultBranch: def, unmergedBranches: kept.map(([b]) => b), unmergedSince: Object.fromEntries(kept) };
}

export function parseWorktreePorcelain(out) {
  return out.split('\n\n').map(b => b.trim()).filter(Boolean).map((block) => {
    const wt = { path: null, branch: null, detached: false, locked: null, prunable: false };
    for (const line of block.split('\n')) {
      if (line.startsWith('worktree ')) wt.path = line.slice('worktree '.length);
      else if (line.startsWith('branch ')) wt.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
      else if (line === 'detached') wt.detached = true;
      else if (line === 'locked' || line.startsWith('locked ')) wt.locked = line.slice('locked '.length);
      else if (line === 'prunable' || line.startsWith('prunable ')) wt.prunable = true;
    }
    return wt;
  });
}

/** The pid in a Claude Code lock reason, "claude session <name> (pid N start <date>)", or null. */
export function lockPid(reason) {
  const m = /\(pid (\d+)\b/.exec(reason || '');
  return m ? Number(m[1]) : null;
}

/**
 * Signal 0 checks for a process without signalling it. A pid of 0 or less
 * would address a process group, so it is refused. EPERM means the process
 * exists under another user, which still counts as alive.
 */
export function pidAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

/**
 * Linked worktrees, minus the scanned checkout and any whose directory is
 * gone. The checkout is excluded by path rather than position: `git worktree
 * list` prints the main checkout first, but the scanned directory can itself
 * be a linked worktree, and position-based dropping would then hide the real
 * main checkout. A worktree locked by a live Claude Code session is in use.
 */
export async function listWorktrees(dir) {
  const out = await exec('git', ['-C', dir, 'worktree', 'list', '--porcelain']);
  if (!out) return [];
  let self = dir;
  try { self = await fs.realpath(dir); } catch { /* keep the joined path */ }
  return parseWorktreePorcelain(out)
    .filter((wt) => wt.path && wt.path !== self && !wt.prunable)
    .map((wt) => ({ ...wt, inUse: wt.locked !== null && pidAlive(lockPid(wt.locked)) }));
}

/**
 * `git status --porcelain -z -uall` to changed paths, deleted paths, and
 * opaque entries. A nested repository prints as `dir/` even under -uall,
 * and its contents cannot be compared. In -z output a rename or copy puts
 * the source path in the next entry.
 */
export function parseStatusZ(out) {
  const entries = (out || '').split('\0');
  const res = { changed: [], deleted: [], opaque: [] };
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.length < 4) continue;
    const code = e.slice(0, 2);
    const p = e.slice(3);
    if (code[0] === 'R' || code[0] === 'C') i++;
    if (p.endsWith('/')) res.opaque.push(p);
    else if (code.includes('D')) res.deleted.push(p);
    else res.changed.push(p);
  }
  return res;
}

const ZERO_OID = /^0+$/;

/**
 * `git log --raw --no-renames --format=%x00%cI` to path -> every blob the
 * path has held, the date of its newest change, and whether that change
 * left it present. Newest commit first, so the first sighting is the latest.
 */
export function parseRawHistory(out) {
  const map = new Map();
  let at = null;
  for (const line of (out || '').split('\n')) {
    if (line.startsWith('\0')) { at = line.slice(1).trim(); continue; }
    const m = /^:\d+ \d+ ([0-9a-f]+) ([0-9a-f]+) ([A-Z])\d*\t(.+)$/.exec(line);
    if (!m) continue;
    const [, oldBlob, newBlob, st, p] = m;
    let entry = map.get(p);
    if (!entry) {
      entry = { blobs: new Set(), latest: at, present: st !== 'D' };
      map.set(p, entry);
    }
    for (const b of [oldBlob, newBlob]) if (!ZERO_OID.test(b)) entry.blobs.add(b);
  }
  return map;
}

/**
 * An edit is noise when the default branch holds or once held this exact
 * content, or changed the path after the edit was made (a draft it has since
 * revised). It is unique when the path is new to the default branch, or when
 * it is newer than every committed version and matches none of them.
 */
export function isUniqueEdit(entry, blob, mtimeMs) {
  if (!entry) return true;
  if (entry.blobs.has(blob)) return false;
  const latest = Date.parse(entry.latest);
  return !(Number.isFinite(mtimeMs) && Number.isFinite(latest) && mtimeMs < latest);
}

/** True when any change in the worktree holds work the default branch lacks. Every failure reads unique. */
async function hasUniqueFiles(dir, wtPath, base, { changed, deleted, opaque }) {
  if (opaque.length || changed.length + deleted.length > STAT_CAP) return true;
  const [hashOut, rawOut] = await Promise.all([
    changed.length ? exec('git', ['-C', wtPath, 'hash-object', '--', ...changed]) : '',
    exec('git', ['--literal-pathspecs', '-c', 'core.quotePath=false', '-C', dir, 'log', '--raw', '--no-abbrev',
      '--no-renames', '--format=%x00%cI', base, '--', ...changed, ...deleted], { maxBuffer: 16 * 1024 * 1024 }),
  ]);
  if (hashOut === null || rawOut === null) return true;
  const hashes = hashOut.trim().split('\n');
  if (changed.length && hashes.length !== changed.length) return true;
  const history = parseRawHistory(rawOut);
  const mtimes = await Promise.all(changed.map(async (p) => {
    try { return (await fs.stat(path.join(wtPath, p))).mtimeMs; } catch { return null; }
  }));
  return changed.some((p, i) => isUniqueEdit(history.get(p), hashes[i], mtimes[i]))
    || deleted.some((p) => history.get(p)?.present === true);
}

/**
 * Linked worktrees with their dirty state and whether that dirt is work the
 * default branch lacks. A worktree in use by a live session reports nothing.
 * A status that fails or times out reads dirty and unique, so a broken
 * worktree is reported rather than hidden.
 */
export async function scanWorktrees(repoName, basePath, { ref, list } = {}) {
  if (!safeRepoName(repoName)) return [];
  const dir = path.join(basePath, repoName);
  const [{ base }, wts] = await Promise.all([ref || resolveBase(dir), list || listWorktrees(dir)]);
  return Promise.all(wts.map(async (wt) => {
    const row = { path: wt.path, branch: wt.branch, inUse: wt.inUse, dirty: false, unique: false };
    if (wt.inUse) return row;
    const status = await exec('git', ['-C', wt.path, 'status', '--porcelain', '-z', '-uall'], { maxBuffer: 16 * 1024 * 1024 });
    if (status === null) return { ...row, dirty: true, unique: true };
    const parsed = parseStatusZ(status);
    row.dirty = parsed.changed.length + parsed.deleted.length + parsed.opaque.length > 0;
    if (row.dirty) row.unique = base ? await hasUniqueFiles(dir, wt.path, base, parsed) : true;
    return row;
  }));
}

// gh is optional. Probed once per process, and a missing or unauthenticated
// gh means "no PR data", never an error the user sees.
let ghAvailable = null;

export async function haveGh() {
  if (ghAvailable === null) ghAvailable = (await exec('gh', ['--version'])) !== null;
  return ghAvailable;
}

export function parsePrStates(json) {
  let rows;
  try { rows = JSON.parse(json); } catch { return {}; }
  if (!Array.isArray(rows)) return {};
  // Highest PR number wins per branch: a reused branch's newest PR is the
  // one whose state matters, and gh's output order is not a contract.
  const map = {};
  const num = {};
  for (const r of rows) {
    if (typeof r?.headRefName !== 'string' || typeof r?.state !== 'string') continue;
    const n = typeof r.number === 'number' ? r.number : -1;
    if (!(r.headRefName in map) || n > num[r.headRefName]) {
      map[r.headRefName] = r.state;
      num[r.headRefName] = n;
    }
  }
  return map;
}

/**
 * PR state per head branch, read-only. `--state all` on purpose: a
 * squash-merged branch is never an ancestor of main, so a MERGED PR is the
 * only signal that its work actually landed. The limit covers every PR of the
 * largest repo (one had 196), since a squash-merged
 * branch older than the limit would otherwise read as unmerged.
 */
export async function prStates(repoName, basePath) {
  if (!safeRepoName(repoName) || !(await haveGh())) return null;
  const dir = path.join(basePath, repoName);
  const out = await exec('gh', ['pr', 'list', '--json', 'number,headRefName,state', '--state', 'all', '--limit', '1000'], { cwd: dir });
  return out === null ? null : parsePrStates(out);
}

export async function scanAll(repoNames, basePath) {
  const results = {};
  await Promise.all(
    repoNames.map(async (name) => {
      const result = await scanOne(name, basePath);
      if (result) results[name] = result;
    })
  );
  return results;
}

export async function getWeeklyLog(repoNames, basePath) {
  const results = {};
  await Promise.all(
    repoNames.filter(safeRepoName).map(async (name) => {
      const dir = path.join(basePath, name);
      const out = await exec('git', ['-C', dir, 'log', '--since=7 days ago', '--format=%s (%cr)', '--no-merges']);
      if (out) {
        const lines = out.trim().split('\n').filter(l => l.trim());
        if (lines.length) results[name] = lines;
      }
    })
  );
  return results;
}

export function parseCommitLog(out) {
  return (out || '').split('\n').filter(Boolean).map((line) => {
    const [sha, at, subject] = line.split('\x1f');
    return { sha, at, subject: subject || '' };
  }).filter((c) => c.sha && c.at);
}

/**
 * Every commit across every ref, not just HEAD's ancestry: a commit sitting
 * on an unmerged branch or a linked worktree's branch is exactly the
 * stranded work the timeline exists to surface.
 */
export async function getCommitLog(repoNames, basePath, days) {
  const results = {};
  await Promise.all(repoNames.filter(safeRepoName).map(async (name) => {
    const dir = path.join(basePath, name);
    const out = await exec('git', ['-C', dir, 'log', '--all', '--no-merges', `--since=${days} days ago`, '--format=%h%x1f%cI%x1f%s'], { maxBuffer: 32 * 1024 * 1024 });
    const commits = parseCommitLog(out);
    if (commits.length) results[name] = commits;
  }));
  return results;
}

export async function getDiff(repoName, basePath) {
  if (!safeRepoName(repoName)) return '';
  const dir = path.join(basePath, repoName);
  return (await exec('git', ['-C', dir, 'diff', 'HEAD'])) || '';
}

/**
 * Every real checkout under the github root, sorted.
 *
 * The dashboard's repo list is hand-maintained, and a name that does not match
 * a directory produces a row that reports nothing forever rather than an error.
 * Offering the real names is what stops that from happening again.
 */
export async function listRepoDirs(basePath) {
  let entries;
  try {
    entries = await fs.readdir(basePath, { withFileTypes: true });
  } catch {
    return [];
  }
  const candidates = entries.filter((e) => e.isDirectory() && safeRepoName(e.name));
  const checked = await Promise.all(candidates.map(async (e) => {
    try {
      await fs.access(path.join(basePath, e.name, '.git'));
      return e.name;
    } catch {
      return null;
    }
  }));
  return checked.filter(Boolean).sort((a, b) => a.localeCompare(b));
}
