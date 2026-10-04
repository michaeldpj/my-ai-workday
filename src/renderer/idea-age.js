/**
 * How long an idea has been building, and when that stops reading like a
 * running session and starts reading like a dead one.
 *
 * Nothing new is recorded for this. The store stamps every transition into
 * `history`, and `snapshot()` spreads the whole idea through to the renderer,
 * so the moment a card entered `building` is already on it.
 *
 * The app cannot see whether a session is alive. It can only see how long the
 * card has been quiet, so the card says that and lets you judge. The threshold
 * is per effort because an execute session's honest length is: a low idea that
 * has been building an hour is stuck, a high one is still working.
 */

import { effortOf } from './idea-sort.js';

const STALE_AFTER_HOURS = { low: 1, medium: 3, high: 6 };
const DEFAULT_STALE_HOURS = 3;
const HOUR = 3600000;

/** The `at` of the last history entry into `stage`, unparsed, or '' when there is none. */
function enteredStageStamp(history, stage) {
  return [...(history || [])].reverse().find((h) => h.to === stage)?.at || '';
}

/** Epoch ms for a timestamp string, or null when it is missing or unparseable. */
function toMs(at) {
  const t = at ? Date.parse(at) : NaN;
  return Number.isNaN(t) ? null : t;
}

/** When the idea entered `building`, in epoch ms, or null if it cannot be told. */
export function buildingSince(idea) {
  return toMs(enteredStageStamp(idea?.history, 'building') || idea?.updatedAt);
}

export function buildingAge(idea, now = Date.now()) {
  const since = buildingSince(idea);
  // A clock that disagrees with the stamp should read as fresh, not negative.
  return since === null ? null : Math.max(0, now - since);
}

/** Coarse on purpose: minutes matter early, hours later, nothing finer. */
export function formatAge(ms) {
  if (ms === null || ms === undefined) return '';
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/**
 * Quiet long enough to be worth a second look. An idea whose age cannot be
 * told is never stale: an unknown is not evidence a session died.
 */
export function buildingStale(idea, now = Date.now()) {
  const age = buildingAge(idea, now);
  if (age === null) return false;
  const hours = STALE_AFTER_HOURS[effortOf(idea)] ?? DEFAULT_STALE_HOURS;
  return age >= hours * HOUR;
}

/**
 * Launch markers drive the same running rail on cards that are NOT `building`.
 *
 * The board opens a terminal for brainstorm, plan, review, ship and reopen and
 * the card stays put while that session runs, so nothing in `history` marks the
 * work. The marker is the only record that a session was fired, and like the
 * building rail it is a proxy: the app still cannot see the process, only how
 * long ago the button was pressed. These sessions are interactive and short, so
 * they read as stale far sooner than an execute session parked in `building`.
 */
// A starting heuristic, not a measured one: these sessions are interactive, so
// twenty quiet minutes almost always means finished or abandoned. Revisit if
// real usage says otherwise.
const LAUNCH_STALE_MINUTES = 20;
const MINUTE = 60000;

/**
 * When the card last entered its current stage, epoch ms, or null. A marker is
 * only trusted while it postdates this, so a card that advanced and later
 * returned to the same stage does not resurrect an old session's rail.
 */
export function enteredStageAt(idea) {
  return toMs(enteredStageStamp(idea?.history, idea?.stage) || idea?.createdAt || idea?.updatedAt);
}

/**
 * A marker lights the rail only while the card still sits in the stage the
 * session was fired from and the mark is no older than the card's entry into
 * that stage. A finished session moves the card, which fails the stage test; a
 * reset or a return stamps a newer entry, which fails the time test.
 */
export function launchActive(idea, marker) {
  if (!idea || !marker || marker.stage !== idea.stage) return false;
  const at = Number(marker.at);
  if (!Number.isFinite(at)) return false;
  const entered = enteredStageAt(idea);
  return entered === null || at >= entered;
}

export function launchAge(marker, now = Date.now()) {
  const at = Number(marker?.at);
  return Number.isFinite(at) ? Math.max(0, now - at) : null;
}

export function launchStale(marker, now = Date.now()) {
  const age = launchAge(marker, now);
  return age !== null && age >= LAUNCH_STALE_MINUTES * MINUTE;
}
