// syncRepoIssues decides between merging a delta and replacing the file with
// a full pull, and must never write after a failed fetch. Exercised through a
// fake fetch against a temp store dir, so no gh is spawned.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

delete process.env.MY_AI_WORKDAY_ISSUES_DIR;
process.env.MY_DAY_ISSUES_DIR = await mkdtemp(path.join(tmpdir(), 'issues-sync-'));
const { syncRepoIssues } = await import('./issues.js');
const { readRepoIssues } = await import('./issues-store.js');

after(async () => { await rm(process.env.MY_DAY_ISSUES_DIR, { recursive: true, force: true }); });

const row = (n) => ({ key: `r#${n}`, repo: 'r', number: n, title: 't' + n, state: 'open', labels: [], createdAt: '', updatedAt: '', closedAt: null, url: 'u' + n, author: '', body: '', comments: [] });
const rows = (...ns) => ns.map(row);

/** A fetch that answers from a script and records what it was asked for. */
function fake(answers) {
  const calls = [];
  const fetch = async (_name, _base, since) => { calls.push(since); return answers.shift(); };
  return { fetch, calls };
}

test('first pull asks with no cursor and writes the file', async () => {
  const { fetch, calls } = fake([{ rows: rows(1, 2) }]);
  assert.deepEqual(await syncRepoIssues('r', '/nowhere', fetch), { ok: true, changed: 2 });
  assert.deepEqual(calls, [null]);
  const doc = await readRepoIssues('r');
  assert.deepEqual(Object.keys(doc.issues), ['1', '2']);
  assert.ok(doc.fetchedAt);
});

test('a delta asks since the last fetch and merges', async () => {
  const before = await readRepoIssues('r');
  const { fetch, calls } = fake([{ rows: rows(3) }]);
  await syncRepoIssues('r', '/nowhere', fetch);
  assert.deepEqual(calls, [before.fetchedAt]);
  assert.deepEqual(Object.keys((await readRepoIssues('r')).issues), ['1', '2', '3']);
});

test('a delta that fills its limit falls back to a full pull that replaces', async () => {
  const filled = { rows: Array.from({ length: 500 }, (_, i) => row(100 + i)) };
  const { fetch, calls } = fake([filled, { rows: rows(2, 3) }]);
  await syncRepoIssues('r', '/nowhere', fetch);
  assert.equal(calls.length, 2);
  assert.equal(calls[1], null, 'the fallback is a full pull');
  assert.deepEqual(Object.keys((await readRepoIssues('r')).issues), ['2', '3'], 'issue 1 is gone from GitHub, so it is gone here');
});

test('a failed fetch, on either path, leaves the file untouched', async () => {
  const before = await readRepoIssues('r');
  const filled = { rows: Array.from({ length: 500 }, (_, i) => row(100 + i)) };
  assert.deepEqual(await syncRepoIssues('r', '/nowhere', fake([{ error: 'timeout' }]).fetch), { ok: false, error: 'timeout' });
  assert.deepEqual(await syncRepoIssues('r', '/nowhere', fake([filled, { error: 'exit' }]).fetch), { ok: false, error: 'exit' });
  assert.deepEqual(await readRepoIssues('r'), before);
});

test('a file from an older store version is pulled in full once', async () => {
  const { writeRepoIssues } = await import('./issues-store.js');
  await writeRepoIssues({ repo: 'old', fetchedAt: '2026-09-01T00:00:00Z', issues: { 9: row(9) } });
  const { fetch, calls } = fake([{ rows: rows(1) }]);
  await syncRepoIssues('old', '/nowhere', fetch);
  assert.deepEqual(calls, [null]);
  const doc = await readRepoIssues('old');
  assert.deepEqual(Object.keys(doc.issues), ['1'], 'replaced, not merged');
  assert.equal(doc.version, 2);
  const again = fake([{ rows: rows(2) }]);
  await syncRepoIssues('old', '/nowhere', again.fetch);
  assert.deepEqual(again.calls, [doc.fetchedAt]);
});

test('a failed first pull writes nothing', async () => {
  assert.deepEqual(await syncRepoIssues('fresh', '/nowhere', fake([{ error: 'ENOENT' }]).fetch), { ok: false, error: 'ENOENT' });
  assert.equal(await readRepoIssues('fresh'), null);
});
