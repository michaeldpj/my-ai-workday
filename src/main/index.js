import { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import { scanAll, getWeeklyLog, listRepoDirs, prStates, safeRepoName, getCommitLog } from './git.js';
import {
  initStore, loadState, saveState, getWindowBounds, saveWindowBounds,
  getGithubPath, getPreviousHashes, savePreviousHashes,
  getStaleBaselines, saveStaleBaselines, isFirstRun, markInitialized,
  getSyncConfig, setSyncUrl, getLaunchPrefs, setLaunchPrefs, getBoardPrefs, setBoardPrefs,
  getScopePrefs, setScopePrefs,
  getIdeaLaunches, setIdeaLaunches,
  getIssuesPrefs, setIssuesPrefs, getIssuesRead, markIssueRead,
  getAttentionSince, saveAttentionSince,
  getAppSettings, setAppSettings, getPersonalClaudeDir,
} from './store.js';
import { applySettings, expandHome } from './app-settings.js';
import { mergeSince } from './attention.js';
import { getAIKey, setAIKey, getSyncToken, setSyncToken, getPublishToken, setPublishToken } from './keys.js';
import { suggestCommitMessage, getDailyBriefing, suggestFocusLine, analyzeStatuses, decomposeTask, getWeeklyDigest } from './ai.js';
import { startSync, stopSync, debouncedPush, pullState, getSyncStatus } from './sync.js';
import { snapshot as ideasSnapshot, addIdea, moveIdea, setIdea, startWatching as startIdeasWatch } from './ideas.js';
import { startIdeasSync, stopIdeasSync, publishSoon, getIdeasSyncStatus } from './ideas-sync.js';
import { launchSession, resolveLaunchRepo, stageCommand, worktreeName, sessionName, CLI_KEYS, claudeConfigDir, launchableActions, EFFORTS } from './terminal.js';
import { MODELS } from '../../scripts/idea-fields.mjs';
import { configPath, storeDir } from '../../scripts/store-dir.mjs';
import { fetchProjectIssues } from './issues.js';
import { projectSnapshot, activityRows, openCounts } from './issues-store.js';
import { startIssuesSync } from './issues-sync.js';
import { ISSUE_KINDS, ISSUE_STATES, ISSUE_SORTS } from '../renderer/issue-model.js';
import { TIMELINE_RANGES, DEFAULT_RANGE } from '../renderer/timeline-model.js';
// The board's sort modes have exactly one definition. Vite bundles this into
// dist/main the same way it bundles scripts/ideas-store.mjs, so main validates
// against the very list the renderer's comparator switches on and the two
// cannot drift into a stored value the board silently ignores.
import { SORT_MODES } from '../renderer/idea-sort.js';
import { SCOPES } from '../renderer/scope-model.js';
import { isStale } from '../renderer/repo-age.js';
import { launchActive } from '../renderer/idea-age.js';
import { WORKSPACE_ID, validateWorkspace, filterStatusSuggestions } from '../renderer/workspace-model.js';

let win = null;
let tray = null;
let rendererWatcher = null;

// The masked sentinel get-sync-config emits for a set token. A field still
// equal to it on save means "unchanged" — do not overwrite the stored token.
const TOKEN_MASK = '••••••••';

let _appIcon;
/** Every repo name across the workspace that may become a path or an argument. */
function allRepoNames() {
  return (loadState()?.ws || []).flatMap((p) => p.repos.map((r) => r.name)).filter(safeRepoName);
}

function getAppIcon() {
  if (_appIcon !== undefined) return _appIcon;
  const resourcePath = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(__dirname, '../../build/icon.png');
  if (fs.existsSync(resourcePath)) return (_appIcon = nativeImage.createFromPath(resourcePath));
  return (_appIcon = null);
}

/** Start ideas sync and push every status change to the board. */
function beginIdeasSync(getWin) {
  startIdeasSync(getWin, (status) => {
    const w = getWin();
    if (!w || w.isDestroyed()) return;
    try { w.webContents.send('ideas:sync', status); } catch { /* torn down */ }
  });
}

function createWindow() {
  const bounds = getWindowBounds();
  const icon = getAppIcon();
  win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    titleBarStyle: 'default',
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, '../../src/renderer/index.html'));

  // Rendered issue bodies carry arbitrary links. A target=_blank must not
  // spawn a second BrowserWindow, and a plain click must not navigate the app
  // away from its own file. Both route https to the default browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith('file:')) return;
    e.preventDefault();
    if (url.startsWith('https://')) shell.openExternal(url);
  });

  win.on('close', () => {
    const b = win.getBounds();
    saveWindowBounds({ x: b.x, y: b.y, width: b.width, height: b.height });
  });

  win.on('closed', () => {
    if (rendererWatcher) { rendererWatcher.close(); rendererWatcher = null; }
  });

  if (isFirstRun()) {
    markInitialized();
    win.webContents.once('did-finish-load', () => {
      win.webContents.send('open-settings');
    });
  }

  if (!app.isPackaged) watchRenderer();
}

