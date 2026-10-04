import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ISSUE_KINDS, ISSUE_STATES, ISSUE_SORTS, DEFAULT_ISSUE_PREFS,
  classifyIssue, filterIssues, issueComparator, journalGroups, isUnread,
} from './issue-model.js';

test('a pull request is its own kind, after journal and before idea', () => {
  const pr = { type: 'pr', labels: [], url: 'https://github.com/x/y/pull/1' };
  assert.equal(classifyIssue(pr, () => true), 'pr');
  assert.equal(classifyIssue({ ...pr, labels: ['session-log'] }, () => false), 'journal');
  assert.equal(classifyIssue({ labels: [], url: 'u' }, () => true), 'idea');
  assert.ok(ISSUE_KINDS.includes('pr'));
});

const row = (o) => ({
  key: `${o.repo || 'r'}#${o.number}`, repo: o.repo || 'r', number: o.number, title: o.title || `t${o.number}`,
  state: o.state || 'open', labels: o.labels || [], createdAt: o.createdAt || '2026-09-01T00:00:00Z',
  updatedAt: o.updatedAt || '2026-09-02T00:00:00Z', closedAt: o.closedAt || null,
  url: o.url || `https://github.com/x/${o.repo || 'r'}/issues/${o.number}`, author: 'm', body: '',
  comments: o.comments || [], kind: o.kind || 'other',
});

test('enums and defaults', () => {
  assert.deepEqual(ISSUE_KINDS, ['all', 'issue', 'journal', 'idea', 'pr', 'other']);
  assert.deepEqual(ISSUE_STATES, ['open', 'closed', 'all']);
  assert.deepEqual(ISSUE_SORTS, ['updated', 'created', 'comments', 'number']);
  assert.deepEqual(DEFAULT_ISSUE_PREFS, { projectId: '', kind: 'all', state: 'open', sort: 'updated' });
});

test('classify: session-log is journal, idea url match is idea, else other', () => {
  const byUrl = (u) => (u.endsWith('/7') ? { id: 'idea-1' } : null);
  assert.equal(classifyIssue(row({ number: 1, labels: ['bug', 'session-log'] }), byUrl), 'journal');
  assert.equal(classifyIssue(row({ number: 7 }), byUrl), 'idea');
  assert.equal(classifyIssue(row({ number: 7, labels: ['session-log'] }), byUrl), 'journal');
  assert.equal(classifyIssue(row({ number: 2 }), byUrl), 'other');
  assert.equal(classifyIssue(row({ number: 2 }), null), 'other');
});

test('filter by kind, state, repo, label, and title query', () => {
  const rows = [
    row({ number: 1, kind: 'journal', state: 'closed', repo: 'a', labels: ['bug'] }),
    row({ number: 2, kind: 'other', state: 'open', repo: 'b', labels: ['enhancement'], title: 'Dark mode' }),
    row({ number: 3, kind: 'idea', state: 'open', repo: 'a', labels: [], title: 'dark theme' }),
    row({ number: 4, kind: 'pr', state: 'open', repo: 'b', labels: [], title: 'Dark mode PR' }),
  ];
  const nums = (f) => filterIssues(rows, { kind: 'all', state: 'all', repo: '', label: '', query: '', ...f }).map((r) => r.number);
  assert.deepEqual(nums({}), [1, 2, 3, 4]);
  assert.deepEqual(nums({ kind: 'issue' }), [1, 2, 3], 'issue is every kind but pr');
  assert.deepEqual(nums({ kind: 'issue', state: 'open' }), [2, 3], 'the rollup count: open and not a PR');
  assert.deepEqual(nums({ kind: 'journal' }), [1]);
  assert.deepEqual(nums({ kind: 'journal', state: 'open' }), [1], 'journal ignores state');
  assert.deepEqual(nums({ state: 'open' }), [2, 3, 4]);
  assert.deepEqual(nums({ repo: 'a' }), [1, 3]);
  assert.deepEqual(nums({ label: 'bug' }), [1]);
  assert.deepEqual(nums({ query: 'DARK' }), [2, 3, 4]);
  assert.deepEqual(nums({ query: '#3' }), [3]);
});

test('sort: updated and created newest first, comments most first, number highest first', () => {
  const rows = [
    row({ number: 1, updatedAt: '2026-09-01T00:00:00Z', createdAt: '2026-09-03T00:00:00Z', comments: [{}, {}] }),
    row({ number: 2, updatedAt: '2026-09-03T00:00:00Z', createdAt: '2026-09-01T00:00:00Z', comments: [] }),
    row({ number: 3, updatedAt: '2026-09-02T00:00:00Z', createdAt: '2026-09-02T00:00:00Z', comments: [{}] }),
  ];
  const order = (s) => [...rows].sort(issueComparator(s)).map((r) => r.number);
  assert.deepEqual(order('updated'), [2, 3, 1]);
  assert.deepEqual(order('created'), [1, 3, 2]);
  assert.deepEqual(order('comments'), [1, 3, 2]);
  assert.deepEqual(order('number'), [3, 2, 1]);
});

test('sort ties break on number descending so the order is stable', () => {
  const rows = [row({ number: 1, comments: [] }), row({ number: 2, comments: [] })];
  assert.deepEqual([...rows].sort(issueComparator('comments')).map((r) => r.number), [2, 1]);
});

test('journal groups by closed date, newest date first, newest row first inside a date', () => {
  const rows = [
    row({ number: 1, closedAt: '2026-09-01T10:00:00Z' }),
    row({ number: 2, closedAt: '2026-09-03T09:00:00Z' }),
    row({ number: 3, closedAt: '2026-09-03T11:00:00Z' }),
    row({ number: 4, closedAt: null, createdAt: '2026-09-02T00:00:00Z' }),
  ];
  assert.deepEqual(journalGroups(rows).map((g) => [g.date, g.rows.map((r) => r.number)]), [
    ['2026-09-03', [3, 2]], ['2026-09-02', [4]], ['2026-09-01', [1]],
  ]);
});

test('unread when never opened or updated since last open', () => {
  const r = row({ number: 1, updatedAt: '2026-09-02T00:00:00Z' });
  assert.equal(isUnread(r, {}), true);
  assert.equal(isUnread(r, undefined), true);
  assert.equal(isUnread(r, { 'r#1': '2026-09-01T00:00:00Z' }), true);
  assert.equal(isUnread(r, { 'r#1': '2026-09-02T00:00:00Z' }), false);
});
