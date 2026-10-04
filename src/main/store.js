import Store from 'electron-store';
import { expandHome } from './app-settings.js';
// One definition of the board's default sort, shared with the renderer's
// comparator. Vite bundles it into dist/main, same as scripts/ideas-store.mjs.
import { DEFAULT_SORT } from '../renderer/idea-sort.js';
import { DEFAULT_ISSUE_PREFS } from '../renderer/issue-model.js';
import { DEFAULT_SCOPE, DEFAULT_WORK } from '../renderer/scope-model.js';
import { storeDir, CONFIG_NAME } from '../../scripts/store-dir.mjs';

// A fresh install starts empty. Existing configs keep their own workspace, since conf fills only missing keys.
export const DEFAULT_WS = [];
export const DEFAULT_LISTS = [];

let store;

export function initStore() {
  store = new Store({
    name: CONFIG_NAME,
    cwd: storeDir(),
    defaults: {
      workspace: { ws: DEFAULT_WS, lists: DEFAULT_LISTS, today: [], doneToday: [], inbox: [], todayDate: '' },
      windowBounds: { width: 1400, height: 900 },
      githubPath: '~/github',
      previousHashes: {},
      staleBaselines: {},
      launchPrefs: { cli: 'work', model: 'fable', effort: 'medium' },
      boardPrefs: { sort: DEFAULT_SORT },
      scopePrefs: { scope: DEFAULT_SCOPE, work: DEFAULT_WORK },
      issuesPrefs: DEFAULT_ISSUE_PREFS,
      issuesRead: {},
      attentionSince: {},
    },
  });
  store.delete('issuesCache');
  return store;
}

export function loadState() {
  return store.get('workspace');
}

export function saveState(data) {
  store.set('workspace', data);
}

export function getWindowBounds() {
  return store.get('windowBounds');
}

export function saveWindowBounds(bounds) {
  store.set('windowBounds', bounds);
}

/** Settings as stored, ~ unexpanded. Absent keys fall back without writing. */
export function getAppSettings() {
  return {
    githubPath: store.get('githubPath', '~/github'),
    personalClaudeDir: store.get('personalClaudeDir', ''),
    dashboardUrl: store.get('dashboardUrl', ''),
  };
}

export function setAppSettings(next) {
  store.set(next);
}

export function getGithubPath() {
  return expandHome(getAppSettings().githubPath);
}

/** The personal CLI's config folder, expanded, or '' when none is set. */
export function getPersonalClaudeDir() {
  const dir = getAppSettings().personalClaudeDir;
  return dir ? expandHome(dir) : '';
}

export function getPreviousHashes() {
  return store.get('previousHashes', {});
}

export function savePreviousHashes(hashes) {
  store.set('previousHashes', hashes);
}

export function getStaleBaselines() {
  return store.get('staleBaselines', {});
}

export function saveStaleBaselines(baselines) {
  store.set('staleBaselines', baselines);
}

/** How the Ideas board orders cards inside a column. Validated in the IPC handler, not here. */
export function getBoardPrefs() {
  return { sort: DEFAULT_SORT, ...store.get('boardPrefs', {}) };
}

export function setBoardPrefs(prefs) {
  store.set('boardPrefs', prefs);
}

/** Which projects the Dashboard, Timeline, and Summary show. Validated in the IPC handler, not here. */
export function getScopePrefs() {
  return { scope: DEFAULT_SCOPE, work: DEFAULT_WORK, ...store.get('scopePrefs', {}) };
}

export function setScopePrefs(prefs) {
  store.set('scopePrefs', prefs);
}

export function getIssuesPrefs() {
  return { ...DEFAULT_ISSUE_PREFS, ...store.get('issuesPrefs', {}) };
}

export function setIssuesPrefs(prefs) {
  store.set('issuesPrefs', prefs);
}

export function getIssuesRead(projectId) {
  return store.get('issuesRead', {})[projectId] || {};
}

export function markIssueRead(projectId, key, updatedAt) {
  const all = store.get('issuesRead', {});
  store.set('issuesRead', { ...all, [projectId]: { ...(all[projectId] || {}), [key]: updatedAt } });
}

export function getAttentionSince() {
  return store.get('attentionSince', {});
}

export function saveAttentionSince(map) {
  store.set('attentionSince', map);
}

/** Which CLI, model, and reasoning level a stage launch uses. Validated in the IPC handler, not here. */
export function getLaunchPrefs() {
  return { cli: 'work', model: 'fable', effort: 'medium', ...store.get('launchPrefs', {}) };
}

export function setLaunchPrefs(prefs) {
  store.set('launchPrefs', prefs);
}

/**
 * Sessions launched from the Ideas board, id -> { action, stage, at }. Local
 * only: a running session is a Mac-side fact, kept out of ideas.json and the sync server
 * sync. The shape is trusted from one caller (the launch IPC), so it is stored
 * as given and validated where it is read.
 */
export function getIdeaLaunches() {
  return store.get('ideaLaunches', {});
}

export function setIdeaLaunches(map) {
  store.set('ideaLaunches', map || {});
}

export function getSyncConfig() {
  return {
    url: store.get('syncUrl', ''),
  };
}

export function setSyncUrl(url) {
  store.set('syncUrl', url);
}

export function getSyncVersion() {
  return store.get('syncVersion', 0);
}

export function setSyncVersion(v) {
  store.set('syncVersion', v);
}

export function isFirstRun() {
  return !store.has('_initialized');
}

export function markInitialized() {
  store.set('_initialized', true);
}
