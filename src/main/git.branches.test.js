// A pushed-but-unmerged branch is the "did I merge that session?" case the
// dashboard exists to catch. The fixture is a clone (so origin/HEAD exists)
// with one branch merged into main and one not.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scanBranches } from './git.js';

const REPO = 'clone';
let base;

function git(dir, ...args) {
  execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' });
}

before(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'branches-'));
  const origin = path.join(base, 'origin');
  execFileSync('git', ['init', '-q', '-b', 'main', origin], { stdio: 'ignore' });
  git(origin, 'config', 'user.email', 'test@example.com');
  git(origin, 'config', 'user.name', 'Test');
  await writeFile(path.join(origin, 'a.txt'), 'one\n');
  git(origin, 'add', 'a.txt');
  git(origin, 'commit', '-qm', 'first');
  const dir = path.join(base, REPO);
  execFileSync('git', ['clone', '-q', origin, dir], { stdio: 'ignore' });
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  // merged branch: commit, merge back to main
  git(dir, 'checkout', '-qb', 'feature-merged');
  await writeFile(path.join(dir, 'b.txt'), 'two\n');
  git(dir, 'add', 'b.txt');
  git(dir, 'commit', '-qm', 'merged work');
  git(dir, 'checkout', '-q', 'main');
  git(dir, 'merge', '-q', '--no-edit', 'feature-merged');
  // unmerged branch: commit, leave it
  git(dir, 'checkout', '-qb', 'claude/session-xyz');
  await writeFile(path.join(dir, 'c.txt'), 'three\n');
  git(dir, 'add', 'c.txt');
  git(dir, 'commit', '-qm', 'stranded work');
  git(dir, 'checkout', '-q', 'main');
});

after(async () => { if (base) await rm(base, { recursive: true, force: true }); });

test('finds the unmerged branch and only it', async () => {
  const r = await scanBranches(REPO, base);
  assert.equal(r.defaultBranch, 'main');
  assert.deepEqual(r.unmergedBranches, ['claude/session-xyz']);
});

test('refuses an unsafe name', async () => {
  assert.equal(await scanBranches('..', base), null);
});

test('reports when each unmerged branch was last committed to', async () => {
  const r = await scanBranches(REPO, base);
  assert.ok(Number.isFinite(Date.parse(r.unmergedSince['claude/session-xyz'])));
  assert.deepEqual(Object.keys(r.unmergedSince), ['claude/session-xyz']);
});
