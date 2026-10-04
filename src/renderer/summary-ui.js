/**
 * The Summary view: stat tiles, six figures, and a repo health table over the
 * same Timeline entries plus plain issue rows. Every rule about the numbers
 * lives in summary-model.js and charts.js; this file paints and wires,
 * modelled on timeline-ui.js.
 */
import { buildEntries, filterEntries, weekStart, repoProjectMap, TIMELINE_RANGES, DEFAULT_RANGE } from './timeline-model.js';
import { dayBuckets, countByProject, prWeeks, issueFlow, pipelineFlow, repoHealth, activitySummary, SUMMARY_KINDS, SUMMARY_LABELS } from './summary-model.js';
import { barStrip, hBars, pairedWeeks, stackedRows } from './charts.js';
import { allIdeas } from './ideas-ui.js';
import { esc } from './text.js';
import { inScope, scopedProjects, DEFAULT_SCOPE } from './scope-model.js';
import { formatAge } from './idea-age.js';

let projects = [];
let repoProject = {};
let wsSnapshot = [];
let range = DEFAULT_RANGE;
let projectId = '';
let scope = DEFAULT_SCOPE;
let work = [];
let raw = null; // { commits, sessions, prs, issues, since } from the last load
let activity = null; // the 14-day payload behind the Today card's line, refreshed at start and after every scan
let loading = null; // the range in flight, so a late answer for a range the user left is dropped

export function setSummaryProjects(list) {
  projects = (list || []).map((p) => ({ id: p.id, name: p.name }));
  repoProject = repoProjectMap(list);
  wsSnapshot = list || [];
}

/** The header's work/personal scope. A chosen project chip outside it is dropped. */
export function setSummaryScope(nextScope, nextWork) {
  scope = nextScope;
  work = nextWork;
  if (projectId && !inScope(projectId, scope, work)) projectId = '';
}

/** Inside the header scope and, when a chip is on, that one project. */
const shown = (pid) => inScope(pid, scope, work) && (!projectId || pid === projectId);

export async function loadSummary() {
  const forRange = range;
  if (loading === forRange) return;
  loading = forRange;
  try {
    const { commits, sessions, prs, issues } = await window.electronAPI.summaryLoad(forRange);
    if (range !== forRange) return; // the user picked a different range while this was in flight
    const since = new Date(Date.now() - forRange * 86400000).toISOString();
    raw = { commits, sessions, prs, issues, since };
  } catch (e) {
    window.showToast('Summary: ' + (e.message || String(e)), 6000);
  } finally {
    if (loading === forRange) loading = null;
  }
  renderSummary();
}

// ── rendering ──────────────────────────────────────────────────────────

function projectName(id) { return projects.find((p) => p.id === id)?.name || (id || 'Other'); }

function legend(pairs) {
  return `<div class="sum-legend">${pairs.map(([key, label]) => `<span class="sum-swatch ch-${esc(key)}"></span>${esc(label)}`).join('')}</div>`;
}

function fig(title, body, legendHtml, extraClass) {
  return `<div class="sum-fig${extraClass ? ' ' + extraClass : ''}"><div class="sum-fig-title">${esc(title)}</div>${legendHtml || ''}${body}</div>`;
}

