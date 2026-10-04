/**
 * Pure rules for the Timeline: what moved, across every repo and project,
 * week by week. No DOM, so it tests under node --test and main imports the
 * range list for IPC validation. PRs contribute an opened event and, once
 * merged, a merged event.
 */
export const TIMELINE_RANGES = [14, 28, 56, 84];
export const DEFAULT_RANGE = 28;
export const ENTRY_KINDS = ['commit', 'session', 'pr', 'idea'];

/** repo name -> project id, the one lookup every view needs from the workspace. */
export function repoProjectMap(ws) {
  const map = {};
  for (const p of ws || []) for (const r of p.repos || []) map[r.name] = p.id;
  return map;
}

const byAtDesc = (a, b) => Date.parse(b.at) - Date.parse(a.at);

export function buildEntries({ commits = {}, sessions = [], prs = [], ideas = [], repoProject = {}, since = '' }) {
  const out = [];
  for (const [repo, list] of Object.entries(commits)) {
    for (const c of list) out.push({ at: c.at, kind: 'commit', projectId: repoProject[repo] || '', repo, title: c.subject, url: null, id: c.sha });
  }
  for (const s of sessions) {
    out.push({ at: s.at, kind: 'session', projectId: repoProject[s.repo] || '', repo: s.repo, title: s.title, url: s.url, id: s.key });
  }
  for (const p of prs) {
    const projectId = repoProject[p.repo] || '';
    const pr = (at, status) => ({ at, kind: 'pr', status, projectId, repo: p.repo, title: `#${p.number} ${p.title} ${status}`, url: p.url, id: `${p.key}:${status}` });
    out.push(pr(p.openedAt, 'opened'));
    if (p.mergedAt) out.push(pr(p.mergedAt, 'merged'));
    else if (p.closedAt) out.push(pr(p.closedAt, 'closed'));
  }
  for (const idea of ideas) {
    for (const h of idea.history || []) {
      if (!h.to || !h.at) continue;
      out.push({ at: h.at, kind: 'idea', stage: h.to, projectId: idea.projectId || '', repo: null, title: `${idea.title} → ${h.to}`, url: null, id: idea.id });
    }
  }
  const sinceMs = since ? Date.parse(since) : -Infinity;
  return out.filter((e) => e.at && Date.parse(e.at) >= sinceMs).sort(byAtDesc);
}

export function filterEntries(entries, { projectId = '', kinds = ENTRY_KINDS }) {
  return entries.filter((e) => (!projectId || e.projectId === projectId) && kinds.includes(e.kind));
}

const pad = (n) => String(n).padStart(2, '0');
export const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function weekStart(iso) {
  const d = new Date(iso);
  const dow = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - dow);
  return localDate(d);
}

export function groupByWeek(entries) {
  const weeks = new Map();
  for (const e of [...entries].sort(byAtDesc)) {
    const w = weekStart(e.at);
    if (!weeks.has(w)) weeks.set(w, { weekStart: w, counts: { commit: 0, session: 0, pr: 0, idea: 0 }, days: new Map() });
    const week = weeks.get(w);
    week.counts[e.kind] += 1;
    const day = localDate(new Date(e.at));
    if (!week.days.has(day)) week.days.set(day, { date: day, entries: [] });
    week.days.get(day).entries.push(e);
  }
  return [...weeks.values()].map((w) => ({ ...w, days: [...w.days.values()] }));
}
