// Claude sessions run in linked worktrees under <repo>/.claude/worktrees/,
// which the dashboard has never seen. `git worktree list --porcelain` from
// the main checkout enumerates them wherever they live.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseWorktreePorcelain, scanWorktrees } from './git.js';

const REPO = 'repo';
let base;

function git(dir, ...args) {
  execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' });
}

before(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'worktrees-'));
  const dir = path.join(base, REPO);
  execFileSync('git', ['init', '-q', '-b', 'main', dir], { stdio: 'ignore' });
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  await writeFile(path.join(dir, 'a.txt'), 'one\n');
  git(dir, 'add', 'a.txt');
  git(dir, 'commit', '-qm', 'first');
  git(dir, 'worktree', 'add', '-q', '-b', 'wt-branch', path.join(dir, '.claude', 'worktrees', 'wt1'));
  await writeFile(path.join(dir, '.claude', 'worktrees', 'wt1', 'a.txt'), 'dirty\n');
});

after(async () => { if (base) await rm(base, { recursive: true, force: true }); });

test('parses porcelain blocks', () => {
  const out = 'worktree /main\nHEAD abc\nbranch refs/heads/main\n\n'
    + 'worktree /wt\nHEAD def\ndetached\nlocked claude session wt (pid 42 start Thu, 01 Jan 2026 00:00:00 GMT)\n\n'
    + 'worktree /gone\nHEAD 123\nbranch refs/heads/old\nlocked\nprunable gitdir file points to non-existent location\n';
  assert.deepEqual(parseWorktreePorcelain(out), [
    { path: '/main', branch: 'main', detached: false, locked: null, prunable: false },
    { path: '/wt', branch: null, detached: true, locked: 'claude session wt (pid 42 start Thu, 01 Jan 2026 00:00:00 GMT)', prunable: false },
    { path: '/gone', branch: 'old', detached: false, locked: '', prunable: true },
  ]);
});

test('lists the linked worktree with its dirty state', async () => {
  const wts = await scanWorktrees(REPO, base);
  assert.equal(wts.length, 1);
  assert.equal(wts[0].branch, 'wt-branch');
  assert.equal(wts[0].dirty, true);
});
