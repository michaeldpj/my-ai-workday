// Invented records for dev/dashboard-preview.html. Never paste live data here.
const repo = (name, over = {}) => ({
  name, status: 'stable', platform: 'web', ship: false, buildTracked: false,
  buildDeps: [], notes: 'clean', buildStale: false, ...over,
});
const project = (id, name, over = {}) => ({
  id, name, status: 'active', priority: 'medium', focus: '', focusTone: 'info',
  blockedSince: null, parity: null, repos: [], tasks: [], ...over,
});
// Every field the board's render reads, shaped like dev/ideas-fixtures.js.
const idea = (o) => ({
  waitingOn: 'you', planEffort: null, brief: '', planPath: '',
  reviewVerdict: '', repos: [], github: null, notes: '', killedReason: '',
  cameBack: false, updatedAt: '2026-09-22T10:00:00Z', ...o,
});

export const FIXTURE = {
  workspace: {
    ws: [
      // Open task: delete must refuse. alpha-app is build-tracked on alpha-web.
      project('alpha', 'Alpha', {
        repos: [repo('alpha-web'), repo('alpha-app', { platform: 'mobile', ship: true, buildTracked: true, buildDeps: ['alpha-web'], buildStale: true })],
        tasks: [{ done: false, text: 'Open task on Alpha' }],
      }),
      // In-flight idea: delete must refuse. shared-lib is also on Gamma.
      project('beta', 'Beta', {
        repos: [repo('beta-api', { status: 'needs-push', notes: '1 to push', since: { dirty: null, unpushed: '2026-09-28T10:00:00Z' } }), repo('shared-lib')],
        tasks: [{ done: true, text: 'Done on Beta' }],
      }),
      // Deletable: done tasks, a parity table, an inbox idea, and on the work list.
      project('gamma', 'Gamma', {
        repos: [repo('shared-lib')],
        tasks: [{ done: true, text: 'Done on Gamma' }],
        parity: { platforms: ['web'], features: [{ name: 'Sync', cov: { web: 'done' } }] },
      }),
      // Empty: the cross-card drop target with no rows.
      project('empty', 'Empty'),
    ],
    lists: [], today: [], doneToday: [], inbox: [], todayDate: '',
  },
  // 'gone' is stale on purpose: a handler that saves this list unfiltered is refused.
  scopePrefs: { scope: 'all', work: ['alpha', 'gamma', 'gone'] },
  repoNames: ['alpha-web', 'alpha-app', 'beta-api', 'shared-lib', 'delta-site'],
  appSettings: { githubPath: '~/github', personalClaudeDir: '~/.claude-personal', dashboardUrl: 'https://example.com/dash' },
  ideas: [
    idea({ id: 'idea-fixture-beta1', title: 'Beta plan in flight', stage: 'planned', projectId: 'beta', impact: 3, effort: 'medium', planEffort: 'medium', planPath: 'docs/plans/2026-09-20-x.md', brief: '## Problem\nFixture.', createdAt: '2026-09-20T10:00:00Z', history: [] }),
    idea({ id: 'idea-fixture-gam1', title: 'Gamma inbox idea', stage: 'inbox', projectId: 'gamma', impact: 2, effort: 'low', createdAt: '2026-09-21T10:00:00Z', history: [] }),
  ],
};

/** What a stranger's first launch loads: no projects, no lists, nothing set, no skills. */
export const EMPTY = {
  workspace: { ws: [], lists: [], today: [], doneToday: [], inbox: [], todayDate: '' },
  scopePrefs: { scope: 'all', work: [] },
  repoNames: ['alpha', 'beta'],
  ideas: [],
  appSettings: { githubPath: '~/github', personalClaudeDir: '', dashboardUrl: '' },
};
