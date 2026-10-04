import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { applySettings, expandHome, SETTING_KEYS } from './app-settings.js';

const CURRENT = { githubPath: '~/github', personalClaudeDir: '', dashboardUrl: '' };
const anyDir = () => true;
const noDir = () => false;

test('expandHome replaces a leading ~ only', () => {
  assert.equal(expandHome('~/github'), os.homedir() + '/github');
  assert.equal(expandHome('/abs/~x'), '/abs/~x');
});

test('applySettings accepts each key, trims, and strips trailing slashes', () => {
  const res = applySettings(CURRENT, { githubPath: ' ~/code/ ', personalClaudeDir: '~/.claude-p', dashboardUrl: 'https://example.com/x' }, anyDir);
  assert.deepEqual(res, { ok: true, next: { githubPath: '~/code', personalClaudeDir: '~/.claude-p', dashboardUrl: 'https://example.com/x' } });
});

test('applySettings allows clearing the optional values but not the repo folder', () => {
  const cleared = applySettings({ ...CURRENT, personalClaudeDir: '~/.p', dashboardUrl: 'https://a.b' }, { personalClaudeDir: '', dashboardUrl: '' }, anyDir);
  assert.deepEqual(cleared.next, CURRENT);
  assert.equal(applySettings(CURRENT, { githubPath: '' }, anyDir).ok, false);
});

test('applySettings refuses unsafe or missing folders', () => {
  assert.match(applySettings(CURRENT, { githubPath: '~/my code' }, anyDir).error, /Repo folder/);
  assert.match(applySettings(CURRENT, { githubPath: '~/nope' }, noDir).error, /Repo folder/);
  assert.match(applySettings(CURRENT, { personalClaudeDir: "~/it's" }, anyDir).error, /Personal Claude folder/);
});

test('applySettings refuses a dashboard link that is not https', () => {
  for (const url of ['http://a.b', 'javascript:alert(1)', 'https://', 'moss']) {
    assert.match(applySettings(CURRENT, { dashboardUrl: url }, anyDir).error, /Dashboard link/, url);
  }
});

test('applySettings refuses unknown keys and non-strings', () => {
  assert.equal(applySettings(CURRENT, { syncUrl: 'x' }, anyDir).ok, false);
  assert.equal(applySettings(CURRENT, { githubPath: 42 }, anyDir).ok, false);
  assert.equal(applySettings(CURRENT, null, anyDir).ok, true);
  assert.deepEqual(SETTING_KEYS, ['githubPath', 'personalClaudeDir', 'dashboardUrl']);
});
