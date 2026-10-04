import { loadIdeas, renderIdeas, initIdeaDrag, initIdeaActions, subscribeIdeas, setIdeaProjects, focusIdeaCapture, loadBoardPrefs, loadLaunchPrefs, allIdeas } from './ideas-ui.js';
import { renderMarkdown } from './markdown.js';
import { esc, jsAttr, timeAgo } from './text.js';
import { setIssueProjects, renderIssues, initIssues, refreshIssues, showProject } from './issues-ui.js';
import { setTimelineProjects, setTimelineScope, loadTimeline, initTimeline, renderTimeline } from './timeline-ui.js';
import { setSummaryProjects, setSummaryScope, loadSummary, initSummary, renderSummary, loadActivity, activityLine } from './summary-ui.js';
import { inScope, DEFAULT_SCOPE } from './scope-model.js';
import { ageTier, oldestSignal, dropMergedBranches, projectSignal } from './repo-age.js';
import { deriveRepoStatus } from './repo-status.js';
import { formatAge } from './idea-age.js';
import { inFlightCount } from './idea-model.js';
import { projectIdFor, newProject, cardNameError, deleteBlocker, deleteConfirmText, moveRepo, buildDepChoices, liveWorkIds } from './card-model.js';
import { ALL_STATUSES, PLATFORMS, PRIORITIES, FOCUS_TONES, shellRepoPath, gitPushArgs } from './workspace-model.js';

// ── STATE ──────────────────────────────────────────────────────────────────
let ws = [];
let lists = [];
let today = [];
let doneToday = [];
let inbox = [];
let todayDate = '';
let lastScanned = null;
let scanning = false;
let hasAIKey = false;
let issueCounts = {};
let scopePrefs = { scope: DEFAULT_SCOPE, work: [] };
const pOpen = {};
const lastCommits = {};
// Last good PR-state map per repo, kept so a failed gh call (offline,
// rate-limited) does not flip squash-merged branches back to unmerged.
const lastPrs = {};
// Branches holding local-only commits per repo, from the last scan. Push
// reads it, because `git push` alone pushes only the checked-out branch.
const lastUnpushed = {};
let dragState = null;
let doneOpen = false;
let decomposeTarget = null;

const SL = { active: 'Active', 'needs-push': 'Needs Push', 'needs-commit': 'Needs Commit', 'needs-merge': 'Needs Merge', blocked: 'Blocked', parked: 'Parked', stable: 'Stable', done: 'Done' };
// One list for every attention surface. The tray badge in src/main/index.js
// keeps its own copy (separate process) and must change in step with this.
const ATTN_STATUSES = ['needs-push', 'needs-commit', 'needs-merge', 'blocked'];
// Every real checkout under the github root, filled once at startup. The add
// field offers these and refuses anything else, because a repo name that
// matches no directory reports nothing forever instead of failing loudly.
let availableRepos = [];
// Repo folder, personal CLI folder, dashboard link. Main owns and validates
// them, and init reads them before the first render. The empty root makes
// shellRepoPath refuse, so a copy before the load can never paste a guess.
let appSettings = { githubPath: '', personalClaudeDir: '', dashboardUrl: '' };

function applyAppSettings(s) {
  if (s) appSettings = { ...appSettings, ...s };
  const dash = document.getElementById('dash-btn');
  if (dash) dash.hidden = !appSettings.dashboardUrl;
}

function repoPath(name) { return shellRepoPath(name, appSettings.githubPath); }
const PI = {
  done:    { icon: '✓', color: '#3fb950' },
  blocked: { icon: '⊘', color: '#f85149' },
  todo:    { icon: '○', color: '#58a6ff' },
  active:  { icon: '●', color: '#e3b341' },
  'n/a':   { icon: '—', color: '#484f58' },
  unknown: { icon: '?',      color: '#6e7681' },
};

// ── UTILS ──────────────────────────────────────────────────────────────────
function daysSince(d) { if (!d) return null; const v = Math.floor((Date.now() - new Date(d).getTime()) / 86400000); return v >= 0 ? v : null; }


function showToast(msg, dur) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._tid);
  t._tid = setTimeout(() => t.classList.remove('show'), dur || 3000);
}

function copyText(t) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(t).then(() => true).catch(() => false);
  return Promise.resolve(false);
}

function copyToast(t, label) {
  copyText(t).then(ok => {
    if (ok) showToast((label || 'Copied') + ' — paste in Terminal');
    else showCopyOverlay(t);
  });
}

function showCopyOverlay(text) {
  const ta = document.getElementById('copy-ta'), ov = document.getElementById('copy-overlay');
  if (ta) ta.value = text;
  if (ov) ov.classList.add('show');
  setTimeout(() => { if (ta) { ta.focus(); ta.select(); } }, 50);
}

function closeCopyOverlay() { document.getElementById('copy-overlay')?.classList.remove('show'); }

// ── SAVE ───────────────────────────────────────────────────────────────────
function validateParity(data) {
  data.forEach(p => {
    if (!p.parity) return;
    const platforms = p.parity.platforms;
    p.parity.features.forEach(f => {
      const keys = Object.keys(f.cov);
      const missing = platforms.filter(pl => !keys.includes(pl));
      const extra = keys.filter(k => !platforms.includes(k));
      if (missing.length) console.warn(`[Parity] ${p.name} / ${f.name}: missing cov for: ${missing.join(', ')}`);
      if (extra.length) console.warn(`[Parity] ${p.name} / ${f.name}: extra cov keys: ${extra.join(', ')}`);
    });
  });
}

// Resolves true once main has stored the workspace. Create and delete wait for
// it before writing the work list, which main checks against the stored ids.
async function autoSave() {
  validateParity(ws);
  try {
    const result = await window.electronAPI.saveState({ ws, lists, today, doneToday, inbox, todayDate });
    if (result?.error) { showToast('Save failed: ' + result.error, 5000); return false; }
    return true;
  } catch (err) {
    showToast('Save failed: ' + (err.message || err), 5000);
    return false;
  }
}

function localDate() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function checkMidnightReset() {
  const now = localDate();
  if (todayDate && todayDate !== now) {
    doneToday = [];
    today.forEach(t => {
      if (t.done) doneToday.push({ text: t.text, project: 'Today (prev)', doneAt: Date.now() });
    });
    today = [];
    autoSave().then(() => { todayDate = now; });
    return;
  }
  todayDate = now;
}

// ── RENDER ─────────────────────────────────────────────────────────────────
function countOpen(p) { return p.tasks.filter(t => !t.done).length; }
function countListOpen(l) { return l.tasks.filter(t => !t.done).length; }
function countDone(tasks) { return tasks.filter(t => t.done).length; }

function sortedTasks(tasks) {
  const open = [], done = [];
  tasks.forEach((t, i) => (t.done ? done : open).push({ task: t, origIdx: i }));
  return [...open, ...done];
}

let renderLocked = false;

const VIEWS = ['dashboard', 'ideas', 'issues', 'lists', 'timeline', 'summary'];

function setView(view) {
  if (!VIEWS.includes(view)) return;
  document.body.dataset.view = view;
  try { localStorage.setItem('view', view); } catch { /* private mode */ }
  if (view === 'ideas') renderIdeas();
  if (view === 'issues') renderIssues();
  if (view === 'timeline') loadTimeline();
  if (view === 'summary') loadSummary();
}

// ── SCOPE ──────────────────────────────────────────────────────────────────
// Work or personal, from the header. The Dashboard, Timeline, and Summary
// follow it; Ideas, Issues, Lists, and the tray badge do not.
function inView(p) { return inScope(p.id, scopePrefs.scope, scopePrefs.work); }

function applyScope(prefs) {
  scopePrefs = { scope: prefs.scope, work: prefs.work };
  setTimelineScope(scopePrefs.scope, scopePrefs.work);
  setSummaryScope(scopePrefs.scope, scopePrefs.work);
  document.querySelectorAll('#scope-seg button').forEach((b) => b.classList.toggle('on', b.dataset.scope === scopePrefs.scope));
}

async function saveScope(partial) {
  const res = await window.electronAPI.scopePrefsSet(partial);
  if (!res.ok) { showToast(res.error); return; }
  applyScope(res);
  render();
  if (document.body.dataset.view === 'timeline') renderTimeline();
  if (document.body.dataset.view === 'summary') renderSummary();
}

function setScope(scope) { if (scope !== scopePrefs.scope) saveScope({ scope }); }

// The Today card's activity line: summary-ui owns the fetch, this repaints the card.
function refreshActivity() { loadActivity().then(renderToday); }

function render() {
  if (renderLocked) return;
  renderStats();
  renderInbox();
  renderToday();
  renderDoneToday();
  renderAttn();
  renderGrid();
  renderLists();
  setIdeaProjects(ws);
  setIssueProjects(ws);
  setTimelineProjects(ws);
  setSummaryProjects(ws);
  paintRepoEditor();
  updateSyncTime();
}

function updateSyncTime() {
  const el = document.getElementById('sync-time');
  if (!lastScanned) { el.textContent = 'Not yet scanned — click Scan'; el.className = 'stale'; return; }
  const mins = Math.floor((Date.now() - lastScanned) / 60000);
  const hrs = Math.floor(mins / 60);
  if (hrs >= 1) { el.textContent = 'Last scanned ' + hrs + 'h ago'; el.className = ''; }
  else if (mins >= 1) { el.textContent = 'Last scanned ' + mins + 'm ago'; el.className = ''; }
  else { el.textContent = 'Last scanned just now'; el.className = ''; }
}

function renderStats() {
  const vis = ws.filter(inView);
  const active = vis.filter(p => p.status === 'active').length;
  const attnR = vis.flatMap(p => p.repos).filter(r => ATTN_STATUSES.includes(r.status));
  const blocked = vis.filter(p => p.focusTone === 'err').length;
  const open = vis.reduce((n, p) => n + countOpen(p), 0) + lists.reduce((n, l) => n + countListOpen(l), 0);
  const doneCount = doneToday.length;
  document.getElementById('stats-row').innerHTML =
    '<div class="stat"><div class="stat-icon">&#x1F680;</div><div><div class="stat-num num-blue">' + active + '</div><div class="stat-lbl">Active Projects</div></div></div>' +
    '<div class="stat"><div class="stat-icon">&#x26A0;&#xFE0F;</div><div><div class="stat-num num-amber">' + attnR.length + '</div><div class="stat-lbl">Repos Need Attention</div></div></div>' +
    '<div class="stat"><div class="stat-icon">&#x1F6AB;</div><div><div class="stat-num num-red">' + blocked + '</div><div class="stat-lbl">Blocked on External</div></div></div>' +
    '<div class="stat"><div class="stat-icon">&#x2705;</div><div><div class="stat-num" style="color:var(--stable)">' + doneCount + '</div><div class="stat-lbl">Done Today</div></div></div>';
}

