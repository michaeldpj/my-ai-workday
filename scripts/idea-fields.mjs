/**
 * The fields a person may write about an idea, and the one validator for them.
 *
 * Three callers share this: the desktop board's renderer, the CLI drain, and
 * the Electron drain. They must not drift, because the allowlist is a security
 * boundary rather than a convenience. Every command-produced artifact is absent
 * from it: `brief`, `planPath`, `reviewVerdict`, and `github` are exactly what
 * the store's earned-stage gates check for, so a surface that could write one
 * could earn the stage it guards without doing the work. `stage` is absent
 * because `applyTransition` is the only path that runs the state machine.
 *
 * These are the fields a person edits about an idea, plus the model a launch
 * should use, and nothing else.
 *
 * A second copy of this list exists on purpose, in `my-day-api/ideas.js` as
 * `CAPTURE_FIELDS`, because that is a different deployable across a trust
 * boundary and validating at the boundary is the point. The two must stay in
 * step: adding a writable field here without adding it there means the API
 * rejects it before the Mac ever sees it. `repos` is settable from the Mac
 * only; `CAPTURE_FIELDS` leaves it out on purpose because the phone has no
 * repo list to pick from.
 */

/** Model aliases the launcher passes to `claude --model`. Shared with terminal.js. */
export const MODELS = Object.freeze(['fable', 'opus', 'sonnet', 'haiku']);

export const WRITABLE = new Set(['title', 'notes', 'projectId', 'impact', 'effort', 'model', 'repos']);

const EFFORTS = ['low', 'medium', 'high'];
const MAX_TEXT = 4000;
// A strict subset of git.js's safeRepoName: no spaces, no leading dot. A name
// that passes here passes there, so a launch never sees a name the scanner would refuse.
const REPO_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const MAX_REPOS = 10;

/** Validate one caller-supplied field, or throw with a message fit for a UI. */
export function checkField(key, raw) {
  if (!WRITABLE.has(key)) throw new Error(`${key} is not settable from the app`);
  if (key === 'impact') {
    if (raw === null || raw === '') return null;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 5) throw new Error('impact must be 1 to 5');
    return n;
  }
  if (key === 'effort') {
    if (raw === null || raw === '') return null;
    if (!EFFORTS.includes(raw)) throw new Error('effort must be low, medium, or high');
    return raw;
  }
  if (key === 'model') {
    if (raw === null || raw === '') return null;
    if (!MODELS.includes(raw)) throw new Error(`model must be one of ${MODELS.join(', ')}`);
    return raw;
  }
  if (key === 'projectId') {
    if (raw === null || raw === '') return null;
    if (typeof raw !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(raw)) {
      throw new Error('projectId must be a short identifier');
    }
    return raw;
  }
  if (key === 'repos') {
    if (raw === null || raw === '') return [];
    const list = Array.isArray(raw) ? raw : String(raw).split(',');
    const names = [...new Set(list.map((s) => String(s).trim()).filter(Boolean))];
    if (names.length > MAX_REPOS) throw new Error(`at most ${MAX_REPOS} repos`);
    for (const n of names) if (!REPO_NAME.test(n)) throw new Error(`"${n}" is not a repo name`);
    return names;
  }
  if (typeof raw !== 'string') throw new Error(`${key} must be a string`);
  if (raw.length > MAX_TEXT) throw new Error(`${key} is too long`);
  return raw;
}

/**
 * Validate a whole capture into the shape `newIdea` takes.
 *
 * Refuses unknown keys rather than dropping them. Dropping is safe but silent,
 * and a caller trying to smuggle `brief` or `stage` through capture is a bug
 * worth surfacing, not swallowing.
 */
export function buildCaptureFields(fields = {}) {
  for (const key of Object.keys(fields)) {
    if (!WRITABLE.has(key)) throw new Error(`${key} is not settable from the app`);
  }
  const title = checkField('title', (fields.title || '').trim());
  if (!title) throw new Error('an idea needs a title');
  return {
    title,
    notes: fields.notes ? checkField('notes', fields.notes) : '',
    projectId: checkField('projectId', fields.projectId ?? null),
    impact: checkField('impact', fields.impact ?? null),
    effort: checkField('effort', fields.effort ?? null),
    model: checkField('model', fields.model ?? null),
    repos: checkField('repos', fields.repos ?? null),
  };
}
