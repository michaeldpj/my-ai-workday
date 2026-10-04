const { contextBridge, ipcRenderer } = require('electron');

function streamListener(channel) {
  return (cb) => {
    const handler = (_e, chunk) => cb(chunk);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  };
}

function eventListener(channel) {
  return (cb) => {
    const handler = () => cb();
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  };
}

contextBridge.exposeInMainWorld('electronAPI', {
  scanRepos: () => ipcRenderer.invoke('scan-repos'),
  listRepos: () => ipcRenderer.invoke('list-repos'),
  loadState: () => ipcRenderer.invoke('load-state'),
  saveState: (data) => ipcRenderer.invoke('save-state', data),
  hasAIKey: () => ipcRenderer.invoke('has-ai-key'),
  setAIKey: (key) => ipcRenderer.invoke('set-ai-key', key),

  suggestCommitMessage: (repoName) => ipcRenderer.invoke('suggest-commit-message', repoName),
  onSuggestCommitChunk: streamListener('suggest-commit-message:chunk'),

  getDailyBriefing: (wsData) => ipcRenderer.invoke('daily-briefing', wsData),
  onDailyBriefingChunk: streamListener('daily-briefing:chunk'),

  suggestFocusLine: (projectId, wsData) => ipcRenderer.invoke('suggest-focus-line', projectId, wsData),
  onSuggestFocusChunk: streamListener('suggest-focus-line:chunk'),

  analyzeStatuses: (wsData) => ipcRenderer.invoke('analyze-statuses', wsData),

  decomposeTask: (text, ctx) => ipcRenderer.invoke('decompose-task', text, ctx),
  onDecomposeChunk: streamListener('decompose-task:chunk'),

  getWeeklyDigest: (wsData) => ipcRenderer.invoke('weekly-digest', wsData),
  onWeeklyDigestChunk: streamListener('weekly-digest:chunk'),

  ideasLoad: () => ipcRenderer.invoke('ideas-load'),
  ideasAdd: (payload) => ipcRenderer.invoke('ideas-add', payload),
  ideasMove: (payload) => ipcRenderer.invoke('ideas-move', payload),
  ideasSet: (payload) => ipcRenderer.invoke('ideas-set', payload),
  ideasLaunch: (payload) => ipcRenderer.invoke('ideas-launch', payload),
  ideaLaunchesGet: () => ipcRenderer.invoke('ideas-launches-get'),
  ideaLaunchesClear: (ids) => ipcRenderer.invoke('ideas-launches-clear', ids),
  ideasCommand: (payload) => ipcRenderer.invoke('ideas-command', payload),
  launchPrefsGet: () => ipcRenderer.invoke('launch-prefs-get'),
  launchPrefsSet: (partial) => ipcRenderer.invoke('launch-prefs-set', partial),
  boardPrefsGet: () => ipcRenderer.invoke('board-prefs-get'),
  boardPrefsSet: (partial) => ipcRenderer.invoke('board-prefs-set', partial),
  scopePrefsGet: () => ipcRenderer.invoke('scope-prefs-get'),
  scopePrefsSet: (partial) => ipcRenderer.invoke('scope-prefs-set', partial),
  issuesPrefsGet: () => ipcRenderer.invoke('issues-prefs-get'),
  issuesPrefsSet: (partial) => ipcRenderer.invoke('issues-prefs-set', partial),
  issuesLoad: (projectId) => ipcRenderer.invoke('issues-load', projectId),
  issuesCounts: () => ipcRenderer.invoke('issues-counts'),
  issuesFetch: (projectId) => ipcRenderer.invoke('issues-fetch', projectId),
  issuesMarkRead: (projectId, key, updatedAt) => ipcRenderer.invoke('issues-mark-read', projectId, key, updatedAt),
  onIssuesChanged: streamListener('issues:changed'),
  timelineLoad: (days) => ipcRenderer.invoke('timeline-load', days),
  summaryLoad: (days) => ipcRenderer.invoke('summary-load', days),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  ideasSyncStatus: () => ipcRenderer.invoke('ideas-sync-status'),
  // streamListener, not eventListener: this push carries {rev, ideas}, and
  // eventListener drops event data.
  onIdeasChanged: streamListener('ideas:changed'),
  onIdeasSync: streamListener('ideas:sync'),
  onViewSelect: streamListener('view:select'),
  onFocusIdea: eventListener('focus-idea'),

  openDashboard: () => ipcRenderer.invoke('open-dashboard'),
  appSettingsGet: () => ipcRenderer.invoke('app-settings-get'),
  appSettingsSet: (partial) => ipcRenderer.invoke('app-settings-set', partial),
  storeDir: () => ipcRenderer.invoke('store-dir'),

  syncNow: () => ipcRenderer.invoke('sync-now'),
  getSyncStatus: () => ipcRenderer.invoke('get-sync-status'),
  getSyncConfig: () => ipcRenderer.invoke('get-sync-config'),
  setSyncConfig: (url, token, publishToken) => ipcRenderer.invoke('set-sync-config', url, token, publishToken),

  onOpenSettings: eventListener('open-settings'),
  onTriggerRescan: eventListener('trigger-rescan'),
  onFocusInbox: eventListener('focus-inbox'),
  onStateUpdatedRemotely: eventListener('state-updated-remotely'),
});
