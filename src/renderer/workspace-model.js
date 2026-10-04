/**
 * What a legal workspace is, in one place. Main runs validateWorkspace on
 * every sync pull and every save-state and refuses a failing payload whole. The
 * renderer imports the enums and the safe-name rule from here, so its pickers
 * can only write values this file accepts. Import-free on purpose: Vite
 * bundles it into dist/main the way it bundles repo-age.js, and
 * electron-builder ships src/renderer, so main imports it and never the reverse.
 *
 * Free text (names, focus, notes, task text, list icons, branch names) is only
 * type-checked. It may hold any character and is escaped where it renders.
 * Keys this file does not name pass through, because nothing reads them (live
 * repos still carry a legacy `branches` array). A change that starts reading a
 * new key adds its check here in the same commit.
 */

// Repo names come from the user's own config and are handed to execFile as an
// argument, never through a shell, so a space in a directory name is safe and
// several real checkouts have one. What is not safe is a name that walks out
// of the repo root, and '.' and '..' passed the old character class, so they
// are refused by name. Leading and trailing space is refused too, because a
// name that only differs by invisible padding is a debugging nightmare.
const SAFE_REPO_NAME = /^[a-zA-Z0-9._ -]{1,200}$/;

export function safeRepoName(name) {
  return typeof name === 'string'
    && SAFE_REPO_NAME.test(name)
    && name === name.trim()
    && name !== '.'
    && name !== '..';
}

// A directory the user names in Settings: ~ or / and then plain segments.
// It is pasted into a shell outside quotes so that ~ expands, which is why
// the character class is this narrow. A folder with a space is refused in
// Settings rather than half-supported here.
const SAFE_DIR = /^~?(\/[A-Za-z0-9._-]+)+$/;

export function safeDirPath(p) {
  return typeof p === 'string' && SAFE_DIR.test(p);
}

/**
 * A checkout as one pasteable shell word, or null. The root stays outside
 * the quotes so the shell expands its ~, and neither safeDirPath nor
 * safeRepoName admits a quote, so nothing can close them.
 */
export function shellRepoPath(name, root) {
  return safeRepoName(name) && safeDirPath(root) ? root + "/'" + name + "'" : null;
}

// Git allows a quote, '$' and ';' in a branch name, so a scanned name is
// checked against a strict pattern before it is pasted into a shell line.
const SAFE_BRANCH = /^[A-Za-z0-9._/-]{1,200}$/;

/**
 * The words after `git` that push every branch holding local-only commits:
 * plain `push` when the scan named none, null when a name is not safe to paste.
 */
export function gitPushArgs(branches = []) {
  if (!branches.length) return 'push';
  if (!branches.every((b) => SAFE_BRANCH.test(b) && !b.startsWith('-'))) return null;
  return 'push origin ' + branches.map((b) => "'" + b + "'").join(' ');
}

/** Project and list ids: every seed and live id, and 'list-' + Date.now(). */
export const WORKSPACE_ID = /^[a-z0-9-]{1,64}$/;

export const STATUSES = ['active', 'needs-commit', 'needs-push', 'needs-merge', 'stable', 'blocked', 'parked', 'done'];
/** What the status pickers and an accepted AI suggestion may set. */
export const ALL_STATUSES = STATUSES.filter((s) => s !== 'done');
export const PLATFORMS = ['web', 'mobile', 'desktop', 'admin', 'api', 'maps', 'client', 'hosting'];
export const PRIORITIES = ['high', 'medium', 'low'];
/** Also the click-to-cycle order on a card's focus dot. */
export const FOCUS_TONES = ['err', 'warn', 'info'];
export const COVERAGE = ['done', 'blocked', 'todo', 'active', 'n/a', 'unknown'];

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const absent = (v) => v === undefined || v === null;
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isCount = (v) => Number.isSafeInteger(v) && v >= 0;
const isId = (v) => typeof v === 'string' && WORKSPACE_ID.test(v);

function need(ok, path, rule, value) {
  if (!ok) throw new Error(`${path} ${rule}, got ${String(JSON.stringify(value)).slice(0, 60)}`);
}
function object(v, path) { need(isObject(v), path, 'must be an object', v); return v; }
function list(v, path) { need(Array.isArray(v), path, 'must be a list', v); return v; }
function optList(v, path) { return absent(v) ? [] : list(v, path); }
const text = (v, path) => need(typeof v === 'string', path, 'must be text', v);
const optText = (v, path) => need(absent(v) || typeof v === 'string', path, 'must be text', v);
const optBool = (v, path) => need(absent(v) || typeof v === 'boolean', path, 'must be true or false', v);
const optCount = (v, path) => need(absent(v) || isCount(v), path, 'must be a whole number', v);
const oneOf = (v, values, path) => need(values.includes(v), path, `must be one of ${values.join(', ')}`, v);
const optOneOf = (v, values, path) => absent(v) || oneOf(v, values, path);
const repoName = (v, path) => need(safeRepoName(v), path, 'must be a safe repo name', v);

function each(items, path, check) {
  items.forEach((item, i) => check(object(item, `${path}[${i}]`), `${path}[${i}]`));
}

function checkTask(t, path) {
  text(t.text, `${path}.text`);
  optBool(t.done, `${path}.done`);
}