function agePill(s) {
  if (!s) return '';
  const tier = ageTier(s.at);
  const what = (s.repo ? s.repo + ' ' : '') + (s.kind === 'branch' ? 'branch ' + s.branch : s.kind);
  return '<span class="age-pill ' + tier + '" title="' + esc(what) + ' since ' + esc(s.at.slice(0, 10)) + '">' + formatAge(Date.now() - Date.parse(s.at)) + '</span>';
}

function renderAttn() {
  const el = document.getElementById('attn');
  const repos = ws.filter(inView).flatMap(p => p.repos).filter(r => ATTN_STATUSES.includes(r.status));
  if (!repos.length) { el.classList.remove('show'); return; }
  el.classList.add('show');
  // Oldest first, undated last: the chip strip is a queue, not a list.
  const dated = repos.map(r => ({ r, s: oldestSignal(r.since) }))
    .sort((a, b) => (a.s?.at || '\uffff') < (b.s?.at || '\uffff') ? -1 : 1);
  const analyzeBtn = hasAIKey && lastScanned ? ' <button class="btn-analyze" onclick="openAnalyze()">&#x26A1; Analyze Statuses</button>' : '';
  el.innerHTML = '<div class="attn-title">&#x26A1; Needs Attention' + analyzeBtn + '</div><div class="chips">' +
    dated.map(({ r, s }) => '<span class="chip ' + esc(r.status) + '">' + esc(r.name) + agePill(s) + '</span>').join('') + '</div>';
}

function renderGrid() {
  // One datalist for every card. Per-card copies would collide on the id and
  // duplicate 56 options across ten cards for nothing.
  const opts = availableRepos.map(n => '<option value="' + esc(n) + '"></option>').join('');
  // Work starts checked under the Work scope, or the new card would vanish on save.
  const workChecked = scopePrefs.scope === 'work' ? ' checked' : '';
  const newCard = '<div class="card new-card"><div class="add-row">' +
    '<input class="add-input" id="new-card-name" maxlength="60" placeholder="New card..." onkeydown="if(event.key===\'Enter\')addProject()">' +
    '<label class="new-card-work"><input type="checkbox" id="new-card-work"' + workChecked + '> Work</label>' +
    '<button class="add-btn" onclick="addProject()" title="Add card">+</button></div></div>';
  document.getElementById('grid').innerHTML =
    // The real workspace index, not the filtered one: project drag splices ws by it.
    ws.map((p, i) => inView(p) ? buildCard(p, i) : '').join('') + newCard + '<datalist id="repo-opts">' + opts + '</datalist>';
}
function renderLists() { document.getElementById('lists-grid').innerHTML = lists.map(buildListCard).join(''); }

// ── TODAY PANEL ────────────────────────────────────────────────────────────
function renderToday() {
  const el = document.getElementById('today-panel');
  const activityHtml = activityLine();
  if (!today.length && !activityHtml && !el.innerHTML) { el.innerHTML = ''; return; }
  const openCount = today.filter(t => !t.done).length;
  const sorted = sortedTasks(today);
  const rows = sorted.map(({ task: t, origIdx: i }) =>
    '<div class="today-row' + (t.done ? ' done' : '') + '" data-today-idx="' + i + '">' +
    '<input type="checkbox" ' + (t.done ? 'checked' : '') + ' onchange="toggleTodayItem(' + i + ',this.checked)">' +
    '<span class="today-text" onclick="editTodayItem(' + i + ')">' + esc(t.text) + '</span>' +
    '<button class="del-task" onclick="deleteTodayItem(' + i + ')" title="Remove">&#x2715;</button></div>'
  ).join('');
  const activityBlock = activityHtml ? '<div class="today-activity">' + activityHtml + '</div>' : '';
  el.innerHTML = '<div class="today-card"><div class="today-hdr"><h3>&#x1F3AF; Today</h3><span class="today-count">' + openCount + ' remaining</span></div>' +
    activityBlock +
    '<div class="today-body">' + rows +
    '<div class="add-row"><input class="add-input" id="today-input" placeholder="Add to today…" onkeydown="if(event.key===\'Enter\')addToToday()">' +
    '<button class="add-btn" onclick="addToToday()">+</button></div></div></div>';
}

function addToToday(text) {
  const inp = document.getElementById('today-input');
  const t = text || inp?.value?.trim();
  if (!t) return;
  today.push({ id: Date.now(), text: t, done: false, addedAt: new Date().toISOString() });
  if (inp) inp.value = '';
  autoSave();
  render();
}

function toggleTodayItem(idx, checked) {
  if (!today[idx]) return;
  today[idx].done = checked;
  if (checked) {
    doneToday.push({ text: today[idx].text, project: 'Today', doneAt: Date.now() });
    const row = document.querySelector('[data-today-idx="' + idx + '"]');
    animateAndRender(row);
    return;
  } else {
    const text = today[idx].text;
    const di = doneToday.findIndex(d => d.text === text && d.project === 'Today');
    if (di >= 0) doneToday.splice(di, 1);
  }
  autoSave();
  render();
}

function deleteTodayItem(idx) {
  today.splice(idx, 1);
  autoSave();
  render();
}

function sendToToday(pid, ti) {
  const p = ws.find(x => x.id === pid);
  if (!p?.tasks[ti]) return;
  addToToday(p.tasks[ti].text);
}

function sendListToToday(lid, ti) {
  const l = lists.find(x => x.id === lid);
  if (!l?.tasks[ti]) return;
  addToToday(l.tasks[ti].text);
}

// ── DONE TODAY ─────────────────────────────────────────────────────────────
function renderDoneToday() {
  const el = document.getElementById('done-today');
  if (!doneToday.length) { el.innerHTML = ''; return; }
  const rows = doneToday.map(d =>
    '<div class="done-row"><span class="done-check">&#x2713;</span><span style="flex:1">' + esc(d.text) + '</span>' +
    '<span class="done-proj">' + esc(d.project || '') + '</span></div>'
  ).join('');
  el.innerHTML = '<div class="done-card"><div class="done-hdr" onclick="toggleDoneOpen()"><h3>&#x2705; Done Today (' + doneToday.length + ')</h3><span style="color:var(--muted);font-size:12px">' + (doneOpen ? '▾' : '▸') + '</span></div>' +
    '<div class="done-body' + (doneOpen ? ' open' : '') + '">' + rows + '</div></div>';
}

function toggleDoneOpen() { doneOpen = !doneOpen; renderDoneToday(); }

// ── INBOX ──────────────────────────────────────────────────────────────────
function renderInbox() {
  const el = document.getElementById('inbox-items');
  if (!inbox.length) { el.innerHTML = ''; return; }
  const rows = inbox.map((item, i) =>
    '<div class="inbox-row">' +
    '<span class="inbox-text">' + esc(item.text) + '</span>' +
    '<button class="inbox-assign" onclick="openAssignPicker(' + i + ',event)">Assign</button>' +
    '<button class="del-task" style="opacity:.5" onclick="deleteInboxItem(' + i + ')">&#x2715;</button></div>'
  ).join('');
  el.innerHTML = '<div class="inbox-card"><div class="inbox-title">&#x1F4E5; Inbox (' + inbox.length + ')</div>' + rows + '</div>';
}

function addToInbox() {
  const inp = document.getElementById('inbox-input');
  const text = inp?.value?.trim();
  if (!text) return;
  inbox.push({ id: Date.now(), text, addedAt: new Date().toISOString() });
  inp.value = '';
  autoSave();
  render();
}

function deleteInboxItem(idx) {
  inbox.splice(idx, 1);
  autoSave();
  render();
}

function openAssignPicker(idx, e) {
  e.stopPropagation();
  document.querySelectorAll('.assign-picker').forEach(el => el.remove());
  const rect = e.currentTarget.getBoundingClientRect();
  const picker = document.createElement('div');
  picker.className = 'assign-picker';
  picker.style.cssText = 'position:fixed;top:' + (rect.bottom + 4) + 'px;left:' + Math.min(rect.left, window.innerWidth - 200) + 'px;z-index:9000;';
  let html = '<div class="ap-header">Projects</div>';
  ws.forEach(p => { html += '<div class="ap-opt" onclick="doAssign(' + idx + ',\'project\',\'' + jsAttr(p.id) + '\')">' + esc(p.name) + '</div>'; });
  html += '<div class="ap-header">Lists</div>';
  lists.forEach(l => { html += '<div class="ap-opt" onclick="doAssign(' + idx + ',\'list\',\'' + jsAttr(l.id) + '\')">' + esc(l.icon) + ' ' + esc(l.name) + '</div>'; });
  html += '<div class="ap-header">Other</div>';
  html += '<div class="ap-opt" onclick="doAssign(' + idx + ',\'today\',\'\')">\u{1F3AF} Today</div>';
  picker.innerHTML = html;
  document.body.appendChild(picker);
  setTimeout(() => {
    const close = (ev) => { if (!picker.contains(ev.target)) { picker.remove(); document.removeEventListener('click', close); } };
    document.addEventListener('click', close);
  }, 0);
}

function doAssign(idx, targetType, targetId) {
  const item = inbox[idx];
  if (!item) return;
  const task = { done: false, text: item.text };
  if (targetType === 'project') {
    const p = ws.find(x => x.id === targetId);
    if (p) p.tasks.push(task);
  } else if (targetType === 'list') {
    const l = lists.find(x => x.id === targetId);
    if (l) l.tasks.push(task);
  } else if (targetType === 'today') {
    today.push({ id: Date.now(), text: item.text, done: false, addedAt: new Date().toISOString() });
  }
  inbox.splice(idx, 1);
  document.querySelectorAll('.assign-picker').forEach(el => el.remove());
  autoSave();
  render();
  const label = targetType === 'today' ? 'Today'
    : targetType === 'project' ? (ws.find(x => x.id === targetId)?.name || targetId)
    : (lists.find(x => x.id === targetId)?.name || targetId);
  showToast('Moved to ' + label);
}

