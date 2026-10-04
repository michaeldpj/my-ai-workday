/**
 * Fixture snapshots for the Ideas board preview harness. Dev-only, never shipped.
 *
 * Each value is a {rev, ideas:[...]} snapshot shaped exactly like the projection
 * ideas-ui.js adopts. waitingOn follows the stage's natural owner: a stage whose
 * next move is a human is 'you', a running session is 'claude', terminal stages
 * are '-'. That keeps the "Your move only" filter and the your-move styling
 * behaving the way they do against real data.
 */

const hoursAgo = (h) => new Date(Date.now() - h * 3600000).toISOString();

const brief = '## Problem\nThe thing is slow.\n\n## Approach\nMeasure, then cut the hot path.';
const verdict = '## Verdict\nProceed. Scope is one file, risk is low.';

const idea = (o) => ({
  id: o.id,
  title: o.title,
  stage: o.stage,
  waitingOn: o.waitingOn ?? (o.stage === 'building' ? 'claude'
    : ['shipped', 'killed'].includes(o.stage) ? '-' : 'you'),
  impact: o.impact ?? null,
  effort: o.effort ?? null,
  planEffort: o.planEffort ?? null,
  brief: o.brief ?? (['shaped', 'planned', 'reviewed'].includes(o.stage) ? brief : ''),
  planPath: o.planPath ?? (['planned', 'reviewed'].includes(o.stage) ? 'docs/plans/2026-08-22-x.md' : ''),
  reviewVerdict: o.reviewVerdict ?? (o.stage === 'reviewed' ? verdict : ''),
  projectId: o.projectId ?? null,
  repos: o.repos ?? [],
  github: o.github ?? null,
  notes: o.notes ?? '',
  killedReason: o.killedReason ?? '',
  cameBack: o.cameBack ?? false,
  createdAt: o.createdAt ?? '2026-08-20T10:00:00Z',
  // `buildingHoursAgo` drives the building card's age label and whether its
  // Reset button reads as a suggestion or an accusation. Written as a history
  // entry rather than a bare timestamp because that is where the real store
  // keeps it.
  updatedAt: o.updatedAt ?? hoursAgo(o.buildingHoursAgo ?? 1),
  history: o.history ?? (o.stage === 'building'
    ? [{ at: hoursAgo(o.buildingHoursAgo ?? 1), from: 'queued', to: 'building' }]
    : []),
});

const full = [
  idea({ id: 'i1', title: 'Batch capture from the share sheet', stage: 'inbox', impact: 4, effort: 'medium', projectId: 'mobile' }),
  idea({ id: 'i2', title: 'Dark map tiles at night', stage: 'inbox', impact: 2, effort: 'low', projectId: 'maps' }),
  idea({ id: 'i3', title: 'Collapse the parity table by default', stage: 'shaped', impact: 3, planEffort: 'low', projectId: 'dashboard' }),
  idea({ id: 'i4', title: 'Weekly digest email', stage: 'planned', impact: 4, planEffort: 'medium', projectId: 'api' }),
  idea({ id: 'i5', title: 'Rename the sync token setting', stage: 'reviewed', impact: 2, planEffort: 'low', projectId: 'dashboard' }),
  idea({ id: 'i6', title: 'Idea search across the board', stage: 'queued', impact: 5, planEffort: 'high', projectId: 'dashboard' }),
  idea({ id: 'i7', title: 'Offline outbox retry backoff', stage: 'building', impact: 4, planEffort: 'medium', projectId: 'mobile' }),
  idea({ id: 'i8', title: 'Show last commit on repo rows', stage: 'built', impact: 3, planEffort: 'low', projectId: 'dashboard', github: { number: 42, url: 'https://example.com/42' } }),
  idea({ id: 'i9', title: 'Migrate to MySQL 9', stage: 'shipped', impact: 5, planEffort: 'high', projectId: 'api' }),
];

const emptyInbox = full.filter((i) => i.stage !== 'inbox');

// Nothing waiting on you: everything is running, shipped, or killed.
const reward = [
  idea({ id: 'r1', title: 'Offline outbox retry backoff', stage: 'building', impact: 4, planEffort: 'medium', projectId: 'mobile' }),
  idea({ id: 'r2', title: 'Idea search across the board', stage: 'building', impact: 5, planEffort: 'high', projectId: 'dashboard' }),
  idea({ id: 'r3', title: 'Migrate to MySQL 9', stage: 'shipped', impact: 5, projectId: 'api' }),
  idea({ id: 'r4', title: 'Old maps rewrite', stage: 'killed', impact: 2, killedReason: 'Superseded by the vector tile work.', projectId: 'maps' }),
];

