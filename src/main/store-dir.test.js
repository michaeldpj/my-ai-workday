import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveStoreDir, resolveIssuesDir, resolveSyncEnv, envFirst,
  NEW_DIR, LEGACY_DIR, CONFIG_FILE,
} from '../../scripts/store-dir.mjs';

const run = promisify(execFile);
const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'ideas.mjs');

// Every case gets its own fake home. The real home directory is never read
// through the pure function and never written by any test here.
const homes = [];
async function home() {
  const dir = await mkdtemp(path.join(tmpdir(), 'store-dir-'));
  homes.push(dir);
  return dir;
}
after(async () => { for (const h of homes) await rm(h, { recursive: true, force: true }); });

// A child env with every MY_* name stripped, so a shell export on the
// machine running the tests cannot change the outcome.
function cleanEnv(extra) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^MY_(DAY|AI_WORKDAY)_/.test(k)) env[k] = v;
  return { ...env, ...extra };
}

test('a fresh home resolves to the new directory without creating it', async () => {
  const h = await home();
  assert.equal(resolveStoreDir({ env: {}, home: h }), path.join(h, NEW_DIR));
  assert.equal(existsSync(path.join(h, NEW_DIR)), false);
});

test('a populated legacy directory is used in place', async () => {
  const h = await home();
  await mkdir(path.join(h, LEGACY_DIR));
  await writeFile(path.join(h, LEGACY_DIR, 'ideas.json'), '{"rev":1,"ideas":[]}');
  assert.equal(resolveStoreDir({ env: {}, home: h }), path.join(h, LEGACY_DIR));
});

test('a populated legacy directory wins even when the new directory exists', async () => {
  const h = await home();
  await mkdir(path.join(h, LEGACY_DIR));
  await writeFile(path.join(h, LEGACY_DIR, CONFIG_FILE), '{}');
  await mkdir(path.join(h, NEW_DIR));
  assert.equal(resolveStoreDir({ env: {}, home: h }), path.join(h, LEGACY_DIR));
});

test('an empty legacy directory does not count', async () => {
  const h = await home();
  await mkdir(path.join(h, LEGACY_DIR));
  assert.equal(resolveStoreDir({ env: {}, home: h }), path.join(h, NEW_DIR));
});

test('an env override is used as given, with no existence check', async () => {
  const h = await home();
  await mkdir(path.join(h, LEGACY_DIR));
  const missing = path.join(h, 'elsewhere');
  assert.equal(resolveStoreDir({ env: { MY_DAY_HOME: missing }, home: h }), missing);
});

test('the new env name beats the legacy env name, and blank values are ignored', async () => {
  const h = await home();
  const env = { MY_AI_WORKDAY_HOME: '/new/home', MY_DAY_HOME: '/old/home' };
  assert.equal(resolveStoreDir({ env, home: h, isPopulated: () => false }), '/new/home');
  assert.equal(resolveStoreDir({ env: { MY_AI_WORKDAY_HOME: '  ', MY_DAY_HOME: '/old/home' }, home: h, isPopulated: () => false }), '/old/home');
  assert.equal(envFirst({ A: '', B: ' b ' }, ['A', 'B']), 'b');
  assert.equal(envFirst({}, ['A']), '');
});

test('the issues directory follows its own override, then the store', () => {
  assert.equal(resolveIssuesDir({ env: {}, storeDir: '/s' }), path.join('/s', 'issues'));
  assert.equal(resolveIssuesDir({ env: { MY_DAY_ISSUES_DIR: '/old' }, storeDir: '/s' }), '/old');
  assert.equal(resolveIssuesDir({ env: { MY_AI_WORKDAY_ISSUES_DIR: '/new', MY_DAY_ISSUES_DIR: '/old' }, storeDir: '/s' }), '/new');
});

test('sync env prefers new names and publish tokens', () => {
  assert.deepEqual(resolveSyncEnv({}), { url: '', token: '' });
  assert.deepEqual(resolveSyncEnv({ MY_DAY_URL: 'u', MY_DAY_TOKEN: 't' }), { url: 'u', token: 't' });
  assert.deepEqual(
    resolveSyncEnv({ MY_AI_WORKDAY_URL: 'nu', MY_DAY_URL: 'u', MY_DAY_PUBLISH_TOKEN: 'op', MY_AI_WORKDAY_TOKEN: 'nt' }),
    { url: 'nu', token: 'op' },
  );
  assert.equal(resolveSyncEnv({ MY_AI_WORKDAY_PUBLISH_TOKEN: 'np', MY_DAY_PUBLISH_TOKEN: 'op' }).token, 'np');
});

test('the CLI resolves through the same rule: populated legacy dir, then env override', async () => {
  const h = await home();
  await mkdir(path.join(h, LEGACY_DIR));
  await writeFile(path.join(h, LEGACY_DIR, 'ideas.json'), '{"rev":1,"ideas":[]}');
  const legacy = await run('node', [cli, 'home'], { env: cleanEnv({ HOME: h }) });
  assert.equal(legacy.stdout.trim(), path.join(h, LEGACY_DIR));
  const over = path.join(h, 'override');
  const forced = await run('node', [cli, 'home'], { env: cleanEnv({ HOME: h, MY_AI_WORKDAY_HOME: over }) });
  assert.equal(forced.stdout.trim(), over);
});

test('CONFIG_FILE is the electron-store file name', () => {
  assert.equal(CONFIG_FILE, 'my-day-config.json');
});
