/**
 * ideas-sync: publish a projection up, drain captures down.
 *
 * The Mac owns the board. This module does not change that and must never be
 * extended until it does. It moves two things across the wire:
 *
 *   publish  a narrow read-only projection, so the phone can see the pipeline
 *   drain    captures typed on the phone, written through the same validated
 *            path the desktop board uses
 *
 * Both the CLI and the Electron main process import this. It takes `{ url,
 * token }` as arguments rather than reading config, because the desktop keeps
 * its token in the keychain and the CLI takes it from the environment, and
 * neither should have to know about the other's storage.
 */

import fs from 'node:fs';
import { read, transact, newIdea, findByCaptureId, waitingOn, nextAction, ROOT, STORE } from './ideas-store.mjs';
import { buildCaptureFields } from './idea-fields.mjs';

const TIMEOUT_MS = 10_000;

/**
 * How many captures one drain will write.
 *
 * `transact` commits to git synchronously, so each capture costs a lock
 * acquisition and an `execFileSync`. In the Electron main process that time is
 * the UI freezing. A drain of the full 200-row queue would stall it for many
 * seconds, so the queue is worked in bounded batches and the rest waits for the
 * next tick, thirty seconds later. Nothing is lost, only delayed.
 */
const DRAIN_BATCH = 25;

/**
 * What leaves this machine.
 *
 * Deliberately narrow, and the test is whether a field is needed to render a
 * card. The brief, the plan text, the review verdict, the issue URL, and the
 * full history all fail it. They are the substance of the pipeline, and
 * publishing them would put every plan you have ever written on a
 * network-reachable box for no gain.
 *
 * `killedReason` and `planEffort` pass it, and it is worth saying why rather
 * than leaving them looking like oversights. A killed card that cannot say why
 * it was killed is a card you have to go to the Mac to understand, and
 * `planEffort` is the low/medium/high rating the whole batching decision runs
 * on. Both are short, both are rendered.
 *
 * `waitingOn` and `nextAction` are computed here so the phone never
 * reimplements the state machine and cannot disagree about whose move it is.
 */
function project(idea) {
  return {
    id: idea.id,
    title: idea.title,
    stage: idea.stage,
    projectId: idea.projectId,
    impact: idea.impact,
    effort: idea.effort,
    planEffort: idea.planEffort,
    waitingOn: waitingOn(idea),
    nextAction: nextAction(idea),
    killedReason: idea.killedReason || null,
    updatedAt: idea.updatedAt,
    createdAt: idea.createdAt,
  };
}

function endpoint(url, path) {
  return String(url).replace(/\/$/, '') + path;
}

async function call(url, token, path, options = {}) {
  const res = await fetch(endpoint(url, path), {
    ...options,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/**
 * Push the current board up as a projection.
 *
 * A missing ideas.json reads as an empty board, and publishing that would
 * replace the phone's projection with nothing. That happens when this process
 * resolved the wrong store folder, so it refuses instead. Drain still runs,
 * since a fresh install creates ideas.json by draining its first capture.
 */
export async function publish({ url, token }) {
  if (!fs.existsSync(STORE)) {
    return { ok: false, error: `no ideas.json at ${ROOT}; refusing to publish an empty projection` };
  }
  const doc = read();
  const body = JSON.stringify({ rev: doc.rev || 0, ideas: doc.ideas.map(project) });
  try {
    const out = await call(url, token, '/api/ideas', { method: 'PUT', body });
    return { ok: true, rev: out.rev, pendingCaptures: out.pendingCaptures };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Pull captures, write them, then ack the ones that landed.
 *
 * Fetch-write-ack in that order, never drain-and-clear: a crash between the
 * write and the ack replays the capture, which `sourceCaptureId` makes a
 * no-op. A crash after a clear would lose it outright.
 */
export async function drain({ url, token }) {
  let captures;
  try {
    ({ captures } = await call(url, token, '/api/ideas/captures'));
  } catch (e) {
    return { ok: false, error: e.message, written: 0 };
  }
  if (!captures?.length) return { ok: true, written: 0, duplicates: 0, rejected: [] };
  const batch = captures.slice(0, DRAIN_BATCH);

  const ack = [];
  const rejected = [];
  let written = 0;
  let duplicates = 0;

  for (const row of batch) {
    try {
      if (typeof row?.captureId !== 'string' || !row.captureId) throw new Error('capture is missing an id');
      const fields = buildCaptureFields({
        title: row.title,
        notes: row.notes,
        projectId: row.projectId,
        impact: row.impact,
        effort: row.effort,
      });
      let dup = false;
      transact((doc) => {
        if (findByCaptureId(doc, row.captureId)) {
          dup = true;
          return null;
        }
        doc.ideas.push(newIdea({ ...fields, sourceCaptureId: row.captureId }));
        return `capture ${row.captureId}: captured from mobile`;
      });
      if (dup) duplicates += 1;
      else written += 1;
      ack.push(row.captureId);
    } catch (e) {
      // A capture this machine refuses is acked anyway. Leaving it queued
      // would make it retry forever and block every capture behind it, and
      // the API already validated the same allowlist, so reaching here means
      // the row is malformed rather than merely unlucky.
      rejected.push({ captureId: row.captureId, error: e.message });
      if (typeof row?.captureId === 'string' && row.captureId) ack.push(row.captureId);
    }
  }

  if (ack.length) {
    try {
      await call(url, token, '/api/ideas/captures', {
        method: 'DELETE',
        body: JSON.stringify({ ids: ack }),
      });
    } catch (e) {
      // Unacked captures replay on the next drain and dedupe on arrival.
      return { ok: true, written, duplicates, rejected, ackFailed: e.message };
    }
  }
  return { ok: true, written, duplicates, rejected, remaining: captures.length - batch.length };
}
