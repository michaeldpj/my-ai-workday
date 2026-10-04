/**
 * The Ideas board.
 *
 * All board logic lives here rather than in app.js, which is already 1236
 * lines against a 800-line house limit. Handlers attach to `window` at the
 * bottom, matching the inline-onclick idiom the rest of the renderer uses.
 *
 * This module never decides whether a stage transition is legal. It asks main,
 * main asks the store, and the store's refusal becomes the toast verbatim.
 */
import { captureRects, playFlip } from './flip.js';
import { keyAction } from './idea-keys.js';
import { ideaComparator, EFFORT_RANK, effortOf } from './idea-sort.js';
import { buildingAge, formatAge, buildingStale, launchActive, launchAge, launchStale } from './idea-age.js';
import { esc } from './text.js';

const COLUMNS = [
  { key: 'inbox', name: 'Inbox', stages: ['inbox'], drop: 'inbox' },
  { key: 'shaping', name: 'Shaping', stages: ['shaped', 'planned', 'reviewed'], drop: null },
  { key: 'queued', name: 'Queued', stages: ['queued'], drop: 'queued' },
  { key: 'building', name: 'Building', stages: ['building'], drop: null },
  { key: 'done', name: 'Done', stages: ['built', 'shipped'], drop: null },
];

const KILLED_COLUMN = { key: 'killed', name: 'Killed', stages: ['killed'], drop: 'killed' };

/**
 * Stages a card may be dragged OUT of. Only cards whose next legal move is a
 * human one are draggable at all, so the UI never offers a drag the store
 * would refuse. Everything else advances by its action button, because
 * everything else is earned by a command producing an artifact.
 */
const DRAGGABLE_FROM = new Set(['shaped', 'reviewed', 'queued']);

const EMPTY_COPY = {
  inbox: '◇ Inbox zero. Ideas land here from ⌘I or /idea.',
  shaping: '◇ Nothing in flight. Brainstorm one from the inbox.',
  queued: '◇ Nothing queued. Queue a reviewed idea when you are ready.',
  building: '◇ No session running.',
  done: '◇ Nothing built yet.',
};

let ideas = [];
let byIssueUrl = new Map();
let rev = -1;
let dragId = null;
let projects = [];
let selId = null;
/**
 * id -> { action, stage, at }, the sessions launched from this window. Local to
 * the Mac, never in ideas.json and never synced: a running session is not
 * pipeline state. Hydrated from main in loadIdeas, updated when a launch fires,
 * and dropped by the render-time launchActive guard once the card advances.
 */
let launches = {};

/** action -> the word the rail's age line uses for a session in that stage. */
const LAUNCH_VERB = Object.freeze({
  brainstorm: 'brainstorming',
  plan: 'planning',
  review: 'reviewing',
  execute: 'executing',
  ship: 'shipping',
  reopen: 'reopening',
});

/**
 * The project list comes from the dashboard's own state, which app.js owns.
 * Passed in rather than read here so there is one source for it.
 */
export function setIdeaProjects(list) {
  projects = (list || []).map((p) => ({ id: p.id, name: p.name }));
  const sel = document.getElementById('idea-project');
  if (!sel) return;
  const keep = sel.value;
  sel.innerHTML = '<option value="">no project</option>'
    + projects.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  if (keep) sel.value = keep;
}

// ── state ──────────────────────────────────────────────────────────────────

/**
 * Adopt a snapshot only if it is newer. A slow load response can otherwise
 * land after a fast mutation response and render a stale board.
 */
function adopt(snap) {
  if (!snap || typeof snap.rev !== 'number') return false;
  if (snap.rev < rev) return false;
  ideas = snap.ideas || [];
  byIssueUrl = new Map(ideas.filter((i) => i.github?.url).map((i) => [i.github.url, i]));
  rev = snap.rev;
  // The dashboard card counts ideas in flight, so a card moving anywhere repaints it.
  window.renderGrid?.();
  return true;
}

export async function loadIdeas() {
  try {
    try { launches = (await window.electronAPI.ideaLaunchesGet?.()) || {}; }
    catch { launches = {}; }
    adopt(await window.electronAPI.ideasLoad());
    renderIdeas();
  } catch (err) {
    console.error('ideas load failed', err);
  }
}

/** Apply a mutation result: adopt on success, surface the store's words on refusal. */
function applyResult(res) {
  if (!res) return false;
  if (res.ok === false) {
    window.showToast(res.error, 6000);
    return false;
  }
  adopt(res);
  renderIdeas();
  return true;
}

// ── rendering ──────────────────────────────────────────────────────────────


function mineOnly() { return document.getElementById('mine-only')?.checked; }
function showKilled() { return document.getElementById('show-killed')?.checked; }

function visible() {
  return showKilled() ? ideas.slice() : ideas.filter((i) => i.stage !== 'killed');
}

