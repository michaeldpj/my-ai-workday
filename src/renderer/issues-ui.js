/**
 * The Issues view: a project's GitHub issues across all of its repos, read
 * only, as a three-pane mail client. Every rule about rows lives in
 * issue-model.js; this file paints and wires.
 */
import {
  ISSUE_KINDS, ISSUE_STATES, ISSUE_SORTS,
  classifyIssue, filterIssues, issueComparator, journalGroups, isUnread, isPullRequest,
} from './issue-model.js';
import { ideaByIssueUrl, selectIdea } from './ideas-ui.js';
import { renderMarkdown } from './markdown.js';
import { esc, timeAgo } from './text.js';

const STALE_MS = 5 * 60 * 1000;

const ERROR_TEXT = {
  ENOENT: 'gh is not installed or not on PATH',
  timeout: 'gh timed out',
  exit: 'gh could not read it: not signed in, or the repo is not on GitHub',
  parse: 'gh returned something unreadable',
  none: 'not fetched yet',
};

let projects = [];
let prefs = { projectId: '', kind: 'all', state: 'open', sort: 'updated' };
let rows = [];
let failedRepos = [];
let fetchedAt = null;
let readMap = {};
let repoFilter = '';
let labelFilter = '';
let query = '';
let selKey = null;
let loading = null; // project id of the fetch in flight, so a late answer for another project is dropped


// ── projects ───────────────────────────────────────────────────────────

/** Same shape and reason as setIdeaProjects: app.js owns the project list. */
export function setIssueProjects(list) {
  projects = (list || []).map((p) => ({ id: p.id, name: p.name }));
  const sel = document.getElementById('iss-project');
  if (!sel) return;
  sel.innerHTML = projects.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  if (prefs.projectId && projects.some((p) => p.id === prefs.projectId)) sel.value = prefs.projectId;
}

// ── data ───────────────────────────────────────────────────────────────

function adopt(res) {
  if (!res || res.ok === false) { if (res?.error) window.showToast(res.error, 6000); return; }
  readMap = res.read || {};
  const snap = res.cache;
  if (!snap) { rows = []; failedRepos = []; fetchedAt = null; return; }
  fetchedAt = snap.fetchedAt;
  const errors = snap.errors || {};
  // Every error, plus any repo with no file yet: cached rows do not mean the refresh worked.
  failedRepos = Object.entries(errors).concat(
    Object.entries(snap.repos).filter(([k, v]) => v === null && !(k in errors)).map(([k]) => [k, 'none']));
  rows = Object.values(snap.repos).flat().filter(Boolean)
    .map((r) => ({ ...r, kind: classifyIssue(r, ideaByIssueUrl) }));
}

async function loadProject() {
  const pid = prefs.projectId;
  if (!pid) return;
  const res = await window.electronAPI.issuesLoad(pid);
  if (prefs.projectId !== pid) return;
  adopt(res);
  renderIssues();
  const stale = !fetchedAt || Date.now() - new Date(fetchedAt).getTime() > STALE_MS;
  if (stale) await refreshIssues();
}

export async function refreshIssues() {
  const pid = prefs.projectId;
  if (!pid || loading === pid) return;
  loading = pid;
  document.getElementById('iss-refresh')?.classList.add('loading');
  let res;
  try {
    res = await window.electronAPI.issuesFetch(pid);
  } finally {
    if (loading === pid) {
      loading = null;
      document.getElementById('iss-refresh')?.classList.remove('loading');
    }
  }
  // The user may have switched projects while gh was running.
  if (prefs.projectId !== pid) return;
  adopt(res);
  renderIssues();
}

async function savePref(partial) {
  prefs = { ...prefs, ...partial };
  const res = await window.electronAPI.issuesPrefsSet(partial);
  if (res?.ok === false) window.showToast(res.error, 6000);
}

// ── list ───────────────────────────────────────────────────────────────

