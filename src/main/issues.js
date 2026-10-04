import { execFile } from 'child_process';
import path from 'path';
import { safeRepoName, haveGh } from './git.js';
import { toolEnv } from './tool-path.js';
import { readRepoIssues, writeRepoIssues, mergeRows, projectSnapshot, DOC_VERSION } from './issues-store.js';

/**
 * Read-only GitHub issues through the local gh CLI, the same path the scanner
 * uses for PR state. Its own exec rather than git.js's: bodies and comments
 * for a repo's full issue history outrun both the 10s ceiling and the
 * default 1MB maxBuffer that helper guarantees for git commands.
 *
 * The first fetch for a repo pulls everything; every later fetch asks gh
 * only for issues updated since the last successful fetch (with a 60s
 * overlap for clock skew) and merges by number, so a failed fetch changes
 * nothing on disk.
 *
 * Pull requests come from `gh pr list` with the same cursor and land in the
 * same map: GitHub numbers issues and PRs from one sequence per repo, so a
 * PR row keyed by number can never collide with an issue row.
 */
const FIELDS = 'number,title,state,labels,createdAt,updatedAt,closedAt,url,author,body,comments';
const PR_FIELDS = FIELDS + ',mergedAt,headRefName,isDraft';
const FULL_LIMIT = '5000';
const DELTA_LIMIT = '500';
const OVERLAP_MS = 60_000;

function exec(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { env: toolEnv(), timeout: 180_000, maxBuffer: 256 * 1024 * 1024, ...opts }, (err, stdout) => {
      if (!err) return resolve({ out: stdout });
      if (err.code === 'ENOENT') return resolve({ error: 'ENOENT' });
      if (err.killed) return resolve({ error: 'timeout' });
      resolve({ error: 'exit' });
    });
  });
}

function deltaArgs(since) {
  if (!since) return ['--limit', FULL_LIMIT];
  const iso = new Date(Date.parse(since) - OVERLAP_MS).toISOString().replace(/\.\d{3}Z$/, 'Z');
  return ['--search', `updated:>=${iso}`, '--limit', DELTA_LIMIT];
}

const str = (v) => (typeof v === 'string' ? v : '');

function parseComment(c) {
  if (typeof c?.body !== 'string') return null;
  return { author: str(c.author?.login), createdAt: str(c.createdAt), body: c.body };
}

export function parseIssueRows(json, repo, type = 'issue') {
  let rows;
  try { rows = JSON.parse(json); } catch { return null; }
  if (!Array.isArray(rows)) return null;
  const out = [];
  for (const r of rows) {
    if (typeof r?.number !== 'number' || typeof r?.title !== 'string' || typeof r?.url !== 'string') continue;
    out.push({
      key: `${repo}#${r.number}`,
      repo,
      number: r.number,
      title: r.title,
      state: r.state === 'OPEN' ? 'open' : 'closed',
      labels: Array.isArray(r.labels) ? r.labels.map((l) => l?.name).filter((n) => typeof n === 'string') : [],
      createdAt: str(r.createdAt),
      updatedAt: str(r.updatedAt),
      closedAt: typeof r.closedAt === 'string' ? r.closedAt : null,
      url: r.url,
      author: str(r.author?.login),
      body: str(r.body),
      comments: Array.isArray(r.comments) ? r.comments.map(parseComment).filter(Boolean) : [],
      type,
      ...(type === 'pr' ? {
        mergedAt: typeof r.mergedAt === 'string' ? r.mergedAt : null,
        branch: str(r.headRefName),
        draft: r.isDraft === true,
      } : {}),
    });
  }
  return out;
}

export async function fetchRepoIssues(name, basePath, since, env) {
  if (!safeRepoName(name)) return { error: 'exit' };
  const opts = { cwd: path.join(basePath, name), ...(env ? { env } : {}) };
  const args = ['--state', 'all', ...deltaArgs(since)];
  const [issues, prs] = await Promise.all([
    exec('gh', ['issue', 'list', ...args, '--json', FIELDS], opts),
    exec('gh', ['pr', 'list', ...args, '--json', PR_FIELDS], opts),
  ]);
  // All or nothing: a full pull replaces the file, and half of one would drop
  // every row of the kind that failed. The next tick retries.
  const failed = issues.error ? issues : prs.error ? prs : null;
  if (failed) return { error: failed.error };
  const a = parseIssueRows(issues.out, name, 'issue');
  const b = parseIssueRows(prs.out, name, 'pr');
  return a && b ? { rows: [...a, ...b] } : { error: 'parse' };
}

// A repo mid-sync from the background loop plus a manual refresh click both
// read-merge-write the same file with no shared lock; without this, the
// second write can land on a doc read before the first finished and silently
// drop the rows it just merged. One in-flight promise per repo serializes
// them so a caller either starts the sync or waits for the one already running.
const inFlight = new Map();

// `fetch` exists for the tests: the decision between merge and replace, and
// the error return before the write, are worth pinning without spawning gh.
async function doSyncRepoIssues(name, basePath, fetch) {
  if (!safeRepoName(name)) return { ok: false, error: 'exit' };
  const doc = (await readRepoIssues(name)) || { repo: name, fetchedAt: null, issues: {} };
  const startedAt = new Date().toISOString();
  // No cursor, or a file from before the store held everything it holds now.
  let full = !doc.fetchedAt || doc.version !== DOC_VERSION;
  let res = await fetch(name, basePath, full ? null : doc.fetchedAt);
  // A delta that fills its limit may have left older updates behind, and the
  // cursor is about to move past them. A full pull is the only honest answer.
  if (!res.error && !full && res.rows.length >= Number(DELTA_LIMIT)) {
    full = true;
    res = await fetch(name, basePath, null);
  }
  if (res.error) return { ok: false, error: res.error };
  await writeRepoIssues(mergeRows(doc, res.rows, startedAt, { full }));
  return { ok: true, changed: res.rows.length };
}

export function syncRepoIssues(name, basePath, fetch = fetchRepoIssues) {
  const existing = inFlight.get(name);
  if (existing) return existing;
  const p = doSyncRepoIssues(name, basePath, fetch).finally(() => inFlight.delete(name));
  inFlight.set(name, p);
  return p;
}

export async function fetchProjectIssues(repoNames, basePath) {
  const names = repoNames.filter(safeRepoName);
  const errors = {};
  if (!(await haveGh())) {
    for (const n of names) errors[n] = 'ENOENT';
    return projectSnapshot(names, errors);
  }
  await Promise.all(names.map(async (n) => {
    const r = await syncRepoIssues(n, basePath);
    if (!r.ok) errors[n] = r.error;
  }));
  return projectSnapshot(names, errors);
}