function columns() {
  return showKilled() ? [...COLUMNS, KILLED_COLUMN] : COLUMNS;
}

/** The select is the live value; an unknown one is the comparator's problem, and it has a default. */
function sortRows(rows) {
  return rows.slice().sort(ideaComparator(document.getElementById('board-sort')?.value));
}

/** Shaping pips: brief, plan, review. An express-lane card shows one filled. */
function pips(i) {
  const on = [!!i.brief, !!i.planPath, !!i.reviewVerdict];
  return `<span class="icard-pips" title="brief / plan / review">${
    on.map((v) => `<span class="pip${v ? ' on' : ''}"></span>`).join('')}</span>`;
}

/**
 * Buttons carry data attributes and are dispatched by one delegated listener.
 *
 * Deliberately NOT inline onclick with an interpolated id: `esc()` escapes HTML
 * quoting, not JavaScript string delimiters, so an id containing an apostrophe
 * would break out of the handler and execute. ideas.json is writable by
 * anything on the machine and the CSP allows inline script, so that path was a
 * real injection route rather than a theoretical one.
 */
const btn = (act, label, cls = '') =>
  `<button class="icard-act${cls ? ' ' + cls : ''}" data-act="${act}">${label}</button>`;

/** Stage actions main found a skill for. Empty until the first prefs load. */
let launchable = new Set();

/** A launch button, or nothing when the selected CLI has no skill for it. */
const launch = (action, label, cls = '') => (launchable.has(action) ? btn('launch:' + action, label, cls) : '');

/**
 * Copy the stage's slash command rather than opening a terminal on it, for
 * pasting into a Claude session that is already open. The command text is
 * built in main from the same enumerated action the launcher takes, so the
 * two buttons can never disagree about what a stage's command is.
 */
const copyBtn = (act) =>
  `<button class="icard-copy" data-act="copy:${act}" title="Copy the command" aria-label="Copy the command">⧉</button>`;

/** Edit the capture before a brainstorm reads it. Inbox only: after that the brief is the authority. */
const editBtn = () =>
  `<button class="icard-copy" data-act="edit" title="Edit this idea" aria-label="Edit this idea">✎</button>`;

/**
 * Quiet kill for stages where dropping the idea is legal but not the decision
 * the card is asking for. Reviewed keeps the full red Kill, since there the
 * choice IS queue-or-kill. Same confirm whichever control you use.
 */
const killBtn = () =>
  `<button class="icard-copy kill" data-act="kill" title="Kill this idea" aria-label="Kill this idea">✕</button>`;

/**
 * `solo` keeps a lone action left-aligned, the way it read before the copy
 * button put every action inside a flex row.
 */
const row = (actions, copy) => {
  const shown = actions.filter(Boolean);
  return `<div class="icard-actions${shown.length === 1 ? ' solo' : ''}">${shown.join('')}${copy}</div>`;
};

/** `inOverlay`: the detail view has its own Edit button, so the pencil stays on the card. */
function actionButton(i, inOverlay = false) {
  switch (i.stage) {
    case 'inbox':
      return row([launch('brainstorm', 'Brainstorm')], copyBtn('brainstorm') + (inOverlay ? '' : editBtn()) + killBtn());
    case 'shaped':
      return i.planEffort === 'low'
        ? row([btn('queue', 'Queue'), launch('plan', 'Plan anyway', 'warn')], copyBtn('plan') + killBtn())
        : row([launch('plan', 'Plan')], copyBtn('plan') + killBtn());
    case 'planned':
      return row([launch('review', 'Review')], copyBtn('review') + killBtn());
    case 'reviewed':
      // Queue and Kill are opposite decisions and never share a control. The
      // copy carries Queue, which is the decision that has a session behind it.
      return row([btn('queue', 'Queue'), btn('kill', 'Kill', 'kill')], copyBtn('queue'));
    case 'queued':
      return row([launch('execute', 'Execute')], copyBtn('execute') + killBtn());
    case 'building': {
      // The app cannot see whether the session is alive, so a fresh card must
      // not assert that it died. Past the effort's threshold the same button
      // takes the warn treatment and says what it suspects.
      const stale = buildingStale(i);
      return row([btn('reset', stale ? 'Reset (session died)' : 'Reset', stale ? 'warn' : 'quiet')], copyBtn('reset'));
    }
    case 'built':
      return row([launch('ship', 'Deployed? Ship it')], copyBtn('ship'));
    case 'killed':
      return row([launch('reopen', 'Reopen', 'warn')], copyBtn('reopen'));
    default:
      return '';
  }
}

/**
 * Effort as a neutral three-bar meter. Level reads from how many bars are lit,
 * never from hue, so it cannot be mistaken for the amber your-move signal or the
 * red kill signal on a card that is only resting.
 */
