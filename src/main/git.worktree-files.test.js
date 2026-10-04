// Most dirty worktrees in a busy repo hold copies, edits main already had,
// or drafts main later revised. Each worktree below
// is one of those cases, or one that must still be reported.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir, utimes, appendFile, unlink } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  scanWorktrees, lockPid, pidAlive, parseStatusZ, parseRawHistory, isUniqueEdit,
} from './git.js';

const REPO = 'repo';
const DAY = 86400000;
const T0 = Date.UTC(2026, 0, 1);
const iso = (d) => new Date(T0 + d * DAY).toISOString();
let base;
let dir;
// Outside the repo on purpose: main commits below use `git add .`, which
// would stage a worktree inside the checkout as an embedded repository.
const wt = (name) => path.join(base, 'wts', name);

function git(cwd, d, ...args) {
  execFileSync('git', ['-C', cwd, ...args], {
    stdio: 'ignore',
    env: { ...process.env, GIT_AUTHOR_DATE: iso(d), GIT_COMMITTER_DATE: iso(d) },
  });
}

/** Write a file and stamp its mtime, so age comparisons never race the clock. */
async function put(file, body, d) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, body);
  const t = new Date(T0 + d * DAY);
  await utimes(file, t, t);
}

const NAMES = [
  'clean', 'current', 'superseded', 'older-draft', 'copy', 'newer-edit', 'new-file',
  'delete-present', 'delete-gone', 'bracket', 'artifact', 'nested', 'overflow',
  'live', 'dead', 'bare-lock', 'pruned', 'broken',
];

before(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'worktree-files-'));
  dir = path.join(base, REPO);
  execFileSync('git', ['init', '-q', '-b', 'main', dir], { stdio: 'ignore' });
  git(dir, 0, 'config', 'user.email', 'test@example.com');
  git(dir, 0, 'config', 'user.name', 'Test');
  await put(path.join(dir, 'doc.md'), 'draft one\n', 0);
  await put(path.join(dir, 'keep.md'), 'same\n', 0);
  await put(path.join(dir, 'old.md'), 'old\n', 0);
  await put(path.join(dir, 'a[1].md'), 'bracket one\n', 0);
  git(dir, 0, 'add', '.');
  git(dir, 0, 'commit', '-qm', 'day 0');
  for (const n of NAMES) git(dir, 0, 'worktree', 'add', '-q', '-b', 'wt-' + n, wt(n));

  // Day 1: main revises doc.md, deletes old.md, commits the final plan.
  await put(path.join(dir, 'doc.md'), 'draft two\n', 1);
  await put(path.join(dir, 'plan.md'), 'final plan\n', 1);
  git(dir, 1, 'rm', '-q', 'old.md');
  git(dir, 1, 'add', '.');
  git(dir, 1, 'commit', '-qm', 'day 1');
  // Day 2: main revises doc.md again and the bracket file.
  await put(path.join(dir, 'doc.md'), 'draft three\n', 2);
  await put(path.join(dir, 'a[1].md'), 'bracket two\n', 2);
  git(dir, 2, 'add', '.');
  git(dir, 2, 'commit', '-qm', 'day 2');

  await appendFile(path.join(dir, '.git', 'info', 'exclude'), '.codex/\n');

  await put(path.join(wt('current'), 'doc.md'), 'draft three\n', 9);
  await put(path.join(wt('superseded'), 'doc.md'), 'draft two\n', 9);
  await put(path.join(wt('older-draft'), 'plan.md'), 'rough plan\n', 0.5);
  await put(path.join(wt('copy'), 'plan.md'), 'final plan\n', 9);
  await put(path.join(wt('newer-edit'), 'plan.md'), 'better plan\n', 9);
  await put(path.join(wt('new-file'), 'fresh.md'), 'new\n', 9);
  await unlink(path.join(wt('delete-present'), 'keep.md'));
  await unlink(path.join(wt('delete-gone'), 'old.md'));
  await put(path.join(wt('bracket'), 'a[1].md'), 'bracket two\n', 9);
  await put(path.join(wt('artifact'), '.codex', 'state.md'), 'tool\n', 9);
  execFileSync('git', ['init', '-q', path.join(wt('nested'), 'vendor')], { stdio: 'ignore' });
  await put(path.join(wt('nested'), 'vendor', 'x.md'), 'x\n', 9);
  for (let i = 0; i <= 200; i++) await put(path.join(wt('overflow'), 'bulk', 'f' + i + '.md'), 'x\n', 9);

  const deadPid = spawnSync('true').pid;
  for (const n of ['live', 'dead', 'bare-lock']) await put(path.join(wt(n), 'fresh.md'), 'new\n', 9);
  git(dir, 0, 'worktree', 'lock', '--reason', `claude session live (pid ${process.pid} start Thu, 01 Jan 2026 00:00:00 GMT)`, wt('live'));
  git(dir, 0, 'worktree', 'lock', '--reason', `claude session dead (pid ${deadPid} start Thu, 01 Jan 2026 00:00:00 GMT)`, wt('dead'));
  git(dir, 0, 'worktree', 'lock', wt('bare-lock'));
  await rm(wt('pruned'), { recursive: true, force: true });
  // The directory is still there, so git does not call it prunable, but its
  // own `git status` fails.
  await writeFile(path.join(wt('broken'), '.git'), 'gitdir: /nonexistent\n');
});

