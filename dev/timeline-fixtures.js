/** Fixture snapshots for the Timeline preview harness. Dev-only, never shipped. */
const daysAgo = (d, h = 10) => {
  const dt = new Date();
  dt.setDate(dt.getDate() - d);
  dt.setHours(h, 0, 0, 0);
  return dt.toISOString();
};

const commit = (sha, subject, d, h) => ({ sha, subject, at: daysAgo(d, h) });

const session = (key, repo, title, d, h) => ({
  key, repo, title, at: daysAgo(d, h),
  url: `https://github.com/example-user/${repo}/issues/${key.split('#')[1] || 1}`,
});

const pr = (key, repo, number, title, openedD, mergedD) => ({
  key, repo, number, title,
  url: `https://github.com/example-user/${repo}/pull/${number}`,
  openedAt: daysAgo(openedD), mergedAt: mergedD === null ? null : daysAgo(mergedD),
});

const idea = (id, title, projectId, moves) => ({
  id, title, projectId, stage: moves[moves.length - 1]?.to || 'inbox',
  history: moves.map(([d, to, from]) => ({ at: daysAgo(d), to, from: from || null, by: 'you', note: null })),
});

export const FIXTURES = {
  busy: {
    commits: {
      'twig.example.com': [
        commit('a1b2c3d', 'fix: comments page 500 on empty thread', 0, 9),
        commit('b2c3d4e', 'feat: dark mode toggle', 2, 14),
        commit('c3d4e5f', 'chore: bump deps', 6, 11),
        commit('d4e5f6a', 'fix: versions page pagination', 9, 16),
        commit('e5f6a7b', 'refactor: extract comment model', 13, 10),
      ],
      'twig-app': [
        commit('f6a7b8c', 'fix: crash on launch', 1, 8),
        commit('a7b8c9d', 'feat: offline queue for comments', 8, 13),
        commit('b8c9d0e', 'test: offline queue coverage', 15, 12),
      ],
      'workspace-dashboard-app': [
        commit('c9d0e1f', 'feat: timeline model', 0, 17),
        commit('d0e1f2a', 'feat: issue store', 4, 9),
        commit('e1f2a3b', 'feat: age signals', 11, 15),
      ],
    },
    sessions: [
      session('twig.example.com#41', 'twig.example.com', 'Session: dark mode toggle (2026-09-02)', 1, 18),
      session('twig-app#12', 'twig-app', 'Session: fix crash on launch (2026-09-02)', 1, 9),
      session('workspace-dashboard-app#7', 'workspace-dashboard-app', 'Session: timeline model (2026-08-25)', 9, 20),
    ],
    prs: [
      pr('twig.example.com#42', 'twig.example.com', 42, 'Dark mode toggle', 3, 1),
      pr('workspace-dashboard-app#7', 'workspace-dashboard-app', 7, 'PRs and timeline rollup', 1, null),
    ],
    ideas: [
      idea('idea-1', 'Dark mode toggle', 'twig', [[10, 'inbox'], [8, 'shaped', 'inbox'], [3, 'planned', 'shaped'], [1, 'built', 'planned']]),
      idea('idea-2', 'Offline comment queue', 'twig-mobile', [[14, 'inbox'], [12, 'shaped', 'inbox'], [8, 'queued', 'shaped']]),
      idea('idea-3', 'Timeline view', 'wda', [[6, 'inbox'], [5, 'shaped', 'inbox'], [4, 'planned', 'shaped'], [2, 'reviewed', 'planned'], [0, 'building', 'reviewed']]),
    ],
  },
  quiet: {
    commits: {
      'twig.example.com': [commit('f1e2d3c', 'fix: typo in footer', 5, 10)],
    },
    sessions: [],
    prs: [],
    ideas: [
      idea('idea-4', 'Footer typo cleanup', 'twig', [[5, 'inbox'], [5, 'killed', 'inbox']]),
    ],
  },
  empty: { commits: {}, sessions: [], prs: [], ideas: [] },
};