function checkSince(s, path) {
  if (absent(s)) return;
  object(s, path);
  optText(s.dirty, `${path}.dirty`);
  optText(s.unpushed, `${path}.unpushed`);
  if (absent(s.branches)) return;
  for (const [branch, at] of Object.entries(object(s.branches, `${path}.branches`))) {
    optText(at, `${path}.branches[${JSON.stringify(branch)}]`);
  }
}

function checkRepo(r, path) {
  repoName(r.name, `${path}.name`);
  optOneOf(r.status, STATUSES, `${path}.status`);
  optOneOf(r.platform, PLATFORMS, `${path}.platform`);
  for (const key of ['ship', 'buildTracked', 'buildStale', 'upstream']) optBool(r[key], `${path}.${key}`);
  optText(r.notes, `${path}.notes`);
  optList(r.buildDeps, `${path}.buildDeps`).forEach((n, i) => repoName(n, `${path}.buildDeps[${i}]`));
  optList(r.ignoreBranches, `${path}.ignoreBranches`).forEach((b, i) => text(b, `${path}.ignoreBranches[${i}]`));
  optCount(r.uncommitted, `${path}.uncommitted`);
  optCount(r.unpushed, `${path}.unpushed`);
  checkSince(r.since, `${path}.since`);
}

function checkParity(par, path) {
  if (absent(par)) return;
  object(par, path);
  list(par.platforms, `${path}.platforms`).forEach((pl, i) => oneOf(pl, PLATFORMS, `${path}.platforms[${i}]`));
  each(list(par.features, `${path}.features`), `${path}.features`, (f, fp) => {
    optText(f.name, `${fp}.name`);
    for (const [pl, cov] of Object.entries(object(f.cov, `${fp}.cov`))) oneOf(cov, COVERAGE, `${fp}.cov.${pl}`);
  });
}

function checkProject(p, path) {
  need(isId(p.id), `${path}.id`, 'must be a lowercase id', p.id);
  optText(p.name, `${path}.name`);
  optText(p.focus, `${path}.focus`);
  optOneOf(p.status, STATUSES, `${path}.status`);
  optOneOf(p.priority, PRIORITIES, `${path}.priority`);
  optOneOf(p.focusTone, FOCUS_TONES, `${path}.focusTone`);
  need(absent(p.blockedSince) || (typeof p.blockedSince === 'string' && DATE.test(p.blockedSince)),
    `${path}.blockedSince`, 'must be a YYYY-MM-DD date', p.blockedSince);
  each(list(p.repos, `${path}.repos`), `${path}.repos`, checkRepo);
  checkParity(p.parity, `${path}.parity`);
  each(list(p.tasks, `${path}.tasks`), `${path}.tasks`, checkTask);
}

function checkList(l, path) {
  need(isId(l.id), `${path}.id`, 'must be a lowercase id', l.id);
  optText(l.name, `${path}.name`);
  optText(l.icon, `${path}.icon`);
  each(list(l.tasks, `${path}.tasks`), `${path}.tasks`, checkTask);
}

/** Today and inbox items. Their ids are Date.now() numbers from every writer. */
function checkItem(item, path) {
  need(absent(item.id) || Number.isFinite(item.id) || isId(item.id), `${path}.id`, 'must be a number or a lowercase id', item.id);
  text(item.text, `${path}.text`);
  optBool(item.done, `${path}.done`);
}

function checkDone(d, path) {
  text(d.text, `${path}.text`);
  optText(d.project, `${path}.project`);
}

/**
 * { ok: true } or { ok: false, error } naming the first failing path. Checks
 * and never repairs, and any exception counts as a failure, so it fails closed.
 */
export function validateWorkspace(w) {
  try {
    object(w, 'workspace');
    each(list(w.ws, 'ws'), 'ws', checkProject);
    each(optList(w.lists, 'lists'), 'lists', checkList);
    each(optList(w.today, 'today'), 'today', checkItem);
    each(optList(w.inbox, 'inbox'), 'inbox', checkItem);
    each(optList(w.doneToday, 'doneToday'), 'doneToday', checkDone);
    need(absent(w.todayDate) || w.todayDate === '' || (typeof w.todayDate === 'string' && DATE.test(w.todayDate)),
      'todayDate', 'must be empty or a YYYY-MM-DD date', w.todayDate);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * The workspace without repos marked `upstream`: clones of someone else's
 * project, whose commits and issues are not this workspace's work.
 */
export function ownProjects(ws) {
  return (ws || []).map((p) => ({ ...p, repos: (p.repos || []).filter((r) => r.upstream !== true) }));
}

/** Repo names on the workspace that pass safeRepoName, in card order. */
export function repoNames(ws) {
  return (ws || []).flatMap((p) => (p.repos || []).map((r) => r.name)).filter(safeRepoName);
}

/**
 * The model's status suggestions cut to ones that name a project in `ws` and a
 * status a picker could set. Anything else is dropped, not repaired, and the
 * two free-text fields are coerced to strings for the overlay to escape.
 */
export function filterStatusSuggestions(raw, ws) {
  if (!Array.isArray(raw)) return [];
  const ids = new Set((ws || []).map((p) => p?.id));
  return raw
    .filter((s) => isObject(s) && typeof s.id === 'string' && ids.has(s.id) && ALL_STATUSES.includes(s.suggested))
    .map((s) => ({
      id: s.id,
      current: typeof s.current === 'string' ? s.current : '',
      suggested: s.suggested,
      reason: typeof s.reason === 'string' ? s.reason : '',
    }));
}
