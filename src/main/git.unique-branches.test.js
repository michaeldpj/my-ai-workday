// A branch whose content already landed by squash or cherry-pick is finished,
// not unmerged. These fixtures are a squash-merged branch and its
// neighbours, scanned through the same entry point the dashboard uses.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scanBranches } from './git.js';

const REPO = 'repo';
let base;
let dir;
let day = 0;

// Every git call carries a pinned date one day after the last, so no
// assertion depends on wall-clock seconds.
function git(cwd, ...args) {
  const when = new Date(Date.UTC(2026, 0, 1) + day * 86400000).toISOString();
  execFileSync('git', ['-C', cwd, ...args], {
    stdio: 'ignore',
    env: { ...process.env, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when },
  });
}

async function commit(file, body, msg) {
  day += 1;
  await writeFile(path.join(dir, file), body);
  git(dir, 'add', file);
  git(dir, 'commit', '-qm', msg);
}

before(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'unique-branches-'));
  dir = path.join(base, REPO);
  execFileSync('git', ['init', '-q', '-b', 'main', dir], { stdio: 'ignore' });
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  await commit('a.txt', 'line one\nline two\n', 'first');

  // Two commits squash-merged into one: the case cherry misses.
  git(dir, 'checkout', '-qb', 'squashed');
  await commit('s1.txt', 'one\n', 's1');
  await commit('s2.txt', 'two\n', 's2');
  git(dir, 'checkout', '-q', 'main');
  git(dir, 'merge', '--squash', '-q', 'squashed');
  day += 1;
  git(dir, 'commit', '-qm', 'squash of squashed');

  // One commit cherry-picked onto main: a rebase merge.
  git(dir, 'checkout', '-qb', 'rebased');
  await commit('r.txt', 'rebased\n', 'r');
  git(dir, 'checkout', '-q', 'main');
  day += 1;
  git(dir, 'cherry-pick', 'rebased');

  // Squash-merged, then main edited the same line again: merge-tree
  // conflicts, so the branch counts as unique until gh says MERGED.
  git(dir, 'checkout', '-qb', 'edited-after');
  await commit('a.txt', 'line ONE\nline two\n', 'shout');
  git(dir, 'checkout', '-q', 'main');
  git(dir, 'merge', '--squash', '-q', 'edited-after');
  day += 1;
  git(dir, 'commit', '-qm', 'squash of edited-after');
  await commit('a.txt', 'line 1!\nline two\n', 'edit again');

  // Real unique work.
  git(dir, 'checkout', '-qb', 'stranded');
  await commit('c.txt', 'stranded\n', 'stranded work');
  git(dir, 'checkout', '-q', 'main');

  // A detached HEAD at an unmerged commit makes `git branch --no-merged`
  // print a pseudo-entry, the same way a rebase in progress does.
  git(dir, 'checkout', '-q', '--detach', 'stranded');
});

after(async () => { if (base) await rm(base, { recursive: true, force: true }); });

test('squash- and rebase-merged branches are not unmerged', async () => {
  const r = await scanBranches(REPO, base);
  assert.equal(r.defaultBranch, 'main');
  assert.ok(!r.unmergedBranches.includes('squashed'));
  assert.ok(!r.unmergedBranches.includes('rebased'));
});

test('a branch with content main lacks is unmerged', async () => {
  const r = await scanBranches(REPO, base);
  assert.ok(r.unmergedBranches.includes('stranded'));
});

test('a conflicting merge counts as unique', async () => {
  const r = await scanBranches(REPO, base);
  assert.ok(r.unmergedBranches.includes('edited-after'));
});

test('only refs/heads branches are listed, never a detached or rebase pseudo-entry', async () => {
  const r = await scanBranches(REPO, base);
  assert.deepEqual([...r.unmergedBranches].sort(), ['edited-after', 'stranded']);
});

test('unmergedSince carries a date for exactly the unique branches', async () => {
  const r = await scanBranches(REPO, base);
  assert.deepEqual(Object.keys(r.unmergedSince).sort(), ['edited-after', 'stranded']);
  assert.ok(Number.isFinite(Date.parse(r.unmergedSince.stranded)));
});

test('a skipped branch is left out', async () => {
  const r = await scanBranches(REPO, base, { skip: new Set(['stranded']) });
  assert.deepEqual(r.unmergedBranches, ['edited-after']);
});

test('branches past the cap count as unique without a merge check', async () => {
  const r = await scanBranches(REPO, base, { cap: 0 });
  assert.deepEqual([...r.unmergedBranches].sort(), ['edited-after', 'rebased', 'squashed', 'stranded']);
});

test('refuses an unsafe name', async () => {
  assert.equal(await scanBranches('..', base), null);
});
