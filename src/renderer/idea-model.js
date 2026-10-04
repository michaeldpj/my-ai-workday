/**
 * Pure rules about ideas the dashboard needs without the board: what counts
 * as in flight. Inbox is not yet work; built, shipped, and killed are done.
 */
export const IN_FLIGHT_STAGES = ['shaped', 'planned', 'reviewed', 'queued', 'building'];

export function inFlightCount(ideas, projectId) {
  return (ideas || []).filter((i) => i.projectId === projectId && IN_FLIGHT_STAGES.includes(i.stage)).length;
}