const building = [
  idea({ id: 'b1', title: 'Offline outbox retry backoff', stage: 'building', impact: 4, planEffort: 'medium', projectId: 'mobile', buildingHoursAgo: 0.4 }),
  idea({ id: 'b2', title: 'Idea search across the board', stage: 'building', impact: 5, planEffort: 'high', projectId: 'dashboard', buildingHoursAgo: 9 }),
  idea({ id: 'b3', title: 'Batch capture from the share sheet', stage: 'inbox', impact: 4, effort: 'medium', projectId: 'mobile' }),
];

// Ten at reviewed: the cap is doing its job.
const cap = Array.from({ length: 10 }, (_, n) => idea({
  id: `c${n}`,
  title: [
    'Rename the sync token setting', 'Collapse the parity table', 'Dark map tiles at night',
    'Idea impact tap on phone', 'Repo name space handling', 'Terminal action allowlist',
    'Weekly digest layout', 'Parity validator toast', 'Drag ghost polish', 'Keyboard triage keys',
  ][n],
  stage: 'reviewed',
  impact: (n % 5) + 1,
  planEffort: ['low', 'medium', 'high'][n % 3],
  projectId: ['dashboard', 'mobile', 'api'][n % 3],
}));

const daysAgo = (d) => hoursAgo(d * 24);
const builtAt = (d) => ({
  history: [{ at: daysAgo(d + 0.1), from: 'queued', to: 'building' }, { at: daysAgo(d), from: 'building', to: 'built' }],
  updatedAt: daysAgo(d),
});
const built = [
  idea({ id: 'd1', title: 'Show last commit on repo rows', stage: 'built', impact: 3, planEffort: 'low', projectId: 'dashboard', github: { number: 42, url: 'https://example.com/42' }, ...builtAt(0.3) }),
  idea({ id: 'd2', title: 'Sync indicator on the header', stage: 'built', impact: 4, planEffort: 'medium', projectId: 'dashboard', github: { number: 39, url: 'https://example.com/39' }, ...builtAt(4) }),
  idea({ id: 'd4', title: 'Tray badge for stale repos', stage: 'built', impact: 2, planEffort: 'low', projectId: 'dashboard', github: { number: 37, url: 'https://example.com/37' }, ...builtAt(8) }),
  idea({ id: 'd3', title: 'Drag to reorder cards', stage: 'shipped', impact: 5, projectId: 'dashboard' }),
];

const killed = [
  idea({ id: 'k1', title: 'Old maps rewrite', stage: 'killed', impact: 2, killedReason: 'Superseded by the vector tile work.', projectId: 'maps' }),
  idea({ id: 'k2', title: 'Custom electron titlebar', stage: 'killed', impact: 1, killedReason: 'Not worth the platform quirks.', projectId: 'dashboard' }),
  idea({ id: 'k3', title: 'Weekly digest email', stage: 'queued', impact: 4, planEffort: 'medium', projectId: 'api' }),
];

// A batch where two came back and one went forward, all one project.
const batchPartial = [
  idea({ id: 't1', title: 'Idea search: indexer', stage: 'building', impact: 5, planEffort: 'high', projectId: 'dashboard' }),
  idea({ id: 't2', title: 'Idea search: query parser', stage: 'queued', impact: 5, planEffort: 'medium', projectId: 'dashboard', cameBack: true, notes: 'Session died mid-run, back in the queue.' }),
  idea({ id: 't3', title: 'Idea search: result UI', stage: 'queued', impact: 4, planEffort: 'medium', projectId: 'dashboard', cameBack: true, notes: 'Blocked on the parser, reset.' }),
];

// Everything landed: the reward screen with nothing actually running behind it.
const allDone = [
  idea({ id: 'd1', title: 'Migrate to MySQL 9', stage: 'shipped', impact: 5, projectId: 'api' }),
  idea({ id: 'd2', title: 'Show last commit on repo rows', stage: 'shipped', impact: 3, projectId: 'dashboard' }),
  idea({ id: 'd3', title: 'Old maps rewrite', stage: 'killed', impact: 2, killedReason: 'Superseded by the vector tile work.', projectId: 'maps' }),
];

export const FIXTURES = {
  full: { rev: 1, ideas: full },
  'empty-inbox': { rev: 1, ideas: emptyInbox },
  reward: { rev: 1, ideas: reward },
  'all-done': { rev: 1, ideas: allDone },
  building: { rev: 1, ideas: building },
  cap: { rev: 1, ideas: cap },
  built: { rev: 1, ideas: built },
  killed: { rev: 1, ideas: killed },
  'batch-partial': { rev: 1, ideas: batchPartial },
};

export const PROJECTS = [
  { id: 'dashboard', name: 'Dashboard' },
  { id: 'mobile', name: 'Mobile' },
  { id: 'api', name: 'API' },
  { id: 'maps', name: 'Maps' },
];