function effortMark(eff) {
  if (!eff) return '';
  const n = EFFORT_RANK[eff] || 0;
  const bars = [1, 2, 3].map((i) => `<i class="eff-bar${i <= n ? ' on' : ''}"></i>`).join('');
  return `<span class="icard-eff" title="effort: ${esc(eff)}"><span class="eff-meter">${bars}</span>${esc(eff)}</span>`;
}

/**
 * The running-session rail, with how long the card has been on it. An age it
 * cannot work out is left off rather than guessed at.
 *
 * `building` cards drive it from the stage-entry stamp and clear it with Reset.
 * A launch marker drives the same rail on any other stage, and there Reset does
 * not apply, so the rail itself is the dismiss control: the session is done and
 * the card just did not move, or it never will.
 */
function liveRail({ sinceMs, stale, label, dismissable }) {
  const age = formatAge(sinceMs);
  const hint = 'Session finished? Click to clear.';
  const bar = dismissable
    ? `<button type="button" class="icard-live" data-act="dismiss-live" title="${hint}" aria-label="Dismiss the running indicator"></button>`
    : '<div class="icard-live" aria-hidden="true"></div>';
  const ageLine = age
    ? `<div class="icard-age${stale ? ' stale' : ''}"${dismissable ? ` data-act="dismiss-live" title="${hint}"` : ''}>${esc(label)} ${esc(age)}</div>`
    : '';
  return `${bar}${ageLine}`;
}

/** The rail a card shows, if any: the building stage, or a live launch marker. */
function railFor(i) {
  if (i.stage === 'building') {
    return liveRail({ sinceMs: buildingAge(i), stale: buildingStale(i), label: 'building', dismissable: false });
  }
  const m = launches[i.id];
  if (m && launchActive(i, m)) {
    return liveRail({ sinceMs: launchAge(m), stale: launchStale(m), label: LAUNCH_VERB[m.action] || 'working', dismissable: true });
  }
  return '';
}

function card(i) {
  const mine = i.waitingOn === 'you';
  const eff = effortOf(i);
  const drag = DRAGGABLE_FROM.has(i.stage);
  const shaping = i.stage === 'shaped' || i.stage === 'planned' || i.stage === 'reviewed';
  const tag = i.stage === 'built' ? '<span class="icard-tag ready">ready</span>'
    : i.stage === 'killed' ? '<span class="icard-tag killed">killed</span>'
    : i.cameBack ? '<span class="icard-tag back">came back</span>' : '';
  return `<div class="icard${mine ? ' mine' : ''}" tabindex="0" role="button" aria-label="${esc(i.title)}"
    ${drag ? 'draggable="true"' : ''} data-id="${esc(i.id)}" data-stage="${esc(i.stage)}">
    <div class="icard-title">${esc(i.title)}</div>
    <div class="icard-meta">
      ${i.projectId ? `<span class="icard-proj">${esc(i.projectId)}</span>` : ''}
      ${effortMark(eff)}
      ${i.impact ? `<span class="icard-impact">i${i.impact}</span>` : ''}
      ${tag}
      ${shaping ? pips(i) : ''}
    </div>
    ${railFor(i)}
    ${mine || i.stage === 'building' ? actionButton(i) : ''}
  </div>`;
}

function updateChrome(mine, reviewed, board) {
  const summary = document.getElementById('ideas-summary');
  if (summary) {
    summary.innerHTML = mine ? `<strong>${mine}</strong> waiting on you` : 'Nothing waiting on you.';
  }
  const badge = document.getElementById('ideas-badge');
  if (badge) badge.textContent = mine || '';

  // The cap is a deliberate limit and must read as one, not as an error.
  const existing = board.parentElement.querySelector('.cap-note');
  if (existing) existing.remove();
  if (reviewed >= 10) {
    const note = document.createElement('div');
    note.className = 'cap-note';
    note.textContent = `${reviewed} plans are waiting on your queue-or-kill call. Review is paused until you clear one. That is the cap doing its job.`;
    board.parentElement.appendChild(note);
  }
}

/** Paint the keyboard selection ring on the currently selected card. */
function applySelection(board) {
  if (!board) return;
  board.querySelectorAll('.icard.sel').forEach((el) => el.classList.remove('sel'));
  if (!selId) return;
  const el = [...board.querySelectorAll('.icard')].find((c) => c.dataset.id === selId);
  if (el) el.classList.add('sel'); else selId = null;
}

