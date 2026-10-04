/**
 * How cards order inside a column.
 *
 * Pure, so it tests without a DOM, in the shape of idea-keys.js and flip.js.
 * The board sorted by impact descending long before there was a control for
 * it, and `impact` stays the default here so a fresh install orders exactly
 * the way the board always has.
 *
 * Every mode ends on the same `createdAt` tie-break. That is not decoration:
 * equal keys with an unstable order permute between renders, and FLIP would
 * then animate cards that never actually moved.
 */

export const SORT_MODES = ['impact', 'effort', 'project'];
export const DEFAULT_SORT = 'impact';

/** The ordinal scale behind both the card's effort meter and the effort sort, so the two cannot disagree. */
export const EFFORT_RANK = { low: 1, medium: 2, high: 3 };

/** The rating that counts: what planning decided, falling back to what the capture guessed. */
export const effortOf = (i) => i?.planEffort || i?.effort || '';

const effortRank = (i) => EFFORT_RANK[effortOf(i)] || 0;

/** Valid impact is 1 to 5, so an absent one ranks 0 and lands below every rated card. */
const impactRank = (i) => i?.impact ?? 0;

const created = (i) => i?.createdAt || '';

/**
 * Rank descending, then oldest first. Descending is what "high at the top"
 * means for both impact and effort, and an unrated card lands at the bottom of
 * its column rather than in among the rated ones.
 */
const byRankDesc = (rank) => (a, b) => (rank(b) - rank(a)) || created(a).localeCompare(created(b));

/**
 * Project ascending, case-insensitive, on the id the card actually shows. The
 * chip renders `projectId` raw and is far too narrow for a display name like
 * "A Long Project Name", so sorting on the name would order the column by a
 * string that is nowhere on screen and read as no order at all.
 *
 * A card with no project goes last. "No project" is a real state, not an
 * alphabetical position.
 */
const byProject = (a, b) => {
  const ap = a?.projectId || '';
  const bp = b?.projectId || '';
  if (!ap !== !bp) return ap ? -1 : 1;
  return ap.localeCompare(bp, undefined, { sensitivity: 'base' })
    || created(a).localeCompare(created(b));
};

/**
 * The comparator for a mode. An unknown mode falls back to the default rather
 * than throwing, so a preference written by an older or newer build degrades
 * to the board's original order instead of emptying a column. That fallback is
 * the only guard the modes need, which is why neither caller repeats it.
 */
export function ideaComparator(mode) {
  switch (mode) {
    case 'effort': return byRankDesc(effortRank);
    case 'project': return byProject;
    default: return byRankDesc(impactRank);
  }
}
