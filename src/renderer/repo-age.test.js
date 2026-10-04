import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ageTier, oldestSignal, isStale, dropMergedBranches, liveBranches, projectSignal, STALE_DAYS } from './repo-age.js';

const DAY = 86400000;
const now = Date.parse('2026-09-10T12:00:00Z');
const ago = (d) => new Date(now - d * DAY).toISOString();

test('tiers escalate at one, three, and seven days', () => {
  assert.equal(ageTier(ago(0.5), now), '');
  assert.equal(ageTier(ago(1), now), 'warm');
  assert.equal(ageTier(ago(3), now), 'warn');
  assert.equal(ageTier(ago(7), now), 'hot');
  assert.equal(ageTier(null, now), '');
});

test('oldest signal picks the earliest date across kinds', () => {
  const s = { dirty: ago(2), unpushed: ago(5), branches: { 'claude/x': ago(9), 'claude/y': ago(1) } };
  assert.deepEqual(oldestSignal(s), { kind: 'branch', at: ago(9), branch: 'claude/x' });
  assert.deepEqual(oldestSignal({ dirty: ago(2), unpushed: null, branches: {} }), { kind: 'dirty', at: ago(2) });
  assert.equal(oldestSignal({ dirty: null, unpushed: null, branches: {} }), null);
  assert.equal(oldestSignal(undefined), null);
});

test('stale means the oldest signal is at least STALE_DAYS old', () => {
  assert.equal(STALE_DAYS, 3);
  assert.equal(isStale({ since: { dirty: ago(2.9) } }, now), false);
  assert.equal(isStale({ since: { dirty: ago(3) } }, now), true);
  assert.equal(isStale({ since: {} }, now), false);
  assert.equal(isStale({ since: { dirty: ago(30) }, status: 'parked' }, now), false, 'parked repos are silenced');
  assert.equal(isStale({ since: { dirty: ago(30) }, status: 'blocked' }, now), true, 'blocked work still ages');
});

test('a squash-merged branch stops aging', () => {
  const since = { dirty: null, unpushed: null, branches: { 'claude/a': ago(9), 'claude/b': ago(2) } };
  assert.deepEqual(dropMergedBranches(since, { 'claude/a': 'MERGED', 'claude/b': 'OPEN' }).branches, { 'claude/b': ago(2) });
  assert.deepEqual(dropMergedBranches(since).branches, since.branches);
  assert.equal(dropMergedBranches(null), null);
});

test('ignored branches are dropped from the live list and from since', () => {
  const prs = { 'claude/a': 'MERGED' };
  assert.deepEqual(liveBranches(['claude/a', 'claude/b', 'gh-pages'], prs, ['gh-pages']), ['claude/b']);
  const since = { dirty: null, unpushed: null, branches: { 'claude/b': ago(2), 'gh-pages': ago(400) } };
  assert.deepEqual(dropMergedBranches(since, prs, ['gh-pages']).branches, { 'claude/b': ago(2) });
});

test('projectSignal is the oldest signal across unparked repos', () => {
  const repos = [
    { name: 'a', status: 'needs-commit', since: { dirty: ago(2), unpushed: null, branches: {} } },
    { name: 'b', status: 'parked', since: { dirty: ago(30), unpushed: null, branches: {} } },
    { name: 'c', status: 'needs-push', since: { dirty: null, unpushed: ago(9), branches: {} } },
  ];
  assert.equal(projectSignal(repos).kind, 'unpushed');
  assert.equal(projectSignal(repos).repo, 'c');
  assert.equal(projectSignal([]), null);
  assert.equal(projectSignal([repos[1]]), null);
});
