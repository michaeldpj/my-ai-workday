// The scrub check guards a leak that cannot be taken back, so the cases that
// matter most are the ones where it must refuse to pass.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseDenylist, parsePrivatePaths, isPublic, findHits } from './scrub-check.mjs';

const SCRIPT = fileURLToPath(new URL('./scrub-check.mjs', import.meta.url));

test('a regex line keeps its flags and a bare line is a case-insensitive literal', () => {
  const { patterns } = parseDenylist('# comment\n\n/\\bZorb\\b/\nqux.example\n');
  assert.equal(patterns.length, 2);
  assert.ok(patterns[0].test('the Zorb box'));
  assert.ok(!patterns[0].test('the zorb box'));
  assert.ok(patterns[1].test('QUX.EXAMPLE'));
  assert.ok(!patterns[1].test('quxXexample'));
});

test('an empty denylist and a bad regex are errors, not a pass', () => {
  assert.throws(() => parseDenylist('# only a comment\n'), /no patterns/);
  assert.throws(() => parseDenylist('fine\n/(unclosed/\n'), /line 2/);
  assert.throws(() => parseDenylist('fine\n/zorb/X\n'), /line 2/);
  assert.throws(() => parseDenylist('/zorb\n'), /line 1/);
});

test('private paths match exactly or by directory prefix', () => {
  const priv = parsePrivatePaths('NOTES.md\nnotes/\n# a comment\n');
  assert.equal(isPublic('NOTES.md', priv), false);
  assert.equal(isPublic('notes/a.md', priv), false);
  assert.equal(isPublic('notes.md', priv), true);
  assert.equal(isPublic('src/NOTES.md', priv), true);
  assert.equal(isPublic('LICENSE', priv), true);
});

test('LICENSE skips only its copyright line', () => {
  const deny = parseDenylist('zorblax\n');
  assert.deepEqual(findHits('LICENSE', 'MIT License\n\nCopyright (c) 2026 Zorblax Q\n', deny), []);
  assert.deepEqual(findHits('LICENSE', 'Copyright (c) 2026 Q\nsee zorblax.example\n', deny).map((h) => h.line), [2]);
  assert.equal(findHits('README.md', 'Copyright (c) 2026 Zorblax Q\n', deny).length, 1);
  assert.equal(findHits('LICENSE', 'Copyright (c) 2026 Zorblax Q, https://zorblax.example\n', deny).length, 1);
});

test('hits carry file and line, the path is checked, and an allow line is narrow', () => {
  const deny = parseDenylist('zorblax\nallow build.yml com.zorblax.app\n');
  assert.deepEqual(findHits('a.js', 'x\n// zorblax here\n', deny).map((h) => h.line), [2]);
  assert.deepEqual(findHits('zorblax/a.js', 'clean', deny).map((h) => h.line), [0]);
  assert.deepEqual(findHits('build.yml', 'appId: com.zorblax.app\n', deny), []);
  assert.equal(findHits('build.yml', 'by zorblax\n', deny).length, 1);
  assert.equal(findHits('other.yml', 'appId: com.zorblax.app\n', deny).length, 1);
  assert.deepEqual(findHits('build.yml', 'appId: com.zorblax.app\n# com.zorblax.app\n', deny).map((h) => h.line), [2]);
});

test('a missing denylist exits 2 instead of passing', () => {
  const r = spawnSync(process.execPath, [SCRIPT], {
    env: { ...process.env, SCRUB_DENYLIST: '/nonexistent/scrub-denylist.txt' },
    encoding: 'utf8',
  });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /cannot use denylist/);
});

test('the index is scanned, so a staged leak or a file deleted on disk still fails', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scrub-'));
  const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: dir });
  git('init', '-q');
  fs.mkdirSync(path.join(dir, 'scripts'));
  fs.writeFileSync(path.join(dir, 'scripts/private-paths.txt'), '# none\n');
  fs.writeFileSync(path.join(dir, 'staged.txt'), 'zorblax\n');
  fs.writeFileSync(path.join(dir, 'gone.txt'), 'zorblax\n');
  git('add', '-A');
  fs.writeFileSync(path.join(dir, 'staged.txt'), 'clean\n');
  fs.rmSync(path.join(dir, 'gone.txt'));
  const deny = path.join(dir, '..', `${path.basename(dir)}-deny.txt`);
  fs.writeFileSync(deny, 'zorblax\n');
  const r = spawnSync(process.execPath, [SCRIPT], { cwd: dir, env: { ...process.env, SCRUB_DENYLIST: deny }, encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(deny, { force: true });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /staged\.txt:1/);
  assert.match(r.stdout, /gone\.txt:1/);
});