/** Move the selection by columns/rows across the rendered board. */
function moveSel(dCol, dRow) {
  const board = document.getElementById('ideas-board');
  if (!board) return;
  const cols = [...board.querySelectorAll('.icol')]
    .map((c) => [...c.querySelectorAll('.icard')]).filter((list) => list.length);
  if (!cols.length) return;
  let ci = 0, ri = 0, found = false;
  for (let c = 0; c < cols.length && !found; c++) {
    for (let r = 0; r < cols[c].length; r++) {
      if (cols[c][r].dataset.id === selId) { ci = c; ri = r; found = true; break; }
    }
  }
  if (found) {
    ci = Math.max(0, Math.min(cols.length - 1, ci + dCol));
    ri = Math.max(0, Math.min(cols[ci].length - 1, ri + dRow));
  }
  const target = cols[ci][ri];
  if (!target) return;
  selId = target.dataset.id;
  applySelection(board);
  target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

export function renderIdeas() {
  const board = document.getElementById('ideas-board');
  if (!board) return;
  const prevRects = captureRects(board, '.icard');

  const all = visible();
  const mine = all.filter((i) => i.waitingOn === 'you').length;
  const reviewed = ideas.filter((i) => i.stage === 'reviewed').length;

  // Reward: the your-move filter is on, nothing waits on you, and the board is
  // not simply empty. The one state that should feel like a win.
  if (mineOnly() && mine === 0 && all.length) {
    board.classList.remove('with-killed');
    // Same exemption as the board: the reward stands, but it names what is
    // actually running. The count is the running ideas and not every idea that
    // simply is not yours, so the number and the list beneath it agree; a
    // shipped idea is finished, not moving on its own.
    const running = all.filter((i) => i.stage === 'building');
    const n = running.length;
    board.innerHTML = `<div class="ideas-reward">
      <div class="rw-mark" aria-hidden="true">✓</div>
      <div class="rw-title">Nothing waiting on you</div>
      <div class="rw-sub">${n
        ? `${n} idea${n === 1 ? '' : 's'} moving on ${n === 1 ? 'its' : 'their'} own`
        : 'Nothing running either. The board is clear.'}</div>
      ${n ? `<ul class="rw-running">${running.map((i) => `<li>${esc(i.title)}</li>`).join('')}</ul>` : ''}
    </div>`;
    updateChrome(mine, reviewed, board);
    return;
  }

  // Building is exempt from the your-move filter. Those cards wait on a session
  // and never on you, so the filter would hide the one thing worth watching:
  // which idea is running, and whether it died and needs /idea-reset.
  const rows = mineOnly()
    ? all.filter((i) => i.waitingOn === 'you' || i.stage === 'building')
    : all;
  const cols = columns();
  board.classList.toggle('with-killed', cols.length > COLUMNS.length);

  board.innerHTML = cols.map((col) => {
    const inCol = sortRows(rows.filter((i) => col.stages.includes(i.stage)));
    const total = all.filter((i) => col.stages.includes(i.stage)).length;
    const body = inCol.length
      ? inCol.map(card).join('')
      : `<div class="icol-empty">${mineOnly() && total ? `${total} here, none waiting on you` : (EMPTY_COPY[col.key] || 'Nothing here.')}</div>`;
    return `<div class="icol" data-col="${col.key}" data-drop="${col.drop || ''}">
      <div class="icol-head">
        <span class="icol-name">${col.name}</span>
        <span class="icol-count">${inCol.length}${total !== inCol.length ? ` / ${total}` : ''}</span>
      </div>
      <div class="icol-body">${body}</div>
    </div>`;
  }).join('');
  playFlip(board, '.icard', prevRects);
  applySelection(board);

  updateChrome(mine, reviewed, board);
}


// ── phone sync ─────────────────────────────────────────────────────────────

/**
 * Show whether the phone can actually reach this board.
 *
 * A sync that cannot authenticate looks identical to a sync with nothing to
 * send, and that is not hypothetical: the workspace sync beside this one
 * stopped reaching the server in April and went unnoticed for four months
 * because nothing ever said so. Anything you have to act on says what to do.
 */
const SYNC_TEXT = {
  ok: (s) => [`phone sync on${s.pendingCaptures ? ` · ${s.pendingCaptures} waiting` : ''}`, 'ok'],
  unconfigured: (s) => [
    s.reason === 'no token'
      ? 'phone sync off · no token. Add it in Settings.'
      : 'phone sync off · no server. Add it in Settings.',
    'warn',
  ],
  unreachable: () => ['phone sync unreachable · retrying', 'warn'],
  error: (s) => [`phone sync failed · ${s.reason || 'unknown'}`, 'bad'],
  idle: () => ['phone sync starting', 'idle'],
};

export function renderSyncStatus(status) {
  const el = document.getElementById('ideas-sync');
  if (!el) return;
  const build = SYNC_TEXT[status?.state];
  if (!build) { el.hidden = true; return; }
  const [text, tone] = build(status);
  el.hidden = false;
  el.textContent = text;
  el.className = `ideas-sync ideas-sync-${tone}`;
  el.title = status.at ? `last checked ${new Date(status.at).toLocaleTimeString()}` : '';
}

// ── capture ────────────────────────────────────────────────────────────────

/**
 * Capture only. It records what you typed and stops: no brainstorming, no
 * planning, no code. The stage between an idea and a branch is the point.
 */
async function addIdea() {
  const input = document.getElementById('idea-input');
  const button = document.getElementById('idea-add');
  const title = (input?.value || '').trim();
  if (!title) { input?.focus(); return; }

  button.disabled = true;
  try {
    const res = await window.electronAPI.ideasAdd({
      title,
      projectId: document.getElementById('idea-project')?.value || null,
      impact: document.getElementById('idea-impact')?.value || null,
      effort: document.getElementById('idea-effort')?.value || null,
      model: document.getElementById('idea-model')?.value || null,
    });
    if (res?.ok === false) { window.showToast(res.error, 6000); return; }
    adopt(res);
    input.value = '';
    // Project and impact stay put: ideas arrive in runs about the same thing.
    renderIdeas();
    window.showToast('Captured. Brainstorm it when you are ready.');
  } finally {
    button.disabled = false;
    input?.focus();
  }
}

export function focusIdeaCapture() {
  document.body.dataset.view = 'ideas';
  renderIdeas();
  document.getElementById('idea-input')?.focus();
}

// ── launch preferences ─────────────────────────────────────────────────────

/** Paint the bar from main's copy. Main owns the value; the bar only shows it. */
function paintLaunchPrefs(p) {
  if (!p) return;
  document.querySelectorAll('#launch-cli button').forEach((b) => {
    b.classList.toggle('on', b.dataset.cli === p.cli);
  });
  const model = document.getElementById('launch-model');
  const reasoning = document.getElementById('launch-reasoning');
  if (model) model.value = p.model;
  if (reasoning) reasoning.value = p.effort;
  launchable = new Set(p.launchable || []);
  const toggle = document.getElementById('launch-cli');
  if (toggle) toggle.hidden = !p.personal;
  const group = document.getElementById('launch-group');
  if (group) group.hidden = !p.personal && launchable.size === 0;
}

export async function loadLaunchPrefs() {
  try { paintLaunchPrefs(await window.electronAPI.launchPrefsGet()); } catch { /* bar keeps defaults */ }
}

async function saveLaunchPref(partial) {
  const res = await window.electronAPI.launchPrefsSet(partial);
  if (res?.ok === false) { window.showToast(res.error, 6000); return loadLaunchPrefs(); }
  paintLaunchPrefs(res);
  // Switching CLI can change which stages have a skill behind them.
  renderIdeas();
}

// ── board preferences ──────────────────────────────────────────────────────

/**
 * How the columns are ordered, remembered across launches. Same path as the
 * launch prefs above rather than localStorage, so the app keeps one place a
 * preference lives.
 *
 * Paints the select and renders nothing, exactly as loadLaunchPrefs does. The
 * board's first render belongs to loadIdeas, and app.js awaits this before it,
 * so the stored sort is already in the select when that render happens. A
 * render here would either paint an empty board or make the real one visibly
 * re-sort, with FLIP animating cards that only moved because of load order.
 */
export async function loadBoardPrefs() {
  const sel = document.getElementById('board-sort');
  if (!sel) return;
  try {
    sel.value = (await window.electronAPI.boardPrefsGet()).sort;
  } catch { /* the select keeps its markup default, which is the board default */ }
}

/**
 * Reorder first, persist after. The comparator reads the select, so the new
 * order is knowable locally and has no reason to wait on a disk write in main.
 */
async function saveBoardPref(sort) {
  renderIdeas();
  const res = await window.electronAPI.boardPrefsSet({ sort });
  if (res?.ok !== false) return;
  window.showToast(res.error, 6000);
  // Only roll back if this is still the mode on screen. A second change made
  // while this call was in flight is the newer intent, and a late refusal of
  // the older one must not drag the board back to it.
  const sel = document.getElementById('board-sort');
  if (!sel || sel.value !== sort) return;
  await loadBoardPrefs();
  renderIdeas();
}

// ── actions ────────────────────────────────────────────────────────────────

async function ideaMove(id, to, note) {
  applyResult(await window.electronAPI.ideasMove({ id, to, note }));
}

/**
 * confirm(), not prompt(): Electron's renderer refuses window.prompt and throws
 * from the click handler, so a prompt-gated action silently does nothing. The
 * kill confirms and records no reason; /idea-kill from the CLI still takes one.
 */
async function ideaKill(id) {
  const i = ideas.find((x) => x.id === id);
  if (!i || !confirm(`Kill "${i.title}"?`)) return;
  await ideaMove(id, 'killed');
}

async function ideaReset(id) {
  const i = ideas.find((x) => x.id === id);
  if (!i || !confirm(`Reset "${i.title}" to queued? Only do this if the session is gone.`)) return;
  await ideaMove(id, 'queued', 'session died');
}

/**
 * The clipboard path. A slash command carries no working directory, so the
 * toast names the repo the session you paste into has to be open on.
 */
async function ideaCopy(id, action) {
  const res = await window.electronAPI.ideasCommand({ action, id });
  if (!res?.ok) return window.showToast(res?.error || 'could not build that command', 6000);
  if (await window.copyText(res.command)) {
    window.showToast(res.repo ? `Copied. Paste into a Claude session on ${res.repo}` : 'Copied');
  } else {
    window.showCopyOverlay(res.command);
  }
}

async function ideaLaunch(id, action) {
  const res = await window.electronAPI.ideasLaunch({ action, id });
  if (res?.ok === false) return window.showToast(res.error, 6000);
  // The rail on this card is driven by the marker main just stamped and handed
  // back, so a session shows as running the moment its terminal opens.
  if (res?.marker) { launches = { ...launches, [id]: res.marker }; renderIdeas(); }
  const cli = res?.cli === 'personal' ? 'personal' : 'claude';
  window.showToast(`Session opening in your terminal (${cli}, ${res?.model}, ${res?.effort})`);
}

/**
 * Clear the running rail by hand. The render drops the marker at once; the store
 * write is what keeps it gone across restarts. Dismiss exists for a session that
 * ended without moving the card, so the read-time GC (which only drops markers a
 * stage change invalidated) would not catch this one — a failed write is worth
 * surfacing, not swallowing.
 */
async function ideaDismissLive(id) {
  const { [id]: _gone, ...rest } = launches;
  launches = rest;
  renderIdeas();
  try {
    await window.electronAPI.ideaLaunchesClear?.([id]);
  } catch (err) {
    console.error('dismiss launch marker failed', err);
  }
}

/** renderMarkdown calls .split(); a non-string field would throw there. */
function md(heading, value) {
  if (typeof value !== 'string' || !value) return '';
  return `<h2>${esc(heading)}</h2>${window.renderMarkdown(value)}`;
}

function ideaOpen(id) {
  const i = ideas.find((x) => x.id === id);
  if (!i) return;
  document.getElementById('idea-title').textContent = i.title;
  const parts = [
    `<div class="meta-line">${esc(i.stage)} · waiting on ${esc(i.waitingOn)} · ${esc(i.projectId || 'no project')}${i.repos?.length ? ' · ' + esc(i.repos.join(', ')) : ''}</div>`,
    `<div class="meta-line">effort: you said ${esc(i.effort || '-')}, the plan says ${esc(i.planEffort || '-')}</div>`,
    i.planPath ? `<div class="meta-line">plan: <code>${esc(i.planPath)}</code></div>` : '',
    i.github ? `<div class="meta-line">issue: <a href="${esc(i.github.url)}" target="_blank" rel="noopener">#${esc(i.github.number)}</a></div>` : '',
    i.notes ? `<h2>Notes</h2><p>${esc(i.notes).replace(/\n/g, '<br>')}</p>` : '',
    md('Brief', i.brief),
    md('Kill criteria', i.killCriteria),
    md('Review', i.reviewVerdict),
    i.killedReason ? `<h2>Killed</h2><p>${esc(i.killedReason)}</p>` : '',
  ];
  document.getElementById('idea-content').innerHTML = parts.filter(Boolean).join('');
  const acts = document.getElementById('idea-actions');
  acts.innerHTML = `${actionButton(i, true)}${i.stage === 'inbox' ? '<button class="btn" data-act="edit">Edit</button>' : ''}${
    i.github ? '<button type="button" class="btn" data-act="view-issue">View in Issues</button>' : ''}<button class="btn" data-act="close">Close</button>`;
  acts.dataset.id = i.id;
  document.getElementById('idea-overlay').classList.add('show');
}

function ideaClose() {
  document.getElementById('idea-overlay')?.classList.remove('show');
}

// ── edit ───────────────────────────────────────────────────────────────────

const opt = (v, label, cur) => `<option value="${esc(v)}"${String(cur ?? '') === String(v) ? ' selected' : ''}>${esc(label)}</option>`;

/**
 * The overlay in edit mode. Six person-owned fields and the launch model,
 * nothing a command produces. Save sends only what changed, through the same
 * allowlist every other writer uses, so the store's refusal is the toast.
 */
function ideaEdit(id) {
  const i = ideas.find((x) => x.id === id);
  if (!i || i.stage !== 'inbox') return;
  document.getElementById('idea-title').textContent = 'Edit idea';
  document.getElementById('idea-content').innerHTML = `
    <form class="idea-form" id="idea-form">
      <label>Title<input name="title" value="${esc(i.title)}" maxlength="4000" required></label>
      <label>Context<textarea name="notes" rows="8" maxlength="4000">${esc(i.notes || '')}</textarea></label>
      <div class="idea-form-row">
        <label>Project<select name="projectId">${opt('', 'no project', i.projectId)}${
          projects.map((p) => opt(p.id, p.name, i.projectId)).join('')}</select></label>
        <label>Impact<select name="impact">${opt('', 'none', i.impact)}${
          [5, 4, 3, 2, 1].map((n) => opt(n, String(n), i.impact)).join('')}</select></label>
        <label>Effort<select name="effort">${opt('', 'unrated', i.effort)}${
          ['low', 'medium', 'high'].map((e) => opt(e, e, i.effort)).join('')}</select></label>
        <label>Model<select name="model">${opt('', 'follow the bar', i.model)}${
          ['fable', 'opus', 'sonnet', 'haiku'].map((m) => opt(m, m, i.model)).join('')}</select></label>
      </div>
      <label>Repos<input name="repos" value="${esc((i.repos || []).join(', '))}" placeholder="repo-a, repo-b" maxlength="1200"></label>
    </form>`;
  const acts = document.getElementById('idea-actions');
  acts.innerHTML = `<button class="btn" data-act="close">Cancel</button><button class="btn primary" data-act="save">Save</button>`;
  acts.dataset.id = i.id;
  // Enter in the title would otherwise submit the form natively and reload
  // the renderer. Save instead, which is what Enter should mean here.
  document.getElementById('idea-form').addEventListener('submit', (e) => {
    e.preventDefault();
    ideaSave(id);
  });
  document.getElementById('idea-overlay').classList.add('show');
  document.querySelector('#idea-form [name="title"]')?.focus();
}

async function ideaSave(id) {
  const i = ideas.find((x) => x.id === id);
  const form = document.getElementById('idea-form');
  if (!i || !form) return;
  const fd = new FormData(form);
  const fields = {};
  for (const key of ['title', 'notes', 'projectId', 'impact', 'effort', 'model', 'repos']) {
    const raw = String(fd.get(key) ?? '');
    if (key === 'repos') {
      const cur = (i.repos || []).join(', ');
      if (raw !== cur) fields.repos = raw;
      continue;
    }
    const next = key === 'title' || key === 'notes' ? raw : (raw || null);
    const cur = key === 'notes' ? (i.notes || '') : (i[key] ?? null);
    if (String(next ?? '') !== String(cur ?? '')) fields[key] = next;
  }
  if (!fields.title && 'title' in fields) return window.showToast('an idea needs a title', 4000);
  if (Object.keys(fields).length === 0) return ideaClose();
  if (applyResult(await window.electronAPI.ideasSet({ id, fields }))) {
    ideaClose();
    window.showToast('Saved');
  }
}

/**
 * One click listener for the whole board and the overlay. Ids travel in
 * data attributes and are never interpolated into executable text.
 */
async function dispatch(id, act) {
  if (act === 'close') return ideaClose();
  if (act === 'queue') return ideaMove(id, 'queued');
  if (act === 'kill') return ideaKill(id);
  if (act === 'reset') return ideaReset(id);
  if (act === 'dismiss-live') return ideaDismissLive(id);
  if (act === 'edit') return ideaEdit(id);
  if (act === 'save') return ideaSave(id);
  if (act === 'view-issue') {
    const url = ideas.find((i) => i.id === id)?.github?.url;
    ideaClose();
    if (url) window.openIssue(url);
    return;
  }
  if (act.startsWith('copy:')) return ideaCopy(id, act.slice(5));
  if (act.startsWith('launch:')) return ideaLaunch(id, act.slice(7));
}

export function initIdeaActions() {
  document.getElementById('idea-add')?.addEventListener('click', addIdea);
  document.getElementById('idea-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addIdea();
  });

  document.getElementById('launch-cli')?.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-cli]');
    if (b) saveLaunchPref({ cli: b.dataset.cli });
  });
  document.getElementById('launch-model')?.addEventListener('change', (e) => saveLaunchPref({ model: e.target.value }));
  document.getElementById('launch-reasoning')?.addEventListener('change', (e) => saveLaunchPref({ effort: e.target.value }));

  document.getElementById('board-sort')?.addEventListener('change', (e) => saveBoardPref(e.target.value));

  document.addEventListener('click', (e) => {
    const button = e.target.closest?.('[data-act]');
    if (button) {
      const holder = button.closest('.icard') || button.closest('#idea-actions');
      const id = holder?.dataset.id;
      if (!id && button.dataset.act !== 'close') return;
      e.stopPropagation();
      dispatch(id, button.dataset.act);
      return;
    }
    const card = e.target.closest?.('.icard');
    if (card && document.getElementById('ideas-board')?.contains(card)) {
      ideaOpen(card.dataset.id);
    }
  });

  document.getElementById('idea-overlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'idea-overlay') ideaClose();
  });

  // Keep the keyboard selection in step with real focus. A card reached by Tab
  // (it is tabindex=0 role=button) then answers Enter and single-key actions
  // without arrowing to it first.
  document.addEventListener('focusin', (e) => {
    const card = e.target.closest?.('.icard');
    const board = document.getElementById('ideas-board');
    if (card && board?.contains(card) && card.dataset.id !== selId) {
      selId = card.dataset.id;
      applySelection(board);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (document.body.dataset.view !== 'ideas') return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const overlayOpen = document.getElementById('idea-overlay')?.classList.contains('show');
    if (e.key === 'Escape') {
      if (overlayOpen) return ideaClose();
      if (selId) { selId = null; applySelection(document.getElementById('ideas-board')); }
      return;
    }
    if (overlayOpen) return;
    if (e.key === '/') { e.preventDefault(); document.getElementById('idea-input')?.focus(); return; }
    if (e.key === 'ArrowLeft') { e.preventDefault(); return moveSel(-1, 0); }
    if (e.key === 'ArrowRight') { e.preventDefault(); return moveSel(1, 0); }
    if (e.key === 'ArrowUp') { e.preventDefault(); return moveSel(0, -1); }
    if (e.key === 'ArrowDown') { e.preventDefault(); return moveSel(0, 1); }
    if (e.key === 'Enter') { if (selId) { e.preventDefault(); ideaOpen(selId); } return; }
    if (selId && e.key.length === 1) {
      const el = [...document.querySelectorAll('.icard')].find((c) => c.dataset.id === selId);
      const stage = el?.dataset.stage;
      const act = stage && keyAction(stage, e.key.toLowerCase());
      if (act) { e.preventDefault(); dispatch(selId, act); }
    }
  });
}