// ── LIST CARD ──────────────────────────────────────────────────────────────
function buildListCard(l) {
  const open = countListOpen(l);
  const done = countDone(l.tasks);
  const total = l.tasks.length;
  const pct = total > 0 ? Math.round(((total - open) / total) * 100) : 0;
  const sorted = sortedTasks(l.tasks);
  const tasksHtml = sorted.map(({ task: t, origIdx: ti }) =>
    '<div class="task-row ' + (t.done ? 'done' : '') + '" draggable="true" data-drag="list-task" data-pid="' + esc(l.id) + '" data-idx="' + ti + '">' +
    '<span class="drag-handle">&#x2847;</span>' +
    '<input type="checkbox" ' + (t.done ? 'checked' : '') + ' onchange="toggleListTask(\'' + jsAttr(l.id) + '\',' + ti + ',this.checked)">' +
    '<span class="task-lbl" onclick="editListTask(\'' + jsAttr(l.id) + '\',' + ti + ')">' + esc(t.text) + '</span>' +
    '<button class="send-today" onclick="sendListToToday(\'' + jsAttr(l.id) + '\',' + ti + ')" title="Add to Today">→ Today</button>' +
    '<button class="del-task" onclick="deleteListTask(\'' + jsAttr(l.id) + '\',' + ti + ')" title="Delete">&#x2715;</button></div>'
  ).join('');
  const empty = total === 0 ? '<div style="color:var(--muted);font-size:13px;padding:8px 0 4px;">No tasks yet</div>' : '';
  const overflowHint = total > 6 ? '<div class="task-overflow-hint">' + (total - 6) + ' more below ↓</div>' : '';
  const clearBtn = done > 0 ? '<button class="clear-done-btn" onclick="clearListDone(\'' + jsAttr(l.id) + '\')">Clear ' + done + ' done</button>' : '';
  const progressBar = total > 0 ? '<div class="task-progress"><div class="task-progress-fill" style="width:' + pct + '%"></div></div>' : '';
  const delBtn = '<button class="list-del" onclick="deleteList(\'' + jsAttr(l.id) + '\')" title="Delete list">&#x2715;</button>';
  return '<div class="card"><div class="card-hdr"><div class="card-title">' + esc(l.icon) + ' ' + esc(l.name) + '</div>' +
    '<span class="list-open-count">' + open + ' open</span>' + delBtn + '</div><div class="card-body">' + empty +
    progressBar + '<div class="task-scroll">' + tasksHtml + '</div>' + overflowHint + clearBtn +
    '<div class="add-row"><input class="add-input" placeholder="Add a task..." id="lni-' + esc(l.id) + '" onkeydown="if(event.key===\'Enter\')addListTask(\'' + jsAttr(l.id) + '\')">' +
    '<button class="add-btn" onclick="addListTask(\'' + jsAttr(l.id) + '\')">+</button></div></div></div>';
}

// ── PROJECT CARD ───────────────────────────────────────────────────────────
async function loadIssueCounts() {
  try { issueCounts = await window.electronAPI.issuesCounts(); } catch { return; }
  renderGrid();
}

function buildRollup(p) {
  const sig = projectSignal(p.repos);
  const counts = p.repos.reduce((n, r) => {
    const c = issueCounts[r.name];
    if (c) { n.issues += c.issues; n.prs += c.prs; }
    return n;
  }, { issues: 0, prs: 0 });
  const inFlight = inFlightCount(allIdeas(), p.id);
  if (!sig && !counts.issues && !counts.prs && !inFlight) return '';
  const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');
  const parts = [];
  if (sig) parts.push('<span class="rollup-age">oldest ' + agePill(sig) + '</span>');
  if (counts.issues) parts.push('<span class="rollup-link" onclick="showIssues(\'' + jsAttr(p.id) + '\',\'issue\')">' + plural(counts.issues, 'open issue') + '</span>');
  if (counts.prs) parts.push('<span class="rollup-link" onclick="showIssues(\'' + jsAttr(p.id) + '\',\'pr\')">' + plural(counts.prs, 'open PR') + '</span>');
  if (inFlight) parts.push('<span class="rollup-link" onclick="setView(\'ideas\')">' + plural(inFlight, 'idea') + ' in flight</span>');
  return '<div class="card-rollup">' + parts.join('<span class="rollup-sep">&middot;</span>') + '</div>';
}

function buildCard(p, idx) {
  const rollupHtml = buildRollup(p);
  const days = daysSince(p.blockedSince);
  const daysBadge = days !== null ? '<span class="blocked-days">' + days + 'd</span>' : '';
  const focusSuggest = hasAIKey ? '<span class="focus-suggest" onclick="event.stopPropagation();aiSuggestFocus(\'' + jsAttr(p.id) + '\')">&#x2728; suggest</span>' : '';
  const toneDot = '<span class="focus-tone-dot" onclick="cycleFocusTone(\'' + jsAttr(p.id) + '\',event)" title="Click to cycle tone (blocked → warning → info)"></span>';
  const focus = p.focus
    ? '<div class="focus-bar ' + esc(p.focusTone) + '" id="fb-' + esc(p.id) + '" onclick="editFocus(\'' + jsAttr(p.id) + '\')" title="Click to edit">' + toneDot + '<span class="focus-text">' + esc(p.focus) + '</span>' + daysBadge + focusSuggest + '<span class="focus-hint">&#x270E;</span></div>'
    : '<div class="focus-bar info" id="fb-' + esc(p.id) + '" onclick="editFocus(\'' + jsAttr(p.id) + '\')" title="Click to set focus">' + toneDot + '<span class="focus-text" style="opacity:.5">Set focus…</span>' + focusSuggest + '<span class="focus-hint">&#x270E;</span></div>';
  const sinceText = p.blockedSince ? 'since ' + esc(p.blockedSince) : '<span style="opacity:.6">set blocked date</span>';
  const sinceBar = p.focusTone === 'err'
    ? '<div class="since-bar" id="sb-' + esc(p.id) + '" onclick="editBlockedSince(\'' + jsAttr(p.id) + '\',event)">&#x1F4C5; ' + sinceText + '<span class="focus-hint" style="margin-left:auto">&#x270E;</span></div>'
    : '';
  const pushCount = p.repos.filter(r => r.status === 'needs-push').length;
  const pushAllBtn = pushCount >= 2 ? '<button class="sec-action" onclick="pushAllInProject(\'' + jsAttr(p.id) + '\')">&#x2191; Push All (' + pushCount + ')</button>' : '';

  const projectLastCommit = getProjectLastCommit(p);
  const lastCommitHtml = projectLastCommit ? '<span class="last-commit">last commit: ' + timeAgo(projectLastCommit) + '</span>' : '';

  const reposHtml = p.repos.map((r, ri) => {
    const k = p.id + '-' + ri;
    let action = '', extra = '';
    if (r.status === 'needs-push') {
      action = '<button class="git-btn push-btn" onclick="pushRepo(\'' + jsAttr(r.name) + '\')">&#x2191; Push</button>';
    } else if (['needs-commit', 'active'].includes(r.status) && r.ship) {
      action = '<button class="git-btn ship-btn" onclick="shipRepo(\'' + jsAttr(r.name) + '\')">&#x1F6A2; /ship</button>';
    } else if (r.status === 'needs-commit' && !r.ship) {
      const aiBtn = hasAIKey ? '<button class="ai-btn" onclick="aiSuggestCommit(\'' + jsAttr(r.name) + '\',\'' + jsAttr('cm-' + k) + '\')">&#x2728; AI</button>' : '';
      action = '<button class="git-btn commit-btn" onclick="document.getElementById(\'' + jsAttr('cf-' + k) + '\').classList.toggle(\'open\')">&#x270E; Commit</button>';
      extra = '<div id="cf-' + esc(k) + '" class="commit-form"><input id="cm-' + esc(k) + '" class="commit-input" placeholder="chore: description" onkeydown="if(event.key===\'Enter\')copyCommit(\'' + jsAttr(r.name) + '\',\'' + jsAttr('cm-' + k) + '\',\'' + jsAttr('cf-' + k) + '\')">' +
        '<div class="commit-actions">' + aiBtn + '<button class="c-go" onclick="copyCommit(\'' + jsAttr(r.name) + '\',\'' + jsAttr('cm-' + k) + '\',\'' + jsAttr('cf-' + k) + '\')">&#x1F4CB; Copy</button>' +
        '<button class="c-cancel" onclick="document.getElementById(\'' + jsAttr('cf-' + k) + '\').classList.remove(\'open\')">Cancel</button></div></div>';
    }
    const buildPill = r.buildTracked
      ? (r.buildStale
        ? '<span class="build-pill build-stale" onclick="markBuilt(\'' + jsAttr(p.id) + '\',' + ri + ')" title="Rebuild needed">Build &#x27F3;</span>'
        : '<span class="build-pill build-ok" title="Build current">Build &#x2713;</span>')
      : '';
    return '<div><div class="repo-row" draggable="true" data-drag="repo" data-pid="' + esc(p.id) + '" data-idx="' + ri + '">' +
      '<span class="drag-handle">&#x2847;</span>' +
      '<span class="repo-name">' + esc(r.name) + '</span>' +
      '<span class="ptag ptag-' + esc(r.platform) + ' clickable" onclick="openRepoEditor(\'' + jsAttr(p.id) + '\',' + ri + ',event)" title="Edit platform, ship, and build tracking">' + esc(r.platform) + '</span>' +
      '<span class="bdg ' + esc(r.status) + ' repo-bdg" onclick="openStatusPicker(\'' + jsAttr(p.id) + '\',' + ri + ',event)" title="Click to change status">' + esc(SL[r.status] || r.status) + '</span>' +
      buildPill +
      '<span class="repo-notes" title="' + esc(r.notes) + '">' + esc(r.notes) + '</span>' +
      agePill(oldestSignal(r.since)) +
      action +
      '<button class="del-repo" onclick="removeRepo(\'' + jsAttr(p.id) + '\',' + ri + ')" title="Stop tracking">&#x2715;</button>' +
      '</div>' + extra + '</div>';
  }).join('');

  const parityHtml = p.parity ? buildParity(p) : '';

  const sorted = sortedTasks(p.tasks);
  const tasksHtml = sorted.map(({ task: t, origIdx: ti }) =>
    '<div class="task-row ' + (t.done ? 'done' : '') + '" draggable="true" data-drag="task" data-pid="' + esc(p.id) + '" data-idx="' + ti + '">' +
    '<span class="drag-handle">&#x2847;</span>' +
    '<input type="checkbox" ' + (t.done ? 'checked' : '') + ' onchange="toggleTask(\'' + jsAttr(p.id) + '\',' + ti + ',this.checked)">' +
    '<span class="task-lbl" onclick="editTask(\'' + jsAttr(p.id) + '\',' + ti + ')">' + esc(t.text) + '</span>' +
    (hasAIKey ? '<button class="decompose-btn" onclick="aiDecompose(\'' + jsAttr(p.id) + '\',' + ti + ')" title="Break down">&#x2935;</button>' : '') +
    '<button class="send-today" onclick="sendToToday(\'' + jsAttr(p.id) + '\',' + ti + ')" title="Add to Today">→ Today</button>' +
    '<button class="del-task" onclick="deleteTask(\'' + jsAttr(p.id) + '\',' + ti + ')" title="Delete">&#x2715;</button></div>'
  ).join('');

  const open = countOpen(p);
  const done = countDone(p.tasks);
  const total = p.tasks.length;
  const pct = total > 0 ? Math.round(((total - open) / total) * 100) : 0;
  const overflowHint = total > 6 ? '<div class="task-overflow-hint">' + (total - 6) + ' more below ↓</div>' : '';
  const clearBtn = done > 0 ? '<button class="clear-done-btn" onclick="clearDone(\'' + jsAttr(p.id) + '\')">Clear ' + done + ' done</button>' : '';
  const progressBar = total > 0 ? '<div class="task-progress"><div class="task-progress-fill" style="width:' + pct + '%"></div></div>' : '';

  return '<div class="card" id="card-' + esc(p.id) + '" data-repo-drop="' + esc(p.id) + '">' +
    '<div class="card-hdr" draggable="true" data-drag="project" data-pid="" data-idx="' + idx + '">' +
    '<div class="card-grip" title="Drag to reorder">&#x283F;</div>' +
    '<div class="card-title" onclick="editProjectName(\'' + jsAttr(p.id) + '\')" title="Click to rename">' + esc(p.name) + '</div>' +
    '<div class="bdgs">' + lastCommitHtml + '<span class="bdg ' + esc(p.status) + ' clickable" onclick="openProjectStatusPicker(\'' + jsAttr(p.id) + '\',event)" title="Click to change status">' + esc(SL[p.status] || p.status) + '</span>' +
    '<span class="bdg ' + esc(p.priority) + ' clickable" onclick="openProjectPriorityPicker(\'' + jsAttr(p.id) + '\',event)" title="Click to change priority">' + esc(p.priority) + '</span>' +
    '<button class="list-del" onclick="deleteProject(\'' + jsAttr(p.id) + '\')" title="Delete card">&#x2715;</button></div></div>' +
    rollupHtml +
    focus + sinceBar +
    '<div class="card-body"><div class="sec-lbl"><span>Repos</span>' + pushAllBtn + '</div>' +
    '<div class="repos">' + reposHtml + '</div>' +
    '<div class="add-row repo-add">' +
    '<input class="add-input" list="repo-opts" placeholder="Add a repo..." id="nr-' + esc(p.id) + '" onkeydown="if(event.key===\'Enter\')addRepo(\'' + jsAttr(p.id) + '\')">' +
    '<select class="add-select" id="np-' + esc(p.id) + '">' + PLATFORMS.map(pf => '<option value="' + pf + '">' + pf + '</option>').join('') + '</select>' +
    '<button class="add-btn" onclick="addRepo(\'' + jsAttr(p.id) + '\')">+</button></div>' +
    parityHtml +
    '<div><div class="sec-lbl"><span>Tasks</span><span>' + open + ' open</span></div>' +
    progressBar + '<div class="task-scroll">' + tasksHtml + '</div>' + overflowHint + clearBtn +
    '<div class="add-row"><input class="add-input" placeholder="Add a task..." id="ni-' + esc(p.id) + '" onkeydown="if(event.key===\'Enter\')addTask(\'' + jsAttr(p.id) + '\')">' +
    '<button class="add-btn" onclick="addTask(\'' + jsAttr(p.id) + '\')">+</button></div></div></div></div>';
}

