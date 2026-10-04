import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

delete process.env.MY_AI_WORKDAY_ISSUES_DIR;
process.env.MY_DAY_ISSUES_DIR = await mkdtemp(path.join(tmpdir(), 'issues-'));
const { mergeRows, readRepoIssues, writeRepoIssues, projectSnapshot, sessionRows, prRows, issueRows, openCounts, pruneIssueFiles, ensureIssuesDir } = await import('./issues-store.js');

const row = (n, o = {}) => ({ key: `r#${n}`, repo: 'r', number: n, title: 't' + n, state: 'open', labels: [], createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z', closedAt: null, url: 'u' + n, author: '', body: '', comments: [], ...o });

after(async () => { await rm(process.env.MY_DAY_ISSUES_DIR, { recursive: true, force: true }); });

test('mergeRows upserts by number and stamps fetchedAt', () => {
  const doc = mergeRows(null, [row(1), row(2)], '2026-09-02T00:00:00Z');
  assert.equal(Object.keys(doc.issues).length, 2);
  const next = mergeRows(doc, [row(2, { title: 'changed' }), row(3)], '2026-09-03T00:00:00Z');
  assert.equal(next.issues[2].title, 'changed');
  assert.equal(next.issues[1].title, 't1');
  assert.equal(Object.keys(next.issues).length, 3);
  assert.equal(next.fetchedAt, '2026-09-03T00:00:00Z');
  assert.equal(doc.issues[2].title, 't2', 'merge returns a new doc');
});

test('a full pull replaces the set, so a deleted issue drops out', () => {
  const doc = mergeRows(null, [row(1), row(2)], '2026-09-02T00:00:00Z');
  const next = mergeRows(doc, [row(2)], '2026-09-03T00:00:00Z', { full: true });
  assert.deepEqual(Object.keys(next.issues), ['2']);
  assert.equal(next.repo, 'r');
});

test('round trip through the store dir writes a nested gitignore', async () => {
  await ensureIssuesDir();
  assert.equal(await readFile(path.join(process.env.MY_DAY_ISSUES_DIR, '.gitignore'), 'utf8'), '*\n');
  await writeRepoIssues({ repo: 'r', fetchedAt: '2026-09-02T00:00:00Z', issues: { 1: row(1, { labels: ['session-log'], closedAt: '2026-09-02T01:00:00Z' }) } });
  const doc = await readRepoIssues('r');
  assert.equal(doc.issues[1].title, 't1');
  assert.equal(await readRepoIssues('missing'), null);
});

test('projectSnapshot and sessionRows read across repos', async () => {
  const snap = await projectSnapshot(['r', 'missing'], { missing: 'exit' });
  assert.equal(snap.fetchedAt, null, 'a repo with no file makes the snapshot incomplete');
  assert.equal(snap.repos.r.length, 1);
  assert.equal(snap.repos.missing, null);
  assert.deepEqual(snap.errors, { missing: 'exit' });
  assert.deepEqual(await sessionRows(['r', 'missing']), [{ key: 'r#1', repo: 'r', number: 1, title: 't1', at: '2026-09-02T01:00:00Z', url: 'u1' }]);
});

test('prRows reads pull requests off the files, issues excluded', async () => {
  await writeRepoIssues({ repo: 'p', fetchedAt: '2026-09-02T00:00:00Z', issues: {
    1: row(1),
    2: row(2, { type: 'pr', state: 'closed', mergedAt: '2026-09-02T02:00:00Z', branch: 'b', draft: false, url: 'https://github.com/x/p/pull/2' }),
  } });
  assert.deepEqual(await prRows(['p', 'missing']), [{ key: 'r#2', repo: 'r', number: 2, title: 't2', url: 'https://github.com/x/p/pull/2', openedAt: '2026-09-01T00:00:00Z', closedAt: null, mergedAt: '2026-09-02T02:00:00Z' }]);
});

test('issueRows returns plain issues, skipping PRs and session records', async () => {
  await writeRepoIssues({ repo: 'q', fetchedAt: '2026-09-02T00:00:00Z', issues: {
    1: row(1),
    2: row(2, { type: 'pr', state: 'closed', mergedAt: '2026-09-02T02:00:00Z', branch: 'b', draft: false }),
    3: row(3, { labels: ['session-log'], closedAt: '2026-09-02T01:00:00Z' }),
  } });
  assert.deepEqual(await issueRows(['q', 'missing']), [{ key: 'r#1', repo: 'r', number: 1, title: 't1', state: 'open', createdAt: '2026-09-01T00:00:00Z', closedAt: null, url: 'u1' }]);
});

test('openCounts counts open issues and open PRs per repo', async () => {
  await writeRepoIssues({ repo: 'c', fetchedAt: '2026-09-02T00:00:00Z', issues: {
    1: row(1), 2: row(2, { state: 'closed' }), 3: row(3, { type: 'pr' }), 4: row(4, { type: 'pr', state: 'closed', mergedAt: '2026-09-02T00:00:00Z' }),
  } });
  assert.deepEqual(await openCounts(['c', 'missing']), { c: { issues: 1, prs: 1 } });
});

test('pruneIssueFiles removes files for repos no longer in the workspace', async () => {
  await writeRepoIssues({ repo: 'gone', fetchedAt: '2026-09-02T00:00:00Z', issues: {} });
  await writeRepoIssues({ repo: 'kept', fetchedAt: '2026-09-02T00:00:00Z', issues: {} });
  const removed = await pruneIssueFiles(['kept', 'r', 'p', 'c', 'q']);
  assert.deepEqual(removed, ['gone']);
  assert.equal(await readRepoIssues('gone'), null);
  assert.ok(await readRepoIssues('kept'));
  assert.equal(await readFile(path.join(process.env.MY_DAY_ISSUES_DIR, '.gitignore'), 'utf8'), '*\n');
});
