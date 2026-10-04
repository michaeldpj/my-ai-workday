/**
 * How long a repo has carried work that is not safe yet. The count on the row
 * says how much; this says how long, which is the signal that a count never
 * gave: 12 uncommitted files for an hour is a session, for nine days is a
 * risk. Pure, so main can import the stale rule for the tray badge.
 */
const DAY = 86400000;

export const AGE_TIERS = [
  { tier: 'hot', days: 7 },
  { tier: 'warn', days: 3 },
  { tier: 'warm', days: 1 },
];
export const STALE_DAYS = 3;

export function ageTier(iso, now = Date.now()) {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return '';
  const days = (now - t) / DAY;
  return AGE_TIERS.find((a) => days >= a.days)?.tier || '';
}

export function oldestSignal(since) {
  if (!since) return null;
  const candidates = [];
  if (since.dirty) candidates.push({ kind: 'dirty', at: since.dirty });
  if (since.unpushed) candidates.push({ kind: 'unpushed', at: since.unpushed });
  for (const [branch, at] of Object.entries(since.branches || {})) {
    if (at) candidates.push({ kind: 'branch', at, branch });
  }
  if (!candidates.length) return null;
  return candidates.reduce((min, c) => (c.at < min.at ? c : min));
}

const keep = (name, prs, ignore) => prs[name] !== 'MERGED' && !ignore.includes(name);

/** The unmerged branch names once squash-merges and any explicitly ignored branch drop out. */
export function liveBranches(names, prs = {}, ignore = []) {
  return (names || []).filter((b) => keep(b, prs, ignore));
}

/**
 * A branch whose PR merged by squash is never an ancestor of main, so git
 * still lists it as unmerged. The scan's PR map is the only signal it landed.
 * A branch named in `ignore` (a repo's own list of branches that will never
 * merge) is dropped the same way.
 */
export function dropMergedBranches(since, prs = {}, ignore = []) {
  if (!since) return null;
  const branches = Object.fromEntries(Object.entries(since.branches || {}).filter(([b]) => keep(b, prs, ignore)));
  return { ...since, branches };
}

/** The oldest signal across a project's repos, parked ones excluded: the card's one age pill. */
export function projectSignal(repos) {
  let oldest = null;
  for (const r of repos || []) {
    if (r.status === 'parked') continue;
    const s = oldestSignal(r.since);
    if (s && (!oldest || s.at < oldest.at)) oldest = { ...s, repo: r.name };
  }
  return oldest;
}

/** Old enough to nag about. A parked repo is silenced on purpose and never counts. */
export function isStale(repo, now = Date.now()) {
  if (!repo || repo.status === 'parked') return false;
  const s = oldestSignal(repo.since);
  return !!s && now - Date.parse(s.at) >= STALE_DAYS * DAY;
}