// ── drag ───────────────────────────────────────────────────────────────────

/**
 * Separate from app.js's initDrag(), which reorders within one container and
 * matches source to target on drag type and pid. It has no concept of columns
 * or legal transitions, so extending it would have meant rewriting it.
 */
export function initIdeaDrag() {
  const board = () => document.getElementById('ideas-board');

  document.addEventListener('dragstart', (e) => {
    const card = e.target.closest?.('.icard');
    if (!card || !board()?.contains(card)) return;
    dragId = card.dataset.id;
    card.classList.add('dragging');
    board()?.classList.add('dragging');
  });

  document.addEventListener('dragend', () => {
    dragId = null;
    document.querySelectorAll('.icard.dragging').forEach((el) => el.classList.remove('dragging'));
    document.querySelectorAll('.icol').forEach((el) => el.classList.remove('drop-ok', 'drop-no'));
    board()?.classList.remove('dragging');
  });

  document.addEventListener('dragover', (e) => {
    if (!dragId) return;
    const col = e.target.closest?.('.icol');
    if (!col || !board()?.contains(col)) return;
    // A grouped column is not a drop target: a drop into Shaping cannot say
    // whether shaped, planned, or reviewed was meant.
    if (col.dataset.drop) {
      e.preventDefault();
      col.classList.add('drop-ok');
    } else {
      col.classList.add('drop-no');
    }
  });

  document.addEventListener('dragleave', (e) => {
    const col = e.target.closest?.('.icol');
    col?.classList.remove('drop-ok', 'drop-no');
  });

  document.addEventListener('drop', async (e) => {
    if (!dragId) return;
    const col = e.target.closest?.('.icol');
    if (!col || !board()?.contains(col)) return;
    e.preventDefault();
    const to = col.dataset.drop;
    const id = dragId;
    dragId = null;
    document.querySelectorAll('.icol').forEach((el) => el.classList.remove('drop-ok', 'drop-no'));
    board()?.classList.remove('dragging');
    if (!to) {
      window.showToast('That column is earned by a command, not by dragging. Use the card action.', 5000);
      return;
    }
    // Same confirm as the button, whichever way you got here.
    if (to === 'killed') { await ideaKill(id); return; }
    await ideaMove(id, to);
  });
}

