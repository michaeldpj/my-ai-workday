import { loadState, saveState, getSyncConfig, getSyncVersion, setSyncVersion } from './store.js';
import { getSyncToken, setSyncToken } from './keys.js';
import { validateWorkspace } from '../renderer/workspace-model.js';

let syncTimer = null;
let lastSyncAt = null;
let syncStatus = 'disconnected';
let syncReason = null;
let pushDebounce = null;

export function startSync(win) {
  const { url } = getSyncConfig();
  if (!url) return;
  if (win && !win.isDestroyed()) {
    win.webContents.once('did-finish-load', () => pullState(win));
  }
  syncTimer = setInterval(() => pullState(win), 30_000);
}

export function stopSync() {
  if (syncTimer) { clearInterval(syncTimer); syncTimer = null; }
  if (pushDebounce) { clearTimeout(pushDebounce); pushDebounce = null; }
}

async function headers() {
  const token = await getSyncToken();
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

function apiUrl(path) {
  const { url } = getSyncConfig();
  if (!url) return null;
  return url.replace(/\/$/, '') + path;
}

/**
 * What one pull does with the server's answer. A workspace that fails the
 * validator is refused whole: nothing is saved, the version stays where it
 * was, and the reason travels to the sync dot. Pure, so it tests without a
 * store or a network.
 */
const refuse = (reason) => ({ adopt: null, version: null, status: 'rejected', reason });

export function pullDecision(data) {
  if (!data?.changed) return { adopt: null, version: null, status: 'connected', reason: null };
  if (!data.workspace) return refuse('a changed answer carried no workspace');
  if (!Number.isSafeInteger(data.version) || data.version < 0) {
    return refuse(`version must be a whole number, got ${String(JSON.stringify(data.version)).slice(0, 60)}`);
  }
  const check = validateWorkspace(data.workspace);
  if (!check.ok) return refuse(check.error);
  return { adopt: data.workspace, version: data.version, status: 'connected', reason: null };
}

export async function pullState(win) {
  const endpoint = apiUrl('/api/state');
  if (!endpoint) return;
  try {
    const localVersion = getSyncVersion();
    const qs = localVersion > 0 ? `?since=${localVersion}` : '';
    const hdrs = await headers();
    const res = await fetch(endpoint + qs, { headers: hdrs, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const decision = pullDecision(data);
    if (decision.adopt) {
      saveState(decision.adopt);
      setSyncVersion(decision.version);
      if (win && !win.isDestroyed()) {
        win.webContents.send('state-updated-remotely');
      }
    }
    syncStatus = decision.status;
    syncReason = decision.reason;
    if (decision.status === 'connected') lastSyncAt = Date.now();
    else console.warn('[sync] refused the pulled workspace: ' + decision.reason);
  } catch {
    syncStatus = 'disconnected';
  }
}

export function debouncedPush(workspace) {
  if (pushDebounce) clearTimeout(pushDebounce);
  pushDebounce = setTimeout(() => pushState(workspace), 2000);
}

async function pushState(workspace) {
  const endpoint = apiUrl('/api/state');
  if (!endpoint) return;
  try {
    const version = getSyncVersion();
    const hdrs = await headers();
    const res = await fetch(endpoint, {
      method: 'PUT',
      headers: hdrs,
      body: JSON.stringify({ version, workspace }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 409) {
      syncStatus = 'conflict';
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    setSyncVersion(data.version);
    syncStatus = 'connected';
    syncReason = null;
    lastSyncAt = Date.now();
  } catch {
    syncStatus = 'disconnected';
  }
}

export function getSyncStatus() {
  return { status: syncStatus, lastSyncAt, reason: syncReason };
}
