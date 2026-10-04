import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEntries, localDate } from './timeline-model.js';
import {
  dayBuckets, countByProject, prWeeks, issueFlow, repoHealth, activitySummary, SUMMARY_KINDS, pipelineFlow, FLOW_STAGES,
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

// ---- pipelineFlow ----
const HR = 3600000;
const at = (msAgo) => new Date(now - msAgo).toISOString();
const h = (stage, msAgo, from = null) => ({ at: at(msAgo), from, to: stage });
const idea = (over) => ({ id: 'i', stage: 'inbox', createdAt: at(DAY(1)), history: [], ...over });
const dwellOf = (flow, stage) => flow.dwell.find((d) => d.stage === stage);

test('pipelineFlow buckets created, shipped and killed by week and zero-fills', () => {
  const ideas = [
    idea({ id: 'a', createdAt: at(DAY(1)), stage: 'shipped', history: [h('shipped', DAY(1))] }),
    idea({ id: 'b', createdAt: at(DAY(8)), stage: 'killed', history: [h('killed', DAY(8))] }),
    idea({ id: 'old', createdAt: at(DAY(30)), stage: 'shipped', history: [h('shipped', DAY(20))] }),
  ];
  const f = pipelineFlow(ideas, 14, now);
  assert.deepEqual(f.weeks.map((w) => w.weekStart), ['2026-08-17', '2026-08-24', '2026-08-31']);
  assert.deepEqual(f.weeks.map((w) => [w.created, w.shipped, w.killed]), [[0, 0, 0], [1, 0, 1], [1, 1, 0]]);
  assert.deepEqual(f.totals, { created: 2, shipped: 1, killed: 1 });
});

test('pipelineFlow counts every kill of a reopened idea', () => {
  const f = pipelineFlow([idea({ stage: 'killed', history: [h('killed', DAY(5)), h('inbox', DAY(4), 'killed'), h('killed', DAY(2), 'inbox')] })], 14, now);
  assert.equal(f.totals.killed, 2);
});

test('pipelineFlow dwell counts closed visits ending in range with full duration', () => {
  const ideas = [idea({ stage: 'shaped', history: [h('inbox', DAY(20)), h('shaped', DAY(3), 'inbox')] })];
  const f = pipelineFlow(ideas, 14, now);
  assert.equal(dwellOf(f, 'inbox').n, 1);
  assert.equal(dwellOf(f, 'inbox').median, DAY(17));
});

test('pipelineFlow ignores a visit that ended before the cutoff', () => {
  const ideas = [idea({ stage: 'shaped', history: [h('inbox', DAY(30)), h('shaped', DAY(20), 'inbox')] })];
  const f = pipelineFlow(ideas, 14, now);
  assert.equal(dwellOf(f, 'inbox').n, 0);
});

test('pipelineFlow open visit runs to now and counts in n and open', () => {
  const f = pipelineFlow([idea({ stage: 'queued', history: [h('queued', 5 * HR)] })], 14, now);
  const d = dwellOf(f, 'queued');
  assert.deepEqual([d.n, d.open, d.median, d.p90], [1, 1, 5 * HR, 5 * HR]);
});

test('pipelineFlow last entry is not open when the idea moved on without history', () => {
  const f = pipelineFlow([idea({ stage: 'built', history: [h('queued', 5 * HR)] })], 14, now);
  assert.equal(dwellOf(f, 'queued').n, 0);
});

test('pipelineFlow reset loop yields two visits per stage', () => {
  const ideas = [idea({ stage: 'building', history: [h('queued', 10 * HR), h('building', 8 * HR), h('queued', 6 * HR), h('building', 4 * HR)] })];
  const f = pipelineFlow(ideas, 14, now);
  assert.equal(dwellOf(f, 'queued').n, 2);
  assert.equal(dwellOf(f, 'building').n, 2);
  assert.equal(dwellOf(f, 'building').open, 1);
});

test('pipelineFlow dwell always lists the seven stages and never terminals', () => {
  const f = pipelineFlow([idea({ stage: 'shipped', history: [h('built', 3 * HR), h('shipped', HR)] })], 14, now);
  assert.deepEqual(f.dwell.map((d) => d.stage), FLOW_STAGES);
  assert.equal(pipelineFlow([], 14, now).dwell.length, 7);
});

test('pipelineFlow uses nearest rank for median and p90', () => {
  const ideas = [];
  for (let n = 1; n <= 10; n += 1) {
    ideas.push(idea({ id: `i${n}`, stage: 'shaped', history: [h('inbox', n * HR + HR), h('shaped', HR, 'inbox')] }));
  }
  const d = dwellOf(pipelineFlow(ideas, 14, now), 'inbox');
  assert.equal(d.n, 10);
  assert.equal(d.median, 5 * HR);
  assert.equal(d.p90, 9 * HR);
});

test('pipelineFlow empty stage has null statistics', () => {
  const d = dwellOf(pipelineFlow([], 14, now), 'planned');
  assert.deepEqual(d, { stage: 'planned', n: 0, open: 0, median: null, p90: null });
});

test('pipelineFlow bulkDays marks ten closes on one local day, not nine, not pre-cutoff', () => {
  const ten = Array.from({ length: 10 }, (_, i) => idea({ id: `t${i}`, stage: 'killed', history: [h('killed', DAY(2) + i * 1000)] }));
  const nine = Array.from({ length: 9 }, (_, i) => idea({ id: `n${i}`, stage: 'shipped', history: [h('shipped', DAY(5) + i * 1000)] }));
  const old = Array.from({ length: 12 }, (_, i) => idea({ id: `o${i}`, stage: 'shipped', history: [h('shipped', DAY(40) + i * 1000)] }));
  const f = pipelineFlow([...ten, ...nine, ...old], 14, now);
  assert.deepEqual(f.bulkDays, [{ date: localDate(new Date(now - DAY(2))), count: 10 }]);
});

test('pipelineFlow skips unparseable history stamps and handles empty input', () => {
  const f = pipelineFlow([idea({ stage: 'shaped', history: [h('inbox', DAY(3)), { at: 'garbage', from: 'inbox', to: 'planned' }, h('shaped', DAY(1), 'inbox')] })], 14, now);
  assert.equal(dwellOf(f, 'inbox').median, DAY(2));
  assert.equal(dwellOf(f, 'planned').n, 0);
  const e = pipelineFlow(undefined, 14, now);
  assert.deepEqual(e.totals, { created: 0, shipped: 0, killed: 0 });
  assert.equal(e.weeks.length, 3);
  assert.deepEqual(e.bulkDays, []);
  assert.ok(e.dwell.every((d) => d.median === null));
});
