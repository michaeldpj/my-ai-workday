// scripts/workspace-config.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readConfig, projectsFrom, repoRootFrom, DEFAULT_REPO_ROOT } from './workspace-config.mjs';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ideas.mjs');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wscfg-'));

const CONFIG = {
  githubPath: '~/code',
  workspace: { ws: [
    { id: 'twig', name: 'Twig', repos: [{ name: 'twig-web' }, { name: 'twig-api' }] },
    { id: 'hollow', name: 'Hollow', repos: [] },
    { name: 'no id, skipped' },
    null,
  ] },
};

test('projectsFrom lists cards with repo names and skips malformed entries', () => {
  assert.deepEqual(projectsFrom(CONFIG), [
    { id: 'twig', name: 'Twig', repos: ['twig-web', 'twig-api'] },
    { id: 'hollow', name: 'Hollow', repos: [] },
  ]);
  assert.deepEqual(projectsFrom({}), []);
  assert.deepEqual(projectsFrom(null), []);
  assert.deepEqual(projectsFrom({ workspace: { ws: [{ id: 'x', repos: [{ name: 3 }, {}] }] } }), [{ id: 'x', name: 'x', repos: [] }]);
});

test('repoRootFrom expands ~ and falls back to ~/github', () => {
  assert.equal(repoRootFrom(CONFIG, '/h'), '/h/code');
  assert.equal(repoRootFrom({ githubPath: '/abs/repos' }, '/h'), '/abs/repos');
  assert.equal(repoRootFrom({ githubPath: '  ' }, '/h'), '/h/github');
  assert.equal(repoRootFrom(null, '/h'), '/h/github');
  assert.equal(DEFAULT_REPO_ROOT, '~/github');
});

test('readConfig tells missing apart from corrupt', () => {
  const dir = tmp();
  assert.deepEqual(readConfig(path.join(dir, 'none.json')), { ok: false, missing: true });
  fs.writeFileSync(path.join(dir, 'bad.json'), '{not json');
  assert.match(readConfig(path.join(dir, 'bad.json')).error, /cannot parse/);
  fs.writeFileSync(path.join(dir, 'ok.json'), JSON.stringify(CONFIG));
  assert.equal(readConfig(path.join(dir, 'ok.json')).config.githubPath, '~/code');
  fs.rmSync(dir, { recursive: true, force: true });
});

function cli(args, store, home) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, MY_AI_WORKDAY_HOME: store, MY_DAY_HOME: '' },
  });
}

test('ideas projects and ideas root read the config beside the store', () => {
  const home = tmp();
  const store = path.join(home, 'store');
  fs.mkdirSync(store);
  fs.writeFileSync(path.join(store, 'my-day-config.json'), JSON.stringify(CONFIG));
  const list = cli(['projects'], store, home);
  assert.equal(list.status, 0);
  assert.match(list.stdout, /^twig\s+Twig\s+\(twig-web, twig-api\)$/m);
  assert.match(list.stdout, /^hollow\s+Hollow$/m);
  assert.deepEqual(JSON.parse(cli(['projects', '--json'], store, home).stdout)[0].repos, ['twig-web', 'twig-api']);
  assert.equal(cli(['root'], store, home).stdout.trim(), path.join(home, 'code'));
  fs.rmSync(home, { recursive: true, force: true });
});

test('without the app config, projects is empty with a note and root falls back', () => {
  const home = tmp();
  const store = path.join(home, 'store');
  const list = cli(['projects'], store, home);
  assert.equal(list.status, 0);
  assert.equal(list.stdout, '');
  assert.match(list.stderr, /my-day-config\.json does not exist/);
  const json = cli(['projects', '--json'], store, home);
  assert.equal(json.stdout.trim(), '[]');
  assert.match(json.stderr, /my-day-config\.json does not exist/);
  assert.equal(cli(['root'], store, home).stdout.trim(), path.join(home, 'github'));
  fs.rmSync(home, { recursive: true, force: true });
});

test('a corrupt app config fails both commands instead of reading as empty', () => {
  const home = tmp();
  const store = path.join(home, 'store');
  fs.mkdirSync(store);
  fs.writeFileSync(path.join(store, 'my-day-config.json'), '{oops');
  for (const cmd of ['projects', 'root']) {
    const r = cli([cmd], store, home);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /cannot parse/);
  }
  fs.rmSync(home, { recursive: true, force: true });
});