function watchRenderer() {
  const rendererDir = path.join(__dirname, '../../src/renderer');
  try {
    rendererWatcher = fs.watch(rendererDir, { recursive: true }, (eventType, filename) => {
      if (filename && win && !win.isDestroyed()) {
        win.reload();
      }
    });
  } catch {
    // watch not available
  }
}

function createMenu() {
  const devTools = app.isPackaged ? [] : [{ role: 'toggleDevTools' }];
  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Settings…',
          accelerator: 'CmdOrCtrl+,',
          click: () => win?.webContents.send('open-settings'),
        },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Rescan Repos',
          accelerator: 'CmdOrCtrl+R',
          click: () => win?.webContents.send('trigger-rescan'),
        },
        {
          label: 'Quick Capture',
          accelerator: 'CmdOrCtrl+N',
          click: () => win?.webContents.send('focus-inbox'),
        },
        { type: 'separator' },
        {
          label: 'Add an Idea',
          accelerator: 'CmdOrCtrl+I',
          click: () => win?.webContents.send('focus-idea'),
        },
        { type: 'separator' },
        {
          label: 'Dashboard',
          accelerator: 'CmdOrCtrl+1',
          click: () => win?.webContents.send('view:select', 'dashboard'),
        },
        {
          label: 'Ideas',
          accelerator: 'CmdOrCtrl+2',
          click: () => win?.webContents.send('view:select', 'ideas'),
        },
        {
          label: 'Issues',
          accelerator: 'CmdOrCtrl+3',
          click: () => win?.webContents.send('view:select', 'issues'),
        },
        {
          label: 'Lists',
          accelerator: 'CmdOrCtrl+4',
          click: () => win?.webContents.send('view:select', 'lists'),
        },
        {
          label: 'Timeline',
          accelerator: 'CmdOrCtrl+5',
          click: () => win?.webContents.send('view:select', 'timeline'),
        },
        {
          label: 'Summary',
          accelerator: 'CmdOrCtrl+6',
          click: () => win?.webContents.send('view:select', 'summary'),
        },
        { type: 'separator' },
        ...devTools,
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createTray() {
  const appIcon = getAppIcon();
  const icon = appIcon
    ? appIcon.resize({ width: 18, height: 18 })
    : nativeImage.createFromDataURL(
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
      );
  tray = new Tray(icon);
  tray.setToolTip(app.name);
  tray.on('click', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });
}

export function updateTrayBadge(count) {
  if (!tray) return;
  tray.setTitle(count > 0 ? String(count) : '');
}

/**
 * Launch prefs plus two facts the board paints from: whether a personal
 * folder is set (the toggle shows only then) and which stage skills the
 * selected CLI's folder holds (the launch buttons show only for those).
 * Built per call and never stored.
 */
function launchState() {
  const prefs = getLaunchPrefs();
  const dir = getPersonalClaudeDir();
  return { ...prefs, personal: Boolean(dir), launchable: launchableActions(claudeConfigDir(prefs.cli, dir)) };
}

