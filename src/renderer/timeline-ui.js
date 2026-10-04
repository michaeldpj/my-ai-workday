/**
 * The Timeline: commits, session records, and idea transitions from every
 * repo and project on one page, newest week first. Every rule about entries
 * lives in timeline-model.js; this file paints and wires.
 */
import { buildEntries, filterEntries, groupByWeek, repoProjectMap, ENTRY_KINDS, TIMELINE_RANGES, DEFAULT_RANGE, weekStart } from './timeline-model.js';
import { allIdeas, selectIdea } from './ideas-ui.js';
import { esc } from './text.js';
import { inScope, scopedProjects, DEFAULT_SCOPE } from './scope-model.js';

let projects = [];
let repoProject = {};
let range = DEFAULT_RANGE;
let projectId = '';
let scope = DEFAULT_SCOPE;
let work = [];
let kinds = new Set(ENTRY_KINDS);
let raw = null; // { commits, sessions, prs, since } from the last load; entries are rebuilt on every render so a later ideas load shows up
let loading = null; // the range of the fetch in flight, so a late answer for a range the user left is dropped

export function setTimelineProjects(list) {
  projects = (list || []).map((p) => ({ id: p.id, name: p.name }));
  repoProject = repoProjectMap(list);
}

/** The header's work/personal scope. A chosen project chip outside it is dropped. */
export function setTimelineScope(nextScope, nextWork) {
  scope = nextScope;
  work = nextWork;
  if (projectId && !inScope(projectId, scope, work)) projectId = '';
}

export async function loadTimeline() {
  const forRange = range;
  if (loading === forRange) return;
  loading = forRange;
  try {
    const { commits, sessions, prs } = await window.electronAPI.timelineLoad(forRange);
    if (range !== forRange) return; // the user picked a different range while this was in flight
    const since = new Date(Date.now() - forRange * 86400000).toISOString();
    raw = { commits, sessions, prs, since };
  } catch (e) {
    window.showToast('Timeline: ' + (e.message || String(e)), 6000);
  } finally {
    if (loading === forRange) loading = null;
  }
  renderTimeline();
}

// ── rendering ──────────────────────────────────────────────────────────

const GLYPH = { commit: '&#x25CF;', session: '&#x1F4DD;', pr: '&#x21C4;', idea: '&#x25C7;' };

