#!/usr/bin/env node
/**
 * ideas-store: the only writer of ideas.json in the store folder (see store-dir.mjs).
 *
 * Implements the locked read-check-write-commit protocol from decision 9 of
 * docs/plans/2026-08-21-idea-pipeline.md. Every /idea-* skill shells out to
 * this; the Electron main process requires it directly in phase 2. Nothing
 * else touches the file.
 *
 * Zero dependencies. Node >= 18.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { storeDir } from './store-dir.mjs';

const ROOT = storeDir();
const STORE = path.join(ROOT, 'ideas.json');
const LOCK = path.join(ROOT, '.lock');

const LOCK_TIMEOUT_MS = 5000;
const REVIEW_CAP = 10;

export const STAGES = [
  'inbox', 'shaped', 'planned', 'reviewed',
  'queued', 'building', 'built', 'shipped', 'killed',
];

/**
 * Legal transitions. `by` is who may make the move: 'you' means a human
 * decision the pipeline never makes on its own, 'command' means a stage
 * earned by an artifact. Anything absent here is illegal by construction.
 */
const TRANSITIONS = {
  inbox: { shaped: 'command', killed: 'you' },
  shaped: { planned: 'command', queued: 'you', killed: 'you' },
  planned: { reviewed: 'command', shaped: 'you', killed: 'you' },
  reviewed: { queued: 'you', shaped: 'you', killed: 'you' },
  queued: { building: 'command', killed: 'you' },
  building: { built: 'command', queued: 'you' },
  built: { shipped: 'you', killed: 'you' },
  shipped: {},
  killed: { inbox: 'you' },
};

/**
 * A command-earned stage requires the artifact that earns it to exist. Without
 * this, `ideas move x --to=shaped` succeeds with no brief and the central
 * claim of the pipeline — that a forward stage means work was actually done —
 * is decoration. The `by` field alone records intent after the fact; it
 * enforces nothing.
 */
const REQUIRES_ARTIFACT = {
  shaped: { field: 'brief', earns: 'a brief', via: '/idea-brainstorm' },
  planned: { field: 'planPath', earns: 'a plan file', via: '/idea-plan' },
  reviewed: { field: 'reviewVerdict', earns: 'a review verdict', via: '/idea-review' },
  built: { field: 'github', earns: 'an issue', via: '/idea-execute' },
};

/** Transitions that must carry a reason, because they undo or end work. */
const NOTE_REQUIRED = new Set([
  'planned>shaped', 'reviewed>shaped', 'building>queued', 'killed>inbox',
]);

// ---------------------------------------------------------------- utilities

const now = () => new Date().toISOString();

export function mintId(prefix) {
  const rand = Math.random().toString(36).slice(2, 6);
  return `${prefix}-${Date.now().toString(36)}-${rand}`;
}

class StoreError extends Error {}
const fail = (msg) => { throw new StoreError(msg); };

function git(args, { quiet = false } = {}) {
  return execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: quiet ? ['ignore', 'pipe', 'ignore'] : ['ignore', 'pipe', 'pipe'],
  });
}

// -------------------------------------------------------------------- lock

function lockIsStale() {
  let pid;
  try {
    pid = parseInt(fs.readFileSync(LOCK, 'utf8').trim(), 10);
  } catch {
    return false; // vanished between check and read; treat as contended
  }
  if (!Number.isInteger(pid)) return true;
  try {
    process.kill(pid, 0);
    return false; // owner alive
  } catch (e) {
    return e.code === 'ESRCH'; // owner gone
  }
}

function acquireLock() {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  let waited = 0;
  for (;;) {
    try {
      const fd = fs.openSync(LOCK, 'wx');
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      // Read back. Two processes can both judge the same lock stale, and the
      // second's unlink can delete the first's freshly-created lock. Whoever
      // does not see their own pid lost the race and must start over.
      if (fs.readFileSync(LOCK, 'utf8').trim() !== String(process.pid)) continue;
      return;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      if (lockIsStale()) {
        try { fs.unlinkSync(LOCK); } catch { /* raced; loop again */ }
        continue;
      }
      if (Date.now() > deadline) {
        fail(`store is locked by another session (waited ${waited}ms). Retry, or remove ${LOCK} if you are certain nothing is running.`);
      }
      const backoff = Math.min(200, 20 + waited / 4);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, backoff);
      waited += backoff;
    }
  }
}

function releaseLock() {
  try { fs.unlinkSync(LOCK); } catch { /* already gone */ }
}

// ------------------------------------------------------------------- state

