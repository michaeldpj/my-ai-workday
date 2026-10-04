import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { parseIssueRows, fetchRepoIssues } from './issues.js';

const ghRow = {
  author: { login: 'example-user', name: 'Example User' },
  closedAt: '2026-09-03T20:50:43Z',
  comments: [{ author: { login: 'example-user' }, createdAt: '2026-09-03T21:00:00Z', body: '## Decisions\n- one' }],
  createdAt: '2026-09-03T20:50:42Z',
  labels: [{ name: 'bug', color: 'd73a4a' }, { name: 'session-log', color: '6f42c1' }],
  number: 19, state: 'CLOSED',
  title: 'Session: fix dead kill and reset dialogs (2026-09-03)',
  updatedAt: '2026-09-03T20:50:43Z',
  url: 'https://github.com/example-user/workspace-dashboard-app/issues/19',
  body: 'Summary body',
};

test('normalizes a gh issue row', () => {
  const [r] = parseIssueRows(JSON.stringify([ghRow]), 'workspace-dashboard-app');
  assert.deepEqual(r, {
    key: 'workspace-dashboard-app#19', repo: 'workspace-dashboard-app', number: 19,
    title: ghRow.title, state: 'closed', labels: ['bug', 'session-log'],
    createdAt: ghRow.createdAt, updatedAt: ghRow.updatedAt, closedAt: ghRow.closedAt,
    url: ghRow.url, author: 'example-user', body: 'Summary body', type: 'issue',
    comments: [{ author: 'example-user', createdAt: '2026-09-03T21:00:00Z', body: '## Decisions\n- one' }],
  });
});

test('normalizes a gh pr row', () => {
  const [r] = parseIssueRows(JSON.stringify([{
    number: 30, title: 'ci and ignored branches', state: 'MERGED', url: 'https://github.com/x/y/pull/30',
    createdAt: '2026-09-03T20:00:00Z', updatedAt: '2026-09-03T21:00:00Z', closedAt: '2026-09-03T21:00:00Z', mergedAt: '2026-09-03T21:00:00Z',
    headRefName: 'claude/ci-ignore-branches', isDraft: false, author: { login: 'example-user' }, labels: [], body: '', comments: [],
  }]), 'y', 'pr');
  assert.equal(r.type, 'pr');
  assert.equal(r.state, 'closed');
  assert.equal(r.mergedAt, '2026-09-03T21:00:00Z');
  assert.equal(r.branch, 'claude/ci-ignore-branches');
  assert.equal(r.draft, false);
  assert.equal(r.key, 'y#30');
});

test('issue rows carry type issue and no pr fields', () => {
  const [r] = parseIssueRows(JSON.stringify([{ number: 1, title: 't', url: 'u', state: 'OPEN' }]), 'x');
  assert.equal(r.type, 'issue');
  assert.equal('mergedAt' in r, false);
});

test('open state lowercases, missing optionals default', () => {
  const [r] = parseIssueRows(JSON.stringify([{ number: 1, title: 't', url: 'u', state: 'OPEN' }]), 'x');
  assert.equal(r.state, 'open');
  assert.equal(r.closedAt, null);
  assert.deepEqual(r.labels, []);
  assert.deepEqual(r.comments, []);
  assert.equal(r.body, '');
  assert.equal(r.author, '');
});

test('rows missing number, title, or url are dropped; comments without a body are dropped', () => {
  const rows = parseIssueRows(JSON.stringify([
    { number: 1, title: 't', url: 'u', state: 'OPEN', comments: [{ author: { login: 'a' } }, { body: 'ok' }] },
    { number: 'x', title: 't', url: 'u' },
    { number: 2, url: 'u' },
  ]), 'x');
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].comments, [{ author: '', createdAt: '', body: 'ok' }]);
});

test('unparseable or non-array input yields null', () => {
  assert.equal(parseIssueRows('nope', 'x'), null);
  assert.equal(parseIssueRows('{"a":1}', 'x'), null);
});

test('a missing gh reports ENOENT rather than null', async () => {
  const res = await fetchRepoIssues('x', tmpdir(), null, { PATH: '/nonexistent' });
  assert.deepEqual(res, { error: 'ENOENT' });
});
