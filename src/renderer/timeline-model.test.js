import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEntries, filterEntries, groupByWeek, weekStart, TIMELINE_RANGES, DEFAULT_RANGE } from './timeline-model.js';

const repoProject = { 'hollow-app': 'hollow', 'twig.example.com': 'twig' };
const input = {
  since: '2026-08-20T00:00:00Z',
  commits: { 'hollow-app': [{ sha: 'abc1234', at: '2026-09-02T10:00:00Z', subject: 'feat: x' }], 'orphan': [{ sha: 'def5678', at: '2026-09-01T10:00:00Z', subject: 'old' }] },
  sessions: [{ key: 'twig.example.com#41', repo: 'twig.example.com', number: 41, title: 'Session: y', at: '2026-09-03T09:00:00Z', url: 'https://github.com/x/y/issues/41' }],
  ideas: [
    { id: 'idea-1', title: 'Dark mode', projectId: 'twig', history: [{ at: '2026-08-01T00:00:00Z', from: null, to: 'inbox' }, { at: '2026-09-01T12:00:00Z', from: 'inbox', to: 'shaped' }] },
    { id: 'idea-2', title: 'No history', projectId: 'twig' },
  ],
};

test('builds entries from all three sources, newest first, dropping anything before since', () => {
  const e = buildEntries({ ...input, repoProject });
  assert.deepEqual(e.map((x) => x.kind), ['session', 'commit', 'idea', 'commit']);
  assert.equal(e[1].projectId, 'hollow');
  assert.equal(e[3].projectId, '', 'a repo outside every project has no project');
  assert.equal(e[2].title, 'Dark mode → shaped');
  assert.equal(e[2].id, 'idea-1');
  assert.equal(e[0].url, 'https://github.com/x/y/issues/41');
});

test('filters by project and kind', () => {
  const e = buildEntries({ ...input, repoProject });
  assert.equal(filterEntries(e, { projectId: 'twig', kinds: ['session', 'idea', 'commit'] }).length, 2);
  assert.equal(filterEntries(e, { projectId: '', kinds: ['commit'] }).length, 2);
  assert.equal(filterEntries(e, { projectId: '', kinds: [] }).length, 0);
});

test('weekStart is the local Monday', () => {
  // 2026-09-03 is a Thursday.
  assert.equal(weekStart('2026-09-03T12:00:00'), '2026-08-31');
  assert.equal(weekStart('2026-08-31T00:00:00'), '2026-08-31');
  assert.equal(weekStart('2026-08-30T12:00:00'), '2026-08-24');
});

test('groups into descending weeks and days with counts', () => {
  const e = buildEntries({ ...input, repoProject });
  const weeks = groupByWeek(e);
  assert.equal(weeks[0].weekStart, '2026-08-31');
  assert.deepEqual(weeks[0].counts, { commit: 2, session: 1, pr: 0, idea: 1 });
  assert.deepEqual(weeks[0].days.map((d) => d.date), ['2026-09-03', '2026-09-02', '2026-09-01']);
  assert.equal(weeks[0].days[2].entries.length, 2);
});

test('ranges', () => {
  assert.deepEqual(TIMELINE_RANGES, [14, 28, 56, 84]);
  assert.equal(DEFAULT_RANGE, 28);
});

test('a pull request contributes an opened event and then a merged or closed one', () => {
  const prs = [
    { key: 'hollow-app#7', repo: 'hollow-app', number: 7, title: 'ci', url: 'https://github.com/x/hollow-app/pull/7', openedAt: '2026-09-01T08:00:00Z', mergedAt: '2026-09-02T08:00:00Z' },
    { key: 'hollow-app#8', repo: 'hollow-app', number: 8, title: 'wip', url: 'https://github.com/x/hollow-app/pull/8', openedAt: '2026-09-02T09:00:00Z', mergedAt: null },
    { key: 'hollow-app#9', repo: 'hollow-app', number: 9, title: 'nope', url: 'https://github.com/x/hollow-app/pull/9', openedAt: '2026-09-01T10:00:00Z', closedAt: '2026-09-01T11:00:00Z', mergedAt: null },
  ];
  const e = buildEntries({ since: '2026-08-20T00:00:00Z', prs, repoProject });
  assert.deepEqual(e.map((x) => [x.kind, x.title]), [['pr', '#8 wip opened'], ['pr', '#7 ci merged'], ['pr', '#9 nope closed'], ['pr', '#9 nope opened'], ['pr', '#7 ci opened']]);
  assert.equal(e[0].projectId, 'hollow');
  assert.equal(e[0].url, prs[1].url);
  assert.notEqual(e[1].id, e[2].id);
  assert.equal(groupByWeek(e)[0].counts.pr, 5);
});
