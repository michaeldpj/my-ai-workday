import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEntries } from './timeline-model.js';
import {
  dayBuckets, countByProject, prWeeks, issueFlow, repoHealth, activitySummary, SUMMARY_KINDS,
} from './summary-model.js';

const now = new Date('2026-09-04T18:00:00').getTime(); // Friday, local time

const repoProject = { 'hollow-app': 'hollow', 'twig.example.com': 'twig' };
const rawInput = {
  since: '2026-08-01T00:00:00',
  commits: {
    'hollow-app': [
      { sha: 'a1', at: new Date(now).toISOString(), subject: 'today' },
      { sha: 'a2', at: new Date(now - DAY(1)).toISOString(), subject: 'yesterday' },
    ],
    'twig.example.com': [{ sha: 'b1', at: new Date(now - DAY(10)).toISOString(), subject: 'old' }],
  },
  sessions: [],
  prs: [
    { key: 'hollow-app#1', repo: 'hollow-app', number: 1, title: 'x', url: 'u', openedAt: new Date(now - DAY(2)).toISOString(), mergedAt: new Date(now).toISOString() },
    { key: 'hollow-app#2', repo: 'hollow-app', number: 2, title: 'y', url: 'u', openedAt: new Date(now).toISOString(), mergedAt: null },
  ],
  ideas: [],
};

function DAY(n) { return n * 86400000; }

test('dayBuckets zero-fills and uses local days, oldest first', () => {
  const entries = buildEntries({ ...rawInput, repoProject });
  const buckets = dayBuckets(entries, 5, now);
  assert.equal(buckets.length, 5);
  assert.equal(buckets[0].commit, 0);
  assert.equal(buckets[buckets.length - 1].commit, 1, 'today has one commit bucketed');
  assert.equal(buckets[buckets.length - 2].commit, 1, 'yesterday has one commit bucketed');
});

test('countByProject sorts descending, folding projectless to other', () => {
  const entries = buildEntries({ ...rawInput, repoProject });
  const rows = countByProject(entries, 'commit');
  assert.deepEqual(rows, [{ projectId: 'hollow', count: 2 }, { projectId: 'twig', count: 1 }]);
});

test('prWeeks zero-fills weeks across the range and separates opened from merged', () => {
  const weeks = prWeeks(rawInput.prs, 14, now);
  assert.ok(weeks.length >= 2);
  const totalOpened = weeks.reduce((s, w) => s + w.opened, 0);
  const totalMerged = weeks.reduce((s, w) => s + w.merged, 0);
  assert.equal(totalOpened, 2);
  assert.equal(totalMerged, 1);
  assert.deepEqual(weeks.map((w) => w.weekStart), [...weeks].sort((a, b) => a.weekStart.localeCompare(b.weekStart)).map((w) => w.weekStart));
});

test('issueFlow counts opened/closed/open by project, descending open count', () => {
  const issues = [
    { key: 'r1#1', repo: 'hollow-app', createdAt: '2026-09-01T00:00:00Z', closedAt: null, state: 'open' },
    { key: 'r1#2', repo: 'hollow-app', createdAt: '2026-08-01T00:00:00Z', closedAt: '2026-09-02T00:00:00Z', state: 'closed' },
    { key: 'r2#1', repo: 'twig.example.com', createdAt: '2026-09-01T00:00:00Z', closedAt: null, state: 'open' },
    { key: 'r2#2', repo: 'twig.example.com', createdAt: '2026-01-01T00:00:00Z', closedAt: null, state: 'open' },
  ];
  const rows = issueFlow(issues, repoProject, '2026-08-20T00:00:00Z');
  assert.deepEqual(rows, [
    { projectId: 'twig', opened: 1, closed: 0, open: 2 },
    { projectId: 'hollow', opened: 1, closed: 1, open: 1 },
  ]);
});

test('repoHealth skips parked repos and sorts oldest signal first, then name', () => {
  const ws = [
    {
      id: 'twig', repos: [
        { name: 'z-repo', status: 'active', since: { dirty: new Date(now - DAY(5)).toISOString(), unpushed: null, branches: {} }, unpushed: 0, uncommitted: 3, ignoreBranches: [] },
        { name: 'a-repo', status: 'active', since: { dirty: new Date(now - DAY(9)).toISOString(), unpushed: null, branches: {} }, unpushed: 1, uncommitted: 0, ignoreBranches: [] },
        { name: 'parked-repo', status: 'parked', since: { dirty: new Date(now - DAY(30)).toISOString(), branches: {} }, ignoreBranches: [] },
        { name: 'clean-repo', status: 'stable', since: null, ignoreBranches: [] },
      ],
    },
  ];
  const rows = repoHealth(ws, now);
  assert.deepEqual(rows.map((r) => r.repo), ['a-repo', 'z-repo', 'clean-repo']);
  assert.equal(rows[0].tier, 'hot');
  assert.equal(rows[2].tier, null);
});

test('activitySummary separates today from the trailing week and counts pr opened/merged by status', () => {
  const entries = buildEntries({ ...rawInput, repoProject });
  const summary = activitySummary(entries, now);
  assert.equal(summary.today.commit, 1);
  assert.equal(summary.today.pr, 1, 'the pr opened today');
  assert.equal(summary.today.prMerged, 1, 'the pr merged today');
  assert.equal(summary.week.commit, 2, 'today + yesterday, the 10-day-old commit is outside the week');
  assert.equal(summary.week.pr, 2, 'both prs opened within the week');
  assert.equal(summary.week.prMerged, 1);
  assert.deepEqual(summary.topRepos, [{ repo: 'hollow-app', count: 2 }]);
});

test('SUMMARY_KINDS', () => {
  assert.deepEqual(SUMMARY_KINDS, ['commit', 'session', 'pr', 'idea']);
});