function weekLabel(ws) {
  const now = new Date();
  const thisWeek = weekStart(now.toISOString());
  if (ws === thisWeek) return 'This week';
  const last = new Date(now);
  last.setDate(last.getDate() - 7);
  if (ws === weekStart(last.toISOString())) return 'Last week';
  const d = new Date(ws + 'T00:00:00');
  return 'Week of ' + d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function dayLabel(day) {
  const d = new Date(day + 'T00:00:00');
  return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
}

function rowHtml(e) {
  const time = new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const proj = projects.find((p) => p.id === e.projectId)?.name || (e.projectId || '');
  const clickable = e.kind !== 'commit' || e.repo;
  return `<div class="tl-row${clickable ? ' clickable' : ''}" data-kind="${e.kind}" data-id="${esc(e.id)}" data-url="${esc(e.url || '')}" data-repo="${esc(e.repo || '')}">
    <span class="tl-time">${time}</span>
    <span class="tl-glyph ${e.kind}">${GLYPH[e.kind]}</span>
    <span class="tl-proj" title="${esc(proj)}">${esc(proj)}</span>
    <span class="tl-title">${e.repo ? `<span class="tl-repo">${esc(e.repo)}</span>` : ''}<span title="${esc(e.title)}">${esc(e.title)}</span></span>
  </div>`;
}

function weekHtml(w) {
  return `<div class="tl-week">
    <div class="tl-week-hdr">
      <span class="tl-week-title">${esc(weekLabel(w.weekStart))}</span>
      <span class="tl-week-counts"><b>${w.counts.commit}</b> commits &middot; <b>${w.counts.session}</b> sessions &middot; <b>${w.counts.pr}</b> PRs &middot; <b>${w.counts.idea}</b> ideas</span>
    </div>
    ${w.days.map((d) => `<div class="tl-day">${esc(dayLabel(d.date))}</div>${d.entries.map(rowHtml).join('')}`).join('')}
  </div>`;
}

function renderChips() {
  const el = document.getElementById('tl-projects');
  if (!el) return;
  el.innerHTML = scopedProjects(projects, scope, work).map((p) => `<button type="button" class="iss-chip${p.id === projectId ? ' on' : ''}" data-project="${esc(p.id)}">${esc(p.name)}</button>`).join('');
}

export function renderTimeline() {
  const el = document.getElementById('tl-weeks');
  if (!el) return;
  const sel = document.getElementById('tl-range');
  if (sel) sel.value = String(range);
  const entries = raw ? buildEntries({ ...raw, ideas: allIdeas(), repoProject }) : [];
  renderChips();
  document.querySelectorAll('#tl-kinds button').forEach((b) => b.classList.toggle('on', kinds.has(b.dataset.kind)));
  const visible = filterEntries(entries, { projectId, kinds: [...kinds] }).filter((e) => inScope(e.projectId, scope, work));
  const weeks = groupByWeek(visible);
  el.innerHTML = weeks.length ? weeks.map(weekHtml).join('') : `<div class="tl-empty">${loading ? 'Loading…' : 'Nothing in this range.'}</div>`;
  const summary = document.getElementById('tl-summary');
  if (summary) {
    const counts = { commit: 0, session: 0, pr: 0, idea: 0 };
    for (const e of visible) counts[e.kind] += 1;
    const weekCount = Math.round(range / 7);
    summary.textContent = `${counts.commit} commits, ${counts.session} sessions, ${counts.pr} PRs, ${counts.idea} idea moves in the last ${weekCount} weeks`;
  }
}

// ── init ───────────────────────────────────────────────────────────────

export function initTimeline() {
  let stored = DEFAULT_RANGE;
  try {
    const raw = Number(localStorage.getItem('timelineRange'));
    if (TIMELINE_RANGES.includes(raw)) stored = raw;
  } catch { /* private mode */ }
  range = stored;

  document.getElementById('tl-range')?.addEventListener('change', (e) => {
    const v = Number(e.target.value);
    if (!TIMELINE_RANGES.includes(v)) return;
    range = v;
    try { localStorage.setItem('timelineRange', String(v)); } catch { /* private mode */ }
    loadTimeline();
  });

  document.getElementById('tl-projects')?.addEventListener('click', (e) => {
    const id = e.target.closest('[data-project]')?.dataset.project;
    if (id === undefined) return;
    projectId = projectId === id ? '' : id;
    renderTimeline();
  });

  document.getElementById('tl-kinds')?.addEventListener('click', (e) => {
    const kind = e.target.closest('[data-kind]')?.dataset.kind;
    if (!kind) return;
    if (kinds.has(kind)) kinds.delete(kind); else kinds.add(kind);
    renderTimeline();
  });

  document.getElementById('tl-weeks')?.addEventListener('click', (e) => {
    const row = e.target.closest('.tl-row');
    if (!row) return;
    const { kind, id, url, repo } = row.dataset;
    if (kind === 'session') { if (url) window.openIssue(url); return; }
    if (kind === 'pr') { if (url) window.electronAPI.openExternal(url); return; }
    if (kind === 'idea') { window.setView('ideas'); selectIdea(id); return; }
    if (kind === 'commit' && repo) {
      const at = window.repoPath(repo);
      if (!at) { window.showToast('Not copied: "' + repo + '" is not a safe repo name', 5000); return; }
      window.copyText(`cd ${at} && git show ${id}`);
      window.showToast('Copied git show ' + id);
    }
  });
}

Object.assign(window, { renderTimeline });