function weekLabelShort(ws) {
  return new Date(ws + 'T00:00:00').toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function weeklyKindBuckets(days) {
  const weeks = new Map();
  for (const d of days) {
    const w = weekStart(d.date + 'T00:00:00');
    if (!weeks.has(w)) weeks.set(w, { label: weekLabelShort(w), commit: 0, session: 0, pr: 0, idea: 0 });
    const row = weeks.get(w);
    for (const kind of SUMMARY_KINDS) row[kind] += d[kind];
  }
  return [...weeks.values()];
}

function statTile(icon, num, label) {
  return `<div class="stat"><div class="stat-icon">${icon}</div><div><div class="stat-num">${num}</div><div class="stat-lbl">${esc(label)}</div></div></div>`;
}

function flowNote(flow) {
  const { created, shipped, killed } = flow.totals;
  const bulk = flow.bulkDays.length
    ? ' \u00b7 bulk closes: ' + [...flow.bulkDays].reverse().map((d) => `${weekLabelShort(d.date)} (${d.count})`).join(', ')
    : '';
  return `<div class="sum-note">${esc(`${created} created, ${shipped} shipped, ${killed} killed${bulk}`)}</div>`;
}

function dwellTable(dwell) {
  const rows = dwell.map((d) => `<tr><td>${esc(d.stage)}</td><td>${esc(formatAge(d.median))}</td><td>${esc(formatAge(d.p90))}</td><td>${esc(d.n)}</td><td>${d.open ? esc(d.open) : ''}</td></tr>`).join('');
  return `<table class="sum-dwell"><thead><tr><th>Stage</th><th>Median</th><th>p90</th><th>Visits</th><th>Waiting now</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function healthRow(r) {
  const age = r.signal ? `<span class="age-pill ${r.tier}" title="${esc(r.signal.kind === 'branch' ? 'branch ' + r.signal.branch : r.signal.kind)} since ${esc(r.signal.at.slice(0, 10))}">${formatAge(Date.now() - Date.parse(r.signal.at))}</span>` : '';
  return `<tr><td>${esc(r.repo)}</td><td>${esc(projectName(r.projectId))}</td><td><span class="bdg ${esc(r.status)}">${esc(r.status)}</span></td><td>${age}</td><td>${esc(r.uncommitted)}</td><td>${esc(r.unpushed)}</td><td>${r.branches}</td></tr>`;
}

export function renderSummary() {
  const el = document.getElementById('summary-view');
  if (!el) return;
  const sel = document.getElementById('sum-range');
  if (sel) sel.value = String(range);
  renderChips();

  const allEntries = raw ? buildEntries({ commits: raw.commits, sessions: raw.sessions, prs: raw.prs, ideas: allIdeas(), repoProject, since: raw.since }) : [];
  const entries = filterEntries(allEntries, { kinds: SUMMARY_KINDS }).filter((e) => shown(e.projectId));
  const issues = (raw?.issues || []).filter((i) => shown(repoProject[i.repo]));
  const flow = pipelineFlow(allIdeas().filter((i) => shown(i.projectId || '')), range);

  const tiles = document.getElementById('sum-tiles');
  if (tiles) {
    const merged = entries.filter((e) => e.status === 'merged').length;
    tiles.innerHTML =
      statTile('&#x1F4E6;', entries.filter((e) => e.kind === 'commit').length, 'Commits') +
      statTile('&#x1F500;', merged, 'PRs merged') +
      statTile('&#x1F4DD;', entries.filter((e) => e.kind === 'session').length, 'Sessions') +
      statTile('&#x1F680;', flow.totals.shipped, 'Ideas shipped');
  }

  const figs = document.getElementById('sum-figs');
  if (figs) {
    const days = dayBuckets(entries, range);
    const weeks = weeklyKindBuckets(days);
    const prs = (raw?.prs || []).filter((p) => shown(repoProject[p.repo]));
    const pw = prWeeks(prs, range);
    figs.innerHTML =
      fig('Commits per day', barStrip({ series: SUMMARY_KINDS.map((k) => ({ key: k, values: days.map((d) => d[k]) })), labels: days.map((d) => d.date), width: 900, height: 100 }), legend(SUMMARY_KINDS.map((k) => [k, SUMMARY_LABELS[k]])), 'span-2') +
      fig('Commits by project', hBars({ rows: countByProject(entries, 'commit').map((r) => ({ label: projectName(r.projectId), value: r.count })) })) +
      fig('Activity mix by week', barStrip({ series: SUMMARY_KINDS.map((k) => ({ key: k, values: weeks.map((w) => w[k]) })), labels: weeks.map((w) => w.label), labelEvery: 1 }), legend(SUMMARY_KINDS.map((k) => [k, SUMMARY_LABELS[k]]))) +
      fig('PR throughput', pairedWeeks({ weeks: pw.map((w) => ({ label: weekLabelShort(w.weekStart), a: w.opened, b: w.merged })), keys: ['pr', 'idea'] }), legend([['pr', 'Opened'], ['idea', 'Merged']])) +
      fig('Issues by project', stackedRows({ rows: issueFlow(issues, repoProject, raw?.since || '').map((r) => ({ label: projectName(r.projectId), parts: [{ key: 'commit', value: r.opened }, { key: 'pr', value: r.closed }, { key: 'idea', value: r.open }] })) }), legend([['commit', 'Opened'], ['pr', 'Closed'], ['idea', 'Open']])) +
      fig('Pipeline flow', pairedWeeks({ weeks: flow.weeks.map((w) => ({ label: weekLabelShort(w.weekStart), a: w.created, b: w.shipped })), keys: ['pr', 'idea'] }) + flowNote(flow), legend([['pr', 'Created'], ['idea', 'Shipped']])) +
      fig('Stage dwell', dwellTable(flow.dwell));
  }

  const health = document.getElementById('sum-health');
  if (health) {
    const rows = repoHealth(wsSnapshot).filter((r) => shown(r.projectId));
    health.innerHTML = `<table><thead><tr><th>Repo</th><th>Project</th><th>Status</th><th>Age</th><th>Uncommitted</th><th>Unpushed</th><th>Branches</th></tr></thead><tbody>${rows.map(healthRow).join('')}</tbody></table>`;
  }

  const summary = document.getElementById('sum-summary');
  if (summary) {
    const weekCount = Math.round(range / 7);
    summary.textContent = `${entries.filter((e) => e.kind === 'commit').length} commits, ${entries.filter((e) => e.kind === 'session').length} sessions in the last ${weekCount} weeks`;
  }
}

function renderChips() {
  const el = document.getElementById('sum-projects');
  if (!el) return;
  el.innerHTML = scopedProjects(projects, scope, work).map((p) => `<button type="button" class="iss-chip${p.id === projectId ? ' on' : ''}" data-project="${esc(p.id)}">${esc(p.name)}</button>`).join('');
}

// ── init ───────────────────────────────────────────────────────────────

export function initSummary() {
  let stored = DEFAULT_RANGE;
  try {
    const r = Number(localStorage.getItem('summaryRange'));
    if (TIMELINE_RANGES.includes(r)) stored = r;
  } catch { /* private mode */ }
  range = stored;

  document.getElementById('sum-range')?.addEventListener('change', (e) => {
    const v = Number(e.target.value);
    if (!TIMELINE_RANGES.includes(v)) return;
    range = v;
    try { localStorage.setItem('summaryRange', String(v)); } catch { /* private mode */ }
    loadSummary();
  });

  document.getElementById('sum-projects')?.addEventListener('click', (e) => {
    const id = e.target.closest('[data-project]')?.dataset.project;
    if (id === undefined) return;
    projectId = projectId === id ? '' : id;
    renderSummary();
  });
}

// ── Today card ─────────────────────────────────────────────────────────

/** Fetch the trailing two weeks for the Today card. Best-effort: a failure leaves the last payload in place. */
export async function loadActivity() {
  try {
    const { commits, sessions, prs } = await window.electronAPI.summaryLoad(14);
    activity = { commits, sessions, prs, since: new Date(Date.now() - 14 * 86400000).toISOString() };
  } catch { /* the line stays as it was */ }
}

export function activityLine() {
  if (!activity) return '';
  const s = activitySummary(buildEntries({ ...activity, ideas: allIdeas(), repoProject }).filter((e) => inScope(e.projectId, scope, work)));
  const part = (n, noun, suffix) => n
    ? `<span class="rollup-link" onclick="window.setView('timeline')">${n} ${noun}${n === 1 ? '' : 's'}${suffix ? ' ' + suffix : ''}</span>`
    : '';
  const todayParts = [part(s.today.commit, 'commit'), part(s.today.session, 'session'), part(s.today.pr, 'PR', 'opened'), part(s.today.prMerged, 'PR', 'merged'), part(s.today.idea, 'idea move')].filter(Boolean);
  const weekParts = [part(s.week.commit, 'commit'), part(s.week.session, 'session'), part(s.week.pr, 'PR', 'opened'), part(s.week.prMerged, 'PR', 'merged'), part(s.week.idea, 'idea move')].filter(Boolean);
  if (!todayParts.length && !weekParts.length) return '';
  const segs = [];
  if (todayParts.length) segs.push('Today: ' + todayParts.join(', '));
  if (weekParts.length) segs.push('This week: ' + weekParts.join(', '));
  return segs.join(' &middot; ');
}

Object.assign(window, { renderSummary });