after(async () => { if (base) await rm(base, { recursive: true, force: true }); });

async function rows() {
  const list = await scanWorktrees(REPO, base);
  return Object.fromEntries(list.map((r) => [r.branch.replace(/^wt-/, ''), r]));
}

const noise = (r) => r.dirty === true && r.unique === false;

test('a clean worktree is neither dirty nor unique', async () => {
  const r = (await rows()).clean;
  assert.equal(r.dirty, false);
  assert.equal(r.unique, false);
});

test('an edit main already contains is noise', async () => {
  assert.ok(noise((await rows()).current));
});

test('a draft main committed and later revised is noise', async () => {
  assert.ok(noise((await rows()).superseded));
});

test('an uncommitted draft older than main\'s latest change to the path is noise', async () => {
  assert.ok(noise((await rows())['older-draft']));
});

test('a byte-identical untracked copy is noise', async () => {
  assert.ok(noise((await rows()).copy));
});

test('an edit newer than main\'s version that matches no committed version is unique', async () => {
  assert.equal((await rows())['newer-edit'].unique, true);
});

test('a file main has never had is unique', async () => {
  assert.equal((await rows())['new-file'].unique, true);
});

test('deleting a file main still has is unique, deleting one main removed is noise', async () => {
  const all = await rows();
  assert.equal(all['delete-present'].unique, true);
  assert.ok(noise(all['delete-gone']));
});

test('a path with glob characters is matched literally', async () => {
  assert.ok(noise((await rows()).bracket));
});

test('an excluded tool artifact does not make a worktree dirty', async () => {
  assert.equal((await rows()).artifact.dirty, false);
});

test('a nested repository and an overflow past the cap count as unique', async () => {
  const all = await rows();
  assert.equal(all.nested.unique, true);
  assert.equal(all.overflow.unique, true);
});

test('a worktree whose git status fails reads dirty and unique', async () => {
  const r = (await rows()).broken;
  assert.deepEqual([r.dirty, r.unique], [true, true]);
});

test('a worktree locked by a live pid is in use and reports nothing', async () => {
  const r = (await rows()).live;
  assert.deepEqual([r.inUse, r.dirty, r.unique], [true, false, false]);
});

test('a lock with a dead pid or no pid is evaluated normally', async () => {
  const all = await rows();
  assert.deepEqual([all.dead.inUse, all.dead.unique], [false, true]);
  assert.deepEqual([all['bare-lock'].inUse, all['bare-lock'].unique], [false, true]);
});

test('a prunable worktree is not listed', async () => {
  assert.equal('pruned' in (await rows()), false);
});

test('lockPid reads the pid from a Claude Code lock reason', () => {
  assert.equal(lockPid('claude session x (pid 54672 start Wed, 30 Sep 2026 16:58:32 GMT)'), 54672);
  assert.equal(lockPid(''), null);
  assert.equal(lockPid(null), null);
});

test('pidAlive never probes a process group and reads EPERM as alive', () => {
  assert.equal(pidAlive(process.pid), true);
  assert.equal(pidAlive(0), false);
  assert.equal(pidAlive(-1), false);
  assert.equal(pidAlive(null), false);
  assert.equal(pidAlive(1), true); // launchd, owned by root: EPERM
});

test('parseStatusZ splits changes, deletions, renames and nested repos', () => {
  const out = ' M a.md\0?? b c.md\0 D gone.md\0R  new.md\0old.md\0?? vendor/\0';
  assert.deepEqual(parseStatusZ(out), {
    changed: ['a.md', 'b c.md', 'new.md'], deleted: ['gone.md'], opaque: ['vendor/'],
  });
});

test('parseRawHistory keeps every blob and the newest date and presence per path', () => {
  const out = '\x002026-01-03T00:00:00Z\n\n'
    + ':100644 000000 bbbb 0000 D\told.md\n'
    + ':100644 100644 aaaa cccc M\tdoc.md\n'
    + '\x002026-01-01T00:00:00Z\n\n'
    + ':000000 100644 0000 aaaa A\tdoc.md\n'
    + ':000000 100644 0000 bbbb A\told.md\n';
  const h = parseRawHistory(out);
  assert.deepEqual([...h.get('doc.md').blobs].sort(), ['aaaa', 'cccc']);
  assert.equal(h.get('doc.md').latest, '2026-01-03T00:00:00Z');
  assert.equal(h.get('doc.md').present, true);
  assert.equal(h.get('old.md').present, false);
});

test('isUniqueEdit: absent path, blob match, older mtime, newer mtime', () => {
  const entry = { blobs: new Set(['aaaa']), latest: iso(2), present: true };
  assert.equal(isUniqueEdit(undefined, 'aaaa', T0), true);
  assert.equal(isUniqueEdit(entry, 'aaaa', T0 + 9 * DAY), false);
  assert.equal(isUniqueEdit(entry, 'ffff', T0 + 1 * DAY), false);
  assert.equal(isUniqueEdit(entry, 'ffff', T0 + 9 * DAY), true);
  assert.equal(isUniqueEdit(entry, 'ffff', null), true);
});
