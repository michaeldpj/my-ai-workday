/** Fixture snapshots for the Issues preview harness. Dev-only, never shipped. */
const hoursAgo = (h) => new Date(Date.now() - h * 3600000).toISOString();

const row = (repo, number, o) => ({
  key: `${repo}#${number}`, repo, number,
  title: o.title, state: o.state || 'open', type: o.type || 'issue',
  labels: o.labels || [], createdAt: hoursAgo(o.age || 48), updatedAt: hoursAgo(o.updated || 2),
  closedAt: o.state === 'closed' ? hoursAgo(o.updated || 2) : null,
  url: `https://github.com/example-user/${repo}/${o.type === 'pr' ? 'pull' : 'issues'}/${number}`, author: 'example-user',
  body: o.body || '## Summary\n\nA body with `code`, a [link](https://example.com), and a fence:\n\n```bash\ngit log --oneline -3\n```',
  comments: o.comments || [],
  ...(o.type === 'pr' ? { mergedAt: o.mergedAt || null, branch: o.branch || '', draft: !!o.draft } : {}),
});

export const FIXTURES = {
  mixed: {
    cache: {
      fetchedAt: hoursAgo(0.1),
      repos: {
        'twig.example.com': [
          row('twig.example.com', 42, { title: 'Dark mode toggle', type: 'pr', state: 'closed', mergedAt: hoursAgo(20), branch: 'claude/dark-mode', updated: 20 }),
          row('twig.example.com', 41, { title: 'Session: dark mode toggle (2026-09-02)', state: 'closed', labels: ['enhancement', 'session-log'], updated: 20 }),
          row('twig.example.com', 40, { title: 'Comments page 500s on empty thread', labels: ['bug'], updated: 3, comments: [{ author: 'example-user', createdAt: hoursAgo(1), body: 'Reproduced on prod.' }] }),
          row('twig.example.com', 39, { title: 'Versions page', labels: [], updated: 30 }),
        ],
        'twig-app': [
          row('twig-app', 12, { title: 'Session: fix crash on launch (2026-09-03)', state: 'closed', labels: ['bug', 'session-log'], updated: 5 }),
          row('twig-app', 11, { title: 'Offline queue for comments', labels: ['enhancement'], updated: 50, age: 200 }),
        ],
        'twig-admin': null,
      },
      errors: {},
    },
    read: { 'twig.example.com#39': hoursAgo(31) },
  },
  empty: { cache: { fetchedAt: hoursAgo(0.2), repos: { 'hollow-app': [], 'hollow.example.com': [] }, errors: {} }, read: {} },
  uncached: { cache: { fetchedAt: null, repos: { a: null }, errors: { a: 'exit' } }, read: {} },
};
