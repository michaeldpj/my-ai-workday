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
