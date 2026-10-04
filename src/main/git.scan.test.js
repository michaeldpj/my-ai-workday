// Regression test for hunt .claude/hunt-bug/repo-names-with-spaces-skipped
//
// Exercises the real boundary: a genuine git checkout whose directory name
// contains a space, scanned through the same entry point the dashboard uses.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scanOne, getCommitLog } from './git.js';

const REPO = 'Spaced Name Repo';
let base;

before(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'huntbug-'));
  const dir = path.join(base, REPO);
  await mkdir(dir);
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' });
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  await writeFile(path.join(dir, 'a.txt'), 'one\n');
  git('add', 'a.txt');
  git('commit', '-qm', 'first');
  await writeFile(path.join(dir, 'a.txt'), 'two\n');   // leaves one uncommitted change
});

after(async () => { if (base) await rm(base, { recursive: true, force: true }); });

test('scans a checkout whose directory name contains a space', async () => {
  const result = await scanOne(REPO, base);
  assert.notEqual(result, null, 'a space in the directory name must not skip the scan');
  assert.equal(result.uncommitted, 1, 'the scan should see the one modified file');
});

test('scan result carries branch and worktree fields', async () => {
  const result = await scanOne(REPO, base);
  assert.deepEqual(result.unmergedBranches, []);
  assert.deepEqual(result.worktrees, []);
  assert.ok('defaultBranch' in result);
});

test('scan result carries since dates', async () => {
  const result = await scanOne(REPO, base);
  const t = Date.parse(result.since.dirty);
  assert.ok(Number.isFinite(t) && t <= Date.now(), 'dirty since is the modified file mtime');
  assert.ok(Number.isFinite(Date.parse(result.since.unpushed)), 'unpushed since is the oldest unpushed commit date');
  assert.deepEqual(result.since.branches, {});
});

test('commit log carries sha, date, and subject per repo', async () => {
  const log = await getCommitLog([REPO, 'nope'], base, 7);
  assert.equal(log[REPO].length, 1);
  assert.equal(log[REPO][0].subject, 'first');
  assert.ok(Number.isFinite(Date.parse(log[REPO][0].at)));
  assert.match(log[REPO][0].sha, /^[0-9a-f]{7,}$/);
  assert.equal('nope' in log, false);
});