function registerIPC() {
  ipcMain.handle('load-state', () => loadState());

  ipcMain.handle('save-state', (_e, data) => {
    // The same rule as a sync pull. autoSave toasts the error, so a refused
    // save is visible and nothing reaches the store, the badge or the sync server.
    const check = validateWorkspace(data);
    if (!check.ok) return { error: check.error };
    try {
      saveState(data);
      const stale = data.ws.flatMap(p => p.repos).filter(r => isStale(r)).length;
      updateTrayBadge(stale);
      debouncedPush(data);
      return { ok: true };
    } catch (err) {
      return { error: err.message };
    }
  });

  // A local write should reach the phone in seconds, not on the next tick.
  // Publishing is fire-and-forget: a failed publish is not a failed write, and
  // the next sync tick republishes anyway.
  const withPublish = (result) => {
    if (result?.ok) publishSoon();
    return result;
  };

  ipcMain.handle('ideas-load', () => ideasSnapshot());
  ipcMain.handle('ideas-sync-status', () => getIdeasSyncStatus());
  ipcMain.handle('ideas-add', (_e, payload) => withPublish(addIdea(payload)));
  ipcMain.handle('ideas-move', (_e, payload) => withPublish(moveIdea(payload)));
  ipcMain.handle('ideas-set', (_e, payload) => withPublish(setIdea(payload)));
  ipcMain.handle('launch-prefs-get', () => launchState());

  // Each key is checked against the same enum buildCommand checks, so a value
  // that lands in the store is by construction one the launcher accepts.
  ipcMain.handle('launch-prefs-set', (_e, partial) => {
    const next = { ...getLaunchPrefs() };
    for (const [key, val] of Object.entries(partial || {})) {
      if (key === 'cli' && CLI_KEYS.includes(val)) {
        if (val === 'personal' && !getPersonalClaudeDir()) return { ok: false, error: 'Set a personal Claude folder in Settings first' };
        next.cli = val;
      } else if (key === 'model' && MODELS.includes(val)) next.model = val;
      else if (key === 'effort' && EFFORTS.includes(val)) next.effort = val;
      else return { ok: false, error: `${key} cannot be "${val}"` };
    }
    setLaunchPrefs(next);
    return { ok: true, ...launchState() };
  });

  ipcMain.handle('board-prefs-get', () => getBoardPrefs());

  // One field, so no loop: a value that lands in the store is by construction
  // one the renderer's comparator knows. `|| {}` rather than a default
  // parameter, which an explicit null would walk straight past into a throw.
  ipcMain.handle('board-prefs-set', (_e, partial) => {
    const { sort } = partial || {};
    if (!SORT_MODES.includes(sort)) return { ok: false, error: `sort cannot be "${sort}"` };
    setBoardPrefs({ sort });
    return { ok: true, sort };
  });

  ipcMain.handle('scope-prefs-get', () => getScopePrefs());

  // Work ids must name projects in the current workspace, so a stale or forged
  // id never lands in the store. Either field may be sent alone.
  ipcMain.handle('scope-prefs-set', (_e, partial) => {
    const p = partial && typeof partial === 'object' ? partial : {};
    const next = getScopePrefs();
    if ('scope' in p) {
      if (!SCOPES.includes(p.scope)) return { ok: false, error: `scope cannot be "${p.scope}"` };
      next.scope = p.scope;
    }
    if ('work' in p) {
      const ids = new Set((loadState()?.ws || []).map((x) => x.id));
      if (!Array.isArray(p.work) || !p.work.every((id) => ids.has(id))) return { ok: false, error: 'work must list existing project ids' };
      next.work = [...new Set(p.work)];
    }
    setScopePrefs(next);
    return { ok: true, ...next };
  });

  // ── issues (read-only, via gh) ─────────────────────────────────────────

  ipcMain.handle('issues-prefs-get', () => getIssuesPrefs());

  ipcMain.handle('issues-prefs-set', (_e, partial) => {
    // Pick the four known fields rather than spreading the payload, so nothing
    // else the renderer sends ever reaches the store.
    const cur = getIssuesPrefs();
    const p = partial && typeof partial === 'object' ? partial : {};
    const next = {
      projectId: 'projectId' in p ? p.projectId : cur.projectId,
      kind: 'kind' in p ? p.kind : cur.kind,
      state: 'state' in p ? p.state : cur.state,
      sort: 'sort' in p ? p.sort : cur.sort,
    };
    if (typeof next.projectId !== 'string' || (next.projectId && !WORKSPACE_ID.test(next.projectId))) return { ok: false, error: 'bad project id' };
    if (!ISSUE_KINDS.includes(next.kind)) return { ok: false, error: `kind must be one of ${ISSUE_KINDS.join(', ')}` };
    if (!ISSUE_STATES.includes(next.state)) return { ok: false, error: `state must be one of ${ISSUE_STATES.join(', ')}` };
    if (!ISSUE_SORTS.includes(next.sort)) return { ok: false, error: `sort must be one of ${ISSUE_SORTS.join(', ')}` };
    setIssuesPrefs(next);
    return { ok: true };
  });

  ipcMain.handle('issues-load', async (_e, projectId) => {
    if (!WORKSPACE_ID.test(String(projectId))) return { cache: null, read: {} };
    const project = (loadState()?.ws || []).find((p) => p.id === projectId);
    if (!project) return { cache: null, read: {} };
    // The store refuses an unsafe name itself; the filter here only keeps a
    // remote-synced junk name from showing up as an error row.
    const names = project.repos.map((r) => r.name).filter(safeRepoName);
    return { cache: await projectSnapshot(names), read: getIssuesRead(projectId) };
  });

  ipcMain.handle('issues-counts', () => {
    return openCounts(allRepoNames());
  });

  ipcMain.handle('issues-fetch', async (_e, projectId) => {
    if (!WORKSPACE_ID.test(String(projectId))) return { ok: false, error: 'bad project id' };
    // Repo names come from the workspace state main holds, never from the
    // renderer, so the list handed to gh is the user's own config.
    const project = (loadState()?.ws || []).find((p) => p.id === projectId);
    if (!project) return { ok: false, error: 'unknown project' };
    const snap = await fetchProjectIssues(project.repos.map((r) => r.name), getGithubPath());
    return { cache: snap, read: getIssuesRead(projectId) };
  });

  ipcMain.handle('issues-mark-read', (_e, projectId, key, updatedAt) => {
    if (!WORKSPACE_ID.test(String(projectId)) || typeof key !== 'string' || typeof updatedAt !== 'string') return;
    markIssueRead(projectId, key, updatedAt);
  });

  // One payload for the Timeline and the Summary: commits from git, and
  // every row kind from a single read of the issue files, cut to the range.
  async function activityLoad(range) {
    const repos = allRepoNames();
    const cutoff = new Date(Date.now() - range * 86400000).toISOString();
    const [commits, rows] = await Promise.all([getCommitLog(repos, getGithubPath(), range), activityRows(repos)]);
    return {
      commits,
      sessions: rows.sessions.filter((r) => r.at >= cutoff),
      prs: rows.prs.filter((r) => [r.openedAt, r.closedAt, r.mergedAt].some((at) => at && at >= cutoff)),
      issues: rows.issues.filter((r) => (r.createdAt && r.createdAt >= cutoff) || (r.closedAt && r.closedAt >= cutoff) || r.state === 'open'),
    };
  }

  for (const channel of ['timeline-load', 'summary-load']) {
    ipcMain.handle(channel, (_e, days) => activityLoad(TIMELINE_RANGES.includes(days) ? days : DEFAULT_RANGE));
  }

  ipcMain.handle('open-external', (_e, url) => {
    if (typeof url !== 'string' || !url.startsWith('https://')) return false;
    shell.openExternal(url);
    return true;
  });

  ipcMain.handle('ideas-launch', async (_e, { action, id }) => {
    const { ideas } = ideasSnapshot();
    const idea = ideas.find(i => i.id === id);
    if (!idea) return { ok: false, error: `no idea ${id}` };
    const { repo, error } = resolveLaunchRepo(idea, loadState()?.ws);
    if (error) return { ok: false, error };
    const prefs = getLaunchPrefs();
    const res = await launchSession(action, idea.id, repo, getGithubPath(), {
      cli: prefs.cli,
      personalDir: getPersonalClaudeDir(),
      model: idea.model || prefs.model,
      effort: prefs.effort,
      worktree: worktreeName(idea.title, idea.id),
      name: sessionName(idea.title, idea.id),
    });
    if (res?.ok === false) return res;
    // Stamp the running rail: the stage the session was fired from, so it clears
    // the moment the session moves the card out of it. Local only.
    const marker = { action, stage: idea.stage, at: Date.now() };
    setIdeaLaunches({ ...getIdeaLaunches(), [id]: marker });
    return { ...res, marker };
  });

  // The launch markers, garbage-collected through the same launchActive predicate
  // the renderer paints with, so a marker for an idea that has advanced (or
  // returned to the stage on a later run) does not linger in the store.
  ipcMain.handle('ideas-launches-get', () => {
    const { ideas } = ideasSnapshot();
    const ideaById = new Map(ideas.map(i => [i.id, i]));
    const all = getIdeaLaunches();
    // Null-proto: the keys are idea ids from a store any local process can write,
    // and a literal `__proto__` key would otherwise retarget this object's prototype.
    const live = Object.create(null);
    for (const [id, m] of Object.entries(all)) {
      if (launchActive(ideaById.get(id), m)) live[id] = m;
    }
    if (Object.keys(live).length !== Object.keys(all).length) setIdeaLaunches(live);
    return live;
  });

  ipcMain.handle('ideas-launches-clear', (_e, ids) => {
    if (!Array.isArray(ids) || !ids.length) return getIdeaLaunches();
    const next = { ...getIdeaLaunches() };
    for (const id of ids) delete next[id];
    setIdeaLaunches(next);
    return next;
  });

  // Copy, not launch. Returns the command text plus the repo it belongs in,
  // because a bare slash command does not say which project the session you
  // paste it into has to be open on.
  ipcMain.handle('ideas-command', (_e, { action, id }) => {
    const { ideas } = ideasSnapshot();
    const idea = ideas.find(i => i.id === id);
    if (!idea) return { ok: false, error: `no idea ${id}` };
    const res = stageCommand(action, idea.id);
    if (!res.ok) return res;
    return { ...res, repo: resolveLaunchRepo(idea, loadState()?.ws).repo || null };
  });

  ipcMain.handle('list-repos', () => listRepoDirs(getGithubPath()));

  ipcMain.handle('scan-repos', async () => {
    const state = loadState();
    if (!state?.ws) return { results: {}, changedDeps: {}, isFirstScan: true };
    const allRepos = state.ws.flatMap(p => p.repos.map(r => r.name));
    const basePath = getGithubPath();
    const results = await scanAll(allRepos, basePath);

    await Promise.all(Object.entries(results).map(async ([name, data]) => {
      if (data.unmergedBranches?.length) data.prs = await prStates(name, basePath);
    }));

    // Seeded from what is stored: a repo that one scan could not read keeps
    // its remembered dates rather than restarting its clock next time.
    const memory = getAttentionSince();
    const nextMemory = { ...memory };
    for (const [name, data] of Object.entries(results)) {
      const merged = mergeSince(memory[name], data.since);
      data.since = { ...data.since, ...merged };
      if (merged.dirty || merged.unpushed) nextMemory[name] = merged;
      else delete nextMemory[name];
    }
    saveAttentionSince(nextMemory);

    const prevHashes = getPreviousHashes();
    const isFirstScan = Object.keys(prevHashes).length === 0;

    const changedDeps = {};
    if (!isFirstScan) {
      for (const [name, data] of Object.entries(results)) {
        if (data.hash && prevHashes[name] && prevHashes[name] !== data.hash) {
          changedDeps[name] = prevHashes[name];
        }
      }
    }

    const newHashes = {};
    for (const [name, data] of Object.entries(results)) {
      if (data.hash) newHashes[name] = data.hash;
    }
    savePreviousHashes(newHashes);

    return { results, changedDeps, isFirstScan };
  });

  ipcMain.handle('open-dashboard', () => {
    const { dashboardUrl } = getAppSettings();
    if (dashboardUrl.startsWith('https://')) shell.openExternal(dashboardUrl);
  });

  ipcMain.handle('analyze-statuses', async (_e, wsData) => {
    const apiKey = await getAIKey();
    if (!apiKey) return { error: 'No API key set' };
    try {
      // Model output is untrusted: only a known project and a pickable status
      // leave main. The stored workspace decides which ids are known.
      return filterStatusSuggestions(await analyzeStatuses(wsData, apiKey), loadState()?.ws);
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('decompose-task', async (_e, taskText, projectContext) => {
    const apiKey = await getAIKey();
    if (!apiKey) return { error: 'No API key set' };
    try {
      await decomposeTask(taskText, projectContext, apiKey, win);
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('weekly-digest', async (_e, wsData) => {
    const apiKey = await getAIKey();
    if (!apiKey) return { error: 'No API key set' };
    try {
      const state = loadState();
      const allRepos = state?.ws?.flatMap(p => p.repos.map(r => r.name)) || [];
      const weeklyLog = await getWeeklyLog(allRepos, getGithubPath());
      await getWeeklyDigest(wsData, weeklyLog, apiKey, win);
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('has-ai-key', async () => {
    const key = await getAIKey();
    return !!key;
  });

  ipcMain.handle('set-ai-key', (_e, key) => setAIKey(key));

  ipcMain.handle('suggest-commit-message', async (_e, repoName) => {
    const apiKey = await getAIKey();
    if (!apiKey) return { error: 'No API key set' };
    try {
      await suggestCommitMessage(repoName, getGithubPath(), apiKey, win);
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('daily-briefing', async (_e, wsData) => {
    const apiKey = await getAIKey();
    if (!apiKey) return { error: 'No API key set' };
    try {
      await getDailyBriefing(wsData, apiKey, win);
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('suggest-focus-line', async (_e, projectId, wsData) => {
    const apiKey = await getAIKey();
    if (!apiKey) return { error: 'No API key set' };
    try {
      await suggestFocusLine(projectId, wsData, apiKey, win);
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('sync-now', async () => {
    await pullState(win);
    return getSyncStatus();
  });

  ipcMain.handle('get-sync-status', () => getSyncStatus());

  ipcMain.handle('app-settings-get', () => getAppSettings());
  // Read-only. Shown in Settings so a store split between app and CLI is
  // visible: `ideas home` must print the same folder.
  ipcMain.handle('store-dir', () => storeDir());

  // Validated here, never in the renderer. A cleared personal folder also
  // drops the CLI back to work in the same save, so a stored `personal` can
  // never launch under the default account. A new repo folder restarts the
  // issue loop, which captured the old path when it started.
  ipcMain.handle('app-settings-set', (_e, partial) => {
    const before = getAppSettings();
    const isDir = (raw) => { try { return fs.statSync(expandHome(raw)).isDirectory(); } catch { return false; } };
    const res = applySettings(before, partial, isDir);
    if (!res.ok) return res;
    setAppSettings(res.next);
    if (!res.next.personalClaudeDir && getLaunchPrefs().cli === 'personal') setLaunchPrefs({ ...getLaunchPrefs(), cli: 'work' });
    if (res.next.githubPath !== before.githubPath) startIssuesSync(() => win, allRepoNames, getGithubPath());
    return { ok: true, ...res.next };
  });

  ipcMain.handle('get-sync-config', async () => {
    const { url } = getSyncConfig();
    const token = await getSyncToken();
    const publishToken = await getPublishToken();
    return { url, token: token ? TOKEN_MASK : '', publishToken: publishToken ? TOKEN_MASK : '' };
  });

  ipcMain.handle('set-sync-config', async (_e, url, token, publishToken) => {
    const trimmedUrl = (url || '').trim();
    if (trimmedUrl && !trimmedUrl.startsWith('https://') && !trimmedUrl.startsWith('http://')) {
      return { error: 'URL must start with https://' };
    }
    setSyncUrl(trimmedUrl);
    // A field still equal to the mask (or absent) means the user did not touch
    // it — leave the stored token as-is rather than overwriting it with the
    // bullet string or clearing it. A blank field still clears the credential.
    if (token !== undefined && token !== TOKEN_MASK) await setSyncToken(token || null);
    if (publishToken !== undefined && publishToken !== TOKEN_MASK) await setPublishToken(publishToken || null);
    stopSync();
    stopIdeasSync();
    // Read the stored tokens back (after the mask-aware writes) so an unchanged
    // masked field still counts as "configured". Workspace sync needs the
    // shared token; ideas sync starts on either.
    const shared = await getSyncToken();
    const publish = await getPublishToken();
    if (trimmedUrl && shared) startSync(win);
    if (trimmedUrl && (shared || publish)) beginIdeasSync(() => win);
    return { ok: true };
  });
}

// Only one copy. Without this, `npm run dev` or a second launch from
// /Applications starts another full instance: several windows over the same
// electron-store, and several writers contending for the ideas store lock.
// A second launch focuses the window that already exists instead.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win || win.isDestroyed()) return createWindow();
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
}

app.whenReady().then(() => {
  try {
    initStore();
  } catch (err) {
    const storePath = configPath();
    try { fs.renameSync(storePath, storePath + '.bak.' + Date.now()); } catch {}
    initStore();
  }
  createMenu();
  createTray();
  registerIPC();
  // Register the watcher BEFORE the window exists, so a store write that lands
  // between startup and the renderer's initial load is not missed. The getter
  // closure keeps it app-scoped across macOS window recreation.
  startIdeasWatch(() => win);
  createWindow();
  startSync(win);
  beginIdeasSync(() => win);
  startIssuesSync(() => win, allRepoNames, getGithubPath());

  const dockIcon = getAppIcon();
  if (dockIcon && app.dock) app.dock.setIcon(dockIcon);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
