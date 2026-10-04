import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveRepoStatus } from './repo-status.js';

const scan = (over = {}) => ({
  uncommitted: 0, unpushed: 0, unpushedBranches: [], defaultBranch: 'main',
  unmergedBranches: [], worktrees: [], ...over,
});
const wt = (over = {}) => ({ path: '/w', branch: 'b', inUse: false, dirty: true, unique: false, ...over });

test('nothing at all reads clean and stable', () => {
  assert.deepEqual(deriveRepoStatus(scan()), { status: 'stable', notes: 'clean' });
});

test('routine worktree dirt is a quiet note under stable', () => {
  const r = deriveRepoStatus(scan({ worktrees: [wt(), wt(), wt(), wt({ dirty: false })] }));
  assert.deepEqual(r, { status: 'stable', notes: '3 worktrees, nothing unique' });
  assert.equal(deriveRepoStatus(scan({ worktrees: [wt()] })).notes, '1 worktree, nothing unique');
});

test('a worktree in use counts for nothing', () => {
  const r = deriveRepoStatus(scan({ worktrees: [wt({ inUse: true, dirty: false })] }));
  assert.deepEqual(r, { status: 'stable', notes: 'clean' });
});

test('unique worktrees are needs-merge and say so', () => {
  const r = deriveRepoStatus(scan({ worktrees: [wt({ unique: true }), wt()] }));
  assert.deepEqual(r, { status: 'needs-merge', notes: '1 worktree with unique files' });
});

test('unique branches are needs-merge with open PRs counted', () => {
  const r = deriveRepoStatus(scan({ unmergedBranches: ['a', 'b'] }), { prs: { a: 'OPEN' } });
  assert.deepEqual(r, { status: 'needs-merge', notes: '2 branches with unique work (1 PR open)' });
});

test('a MERGED PR or an ignored branch still drops out', () => {
  const r = deriveRepoStatus(scan({ unmergedBranches: ['a', 'b'] }), { prs: { a: 'MERGED' }, ignore: ['b'] });
  assert.deepEqual(r, { status: 'stable', notes: 'clean' });
});

test('unpushed on the default branch only reads as before', () => {
  const r = deriveRepoStatus(scan({ unpushed: 2, unpushedBranches: ['main'] }));
  assert.deepEqual(r, { status: 'needs-push', notes: '2 to push' });
});

test('unpushed on another branch names it and outranks unique work', () => {
  const r = deriveRepoStatus(scan({ unpushed: 3, unpushedBranches: ['claude/x', 'main'], unmergedBranches: ['claude/x'] }));
  assert.deepEqual(r, { status: 'needs-push', notes: '3 to push (claude/x), 1 branch with unique work' });
});

test('uncommitted wins, active when the repo ships', () => {
  const s = scan({ uncommitted: 4, worktrees: [wt({ unique: true })] });
  assert.equal(deriveRepoStatus(s).status, 'needs-commit');
  assert.equal(deriveRepoStatus(s, { ship: true }).status, 'active');
  assert.equal(deriveRepoStatus(s).notes, '4 uncommitted, 1 worktree with unique files');
});
