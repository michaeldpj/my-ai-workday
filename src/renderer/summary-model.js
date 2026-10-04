/**
 * Pure rules for the Summary view: daily and weekly buckets, per-project
 * rollups, repo health, and the Today card's activity line. No DOM, so it
 * tests under node --test. Built on top of Timeline entries and repo-age's
 * age signals so the three views never disagree about what a "day" or a
 * "stale repo" is.
 */
import { weekStart, localDate } from './timeline-model.js';
import { oldestSignal, ageTier, liveBranches } from './repo-age.js';

const DAY = 86400000;

export const SUMMARY_KINDS = ['commit', 'session', 'pr', 'idea'];
export const SUMMARY_LABELS = { commit: 'Commits', session: 'Sessions', pr: 'PRs', idea: 'Idea moves' };

const dayKey = (iso) => localDate(new Date(iso));
const startOfDay = (ms) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d;
};

/** One row per local day, oldest first, `days` long, zero-filled counts by kind. */
export function dayBuckets(entries, days, now = Date.now()) {
  const today = startOfDay(now);
  const rows = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    rows.push({ date: localDate(d), commit: 0, session: 0, pr: 0, idea: 0 });
  }
  const byDate = new Map(rows.map((r) => [r.date, r]));
  for (const e of entries) {
    if (!e.at) continue;
    const row = byDate.get(dayKey(e.at));
    if (row) row[e.kind] += 1;
  }
  return rows;
}

/** Counts of one kind grouped by project, descending, ties broken by id. Projectless rows fold to 'other'. */
export function countByProject(entries, kind) {
  const counts = new Map();
  for (const e of entries) {
    if (e.kind !== kind) continue;
    const id = e.projectId || 'other';
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([projectId, count]) => ({ projectId, count }))
    .sort((a, b) => b.count - a.count || a.projectId.localeCompare(b.projectId));
}

/** Zero-filled week list for a range, keyed by weekStart, Monday of the cutoff through the current week. */
function rangeWeeks(days, now, blank) {
  const cutoff = now - days * DAY;
  const endWeek = weekStart(new Date(now).toISOString());
  const weeks = new Map();
  const cursor = new Date(`${weekStart(new Date(cutoff).toISOString())}T00:00:00`);
  while (localDate(cursor) <= endWeek) {
    const w = localDate(cursor);
    weeks.set(w, { weekStart: w, ...blank });
    cursor.setDate(cursor.getDate() + 7);
  }
  return weeks;
}

/** Opened vs merged PR counts per week, oldest first, zero-filled across the range. */
export function prWeeks(prs, days, now = Date.now()) {
  const cutoff = now - days * DAY;
  const weeks = rangeWeeks(days, now, { opened: 0, merged: 0 });
  for (const p of prs || []) {
    if (p.openedAt && Date.parse(p.openedAt) >= cutoff) {
      const w = weekStart(p.openedAt);
      if (weeks.has(w)) weeks.get(w).opened += 1;
    }
    if (p.mergedAt && Date.parse(p.mergedAt) >= cutoff) {
      const w = weekStart(p.mergedAt);
      if (weeks.has(w)) weeks.get(w).merged += 1;
    }
  }
  return [...weeks.values()];
}

export const FLOW_STAGES = ['inbox', 'shaped', 'planned', 'reviewed', 'queued', 'building', 'built'];
export const BULK_CLOSE_DAY = 10;

const NO_FLOW = Object.freeze({ created: 0, shipped: 0, killed: 0 });
const nearestRank = (sorted, q) => (sorted.length ? sorted[Math.ceil(q * sorted.length) - 1] : null);

/**
 * Idea pipeline flow over the range: created, shipped and killed per week,
 * time spent in each non-terminal stage (one visit per history entry, counted
 * when it ended in range or is still open, full unclipped duration), and local
 * days with BULK_CLOSE_DAY or more closes. History entries with an unparseable
 * `at` are dropped before visits are built.
 */