function readRaw() {
  if (!fs.existsSync(STORE)) return { rev: 0, ideas: [] };
  const doc = JSON.parse(fs.readFileSync(STORE, 'utf8'));
  if (!Array.isArray(doc.ideas)) fail(`${STORE} is malformed: no ideas array`);
  return doc;
}

function writeRaw(doc) {
  const tmp = `${STORE}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, JSON.stringify(doc, null, 2) + '\n');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, STORE);
}

/** Local commit only. Fast, and safe to hold the lock across. */
function commitLocal(subject) {
  // A fresh machine has no repo here until `ideas init`. Running git anyway
  // would fail, or worse, commit into a repo that encloses the home folder.
  if (!fs.existsSync(path.join(ROOT, '.git'))) return { committed: false };
  try {
    // Explicitly only the store. The store folder is ALSO the desktop app's
    // live electron-store directory (src/main/store.js), so `add -A` would
    // sweep every task toggle into an idea commit.
    git(['add', 'ideas.json', '.gitignore']);
    git(['commit', '-m', subject]);
    return { committed: true };
  } catch (e) {
    return { committed: false, warning: `commit failed: ${String(e.stderr || e.message).trim()}` };
  }
}

/**
 * Push. Runs AFTER the lock is released: it is network work, and holding a
 * filesystem lock across it means every other session waits on GitHub.
 */
function pushRemote() {
  // No upstream is a legitimate state (store not yet pushed anywhere). Stay
  // silent rather than crying wolf on every single write.
  let ahead = 0;
  try {
    ahead = parseInt(git(['rev-list', '--count', '@{u}..HEAD'], { quiet: true }).trim(), 10) || 0;
  } catch {
    return { pushed: false, warning: null, noRemote: true };
  }
  try {
    git(['push', '--quiet']);
  } catch {
    try {
      git(['pull', '--rebase', '--quiet']);
      git(['push', '--quiet']);
    } catch (e2) {
      return {
        pushed: false,
        warning: `push failed and rebase did not resolve it; ${ahead || 1} commit(s) held locally. Left your history alone: ${String(e2.stderr || e2.message).trim().split('\n')[0]}`,
      };
    }
  }
  const carried = ahead > 1 ? `pushed ${ahead} commits, including ${ahead - 1} held from earlier failures` : null;
  return { pushed: true, warning: carried };
}

/**
 * The protocol. Acquire, re-read INSIDE the lock, apply, write, commit, push,
 * release. `mutate` receives the freshly-read doc and returns a commit
 * subject, or null to abort without writing.
 */
export function transact(mutate) {
  if (!fs.existsSync(ROOT)) fail(`${ROOT} does not exist. Run: ideas-store init`);
  let committed = { committed: false };
  let rev = 0;
  acquireLock();
  try {
    const doc = readRaw();
    const subject = mutate(doc);
    if (subject === null) return { changed: false };
    doc.rev = (doc.rev || 0) + 1;
    writeRaw(doc);
    committed = commitLocal(subject);
    rev = doc.rev;
  } finally {
    releaseLock();
  }
  // Network work happens with the lock released, so a slow push never makes
  // another session time out waiting on GitHub.
  const push = committed.committed ? pushRemote() : { pushed: false };
  return { changed: true, rev, ...committed, ...push };
}

export function read() {
  return readRaw();
}

// -------------------------------------------------------------- operations

function findIdea(doc, id) {
  const matches = doc.ideas.filter((i) => i.id === id || i.id.endsWith(`-${id}`));
  if (matches.length === 0) fail(`no idea matching "${id}"`);
  if (matches.length > 1) fail(`"${id}" is ambiguous: ${matches.map((m) => m.id).join(', ')}`);
  return matches[0];
}

/**
 * Has this capture already been written? Delivery from the sync server is at-least-once:
 * the desktop fetches, writes, then acks, so a crash between the write and the
 * ack replays the capture on the next drain. Without this the replay creates a
 * second card and the board quietly grows duplicates nobody typed.
 */
export function findByCaptureId(doc, captureId) {
  if (captureId == null) return null;
  return doc.ideas.find((i) => i.sourceCaptureId === captureId) || null;
}

export function newIdea({
  title, notes = '', projectId = null, impact = null, effort = null,
  model = null, sourceCaptureId = null, repos = [],
}) {
  if (!title) fail('title is required');
  const ts = now();
  return {
    id: mintId('idea'),
    title,
    notes,
    projectId,
    // Opaque id of the capture this idea came from, set only for ideas that
    // arrived through the sync server's capture queue. Delivery there is at-least-once
    // by design, so this is what makes a replayed capture a no-op instead of a
    // duplicate card. Never a counter: see the sync server's mintCaptureId.
    sourceCaptureId,
    repos,
    stage: 'inbox',
    impact,
    effort,
    model,
    planEffort: null,
    proposalPending: false,
    brief: null,
    proposedTasks: [],
    planPath: null,
    reviewVerdict: null,
    killCriteria: null,
    killedReason: null,
    taskIds: [],
    batchId: null,
    github: null,
    history: [{ at: ts, from: null, to: 'inbox', by: 'you', note: null }],
    createdAt: ts,
    updatedAt: ts,
  };
}

/**
 * Validate and apply a stage transition. Every gate lives here so no skill can
 * forget one, and every refusal names the command that would advance it.
 */
export function applyTransition(doc, idea, to, { note = null, by = null } = {}) {
  const from = idea.stage;
  if (!STAGES.includes(to)) fail(`"${to}" is not a stage`);
  if (from === to) fail(`${idea.id} is already ${to}`);

  const legal = TRANSITIONS[from] || {};
  if (!(to in legal)) {
    const options = Object.keys(legal);
    fail(`${idea.id} is ${from}; it cannot move to ${to}. ${options.length ? `From ${from} it can go to: ${options.join(', ')}.` : `${from} is terminal.`}`);
  }

  const key = `${from}>${to}`;
  if (NOTE_REQUIRED.has(key) && !note) fail(`moving ${from} to ${to} requires a reason`);

  // Earned stages: the artifact must already be on the idea.
  const need = REQUIRES_ARTIFACT[to];
  if (need && (idea[need.field] === null || idea[need.field] === undefined || idea[need.field] === '')) {
    fail(`${idea.id} cannot become ${to} without ${need.earns}. Run ${need.via} ${idea.id}, which writes ${need.field} and then makes this move.`);
  }

  // Gates, in the order a person would hit them.
  if (to === 'planned' && idea.planEffort === 'low') {
    // Legal, but worth saying: the express lane exists.
    process.stderr.write(`note: ${idea.id} is rated low and could go straight to queued (express lane). Planning it anyway.\n`);
  }
  if (to === 'reviewed') {
    const reviewed = doc.ideas.filter((i) => i.stage === 'reviewed').length;
    if (reviewed >= REVIEW_CAP) {
      const waiting = doc.ideas.filter((i) => i.stage === 'reviewed').map((i) => `${i.id} (${i.title})`);
      fail(`${reviewed} ideas already sit at reviewed, waiting on your queue-or-kill call. Clear one first:\n  ${waiting.join('\n  ')}`);
    }
  }
  if (to === 'queued' && from === 'shaped' && idea.planEffort !== 'low') {
    fail(`${idea.id} is rated ${idea.planEffort || 'unrated'}; only low ideas take the express lane. Run /idea-plan ${idea.id} first.`);
  }
  if (to === 'shaped' && from === 'inbox' && !idea.projectId) {
    fail(`${idea.id} has no project, and tasks live on a project. Set one first: ideas-store set ${idea.id} --project=<id>`);
  }

  // A kill's reason IS its note. Requiring a second command to record it is
  // how reasons go missing, and a killed idea without one gets brainstormed
  // again from scratch six weeks later.
  if (to === 'killed') idea.killedReason = note;
  if (to === 'inbox' && from === 'killed') idea.killedReason = null;

  idea.stage = to;
  idea.updatedAt = now();
  idea.history.push({
    at: idea.updatedAt,
    from,
    to,
    by: by || legal[to],
    note,
  });
  return idea;
}

export function waitingOn(idea) {
  switch (idea.stage) {
    case 'building': return 'session';
    case 'shipped': return 'done';
    case 'killed': return 'done';
    default: return 'you';
  }
}

export function nextAction(idea) {
  switch (idea.stage) {
    case 'inbox': return `/idea-brainstorm ${idea.id}`;
    case 'shaped': return idea.planEffort === 'low'
      ? `/idea-queue ${idea.id}   (express lane)`
      : `/idea-plan ${idea.id}`;
    case 'planned': return `/idea-review ${idea.id}`;
    case 'reviewed': return `/idea-queue ${idea.id}  or  /idea-kill ${idea.id}`;
    case 'queued': return `/idea-execute ${idea.id}`;
    case 'building': return 'session running (or /idea-reset if it died)';
    case 'built': return `deploy or accept, then /idea-ship ${idea.id}`;
    case 'shipped': return '-';
    case 'killed': return `/idea-reopen ${idea.id}`;
    default: return '-';
  }
}

export { findIdea, REVIEW_CAP, ROOT, STORE };