function getProjectLastCommit(p) {
  let latest = null;
  p.repos.forEach(r => {
    const lc = lastCommits[r.name];
    if (lc && (!latest || new Date(lc) > new Date(latest))) latest = lc;
  });
  return latest;
}

function buildParity(p) {
  const open = pOpen[p.id];
  const { platforms, features } = p.parity;
  return '<div class="parity-sec"><button class="parity-toggle" onclick="toggleParity(\'' + jsAttr(p.id) + '\')">' +
    '<span id="pa-' + esc(p.id) + '">' + (open ? '▾' : '▸') + '</span>&nbsp;Feature Parity' +
    '<span style="margin-left:4px;font-size:10px;font-weight:400">(' + features.length + ' tracked)</span></button>' +
    '<div class="pgrid' + (open ? ' open' : '') + '" id="pg-' + esc(p.id) + '">' +
    '<table class="ptable"><thead><tr><th>Feature</th>' + platforms.map(pl => '<th>' + esc(pl) + '</th>').join('') + '</tr></thead><tbody>' +
    features.map(f => '<tr><td>' + esc(f.name) + '</td>' + platforms.map(pl => {
      const s = f.cov[pl] || 'unknown';
      const c = PI[s] || PI.unknown;
      return '<td title="' + esc(s) + '"><span class="pdot" style="color:' + c.color + '">' + c.icon + '</span></td>';
    }).join('') + '</tr>').join('') +
    '</tbody></table></div></div>';
}

// ── DRAG ───────────────────────────────────────────────────────────────────
// Where a drag may land. Repo drags may cross cards: a row on another card
// inserts there, the card itself appends. Every other type keeps the same-type,
// same-parent rule, so a task or project drag can never land on another card.
function dropTarget(e) {
  if (!dragState) return null;
  if (dragState.type === 'repo') {
    const el = e.target.closest('[data-drag="repo"],[data-repo-drop]');
    if (!el) return null;
    const onRow = el.dataset.drag === 'repo';
    const pid = onRow ? el.dataset.pid : el.dataset.repoDrop;
    if (pid === dragState.pid) return onRow ? { el, pid, idx: parseInt(el.dataset.idx) } : null;
    const dst = ws.find(p => p.id === pid);
    if (!dst || dst.repos.some(r => r.name === dragState.name)) return null;
    return { el, pid, idx: onRow ? parseInt(el.dataset.idx) : dst.repos.length };
  }
  const el = e.target.closest('[data-drag]');
  if (!el || el.dataset.drag !== dragState.type || el.dataset.pid !== dragState.pid) return null;
  return { el, pid: el.dataset.pid, idx: parseInt(el.dataset.idx) };
}

function clearDragMarks() {
  document.querySelectorAll('.drag-over,.dragging,.repo-drop-over').forEach(x => x.classList.remove('drag-over', 'dragging', 'repo-drop-over'));
}

function initDrag() {
  document.addEventListener('dragstart', (e) => {
    const el = e.target.closest('[data-drag]');
    if (!el) return;
    const idx = parseInt(el.dataset.idx);
    const name = el.dataset.drag === 'repo' ? ws.find(p => p.id === el.dataset.pid)?.repos[idx]?.name ?? null : null;
    dragState = { type: el.dataset.drag, pid: el.dataset.pid, idx, name };
    el.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', '');
  });

  document.addEventListener('dragover', (e) => {
    const t = dropTarget(e);
    if (!t) return;
    if (dragState.type === 'task' || dragState.type === 'list-task') {
      const srcDone = t.el.closest('.card,.today-card')?.querySelector('[data-drag][data-idx="' + dragState.idx + '"]')?.classList.contains('done') || false;
      const tgtDone = t.el.classList.contains('done');
      if (srcDone !== tgtDone) return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    document.querySelectorAll('.drag-over,.repo-drop-over').forEach(x => x.classList.remove('drag-over', 'repo-drop-over'));
    t.el.classList.add(t.el.dataset.drag ? 'drag-over' : 'repo-drop-over');
  });

  document.addEventListener('dragleave', (e) => {
    const el = e.target.closest('[data-drag]');
    if (el) el.classList.remove('drag-over');
    const card = e.target.closest('[data-repo-drop]');
    if (card && !card.contains(e.relatedTarget)) card.classList.remove('repo-drop-over');
  });

  document.addEventListener('drop', (e) => {
    e.preventDefault();
    clearDragMarks();
    const t = dropTarget(e);
    if (!t || (t.pid === dragState.pid && t.idx === dragState.idx)) { dragState = null; return; }
    if (dragState.type === 'repo' && t.pid !== dragState.pid) {
      const res = moveRepo(ws, dragState.pid, dragState.idx, t.pid, t.idx);
      dragState = null;
      if (!res.ok) { showToast(res.error, 4000); return; }
      autoSave();
      render();
      showToast('Moved ' + res.repo.name + ' to ' + res.to.name);
      return;
    }
    let arr = null;
    if (dragState.type === 'task') arr = ws.find(p => p.id === dragState.pid)?.tasks;
    else if (dragState.type === 'repo') arr = ws.find(p => p.id === dragState.pid)?.repos;
    else if (dragState.type === 'list-task') arr = lists.find(l => l.id === dragState.pid)?.tasks;
    // Projects have no parent, so their data-pid is empty on both the source
    // and the target and the pid equality check passes trivially.
    else if (dragState.type === 'project') arr = ws;
    if (arr) {
      const [item] = arr.splice(dragState.idx, 1);
      arr.splice(t.idx, 0, item);
      autoSave();
      render();
    }
    dragState = null;
  });

  document.addEventListener('dragend', () => {
    clearDragMarks();
    dragState = null;
  });
}

// ── MUTATIONS ──────────────────────────────────────────────────────────────
function animateAndRender(row) {
  if (!row) { autoSave(); render(); return; }
  renderLocked = true;
  row.classList.add('completing');
  setTimeout(() => { renderLocked = false; autoSave(); render(); }, 250);
}

function toggleTask(pid, ti, checked) {
  const p = ws.find(x => x.id === pid);
  if (!p?.tasks[ti]) return;
  p.tasks[ti].done = checked;
  if (checked) doneToday.push({ text: p.tasks[ti].text, project: p.name, doneAt: Date.now() });
  if (checked) {
    const row = document.querySelector('[data-drag="task"][data-pid="' + pid + '"][data-idx="' + ti + '"]');
    animateAndRender(row);
  } else { autoSave(); render(); }
}

function addTask(pid) {
  const inp = document.getElementById('ni-' + pid);
  const text = inp?.value.trim();
  if (!text) return;
  const p = ws.find(x => x.id === pid);
  if (!p) return;
  p.tasks.push({ done: false, text });
  inp.value = '';
  autoSave();
  render();
}

function editTask(pid, ti) {
  const p = ws.find(x => x.id === pid);
  if (!p?.tasks[ti]) return;
  const row = document.querySelector('[data-drag="task"][data-pid="' + pid + '"][data-idx="' + ti + '"]');
  const lbl = row?.querySelector('.task-lbl');
  if (!lbl || lbl.querySelector('input')) return;
  const inp = document.createElement('input');
  inp.className = 'focus-input';
  inp.value = p.tasks[ti].text;
  inp.style.cssText = 'font-size:14px;';
  lbl.textContent = '';
  lbl.appendChild(inp);
  let done = false;
  const apply = () => { if (done) return; done = true; const v = inp.value.trim(); if (v) p.tasks[ti].text = v; autoSave(); render(); };
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); apply(); } else if (e.key === 'Escape') { done = true; render(); } });
  inp.addEventListener('blur', apply);
  inp.focus();
  inp.select();
}

