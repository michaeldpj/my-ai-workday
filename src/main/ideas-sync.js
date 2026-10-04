/**
 * Ideas sync wiring for the desktop.
 *
 * All the logic is in scripts/ideas-sync.mjs, shared with the CLI. This file
 * exists only to supply the two things the shared module refuses to look up
 * for itself: the server URL from the app's config and the token from the
 * keychain. It reuses the same URL and token as workspace sync, so there is
 * one server to configure rather than two.
 */

import { getSyncConfig } from './store.js';
import { getSyncToken, getPublishToken } from './keys.js';
import { snapshot } from './ideas.js';
import { publish, drain } from '../../scripts/ideas-sync.mjs';

const INTERVAL_MS = 30_000;
const PUBLISH_DEBOUNCE_MS = 2000;

let timer = null;
let publishDebounce = null;
let inFlight = false;

/**
 * What the board shows about phone sync.
 *
 * This exists because silence was the expensive failure: the workspace sync
 * beside this one stopped reaching the server in April and nothing anywhere
 * said so for four months. A packaged Electron main process logs to nobody, so
 * a condition the user has to act on must reach the UI or it does not exist.
 */
let status = { state: 'idle', reason: null, at: null, pendingCaptures: 0 };
let onChange = null;

function setStatus(next) {
  status = { ...status, ...next, at: Date.now() };
  onChange?.(status);
}

/**
 * Resolve the server and credential, and say so once when they are missing.
 *
 * Silence here is expensive. A sync that returns early because the keychain
 * holds no token looks exactly like a sync that is working and has nothing to
 * send, which is how a broken sync survives for months without anyone
 * noticing. Warned once rather than every tick.
 */
async function config() {
  const { url } = getSyncConfig();
  // The publish token wins; the shared token is the fallback so an install that
  // has not set a publish token yet, against a server that also has none, keeps
  // working. Once the server requires the publish token, the shared-token
  // fallback 401s and surfaces below as an auth-specific status.
  const token = url ? (await getPublishToken()) || (await getSyncToken()) : '';
  if (!url || !token) {
    setStatus({ state: 'unconfigured', reason: !url ? 'no server URL' : 'no token' });
    return null;
  }
  return { url, token };
}

/**
 * Drain then publish, guarded against overlap.
 *
 * The guard matters more than it looks: a slow or wedged network can outlast
 * the 30s interval, and two concurrent drains would both fetch the same
 * captures. They would still deduplicate on `sourceCaptureId`, so the guard is
 * about not queueing writes behind each other rather than about correctness.
 */
async function tick(getWindow) {
  if (inFlight) return;
  const cfg = await config();
  if (!cfg) return;
  inFlight = true;
  try {
    const drained = await drain(cfg);
    const published = await publish(cfg);
    setStatus(published.ok
      ? { state: 'ok', reason: null, pendingCaptures: published.pendingCaptures ?? 0 }
      : { state: 'unreachable', reason: /HTTP 401/.test(published.error || '')
          ? 'auth rejected — check the Ideas Publish Token in Settings'
          : published.error });
    if (drained.rejected?.length) {
      console.error('ideas drain rejected captures:', drained.rejected);
    }
    // A drained capture is a new card. The store watcher fires on the write
    // too, so this is belt and braces for the case where the watcher is
    // between restarts.
    if (drained.written > 0) {
      const win = getWindow?.();
      if (win && !win.isDestroyed()) {
        try { win.webContents.send('ideas:changed', snapshot()); } catch { /* torn down */ }
      }
    }
  } catch (e) {
    // Without this the rejection is unhandled and the failure is invisible:
    // the tick just stops producing, which looks exactly like a working sync
    // that has nothing to send.
    setStatus({ state: 'error', reason: e?.message || String(e) });
  } finally {
    inFlight = false;
  }
}

export function startIdeasSync(getWindow, notify) {
  onChange = notify || null;
  if (timer) return;
  timer = setInterval(() => tick(getWindow), INTERVAL_MS);
  timer.unref?.();
  tick(getWindow);
}

export function getIdeasSyncStatus() {
  return status;
}

export function stopIdeasSync() {
  if (timer) { clearInterval(timer); timer = null; }
  if (publishDebounce) { clearTimeout(publishDebounce); publishDebounce = null; }
}

/** Publish soon after a local change, so the phone is not 30 seconds stale. */
export function publishSoon() {
  if (publishDebounce) clearTimeout(publishDebounce);
  publishDebounce = setTimeout(async () => {
    const cfg = await config();
    if (cfg) await publish(cfg);
  }, PUBLISH_DEBOUNCE_MS);
  publishDebounce.unref?.();
}
