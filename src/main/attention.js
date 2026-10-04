/**
 * The first scan that saw a repo dirty or unpushed, remembered across scans.
 * A file edited every day has a fresh mtime forever, so the mtime alone would
 * say "dirty since this morning" about work that has sat uncommitted for a
 * month. The earlier of memory and scan is the honest answer, and a clean
 * scan forgets, so the next dirty spell starts its own clock.
 */
const earlier = (a, b) => (a && b ? (a < b ? a : b) : a || b || null);

export function mergeSince(prev, fresh) {
  const p = prev || {};
  return {
    dirty: fresh.dirty ? earlier(p.dirty, fresh.dirty) : null,
    unpushed: fresh.unpushed ? earlier(p.unpushed, fresh.unpushed) : null,
  };
}