function editListTask(lid, ti) {
  const l = lists.find(x => x.id === lid);
  if (!l?.tasks[ti]) return;
  const row = document.querySelector('[data-drag="list-task"][data-pid="' + lid + '"][data-idx="' + ti + '"]');
  const lbl = row?.querySelector('.task-lbl');
  if (!lbl || lbl.querySelector('input')) return;
  const inp = document.createElement('input');
  inp.className = 'focus-input';
  inp.value = l.tasks[ti].text;
  inp.style.cssText = 'font-size:14px;';
  lbl.textContent = '';
  lbl.appendChild(inp);
  let done = false;
  const apply = () => { if (done) return; done = true; const v = inp.value.trim(); if (v) l.tasks[ti].text = v; autoSave(); render(); };
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); apply(); } else if (e.key === 'Escape') { done = true; render(); } });
  inp.addEventListener('blur', apply);
  inp.focus();
  inp.select();
}

function editTodayItem(idx) {
  if (!today[idx]) return;
  const rows = document.querySelectorAll('.today-row');
  const lbl = rows[idx]?.querySelector('.today-text');
  if (!lbl || lbl.querySelector('input')) return;
  const inp = document.createElement('input');
  inp.className = 'focus-input';
  inp.value = today[idx].text;
  inp.style.cssText = 'font-size:14px;';
  lbl.textContent = '';
  lbl.appendChild(inp);
  let done = false;
  const apply = () => { if (done) return; done = true; const v = inp.value.trim(); if (v) today[idx].text = v; autoSave(); render(); };
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); apply(); } else if (e.key === 'Escape') { done = true; render(); } });
  inp.addEventListener('blur', apply);
  inp.focus();
  inp.select();
}

function addRepo(pid) {
  const inp = document.getElementById('nr-' + pid);
  const sel = document.getElementById('np-' + pid);
  const name = inp?.value.trim();
  if (!name) return;
  const p = ws.find(x => x.id === pid);
  if (!p) return;
  // Fail closed. An empty list means the folder could not be read, and
  // accepting a name on faith is exactly how untrackable rows got in before.
  if (!availableRepos.length) {
    showToast('Could not read the github folder, so the name cannot be checked', 5000);
    return;
  }
  if (!availableRepos.includes(name)) {
    showToast('No checkout named \'' + name + '\' under the github folder', 5000);
    return;
  }
  if (p.repos.some(r => r.name === name)) {
    showToast(name + ' is already on this card', 3000);
    return;
  }
  p.repos.push({
    name, status: 'stable', platform: sel?.value || 'web', ship: false,
    buildTracked: false, buildDeps: [], notes: '', buildStale: false,
  });
  inp.value = '';
  autoSave();
  render();
  scanAllRepos();
}

function removeRepo(pid, ri) {
  const p = ws.find(x => x.id === pid);
  const r = p?.repos[ri];
  if (!r) return;
  if (!confirm('Stop tracking ' + r.name + ' on ' + p.name + '?\n\n'
    + 'This only removes the row from this card. The checkout on disk is untouched.')) return;
  p.repos.splice(ri, 1);
  autoSave();
  render();
}

async function addProject() {
  const inp = document.getElementById('new-card-name');
  const name = inp?.value.trim();
  if (!name) return;
  const err = cardNameError(ws, name);
  if (err) { showToast(err, 4000); return; }
  const work = document.getElementById('new-card-work')?.checked;
  const p = newProject(projectIdFor(name, ws.map(x => x.id)), name);
  const id = p.id;
  ws.push(p);
  inp.value = '';
  if (!(await autoSave())) { render(); return; }
  // Only after the save: main checks the work list against the stored ids.
  if (work) await saveScope({ work: liveWorkIds([...scopePrefs.work, id], ws) });
  render();
  showToast('Added ' + name + (inView(p) ? '' : ', hidden by the ' + scopePrefs.scope + ' scope'));
  document.getElementById('card-' + id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function editProjectName(pid) {
  const p = ws.find(x => x.id === pid);
  const hdr = document.getElementById('card-' + pid)?.querySelector('.card-hdr');
  const lbl = hdr?.querySelector('.card-title');
  if (!p || !lbl || lbl.querySelector('input')) return;
  // An input inside a draggable header starts a drag instead of selecting text.
  // render() rebuilds the header with draggable restored.
  hdr.draggable = false;
  const inp = document.createElement('input');
  inp.className = 'focus-input';
  inp.maxLength = 60;
  inp.value = p.name || '';
  lbl.textContent = '';
  lbl.appendChild(inp);
  let done = false;
  const apply = () => {
    if (done) return;
    done = true;
    const v = inp.value.trim();
    if (v === (p.name || '').trim()) { render(); return; }
    const err = cardNameError(ws, v, pid);
    if (err) { showToast(err, 4000); render(); return; }
    p.name = v;
    autoSave();
    render();
  };
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); apply(); } else if (e.key === 'Escape') { done = true; render(); } });
  inp.addEventListener('blur', apply);
  inp.focus();
  inp.select();
}

async function deleteProject(pid) {
  let ideas = null;
  try { ideas = (await window.electronAPI.ideasLoad())?.ideas; } catch { ideas = null; }
  // Look the card up after the only await: a remote pull during it replaces ws.
  // From here to the splice nothing awaits, and confirm() blocks the renderer.
  const idx = ws.findIndex(x => x.id === pid);
  if (idx < 0) return;
  const p = ws[idx];
  if (!Array.isArray(ideas)) { showToast('Could not read the ideas store, so ' + p.name + ' was not deleted', 5000); return; }
  const blocker = deleteBlocker(p, ideas);
  if (blocker) { showToast(blocker, 6000); return; }
  if (!confirm(deleteConfirmText(p, ideas))) return;
  ws.splice(idx, 1);
  delete pOpen[pid];
  if (!(await autoSave())) { render(); return; }
  if (scopePrefs.work.includes(pid)) await saveScope({ work: liveWorkIds(scopePrefs.work, ws) });
  render();
  showToast('Deleted ' + p.name);
}

function deleteTask(pid, ti) {
  const p = ws.find(x => x.id === pid);
  if (!p) return;
  p.tasks.splice(ti, 1);
  autoSave();
  render();
}

function addListTask(lid) {
  const inp = document.getElementById('lni-' + lid);
  const text = inp?.value.trim();
  if (!text) return;
  const l = lists.find(x => x.id === lid);
  if (!l) return;
  l.tasks.push({ done: false, text });
  inp.value = '';
  autoSave();
  render();
}

function toggleListTask(lid, ti, checked) {
  const l = lists.find(x => x.id === lid);
  if (!l?.tasks[ti]) return;
  l.tasks[ti].done = checked;
  if (checked) doneToday.push({ text: l.tasks[ti].text, project: l.name, doneAt: Date.now() });
  if (checked) {
    const row = document.querySelector('[data-drag="list-task"][data-pid="' + lid + '"][data-idx="' + ti + '"]');
    animateAndRender(row);
  } else { autoSave(); render(); }
}

function deleteListTask(lid, ti) {
  const l = lists.find(x => x.id === lid);
  if (!l) return;
  l.tasks.splice(ti, 1);
  autoSave();
  render();
}

function clearDone(pid) {
  const p = ws.find(x => x.id === pid);
  if (!p) return;
  p.tasks = p.tasks.filter(t => !t.done);
  autoSave();
  render();
}

function clearListDone(lid) {
  const l = lists.find(x => x.id === lid);
  if (!l) return;
  l.tasks = l.tasks.filter(t => !t.done);
  autoSave();
  render();
}

function createList() {
  const name = prompt('List name:');
  if (!name?.trim()) return;
  const icon = prompt('Emoji icon (e.g. \u{1F4DD}):', '\u{1F4DD}') || '\u{1F4DD}';
  lists.push({ id: 'list-' + Date.now(), name: name.trim(), icon, tasks: [] });
  autoSave();
  render();
}

function deleteList(lid) {
  const l = lists.find(x => x.id === lid);
  if (!l) return;
  if (!confirm('Delete "' + l.name + '" and all its tasks?')) return;
  lists = lists.filter(x => x.id !== lid);
  autoSave();
  render();
}

function editFocus(pid) {
  const p = ws.find(x => x.id === pid);
  const bar = document.getElementById('fb-' + pid);
  if (!bar || bar.querySelector('input')) return;
  bar.innerHTML = '<input class="focus-input" id="fi-' + esc(pid) + '" autocomplete="off" spellcheck="false">';
  const inp = bar.querySelector('input');
  inp.value = p.focus || '';
  let done = false;
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); done = true; applyFocus(pid, inp.value); }
    else if (e.key === 'Escape') { e.preventDefault(); done = true; render(); }
  });
  inp.addEventListener('blur', () => { if (!done) { done = true; applyFocus(pid, inp.value); } });
  inp.focus();
  inp.setSelectionRange(inp.value.length, inp.value.length);
}

function applyFocus(pid, val) {
  const p = ws.find(x => x.id === pid);
  const t = val.trim();
  if (t) p.focus = t;
  autoSave();
  render();
}

function cycleFocusTone(pid, e) {
  e.stopPropagation();
  const p = ws.find(x => x.id === pid);
  if (!p) return;
  const order = FOCUS_TONES;
  const idx = order.indexOf(p.focusTone);
  const next = order[(idx + 1) % order.length];
  p.focusTone = next;
  if (next !== 'err') p.blockedSince = null;
  autoSave();
  render();
}

function editBlockedSince(pid, e) {
  e.stopPropagation();
  const p = ws.find(x => x.id === pid);
  const bar = document.getElementById('sb-' + pid);
  if (!bar || bar.querySelector('input')) return;
  bar.innerHTML = '&#x1F4C5; <input class="since-input" id="sbi-' + esc(pid) + '" type="date" value="' + esc(p.blockedSince || '') + '">';
  const inp = document.getElementById('sbi-' + pid);
  if (!inp) return;
  inp.focus();
  const apply = () => { p.blockedSince = inp.value || null; autoSave(); render(); };
  inp.addEventListener('change', apply);
  inp.addEventListener('blur', () => render());
  inp.addEventListener('keydown', ev => { if (ev.key === 'Escape' || ev.key === 'Enter') render(); });
}