// ── live updates ───────────────────────────────────────────────────────────

export function subscribeIdeas() {
  window.electronAPI.onIdeasChanged?.((snap) => {
    // A card moving on its own when a session finishes elsewhere is the whole
    // point of the watcher.
    if (adopt(snap)) { renderIdeas(); if (document.body.dataset.view === 'timeline') window.renderTimeline?.(); }
  });
  window.electronAPI.onIdeasSync?.(renderSyncStatus);
  // Ask once at startup: the first tick may already have run and pushed its
  // status before this view was ever subscribed.
  window.electronAPI.ideasSyncStatus?.().then(renderSyncStatus).catch(() => {});
}

// renderIdeas is reached from the two inline onchange handlers on the filter
// checkboxes in index.html. Nothing else needs a global.
Object.assign(window, { renderIdeas });

/** Issues view asks this for every row, so it is a lookup, not a scan. */
export function ideaByIssueUrl(url) {
  return byIssueUrl.get(url) || null;
}

/** Timeline reads idea history off the module's own array. */
export function allIdeas() {
  return ideas;
}

/** Select a card from outside the board, e.g. from an issue's "Show on board". */
export function selectIdea(id) {
  selId = id;
  renderIdeas();
  const board = document.getElementById('ideas-board');
  applySelection(board);
  [...(board?.querySelectorAll('.icard') || [])].find((c) => c.dataset.id === id)
    ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
