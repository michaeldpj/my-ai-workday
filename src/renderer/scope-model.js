/**
 * Work or personal: which projects a view shows.
 *
 * Pure, and imported by main to validate `scopePrefs`, the same way
 * idea-sort.js is. The work list is a local preference, never a field on the
 * synced workspace, so the sync server and the phone never see it. A project not on
 * the list is personal, and so is an entry with no project at all.
 */
export const SCOPES = ['all', 'work', 'personal'];
export const DEFAULT_SCOPE = 'all';
export const DEFAULT_WORK = [];

export function inScope(projectId, scope, work) {
  if (scope === 'work') return work.includes(projectId);
  if (scope === 'personal') return !work.includes(projectId);
  return true;
}

/** The workspace's projects visible under a scope, in workspace order. */
export function scopedProjects(ws, scope, work) {
  return (ws || []).filter((p) => inScope(p.id, scope, work));
}
