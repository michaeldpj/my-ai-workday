/**
 * Ideas: the app's client onto ideas.json in the store folder.
 *
 * The app is a writer like any command and gets no shortcut. Every mutation
 * goes through scripts/ideas-store.mjs so the lock, the revision check, the
 * state machine, and the earned-stage gates have exactly one implementation.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  transact, read, findIdea, applyTransition, newIdea,
  waitingOn, nextAction, ROOT, STORE,
} from '../../scripts/ideas-store.mjs';
import { checkField, buildCaptureFields } from '../../scripts/idea-fields.mjs';

const WATCH_DEBOUNCE_MS = 150;

/**
 * What the RENDERER may write lives in scripts/idea-fields.mjs, shared with the
 * CLI drain and the Electron drain so the three surfaces cannot drift. The
 * allowlist is deliberately narrower than the CLI's: see that file for why.
 */

function decorate(idea) {
  return { ...idea, waitingOn: waitingOn(idea), nextAction: nextAction(idea) };
}

/** The one shape every ideas IPC call resolves to. */
export function snapshot() {
  const doc = read();
  return { rev: doc.rev || 0, ideas: doc.ideas.map(decorate) };
}

/**
 * Capture from the app. Same allowlist and same validation as an edit, so the
 * board cannot create an idea carrying fields it could not otherwise write.
 */
export function addIdea(fields = {}) {
  try {
    const idea = newIdea(buildCaptureFields(fields));
    transact((doc) => {
      doc.ideas.push(idea);
      return `${idea.id}: captured`;
    });
    return { ok: true, id: idea.id, ...snapshot() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export function moveIdea({ id, to, note }) {
  try {
    transact((doc) => {
      const idea = findIdea(doc, id);
      applyTransition(doc, idea, to, { note: note || null });
      return `${idea.id}: ${to}`;
    });
    return { ok: true, ...snapshot() };
  } catch (e) {
    // The store's refusal is the UI error, verbatim. It already names the
    // current stage and the command that would advance it.
    return { ok: false, error: e.message };
  }
}

export function setIdea({ id, fields }) {
  try {
    transact((doc) => {
      const idea = findIdea(doc, id);
      const applied = [];
      for (const [key, raw] of Object.entries(fields || {})) {
        idea[key] = checkField(key, raw);
        applied.push(key);
      }
      if (applied.length === 0) return null;
      idea.updatedAt = new Date().toISOString();
      return `${idea.id}: set ${applied.join(', ')}`;
    });
    return { ok: true, ...snapshot() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Watch for changes made by CLI sessions running elsewhere.
 *
 * Watches the DIRECTORY, not the file: the store writes through rename, which
 * fires `rename` rather than `change`, and a file watcher can lose its target.
 *
 * App-scoped, not window-scoped. On macOS the app outlives its last window and
 * builds a new one on activate, so the watcher is registered once and every
 * send is guarded against a destroyed webContents.
 */
let watcher = null;
let debounce = null;

export function startWatching(getWindow) {
  if (watcher) return;
  // The store directory may not exist yet on a fresh machine. Retry rather
  // than logging once and leaving the app permanently blind to CLI writes.
  if (!fs.existsSync(ROOT)) {
    setTimeout(() => startWatching(getWindow), 10000).unref?.();
    return;
  }
  try {
    watcher = fs.watch(ROOT, (_event, filename) => {
      if (filename && filename !== path.basename(STORE)) return;
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        const win = getWindow();
        if (!win || win.isDestroyed()) return;
        try {
          win.webContents.send('ideas:changed', snapshot());
        } catch {
          // window torn down between the guard and the send
        }
      }, WATCH_DEBOUNCE_MS);
    });
    // A watcher can die if the directory is replaced. Re-establish rather
    // than silently stopping.
    watcher.on('error', (err) => {
      console.error('ideas watcher error, restarting:', err.message);
      stopWatching();
      setTimeout(() => startWatching(getWindow), 5000).unref?.();
    });
  } catch (e) {
    console.error('ideas watcher failed to start, retrying:', e.message);
    watcher = null;
    setTimeout(() => startWatching(getWindow), 10000).unref?.();
  }
}

export function stopWatching() {
  clearTimeout(debounce);
  try { watcher?.close(); } catch { /* already closed */ }
  watcher = null;
}

export function storeExists() {
  return fs.existsSync(STORE);
}

export { ROOT as ideasRoot };
