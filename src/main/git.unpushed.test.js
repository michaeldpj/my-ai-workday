// A commit only this Mac has is the one case that can lose data. A branch
// can also have one whose content is already in main, and it must not be
// reported.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scanOne, parseUnpushed } from './git.js';

const REPO = 'clone';
let base;
let dir;
let day = 0;
const iso = (d) => new Date(Date.UTC(2026, 0, 1) + d * 86400000).toISOString();

function git(cwd, ...args) {
  execFileSync('git', ['-C', cwd, ...args], {
    stdio: 'ignore',
    env: { ...process.env, GIT_AUTHOR_DATE: iso(day), GIT_COMMITTER_DATE: iso(day) },
  });
}

async function commit(cwd, file, msg) {
  day += 1;
  await writeFile(path.join(cwd, file), msg + '\n');
  git(cwd, 'add', file);
  git(cwd, 'commit', '-qm', msg);
}

const busy = () => path.join(dir, '.claude', 'worktrees', 'busy');

before(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'unpushed-'));
  const origin = path.join(base, 'origin.git');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { stdio: 'ignore' });
  dir = path.join(base, REPO);
  execFileSync('git', ['clone', '-q', origin, dir], { stdio: 'ignore' });
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'checkout', '-qb', 'main');
  await commit(dir, 'base.txt', 'base');
  git(dir, 'push', '-q', '-u', 'origin', 'main');
  git(dir, 'remote', 'set-head', 'origin', 'main');

  git(dir, 'checkout', '-qb', 'side');
  await commit(dir, 'side.txt', 'side');               // day 2: local-only, unique
  git(dir, 'checkout', '-q', 'main');

  git(dir, 'checkout', '-qb', 'landed');
  await commit(dir, 'land.txt', 'landed');             // day 3: local-only, content lands below
  git(dir, 'checkout', '-q', 'main');
  day += 1;
  git(dir, 'cherry-pick', 'landed');                   // day 4
  git(dir, 'push', '-q', 'origin', 'main');

  git(dir, 'worktree', 'add', '-q', '-b', 'busy', busy());
  await commit(busy(), 'busy.txt', 'busy');            // day 5: local-only, unique, live session
  git(dir, 'worktree', 'lock', '--reason', `claude session busy (pid ${process.pid} start Thu, 01 Jan 2026 00:00:00 GMT)`, busy());

  await commit(dir, 'local.txt', 'local');             // day 6: unpushed on main
});

after(async () => { if (base) await rm(base, { recursive: true, force: true }); });

test('counts local-only commits on HEAD, main and unique branches only', async () => {
  const r = await scanOne(REPO, base);
  assert.equal(r.unpushed, 2);
  assert.deepEqual(r.unpushedBranches, ['main', 'side']);
  assert.equal(Date.parse(r.since.unpushed), Date.parse(iso(2)));
});

test('a branch whose content already landed is neither unmerged nor unpushed', async () => {
  const r = await scanOne(REPO, base);
  assert.ok(!r.unmergedBranches.includes('landed'));
  assert.ok(!r.unpushedBranches.includes('landed'));
});

test('a live session\'s branch and worktree are left out of every count', async () => {
  const r = await scanOne(REPO, base);
  assert.deepEqual(r.unmergedBranches, ['side']);
  assert.deepEqual(r.worktrees.map((w) => [w.branch, w.inUse, w.dirty]), [['busy', true, false]]);
});

test('once the session\'s pid is dead, its branch counts again', async () => {
  git(dir, 'worktree', 'unlock', busy());
  git(dir, 'worktree', 'lock', '--reason', `claude session busy (pid ${spawnSync('true').pid} start Thu, 01 Jan 2026 00:00:00 GMT)`, busy());
  const r = await scanOne(REPO, base);
  assert.equal(r.unpushed, 3);
  assert.deepEqual(r.unpushedBranches, ['busy', 'main', 'side']);
  assert.deepEqual([...r.unmergedBranches].sort(), ['busy', 'side']);
});

test('parseUnpushed keeps only branches in the kept set and sorts dates', () => {
  const out = '2026-01-06T00:00:00Z\tmain\n2026-01-02T00:00:00Z\tside, other\n2026-01-01T00:00:00Z\t\n';
  assert.deepEqual(parseUnpushed(out, new Set(['main', 'side'])), {
    dates: ['2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z', '2026-01-06T00:00:00Z'],
    branches: ['main', 'side'],
  });
  assert.deepEqual(parseUnpushed(null, new Set()), { dates: [], branches: [] });
});