function openStatusPicker(pid, ri, e) {
  e.stopPropagation();
  document.querySelectorAll('.status-picker').forEach(el => el.remove());
  const rect = e.currentTarget.getBoundingClientRect();
  const p = ws.find(x => x.id === pid);
  if (!p?.repos[ri]) return;
  const r = p.repos[ri];
  const cur = r.status;
  const picker = document.createElement('div');
  picker.className = 'status-picker';
  picker.style.cssText = 'position:fixed;top:' + (rect.bottom + 6) + 'px;left:' + rect.left + 'px;z-index:9000;';
  const statusHtml = ALL_STATUSES.map(s =>
    '<div class="sp-opt' + (s === cur ? ' sp-cur' : '') + '" onclick="setRepoStatus(\'' + jsAttr(pid) + '\',' + ri + ',\'' + jsAttr(s) + '\')">' + esc(SL[s] || s) + '</div>'
  ).join('');
  // The live list is what the last scan kept after the merged and ignored
  // filters, so the picker reads it off since rather than carrying a copy.
  const branchRow = (b, off) =>
    '<div class="sp-opt sp-branch' + (off ? ' sp-ignored' : '') + '" onclick="toggleIgnoreBranch(\'' + jsAttr(pid) + '\',' + ri + ',\'' + jsAttr(b) + '\')" title="' + (off ? 'Count this branch again' : 'Stop counting this branch as unmerged work') + '">' +
    '<span class="sp-branch-name">' + esc(b) + '</span><span class="sp-branch-act">' + (off ? 'watch' : 'ignore') + '</span></div>';
  const live = Object.keys(r.since?.branches || {}).map(b => branchRow(b, false));
  const ignored = (r.ignoreBranches || []).map(b => branchRow(b, true));
  const branchHtml = live.length || ignored.length
    ? '<div class="sp-divider">Branches</div>' + live.join('') + ignored.join('') : '';
  // No other control sets buildTracked, and a red Build pill on a repo whose
  // dependency churns daily (an app built on a busy web repo) is noise.
  const buildHtml = r.buildTracked || r.buildDeps?.length
    ? '<div class="sp-divider">Build</div>' +
      '<div class="sp-opt sp-branch" onclick="toggleBuildTracked(\'' + jsAttr(pid) + '\',' + ri + ')" title="' +
      (r.buildTracked ? 'Stop marking this build stale when a dependency changes' : 'Mark this build stale when a dependency changes') + '">' +
      '<span class="sp-branch-name">Track build</span><span class="sp-branch-act">' + (r.buildTracked ? 'on' : 'off') + '</span></div>'
    : '';
  picker.innerHTML = statusHtml + branchHtml + buildHtml;
  document.body.appendChild(picker);
  setTimeout(() => {
    const close = (ev) => { if (!picker.contains(ev.target)) { picker.remove(); document.removeEventListener('click', close); } };
    document.addEventListener('click', close);
  }, 0);
}

function toggleIgnoreBranch(pid, ri, branch) {
  const r = ws.find(x => x.id === pid)?.repos[ri];
  if (!r) return;
  const cur = r.ignoreBranches || [];
  r.ignoreBranches = cur.includes(branch) ? cur.filter(b => b !== branch) : [...cur, branch];
  document.querySelectorAll('.status-picker').forEach(el => el.remove());
  autoSave().then(() => scanAllRepos(true));
}

function toggleBuildTracked(pid, ri) {
  const r = ws.find(x => x.id === pid)?.repos[ri];
  if (!r) return;
  r.buildTracked = !r.buildTracked;
  if (!r.buildTracked) r.buildStale = false;
  document.querySelectorAll('.status-picker').forEach(el => el.remove());
  autoSave();
  render();
}

function setRepoStatus(pid, ri, status) {
  const p = ws.find(x => x.id === pid);
  if (!p?.repos[ri]) return;
  p.repos[ri].status = status;
  document.querySelectorAll('.status-picker').forEach(el => el.remove());
  autoSave();
  render();
}

// The open repo editor, repainted in place after each change so it stays open.
let repoEditor = null;

function openRepoEditor(pid, ri, e) {
  e.stopPropagation();
  document.querySelectorAll('.status-picker').forEach(el => el.remove());
  const r = ws.find(x => x.id === pid)?.repos[ri];
  if (!r) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const picker = document.createElement('div');
  picker.className = 'status-picker repo-editor';
  picker.style.cssText = 'position:fixed;top:' + (rect.bottom + 6) + 'px;left:' + Math.min(rect.left, window.innerWidth - 260) + 'px;z-index:9000;';
  // Clicks inside never reach the document listener, so a repaint that
  // detaches the clicked element cannot read as a click outside.
  picker.addEventListener('click', ev => ev.stopPropagation());
  repoEditor = { pid, ri, name: r.name, el: picker };
  paintRepoEditor();
  document.body.appendChild(picker);
  setTimeout(() => {
    const close = (ev) => { if (!picker.contains(ev.target)) { picker.remove(); if (repoEditor?.el === picker) repoEditor = null; document.removeEventListener('click', close); } };
    document.addEventListener('click', close);
  }, 0);
}

// One checkbox row; call is the handler up to its last argument, which is this.checked.
function checkRow(label, on, call) {
  return '<label class="sp-opt sp-check"><input type="checkbox"' + (on ? ' checked' : '') +
    ' onchange="' + call + 'this.checked)"> ' + esc(label) + '</label>';
}

function paintRepoEditor() {
  if (!repoEditor) return;
  const { pid, ri, name, el } = repoEditor;
  const p = ws.find(x => x.id === pid);
  const r = p?.repos[ri];
  // The handlers carry ri, so close once a reorder, move or pull shifts it.
  if (!r || r.name !== name) { el.remove(); repoEditor = null; return; }
  const plat = PLATFORMS.map(pf =>
    '<div class="sp-opt' + (pf === r.platform ? ' sp-cur' : '') + '" onclick="setRepoPlatform(\'' + jsAttr(pid) + '\',' + ri + ',\'' + jsAttr(pf) + '\')">' + esc(pf) + '</div>'
  ).join('');
  const flag = 'setRepoFlag(\'' + jsAttr(pid) + '\',' + ri + ',';
  const choices = buildDepChoices(p, r);
  const deps = !r.buildTracked ? '' : '<div class="sp-divider">Rebuild when these change</div>' + (choices.length
    ? choices.map(n => checkRow(n, (r.buildDeps || []).includes(n), 'toggleBuildDep(\'' + jsAttr(pid) + '\',' + ri + ',\'' + jsAttr(n) + '\',')).join('')
    : '<div class="sp-note">No other repo on this card, so nothing marks the build stale</div>');
  el.innerHTML = '<div class="sp-divider">Platform</div>' + plat +
    '<div class="sp-divider">Options</div>' +
    checkRow('Ships with /ship', r.ship, flag + '\'ship\',') +
    checkRow('Track build', r.buildTracked, flag + '\'buildTracked\',') + deps;
}

function setRepoPlatform(pid, ri, platform) {
  const r = ws.find(x => x.id === pid)?.repos[ri];
  if (!r || !PLATFORMS.includes(platform)) return;
  r.platform = platform;
  document.querySelectorAll('.status-picker').forEach(el => el.remove());
  repoEditor = null;
  autoSave();
  render();
}

function setRepoFlag(pid, ri, key, on) {
  const r = ws.find(x => x.id === pid)?.repos[ri];
  if (!r || !['ship', 'buildTracked'].includes(key)) return;
  r[key] = !!on;
  // A stale pill must not come back the next time tracking is turned on.
  if (key === 'buildTracked' && !on) r.buildStale = false;
  render();
  // The status rule reads ship (active versus needs-commit), so rescan quietly.
  if (key === 'ship') autoSave().then(() => scanAllRepos(true));
  else autoSave();
}

function toggleBuildDep(pid, ri, name, on) {
  const r = ws.find(x => x.id === pid)?.repos[ri];
  if (!r) return;
  const cur = r.buildDeps || [];
  r.buildDeps = on ? [...new Set([...cur, name])] : cur.filter(n => n !== name);
  autoSave();
  render();
}

function openProjectStatusPicker(pid, e) {
  e.stopPropagation();
  document.querySelectorAll('.status-picker').forEach(el => el.remove());
  const rect = e.currentTarget.getBoundingClientRect();
  const p = ws.find(x => x.id === pid);
  if (!p) return;
  const cur = p.status;
  const picker = document.createElement('div');
  picker.className = 'status-picker';
  picker.style.cssText = 'position:fixed;top:' + (rect.bottom + 6) + 'px;left:' + rect.left + 'px;z-index:9000;';
  picker.innerHTML = ALL_STATUSES.map(s =>
    '<div class="sp-opt' + (s === cur ? ' sp-cur' : '') + '" onclick="setProjectStatus(\'' + jsAttr(pid) + '\',\'' + jsAttr(s) + '\')">' + esc(SL[s] || s) + '</div>'
  ).join('');
  document.body.appendChild(picker);
  setTimeout(() => {
    const close = (ev) => { if (!picker.contains(ev.target)) { picker.remove(); document.removeEventListener('click', close); } };
    document.addEventListener('click', close);
  }, 0);
}

function setProjectStatus(pid, status) {
  const p = ws.find(x => x.id === pid);
  if (!p) return;
  p.status = status;
  document.querySelectorAll('.status-picker').forEach(el => el.remove());
  autoSave();
  render();
}

function openProjectPriorityPicker(pid, e) {
  e.stopPropagation();
  document.querySelectorAll('.status-picker').forEach(el => el.remove());
  const rect = e.currentTarget.getBoundingClientRect();
  const p = ws.find(x => x.id === pid);
  if (!p) return;
  const cur = p.priority;
  const opts = PRIORITIES;
  const picker = document.createElement('div');
  picker.className = 'status-picker';
  picker.style.cssText = 'position:fixed;top:' + (rect.bottom + 6) + 'px;left:' + rect.left + 'px;z-index:9000;';
  picker.innerHTML = opts.map(s =>
    '<div class="sp-opt' + (s === cur ? ' sp-cur' : '') + '" onclick="setProjectPriority(\'' + jsAttr(pid) + '\',\'' + jsAttr(s) + '\')">' + s + '</div>'
  ).join('');
  document.body.appendChild(picker);
  setTimeout(() => {
    const close = (ev) => { if (!picker.contains(ev.target)) { picker.remove(); document.removeEventListener('click', close); } };
    document.addEventListener('click', close);
  }, 0);
}

function setProjectPriority(pid, priority) {
  const p = ws.find(x => x.id === pid);
  if (!p) return;
  p.priority = priority;
  document.querySelectorAll('.status-picker').forEach(el => el.remove());
  autoSave();
  render();
}

function toggleParity(pid) {
  pOpen[pid] = !pOpen[pid];
  const pg = document.getElementById('pg-' + pid);
  const pa = document.getElementById('pa-' + pid);
  if (pg) pg.classList.toggle('open', pOpen[pid]);
  if (pa) pa.textContent = pOpen[pid] ? '▾' : '▸';
}

