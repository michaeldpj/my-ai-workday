// Hunt: .claude/hunt-bug/gh-not-found-in-installed-app/report.md
// A Finder-launched app inherits launchd's PATH (/usr/bin:/bin:/usr/sbin:/sbin),
// which has git but not Homebrew's gh. Every gh call then fails with ENOENT and
// the Issues view blames gh auth. The child environment handed to execFile has
// to carry the tool directories a shell would.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { toolEnv, withToolDirs } from './tool-path.js';

const LAUNCHD_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';

test('withToolDirs appends the Homebrew and local bin dirs a shell would have', () => {
  const p = withToolDirs(LAUNCHD_PATH).split(':');
  assert.ok(p.includes('/opt/homebrew/bin'));
  assert.ok(p.includes('/usr/local/bin'));
  assert.deepEqual(p.slice(0, 4), LAUNCHD_PATH.split(':'), 'system dirs keep priority');
});

test('withToolDirs is idempotent and tolerates an empty PATH', () => {
  const once = withToolDirs(LAUNCHD_PATH);
  assert.equal(withToolDirs(once), once);
  assert.ok(withToolDirs('').split(':').includes('/opt/homebrew/bin'));
  assert.ok(withToolDirs(undefined).split(':').includes('/opt/homebrew/bin'));
});

test('toolEnv leaves every other variable alone', () => {
  const env = toolEnv({ PATH: LAUNCHD_PATH, HOME: '/Users/x' });
  assert.equal(env.HOME, '/Users/x');
  assert.notEqual(env.PATH, LAUNCHD_PATH);
});

test('gh resolves from a launchd PATH once toolEnv is applied', { skip: !existsSync('/opt/homebrew/bin/gh') && 'gh not installed' }, async () => {
  const run = (env) => new Promise((resolve) => {
    execFile('gh', ['--version'], { env, timeout: 10000 }, (err) => resolve(err ? err.code : 'ok'));
  });
  assert.equal(await run({ PATH: LAUNCHD_PATH }), 'ENOENT', 'the bug: bare launchd PATH cannot see gh');
  assert.equal(await run(toolEnv({ PATH: LAUNCHD_PATH })), 'ok');
});
