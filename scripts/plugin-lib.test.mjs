// scripts/plugin-lib.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PLUGIN_LIB, SRC, DEST } from './sync-plugin-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('plugin/lib matches scripts/ byte for byte', () => {
  for (const f of PLUGIN_LIB) {
    assert.ok(fs.readFileSync(path.join(SRC, f)).equals(fs.readFileSync(path.join(DEST, f))),
      `plugin/lib/${f} differs from scripts/${f}. Run: npm run plugin:lib`);
  }
});

test('plugin/lib holds only the synced modules', () => {
  assert.deepEqual(fs.readdirSync(DEST).sort(), [...PLUGIN_LIB].sort());
});

test('every relative import in plugin/lib stays inside plugin/lib', () => {
  for (const f of PLUGIN_LIB) {
    const text = fs.readFileSync(path.join(DEST, f), 'utf8');
    for (const [, spec] of text.matchAll(/from\s+'(\.[^']+)'/g)) {
      assert.ok(PLUGIN_LIB.includes(spec.replace(/^\.\//, '')), `${f} imports ${spec}, which plugin/lib does not carry`);
    }
  }
});

test('plugin/bin/ideas is executable in git', () => {
  const entry = execFileSync('git', ['ls-files', '-s', 'plugin/bin/ideas'], { cwd: ROOT, encoding: 'utf8' });
  assert.match(entry, /^100755 /);
});

test('the plugin runs from a copy outside the repo, the way the plugin cache holds it', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-cache-'));
  const plugin = path.join(home, 'cache', 'idea-pipeline');
  fs.cpSync(path.join(ROOT, 'plugin'), plugin, { recursive: true });
  const store = path.join(home, 'store');
  const env = {
    ...process.env, HOME: home, MY_AI_WORKDAY_HOME: store, MY_DAY_HOME: '',
    GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid',
    GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid',
  };
  const ideas = (...args) => {
    const r = spawnSync('/bin/sh', [path.join(plugin, 'bin', 'ideas'), ...args], { encoding: 'utf8', env });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  };
  ideas('init');
  fs.writeFileSync(path.join(store, 'my-day-config.json'), JSON.stringify({
    githubPath: '~/code', workspace: { ws: [{ id: 'twig', name: 'Twig', repos: [{ name: 'twig-web' }] }] },
  }));
  const id = ideas('add', '--title=Sample capture', '--project=twig').trim().split('\n').pop();
  assert.match(id, /^idea-[a-z0-9]+-[a-z0-9]+$/);
  assert.ok(JSON.parse(ideas('list', '--json')).some((i) => i.id === id && i.title === 'Sample capture'));
  assert.match(ideas('projects'), /^twig\s+Twig\s+\(twig-web\)$/m);
  assert.equal(ideas('root').trim(), path.join(home, 'code'));
  assert.equal(ideas('home').trim(), store);
  fs.rmSync(home, { recursive: true, force: true });
});