// ── GIT ACTIONS ────────────────────────────────────────────────────────────
// A name that fails safeRepoName could break out of the quotes, so it is
// refused rather than copied. No real checkout fails it.
function refuseCopy(name) { showToast('Not copied: "' + name + '" is not a safe repo name', 5000); }

function refuseBranch(name) { showToast('Not copied: a branch on ' + name + ' has a name that is not safe to paste', 5000); }

function pushRepo(name) {
  const at = repoPath(name);
  if (!at) return refuseCopy(name);
  const args = gitPushArgs(lastUnpushed[name]);
  if (!args) return refuseBranch(name);
  copyToast('cd ' + at + ' && git ' + args, 'Copied');
}

function pushAllInProject(pid) {
  const repos = ws.find(x => x.id === pid).repos.filter(r => r.status === 'needs-push');
  const bad = repos.find(r => !repoPath(r.name));
  if (bad) return refuseCopy(bad.name);
  const badBranch = repos.find(r => !gitPushArgs(lastUnpushed[r.name]));
  if (badBranch) return refuseBranch(badBranch.name);
  copyToast(repos.map(r => 'git -C ' + repoPath(r.name) + ' ' + gitPushArgs(lastUnpushed[r.name])).join(' && '), 'Copied — push all ' + repos.length);
}

