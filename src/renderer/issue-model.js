/**
 * Pure rules for the Issues view. No DOM, so it tests under node --test and
 * main can import the enums for IPC validation the way it imports SORT_MODES.
 */
// `issue` is every kind but `pr`: what the dashboard rollup counts as open issues.
export const ISSUE_KINDS = ['all', 'issue', 'journal', 'idea', 'pr', 'other'];
export const ISSUE_STATES = ['open', 'closed', 'all'];
export const ISSUE_SORTS = ['updated', 'created', 'comments', 'number'];
export const DEFAULT_ISSUE_PREFS = { projectId: '', kind: 'all', state: 'open', sort: 'updated' };

export const SESSION_LABEL = 'session-log';

/** A session record, wherever it is read: the Journal, the Timeline, the store. */
export function isSessionRecord(row) {
  return Array.isArray(row?.labels) && row.labels.includes(SESSION_LABEL);
}

/** The date a session record stands for: when it closed, or when it opened if it never did. */
export function sessionStamp(row) {
  return row.closedAt || row.createdAt;
}

/** A pull request row, wherever it is read. */
export function isPullRequest(row) {
  return row?.type === 'pr';
}

/** session-log wins over an idea link: a session record about an idea is still a record. */
export function classifyIssue(row, ideaByUrl) {
  if (isSessionRecord(row)) return 'journal';
  if (isPullRequest(row)) return 'pr';
  if (typeof ideaByUrl === 'function' && ideaByUrl(row.url)) return 'idea';
  return 'other';
}

export function filterIssues(rows, { kind, state, repo, label, query }) {
  const q = (query || '').trim().toLowerCase();
  const num = q.startsWith('#') ? Number(q.slice(1)) : NaN;
  return rows.filter((r) =>
    (kind === 'all' || (kind === 'issue' ? r.kind !== 'pr' : r.kind === kind))
    // Session records are always closed, so Journal ignores the state filter.
    && (kind === 'journal' || state === 'all' || r.state === state)
    && (!repo || r.repo === repo)
    && (!label || r.labels.includes(label))
    && (!q || r.title.toLowerCase().includes(q) || (Number.isFinite(num) && r.number === num)));
}

const desc = (a, b) => (a < b ? 1 : a > b ? -1 : 0);

export function issueComparator(sort) {
  const key = {
    updated: (r) => r.updatedAt,
    created: (r) => r.createdAt,
    comments: (r) => r.comments.length,
    number: (r) => r.number,
  }[sort] || ((r) => r.updatedAt);
  return (a, b) => desc(key(a), key(b)) || desc(a.number, b.number);
}

export function journalGroups(rows) {
  const stamp = sessionStamp;
  const byDate = new Map();
  for (const r of [...rows].sort((a, b) => desc(stamp(a), stamp(b)))) {
    const date = stamp(r).slice(0, 10);
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(r);
  }
  return [...byDate].map(([date, list]) => ({ date, rows: list }));
}

export function isUnread(row, readMap) {
  const seen = readMap?.[row.key];
  return !seen || seen < row.updatedAt;
}