function visibleRows() {
  const list = filterIssues(rows, { kind: prefs.kind, state: prefs.state, repo: repoFilter, label: labelFilter, query });
  return prefs.kind === 'journal' ? list : list.sort(issueComparator(prefs.sort));
}

function chip(kind, value, on) {
  return `<button type="button" class="iss-chip${on ? ' on' : ''}" data-${kind}="${esc(value)}">${esc(value)}</button>`;
}

function renderChips() {
  const repos = [...new Set(rows.map((r) => r.repo))].sort();
  const labels = [...new Set(rows.flatMap((r) => r.labels))].sort();
  document.getElementById('iss-repos').innerHTML = repos.length > 1 ? repos.map((r) => chip('repo', r, r === repoFilter)).join('') : '';
  document.getElementById('iss-labels').innerHTML = labels.map((l) => chip('label', l, l === labelFilter)).join('');
}

function rowHtml(r) {
  const unread = isUnread(r, readMap);
  const labels = r.labels.filter((l) => l !== 'session-log').slice(0, 3)
    .map((l) => `<span class="iss-label">${esc(l)}</span>`).join('');
  const pr = isPullRequest(r);
  const kind = r.kind === 'idea' ? '<span class="iss-kind-idea" title="On the Ideas board">&#x25C7;</span>'
    : pr ? '<span class="iss-kind-pr" title="Pull request">&#x21C4;</span>' : '';
  const prMeta = pr ? `<span class="iss-branch">${esc(r.branch)}</span>${r.mergedAt ? ' <span class="iss-tag merged">merged</span>' : r.draft ? ' <span class="iss-tag">draft</span>' : ''}` : '';
  const n = r.comments.length ? `&#x1F4AC; ${r.comments.length}` : '';
  return `<div class="iss-row${unread ? ' unread' : ''}${r.key === selKey ? ' sel' : ''}" data-key="${esc(r.key)}">
    <span class="iss-dot"></span>
    <div>
      <div class="iss-row-title">${kind}${esc(r.title)}</div>
      <div class="iss-row-meta"><span class="iss-repo">${esc(r.repo)}</span> #${r.number} ${prMeta} ${labels} ${n}</div>
    </div>
    <span class="iss-row-when" title="${esc(r.updatedAt)}">${timeAgo(r.updatedAt)}</span>
  </div>`;
}

function failureNote() {
  if (!failedRepos.length) return '';
  const items = failedRepos.map(([name, code]) => `${esc(name)}: ${ERROR_TEXT[code] || esc(code)}`).join('; ');
  return `<div class="iss-note">${items}.</div>`;
}

function renderRows(list) {
  const el = document.getElementById('iss-rows');
  if (!prefs.projectId) { el.innerHTML = '<div class="iss-empty">Pick a project.</div>'; return; }
  const note = failureNote();
  if (!list.length) {
    el.innerHTML = note + `<div class="iss-empty">${loading ? 'Reading issues…' : 'Nothing matches.'}</div>`;
    return;
  }
  if (prefs.kind === 'journal') {
    el.innerHTML = note + journalGroups(list)
      .map((g) => `<div class="iss-date">${esc(g.date)}</div>` + g.rows.map(rowHtml).join('')).join('');
    return;
  }
  el.innerHTML = note + list.map(rowHtml).join('');
}

function paintControls() {
  document.querySelectorAll('#iss-kind button').forEach((b) => b.classList.toggle('on', b.dataset.kind === prefs.kind));
  // Journal ignores state in the model, so the segment shows closed without touching the pref.
  const journal = prefs.kind === 'journal';
  const shownState = journal ? 'closed' : prefs.state;
  document.querySelectorAll('#iss-state button').forEach((b) => {
    b.classList.toggle('on', b.dataset.state === shownState);
    b.disabled = journal;
  });
  const sort = document.getElementById('iss-sort');
  sort.value = prefs.sort;
  sort.disabled = prefs.kind === 'journal';
  const f = document.getElementById('iss-fetched');
  f.textContent = fetchedAt ? `fetched ${timeAgo(fetchedAt)}` : '';
}

