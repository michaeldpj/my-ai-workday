/** Fixture snapshots for the Summary preview harness. Dev-only, never shipped. */
import { FIXTURES as TIMELINE_FIXTURES } from './timeline-fixtures.js';

const daysAgo = (d, h = 10) => {
  const dt = new Date();
  dt.setDate(dt.getDate() - d);
  dt.setHours(h, 0, 0, 0);
  return dt.toISOString();
};

const issue = (key, repo, number, title, state, createdD, closedD) => ({
  key, repo, number, title, state,
  createdAt: daysAgo(createdD), closedAt: closedD === null ? null : daysAgo(closedD),
  url: `https://github.com/example-user/${repo}/issues/${number}`,
});

const since = (dirtyD, unpushedD) => ({
  dirty: dirtyD === null ? null : daysAgo(dirtyD),
  unpushed: unpushedD === null ? null : daysAgo(unpushedD),
  branches: {},
});

// Moves are [daysAgo, from, to] in stored order; the first has from null. Ships on one day share an hour, so they stay one local day.
const flowIdea = (id, title, projectId, createdD, moves) => ({
  id, title, projectId, createdAt: daysAgo(createdD),
  stage: moves[moves.length - 1][2],
  history: moves.map(([d, from, to]) => ({ at: daysAgo(d), from, to, by: 'you', note: null })),
});

export const FIXTURES = {
  busy: {
    ...TIMELINE_FIXTURES.busy,
    issues: [
      issue('twig.example.com#10', 'twig.example.com', 10, 'Comments page 500 on empty thread', 'closed', 6, 0),
      issue('twig.example.com#11', 'twig.example.com', 11, 'Add dark mode preference', 'open', 4, null),
      issue('twig-app#3', 'twig-app', 3, 'Crash on launch, offline mode', 'open', 9, null),
      issue('workspace-dashboard-app#5', 'workspace-dashboard-app', 5, 'Summary view', 'open', 2, null),
    ],
    ws: [
      {
        id: 'twig', name: 'Twig',
        repos: [{ name: 'twig.example.com', status: 'needs-push', uncommitted: 2, unpushed: 3, since: since(1, 2) }],
      },
      {
        id: 'twig-mobile', name: 'Twig Mobile',
        repos: [{ name: 'twig-app', status: 'needs-commit', uncommitted: 1, unpushed: 0, since: since(9, null) }],
      },
      {
        id: 'wda', name: 'Workspace Dashboard',
        repos: [{ name: 'workspace-dashboard-app', status: 'stable', uncommitted: 0, unpushed: 0, since: since(null, null) }],
      },
    ],
  },
  quiet: {
    ...TIMELINE_FIXTURES.quiet,
    issues: [],
    ws: [
      { id: 'twig', name: 'Twig', repos: [{ name: 'twig.example.com', status: 'stable', uncommitted: 0, unpushed: 0, since: since(null, null) }] },
    ],
  },
  empty: { ...TIMELINE_FIXTURES.empty, issues: [], ws: [] },
};

// Every stage, one reset loop (flow-3), one idea waiting at built (flow-2), one kill, and ten ships on one day.
const FLOW_IDEAS = [
  flowIdea('flow-1', 'Offline comment queue', 'twig-mobile', 20, [[20, null, 'inbox'], [18, 'inbox', 'shaped'], [16, 'shaped', 'planned'], [15, 'planned', 'reviewed'], [14, 'reviewed', 'queued'], [13, 'queued', 'building'], [12, 'building', 'built'], [9, 'built', 'shipped']]),
  flowIdea('flow-2', 'Dark mode toggle', 'twig', 12, [[12, null, 'inbox'], [10, 'inbox', 'shaped'], [8, 'shaped', 'planned'], [7, 'planned', 'reviewed'], [6, 'reviewed', 'queued'], [5, 'queued', 'building'], [2, 'building', 'built']]),
  flowIdea('flow-3', 'Summary pipeline view', 'wda', 9, [[9, null, 'inbox'], [8, 'inbox', 'shaped'], [7, 'shaped', 'planned'], [6, 'planned', 'reviewed'], [5, 'reviewed', 'queued'], [4, 'queued', 'building'], [3, 'building', 'queued'], [2, 'queued', 'building']]),
  flowIdea('flow-4', 'Footer typo cleanup', 'twig', 15, [[15, null, 'inbox'], [11, 'inbox', 'killed']]),
  flowIdea('flow-5', 'Retry banner copy', 'twig-mobile', 6, [[6, null, 'inbox'], [4, 'inbox', 'shaped'], [1, 'shaped', 'planned']]),
  flowIdea('flow-6', 'Sort comments by newest', 'twig', 1, [[1, null, 'inbox']]),
  ...Array.from({ length: 10 }, (_, i) => flowIdea(`flow-b${i}`, `Small tweak ${i + 1}`, i % 2 ? 'twig' : 'wda', 18, [[18, null, 'inbox'], [17, 'inbox', 'shaped'], [16, 'shaped', 'planned'], [3, 'planned', 'shipped']])),
];
FIXTURES.flow = { ...FIXTURES.busy, ideas: FLOW_IDEAS };