export function pipelineFlow(ideas, days, now = Date.now()) {
  const cutoff = now - days * DAY;
  const weeks = rangeWeeks(days, now, NO_FLOW);
  const totals = { ...NO_FLOW };
  const visits = new Map(FLOW_STAGES.map((s) => [s, { ms: [], open: 0 }]));
  const closesByDay = new Map();
  const count = (kind, iso) => {
    totals[kind] += 1;
    const w = weeks.get(weekStart(iso));
    if (w) w[kind] += 1;
  };

  for (const idea of ideas || []) {
    if (idea.createdAt && Date.parse(idea.createdAt) >= cutoff) count('created', idea.createdAt);
    const history = (idea.history || []).filter((e) => Number.isFinite(Date.parse(e.at)));
    history.forEach((e, i) => {
      const start = Date.parse(e.at);
      if (e.to === 'shipped' || e.to === 'killed') {
        if (start < cutoff) return;
        count(e.to, e.at);
        const day = dayKey(e.at);
        closesByDay.set(day, (closesByDay.get(day) || 0) + 1);
        return;
      }
      const v = visits.get(e.to);
      if (!v) return;
      const next = history[i + 1];
      const isOpen = !next && idea.stage === e.to;
      if (!next && !isOpen) return;
      const end = next ? Date.parse(next.at) : now;
      if (!isOpen && end < cutoff) return;
      v.ms.push(Math.max(0, end - start));
      if (isOpen) v.open += 1;
    });
  }

  const dwell = FLOW_STAGES.map((stage) => {
    const { ms, open } = visits.get(stage);
    const sorted = ms.sort((a, b) => a - b);
    return { stage, n: sorted.length, open, median: nearestRank(sorted, 0.5), p90: nearestRank(sorted, 0.9) };
  });
  const bulkDays = [...closesByDay.entries()]
    .filter(([, c]) => c >= BULK_CLOSE_DAY)
    .map(([date, c]) => ({ date, count: c }))
    .sort((a, b) => a.date.localeCompare(b.date));
  return { weeks: [...weeks.values()], totals, dwell, bulkDays };
}

/**
 * Opened/closed/open issue counts per project, descending by open count.
 * The loader keeps every still-open issue however old, so `open` is current;
 * opened and closed are bounded by `since` here so an old open issue is not
 * counted as newly opened on every range.
 */
export function issueFlow(issues, repoProject = {}, since = '') {
  const rows = new Map();
  const row = (projectId) => {
    if (!rows.has(projectId)) rows.set(projectId, { projectId, opened: 0, closed: 0, open: 0 });
    return rows.get(projectId);
  };
  for (const issue of issues || []) {
    const projectId = repoProject[issue.repo] || 'other';
    const r = row(projectId);
    if (issue.createdAt && issue.createdAt >= since) r.opened += 1;
    if (issue.closedAt && issue.closedAt >= since) r.closed += 1;
    if (issue.state === 'open') r.open += 1;
  }
  return [...rows.values()].sort((a, b) => b.open - a.open || a.projectId.localeCompare(b.projectId));
}

/** Every unparked repo's age signal, sorted oldest first then by name. */
export function repoHealth(ws, now = Date.now()) {
  const rows = [];
  for (const project of ws || []) {
    for (const r of project.repos || []) {
      if (r.status === 'parked') continue;
      const signal = oldestSignal(r.since);
      rows.push({
        repo: r.name,
        projectId: project.id,
        status: r.status,
        signal,
        tier: signal ? ageTier(signal.at, now) : null,
        unpushed: r.unpushed || 0,
        uncommitted: r.uncommitted || 0,
        branches: liveBranches(Object.keys(r.since?.branches || {}), {}, r.ignoreBranches || []).length,
      });
    }
  }
  return rows.sort((a, b) => {
    if (a.signal && b.signal) return a.signal.at < b.signal.at ? -1 : a.signal.at > b.signal.at ? 1 : a.repo.localeCompare(b.repo);
    if (a.signal) return -1;
    if (b.signal) return 1;
    return a.repo.localeCompare(b.repo);
  });
}

const emptyCounts = () => ({ commit: 0, session: 0, pr: 0, prMerged: 0, idea: 0 });

/** Today's and this trailing week's counts, plus the top three repos by commits in the week. */
export function activitySummary(entries, now = Date.now()) {
  const today = dayKey(now);
  const weekCutoff = startOfDay(now).getTime() - 6 * DAY;
  const todayCounts = emptyCounts();
  const weekCounts = emptyCounts();
  const repoCommits = new Map();
  for (const e of entries) {
    if (!e.at) continue;
    const t = Date.parse(e.at);
    if (t < weekCutoff) continue;
    const isToday = dayKey(e.at) === today;
    // A PR entry is one of opened, merged, or closed; the line counts the first two.
    const key = e.kind === 'pr' ? { opened: 'pr', merged: 'prMerged' }[e.status] : e.kind;
    if (!key) continue;
    const bump = (counts) => { counts[key] += 1; };
    bump(weekCounts);
    if (isToday) bump(todayCounts);
    if (e.kind === 'commit' && e.repo) repoCommits.set(e.repo, (repoCommits.get(e.repo) || 0) + 1);
  }
  const topRepos = [...repoCommits.entries()]
    .map(([repo, count]) => ({ repo, count }))
    .sort((a, b) => b.count - a.count || a.repo.localeCompare(b.repo))
    .slice(0, 3);
  return { today: todayCounts, week: weekCounts, topRepos };
}