export function renderIssues() {
  if (!document.getElementById('issues-view')) return;
  paintControls();
  renderChips();
  const list = visibleRows();
  if (selKey && !list.some((r) => r.key === selKey)) selKey = null;
  renderRows(list);
  renderPane();
}

// ── pane ───────────────────────────────────────────────────────────────

function message(author, at, body, first) {
  return `<div class="iss-msg">
    <div class="iss-msg-hdr"><b>${esc(author || 'unknown')}</b><span title="${esc(at)}">${first ? 'opened' : 'commented'} ${esc(timeAgo(at))}</span></div>
    <div class="iss-msg-body">${body.trim() ? renderMarkdown(body) : '<em>No description.</em>'}</div>
  </div>`;
}

function ideaLine(r) {
  const idea = ideaByIssueUrl(r.url);
  if (!idea) return '';
  return `<span class="iss-idea-link">&#x25C7; on the board as <b>${esc(idea.stage)}</b>
    <button type="button" class="btn" data-idea="${esc(idea.id)}">Show on board</button></span>`;
}

function renderPane() {
  const el = document.getElementById('iss-pane');
  if (!el) return;
  const r = rows.find((x) => x.key === selKey);
  if (!r) { el.innerHTML = '<div class="iss-pane-empty">Select an issue. j / k to move, Enter to read, o to open on GitHub.</div>'; return; }
  const labels = r.labels.map((l) => `<span class="iss-label${l === 'session-log' ? ' journal' : ''}">${esc(l)}</span>`).join('');
  const state = r.mergedAt ? 'merged' : r.state;
  el.innerHTML = `
    <h1>${esc(r.title)}</h1>
    <div class="iss-pane-meta">
      <span class="iss-state ${state}">${state}</span>
      <span class="iss-repo">${esc(r.repo)}</span>
      ${isPullRequest(r) ? `<span class="iss-branch">${esc(r.branch)}</span>` : ''}
      <a href="${esc(r.url)}" target="_blank" rel="noopener">#${r.number}</a>
      ${labels}
      ${ideaLine(r)}
    </div>
    ${message(r.author, r.createdAt, r.body, true)}
    ${r.comments.map((c) => message(c.author, c.createdAt, c.body, false)).join('')}`;
  el.scrollTop = 0;
}

function select(key) {
  selKey = key;
  const r = rows.find((x) => x.key === key);
  if (r && isUnread(r, readMap)) {
    readMap = { ...readMap, [key]: r.updatedAt };
    window.electronAPI.issuesMarkRead(prefs.projectId, key, r.updatedAt);
  }
  renderIssues();
  document.querySelector(`.iss-row[data-key="${CSS.escape(key)}"]`)?.scrollIntoView({ block: 'nearest' });
}

function moveSel(delta) {
  const keys = [...document.querySelectorAll('.iss-row')].map((el) => el.dataset.key);
  if (!keys.length) return;
  const i = keys.indexOf(selKey);
  const next = i < 0 ? (delta > 0 ? 0 : keys.length - 1) : Math.max(0, Math.min(keys.length - 1, i + delta));
  select(keys[next]);
}

/** Move the view onto a project with fresh local filters, then read its rows. */
async function openProject(pid, partial) {
  selKey = null; repoFilter = ''; labelFilter = '';
  await savePref({ projectId: pid, ...partial });
  document.getElementById('iss-project').value = pid;
  await loadProject();
}

/**
 * Reached from a card on the Ideas board. The card knows its project, so
 * switch to that project, fetch if the cache is missing or has not seen the
 * issue yet, then select the row.
 */
