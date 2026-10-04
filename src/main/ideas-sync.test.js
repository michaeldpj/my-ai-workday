import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// The store folder is resolved once at import, so the env must be set before
// the dynamic import below. A static import would be hoisted above this line.
const dir = await mkdtemp(path.join(tmpdir(), 'ideas-sync-'));
delete process.env.MY_DAY_HOME;
process.env.MY_AI_WORKDAY_HOME = dir;
const { publish } = await import('../../scripts/ideas-sync.mjs');

after(async () => { await rm(dir, { recursive: true, force: true }); });

let calls;
beforeEach(() => {
  calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, method: options?.method });
    return { ok: true, json: async () => ({ rev: 1, pendingCaptures: 0 }) };
  };
});

const cfg = { url: 'http://sync.invalid', token: 't' };

test('publish refuses, without calling the server, when ideas.json is missing', async () => {
  const out = await publish(cfg);
  assert.equal(out.ok, false);
  assert.match(out.error, /no ideas\.json at .*refusing to publish an empty projection/);
  assert.equal(calls.length, 0);
});

test('publish sends one PUT once ideas.json exists', async () => {
  await writeFile(path.join(dir, 'ideas.json'), JSON.stringify({ rev: 3, ideas: [] }));
  const out = await publish(cfg);
  assert.equal(out.ok, true);
  assert.deepEqual(calls, [{ url: 'http://sync.invalid/api/ideas', method: 'PUT' }]);
});