function copyCommit(name, msgId, formId) {
  const msg = document.getElementById(msgId)?.value?.trim() || '';
  if (!msg) { document.getElementById(msgId)?.focus(); return; }
  const at = repoPath(name);
  if (!at) return refuseCopy(name);
  copyToast('cd ' + at + " && git add -A && git commit -m '" + msg.replace(/'/g, "'\\''") + "'", 'Copied');
  document.getElementById(formId)?.classList.remove('open');
}

function shipRepo(name) {
  const at = repoPath(name);
  if (!at) return refuseCopy(name);
  copyToast('cd ' + at + ' && claude /ship', 'Copied — open Claude Code');
}

function markBuilt(pid, ri) {
  const p = ws.find(x => x.id === pid);
  if (!p?.repos[ri]) return;
  p.repos[ri].buildStale = false;
  autoSave();
  render();
  showToast('Build marked current');
}

// ── SCAN ───────────────────────────────────────────────────────────────────
async function scanAllRepos(quiet = false) {
  if (scanning) return;
  scanning = true;
  const btn = document.getElementById('scan-btn');
  if (btn) { btn.textContent = 'Scanning…'; btn.disabled = true; }
  try {
    const { results, changedDeps, isFirstScan } = await window.electronAPI.scanRepos();
    const parsedCount = Object.keys(results).length;
    if (parsedCount === 0) { if (!quiet) showToast('Scan: 0 repos returned data'); return; }

    const scanStamp = (r) => [r.name, r.status, r.notes, r.buildStale ? 1 : 0, JSON.stringify(r.since || null), JSON.stringify(r.ignoreBranches || null)].join('|');
    const before = ws.flatMap(p => p.repos.map(scanStamp)).join(';');

    ws.forEach(proj => proj.repos.forEach(r => {
      const s = results[r.name];
      if (!s) return;
      if (s.lastCommit) lastCommits[r.name] = s.lastCommit;
      // gh failing (offline, rate-limited) must not make squash-merged
      // branches flap back to unmerged, so the last good PR map is kept and
      // used whenever the scan brings none.
      if (s.prs) lastPrs[r.name] = s.prs;
      const prs = s.prs || lastPrs[r.name] || {};
      lastUnpushed[r.name] = s.unpushedBranches || [];
      const ignore = r.ignoreBranches || [];
      const derived = deriveRepoStatus(s, { prs, ignore, ship: r.ship });
      r.notes = derived.notes;
      r.since = dropMergedBranches(s.since, prs, ignore);
      if (['blocked', 'parked'].includes(r.status)) return;
      r.status = derived.status;
    }));

    if (!isFirstScan && Object.keys(changedDeps).length > 0) {
      ws.forEach(proj => proj.repos.forEach(r => {
        if (!r.buildTracked || !r.buildDeps?.length) return;
        if (r.buildDeps.some(dep => dep in changedDeps)) r.buildStale = true;
      }));
    }

    lastScanned = Date.now();
    const changed = ws.flatMap(p => p.repos.map(scanStamp)).join(';') !== before;
    if (changed) await autoSave();
    // A quiet scan must not rebuild the DOM under the user's hands: render()
    // replaces innerHTML wholesale, which destroys a focused inline edit
    // without ever firing blur. The state is already mutated, so the next
    // render (manual scan, any user action, or the next changed quiet scan
    // with no edit open) shows it.
    const editing = document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName);
    if (!quiet || (changed && !editing)) render();
    if (!quiet) showToast('Scan complete — ' + parsedCount + ' repos');
    refreshActivity();
  } catch (e) {
    showToast('Scan error: ' + (e.message || String(e)), 7000);
  } finally {
    scanning = false;
    const b = document.getElementById('scan-btn');
    if (b) { b.innerHTML = '&#x27F3; Scan'; b.disabled = false; }
  }
}

// ── AI ─────────────────────────────────────────────────────────────────────
async function aiSuggestCommit(repoName, inputId) {
  const inp = document.getElementById(inputId);
  if (!inp) return;
  inp.value = '';
  inp.placeholder = 'Generating…';
  const unsub = window.electronAPI.onSuggestCommitChunk((chunk) => { inp.value += chunk; });
  try {
    const result = await window.electronAPI.suggestCommitMessage(repoName);
    if (result?.error) showToast('AI: ' + result.error, 5000);
  } finally {
    unsub();
    inp.placeholder = 'chore: description';
  }
}

async function openBriefing() {
  const overlay = document.getElementById('briefing-overlay');
  const content = document.getElementById('briefing-content');
  const spinner = document.getElementById('briefing-spinner');
  overlay.classList.add('show');
  content.innerHTML = '';
  document.getElementById('briefing-title').textContent = '\u{2728} Daily Briefing';
  spinner.innerHTML = '<span class="ai-spinner"></span>';
  let rawText = '';
  const unsub = window.electronAPI.onDailyBriefingChunk((chunk) => {
    rawText += chunk;
    content.innerHTML = renderMarkdown(rawText);
    content.scrollTop = content.scrollHeight;
  });
  try {
    const result = await window.electronAPI.getDailyBriefing(ws);
    if (result?.error) {
      content.textContent = result.error === 'No API key set'
        ? 'Set your API key in Settings (⌘,) to use AI features.'
        : 'Error: ' + result.error;
    }
  } finally {
    unsub();
    spinner.innerHTML = '';
  }
}

function closeBriefing() { document.getElementById('briefing-overlay')?.classList.remove('show'); }

async function aiSuggestFocus(pid) {
  const bar = document.getElementById('fb-' + pid);
  if (!bar) return;
  const textEl = bar.querySelector('.focus-text');
  if (textEl) textEl.textContent = 'Thinking…';
  let text = '';
  const unsub = window.electronAPI.onSuggestFocusChunk((chunk) => {
    text += chunk;
    if (textEl) textEl.textContent = text;
  });
  let result;
  try {
    result = await window.electronAPI.suggestFocusLine(pid, ws);
  } finally {
    unsub();
  }
  if (result?.error) { showToast('AI: ' + result.error, 5000); render(); return; }
  if (text.trim()) {
    ws.find(x => x.id === pid).focus = text.trim();
    await autoSave();
  }
  render();
}

// ── SMART STATUS ANALYSIS ──────────────────────────────────────────────────
async function openAnalyze() {
  const overlay = document.getElementById('analyze-overlay');
  const content = document.getElementById('analyze-content');
  const spinner = document.getElementById('analyze-spinner');
  overlay.classList.add('show');
  content.innerHTML = '<div style="color:var(--muted);padding:12px 0;">Analyzing project statuses…</div>';
  spinner.innerHTML = '<span class="ai-spinner"></span>';
  const result = await window.electronAPI.analyzeStatuses(ws);
  spinner.innerHTML = '';
  if (result?.error) {
    content.innerHTML = '<div style="color:var(--blocked)">' + esc(result.error) + '</div>';
    return;
  }
  if (!Array.isArray(result) || result.length === 0) {
    content.innerHTML = '<div style="color:var(--stable);padding:12px 0;">All project statuses look correct.</div>';
    return;
  }
  content.innerHTML = result.map((s, i) =>
    '<div class="sug-row"><div class="sug-info"><div class="sug-name">' + esc(s.id) + '</div>' +
    '<div class="sug-change">' + esc(s.current || '?') + ' → ' + esc(s.suggested || '?') + '</div>' +
    '<div class="sug-reason">' + esc(s.reason || '') + '</div></div>' +
    '<button class="sug-accept" onclick="acceptStatusSuggestion(\'' + jsAttr(s.id) + '\',\'' + jsAttr(s.suggested) + '\',this)">Accept</button>' +
    '<button class="sug-skip" onclick="this.closest(\'.sug-row\').remove()">Skip</button></div>'
  ).join('');
}

function acceptStatusSuggestion(pid, status, btn) {
  // Main already filters suggestions. This is the second check, so a value
  // that slipped past it is refused here rather than stored and synced.
  if (!ALL_STATUSES.includes(status)) {
    showToast('Not applied: "' + status + '" is not a project status', 5000);
    return;
  }
  const p = ws.find(x => x.id === pid);
  if (p) {
    p.status = status;
    autoSave();
    render();
  }
  const row = btn?.closest('.sug-row');
  if (row) { row.style.opacity = '.3'; btn.disabled = true; btn.textContent = 'Applied'; }
}

function closeAnalyze() { document.getElementById('analyze-overlay')?.classList.remove('show'); }

// ── TASK DECOMPOSITION ────────────────────────────────────────────────────
async function aiDecompose(pid, ti) {
  const p = ws.find(x => x.id === pid);
  if (!p?.tasks[ti]) return;
  decomposeTarget = { pid, ti };
  const overlay = document.getElementById('decompose-overlay');
  const content = document.getElementById('decompose-content');
  const spinner = document.getElementById('decompose-spinner');
  const acceptBtn = document.getElementById('decompose-accept');
  overlay.classList.add('show');
  content.textContent = '';
  acceptBtn.style.display = 'none';
  spinner.innerHTML = '<span class="ai-spinner"></span>';
  const ctx = { name: p.name, repos: p.repos.map(r => ({ name: r.name, status: r.status })), tasks: p.tasks.map(t => t.text) };
  const unsub = window.electronAPI.onDecomposeChunk((chunk) => { content.textContent += chunk; });
  try {
    const result = await window.electronAPI.decomposeTask(p.tasks[ti].text, ctx);
    if (result?.error) { content.textContent = 'Error: ' + result.error; return; }
    acceptBtn.style.display = '';
  } finally {
    unsub();
    spinner.innerHTML = '';
  }
}

function acceptDecompose() {
  if (!decomposeTarget) return;
  const { pid, ti } = decomposeTarget;
  const p = ws.find(x => x.id === pid);
  if (!p) return;
  const content = document.getElementById('decompose-content').textContent;
  const subtasks = content.split('\n').map(l => l.replace(/^[-*]\s*/, '').trim()).filter(l => l.length > 0);
  if (subtasks.length === 0) return;
  p.tasks.splice(ti, 1, ...subtasks.map(text => ({ done: false, text })));
  decomposeTarget = null;
  closeDecompose();
  autoSave();
  render();
  showToast(subtasks.length + ' subtasks added');
}

function closeDecompose() {
  document.getElementById('decompose-overlay')?.classList.remove('show');
  decomposeTarget = null;
}

// ── WEEKLY DIGEST ─────────────────────────────────────────────────────────
async function openWeeklyDigest() {
  const overlay = document.getElementById('briefing-overlay');
  const content = document.getElementById('briefing-content');
  const spinner = document.getElementById('briefing-spinner');
  overlay.classList.add('show');
  content.innerHTML = '';
  spinner.innerHTML = '<span class="ai-spinner"></span>';
  document.getElementById('briefing-title').textContent = '\u{1F4C5} Weekly Digest';
  let rawText = '';
  const unsub = window.electronAPI.onWeeklyDigestChunk((chunk) => {
    rawText += chunk;
    content.innerHTML = renderMarkdown(rawText);
    content.scrollTop = content.scrollHeight;
  });
  try {
    const result = await window.electronAPI.getWeeklyDigest(ws);
    if (result?.error) {
      content.textContent = result.error === 'No API key set'
        ? 'Set your API key in Settings (⌘,) to use AI features.'
        : 'Error: ' + result.error;
    }
  } finally {
    unsub();
    spinner.innerHTML = '';
  }
}

// ── SETTINGS & DASHBOARD ──────────────────────────────────────────────────
async function openSettings() {
  const hasKey = await window.electronAPI.hasAIKey();
  const keyInput = document.getElementById('settings-key');
  keyInput.value = '';
  keyInput.placeholder = hasKey ? 'Key is set (enter new to replace)' : 'sk-ant-...';
  const syncCfg = await window.electronAPI.getSyncConfig();
  document.getElementById('settings-sync-url').value = syncCfg.url || '';
  document.getElementById('settings-sync-token').value = syncCfg.token || '';
  document.getElementById('settings-ideas-publish-token').value = syncCfg.publishToken || '';
  document.getElementById('settings-github-path').value = appSettings.githubPath;
  document.getElementById('settings-claude-dir').value = appSettings.personalClaudeDir;
  document.getElementById('settings-dashboard-url').value = appSettings.dashboardUrl;
  document.getElementById('settings-store-dir').textContent = await window.electronAPI.storeDir();
  document.getElementById('settings-work').innerHTML = ws.map(p =>
    '<label class="settings-check"><input type="checkbox" value="' + esc(p.id) + '"' + (scopePrefs.work.includes(p.id) ? ' checked' : '') + '> ' + esc(p.name) + '</label>'
  ).join('');
  document.getElementById('settings-overlay').classList.add('show');
}

function closeSettings() { document.getElementById('settings-overlay').classList.remove('show'); }

async function saveSettings() {
  const res = await window.electronAPI.appSettingsSet({
    githubPath: document.getElementById('settings-github-path').value,
    personalClaudeDir: document.getElementById('settings-claude-dir').value,
    dashboardUrl: document.getElementById('settings-dashboard-url').value,
  });
  if (!res?.ok) return showToast(res?.error || 'Settings not saved', 6000);
  const rootChanged = res.githubPath !== appSettings.githubPath;
  applyAppSettings(res);
  if (rootChanged) availableRepos = (await window.electronAPI.listRepos?.()) || [];
  const key = document.getElementById('settings-key').value.trim();
  // A blank field means untouched: openSettings always shows it blank.
  if (key) await window.electronAPI.setAIKey(key);
  hasAIKey = await window.electronAPI.hasAIKey();
  const syncUrl = document.getElementById('settings-sync-url').value.trim();
  const syncToken = document.getElementById('settings-sync-token').value.trim();
  const publishToken = document.getElementById('settings-ideas-publish-token').value.trim();
  await window.electronAPI.setSyncConfig(syncUrl, syncToken, publishToken);
  const work = [...document.querySelectorAll('#settings-work input:checked')].map(i => i.value);
  await saveScope({ work });
  // A newly set or cleared personal folder shows or hides the toggle and
  // the launch buttons at once.
  await loadLaunchPrefs();
  renderIdeas();
  closeSettings();
  render();
  updateSyncDot();
  showToast('Settings saved');
}

// The last refusal reason toasted. Forgotten only when sync reconnects, so a
// dot that alternates between rejected and conflict does not toast every tick.
let lastSyncReason = null;

async function updateSyncDot() {
  const dot = document.getElementById('sync-dot');
  if (!dot) return;
  try {
    const s = await window.electronAPI.getSyncStatus();
    const status = s.status || 'disconnected';
    const rejected = status === 'rejected' && s.reason;
    dot.className = 'sync-dot ' + status;
    // Review amendment: a 409 after a refusal keeps the reason, so the tooltip
    // shows it whenever main still carries one, not only while 'rejected'.
    dot.title = 'Sync: ' + status + (s.reason ? ': ' + s.reason : '') +
      (s.lastSyncAt ? ' (' + timeAgo(new Date(s.lastSyncAt).toISOString()) + ')' : '');
    if (rejected && s.reason !== lastSyncReason) showToast("Sync refused the server's workspace: " + s.reason, 8000);
    if (rejected) lastSyncReason = s.reason;
    else if (status === 'connected') lastSyncReason = null;
  } catch {
    dot.className = 'sync-dot disconnected';
  }
}

function openDashboard() { window.electronAPI.openDashboard(); }

// ── INIT ───────────────────────────────────────────────────────────────────
async function init() {
  const saved = await window.electronAPI.loadState();
  if (saved) {
    ws = saved.ws || [];
    lists = saved.lists || [];
    today = saved.today || [];
    doneToday = saved.doneToday || [];
    inbox = saved.inbox || [];
    todayDate = saved.todayDate || '';
  }
  validateParity(ws);
  checkMidnightReset();
  setInterval(checkMidnightReset, 60000);

  hasAIKey = await window.electronAPI.hasAIKey();
  applyAppSettings(await window.electronAPI.appSettingsGet());
  availableRepos = (await window.electronAPI.listRepos?.()) || [];
  applyScope(await window.electronAPI.scopePrefsGet());

  initDrag();
  initIdeaDrag();
  initIdeaActions();
  setIssueProjects(ws);
  initIssues();
  loadIssueCounts();
  window.electronAPI.onIssuesChanged?.(loadIssueCounts);
  setTimelineProjects(ws);
  initTimeline();
  setSummaryProjects(ws);
  initSummary();
  subscribeIdeas();

  let startView = 'dashboard';
  try { startView = localStorage.getItem('view') || 'dashboard'; } catch { /* private mode */ }
  setView(startView);
  window.electronAPI.onViewSelect?.((v) => setView(v));
  window.electronAPI.onFocusIdea?.(() => focusIdeaCapture());
  setIdeaProjects(ws);
  // Sort and launchable stages both have to be known before the board's
  // first render, or it sorts by the markup default and shows no launch
  // buttons, then repaints.
  Promise.all([loadBoardPrefs(), loadLaunchPrefs()]).then(loadIdeas).then(() => { if (document.body.dataset.view === 'timeline') renderTimeline(); });

  window.electronAPI.onOpenSettings(() => openSettings());
  window.electronAPI.onTriggerRescan(() => {
    if (document.body.dataset.view === 'issues') return refreshIssues();
    if (document.body.dataset.view === 'timeline') return loadTimeline();
    if (document.body.dataset.view === 'summary') return loadSummary();
    scanAllRepos();
  });
  window.electronAPI.onFocusInbox(() => document.getElementById('inbox-input')?.focus());
  window.electronAPI.onStateUpdatedRemotely(async () => {
    const saved = await window.electronAPI.loadState();
    if (saved) {
      ws = saved.ws || []; lists = saved.lists || []; today = saved.today || [];
      doneToday = saved.doneToday || []; inbox = saved.inbox || []; todayDate = saved.todayDate || '';
    }
    setTimelineProjects(ws);
    setSummaryProjects(ws);
    render();
  });

  render();
  scanAllRepos();
  refreshActivity();
  const SCAN_INTERVAL_MS = 5 * 60 * 1000;
  setInterval(() => { if (!document.hidden) scanAllRepos(true); }, SCAN_INTERVAL_MS);
  updateSyncDot();
  setInterval(updateSyncDot, 30000);
}

// The card rollup's issue/PR links jump to the Issues view on a project and kind.

// ── WINDOW EXPORTS ─────────────────────────────────────────────────────────
Object.assign(window, {
  // ideas-ui.js is a module and reaches these through window, same as the
  // inline onclick handlers do.
  showToast, renderMarkdown, setView, renderGrid, showIssues: showProject,
  // The ideas board copies slash commands, not shell lines, so it words its own
  // toast rather than reusing copyToast's "paste in Terminal".
  copyText, showCopyOverlay,
  setScope,
  scanAllRepos, pushRepo, pushAllInProject, copyCommit, shipRepo, markBuilt, repoPath,
  addTask, toggleTask, deleteTask, editTask, clearDone,
  addRepo, removeRepo, addProject, editProjectName, deleteProject,
  addListTask, toggleListTask, deleteListTask, editListTask, clearListDone,
  editTodayItem,
  editFocus, editBlockedSince, cycleFocusTone, openStatusPicker, setRepoStatus, openRepoEditor, setRepoPlatform, setRepoFlag, toggleBuildDep, toggleIgnoreBranch, toggleBuildTracked,
  openProjectStatusPicker, setProjectStatus, openProjectPriorityPicker, setProjectPriority, toggleParity,
  closeCopyOverlay, openBriefing, closeBriefing, openSettings, closeSettings, saveSettings,
  aiSuggestCommit, aiSuggestFocus, openDashboard, openWeeklyDigest,
  openAnalyze, acceptStatusSuggestion, closeAnalyze,
  aiDecompose, acceptDecompose, closeDecompose,
  createList, deleteList,
  addToToday, toggleTodayItem, deleteTodayItem, sendToToday, sendListToToday,
  toggleDoneOpen,
  addToInbox, deleteInboxItem, openAssignPicker, doAssign,
});

init();