export async function openIssueByUrl(url) {
  window.setView('issues');
  const inCurrent = rows.find((r) => r.url === url);
  if (inCurrent) { select(inCurrent.key); return; }
  const pid = ideaByIssueUrl(url)?.projectId;
  if (!pid || !projects.some((p) => p.id === pid)) {
    window.showToast('That card has no project, so there is nowhere to look for its issue.', 6000);
    return;
  }
  await openProject(pid, { kind: 'all', state: 'all' });
  if (!rows.some((r) => r.url === url)) await refreshIssues();
  const hit = rows.find((r) => r.url === url);
  if (hit) select(hit.key);
  else window.showToast('That issue is not among the ones gh returned for its project.', 6000);
}

/** Open the view on a project, optionally on one kind. From the dashboard card's rollup. */
export async function showProject(pid, kind = 'all') {
  window.setView('issues');
  if (!projects.some((p) => p.id === pid)) return;
  await openProject(pid, { kind, state: 'open' });
}

// ── init ───────────────────────────────────────────────────────────────

function setKind(kind) {
  if (!ISSUE_KINDS.includes(kind)) return;
  savePref({ kind });
  renderIssues();
}

/** Delegated click on a group of buttons or chips: hands the picked data value to apply. */
function onPick(id, attr, apply) {
  document.getElementById(id)?.addEventListener('click', (e) => {
    const v = e.target.closest(`[data-${attr}]`)?.dataset[attr];
    if (v !== undefined) apply(v);
  });
}

export async function initIssues() {
  try { prefs = { ...prefs, ...(await window.electronAPI.issuesPrefsGet()) }; } catch { /* defaults */ }
  const projSel = document.getElementById('iss-project');
  if (!prefs.projectId && projects[0]) prefs.projectId = projects[0].id;
  if (projSel && prefs.projectId) projSel.value = prefs.projectId;

  projSel?.addEventListener('change', (e) => openProject(e.target.value, {}));
  onPick('iss-kind', 'kind', setKind);
  onPick('iss-state', 'state', (v) => { if (ISSUE_STATES.includes(v)) { savePref({ state: v }); renderIssues(); } });
  document.getElementById('iss-sort')?.addEventListener('change', (e) => {
    if (ISSUE_SORTS.includes(e.target.value)) { savePref({ sort: e.target.value }); renderIssues(); }
  });
  onPick('iss-repos', 'repo', (v) => { repoFilter = repoFilter === v ? '' : v; renderIssues(); });
  onPick('iss-labels', 'label', (v) => { labelFilter = labelFilter === v ? '' : v; renderIssues(); });
  document.getElementById('iss-search')?.addEventListener('input', (e) => { query = e.target.value; renderIssues(); });
  document.getElementById('iss-refresh')?.addEventListener('click', refreshIssues);

  document.getElementById('iss-rows')?.addEventListener('click', (e) => {
    const key = e.target.closest('.iss-row')?.dataset.key;
    if (key) select(key);
  });
  document.getElementById('iss-pane')?.addEventListener('click', (e) => {
    const ideaId = e.target.closest('[data-idea]')?.dataset.idea;
    if (ideaId) { window.setView('ideas'); selectIdea(ideaId); return; }
    const a = e.target.closest('a[href]');
    if (!a) return;
    e.preventDefault();
    window.electronAPI.openExternal(a.href);
  });
  document.addEventListener('keydown', (e) => {
    if (document.body.dataset.view !== 'issues') return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      if (e.key === 'Escape') document.activeElement.blur();
      return;
    }
    if (e.key === '/') { e.preventDefault(); document.getElementById('iss-search')?.focus(); return; }
    if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); return moveSel(1); }
    if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); return moveSel(-1); }
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('iss-pane')?.focus(); return; }
    if (e.key === 'o') {
      const r = rows.find((x) => x.key === selKey);
      if (r) window.electronAPI.openExternal(r.url);
      return;
    }
    if (e.key === 'Escape' && selKey) { selKey = null; renderIssues(); }
  });

  window.electronAPI.onIssuesChanged?.(() => loadProject());

  loadProject();
}

Object.assign(window, { renderIssues, openIssue: openIssueByUrl });
