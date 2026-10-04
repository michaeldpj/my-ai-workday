/**
 * Single-key stage actions for hands-on-keys triage. The map mirrors the legal
 * actions in ideas-ui.js `actionButton`, so a key never offers a move the store
 * would refuse. Stage-only: where a button is conditional on planEffort (a
 * shaped card's Queue), the store still enforces it and its refusal becomes the
 * toast, same as the button path.
 */
const MAP = {
  inbox: { b: 'launch:brainstorm', e: 'edit', k: 'kill' },
  shaped: { p: 'launch:plan', q: 'queue', k: 'kill' },
  planned: { r: 'launch:review', k: 'kill' },
  reviewed: { q: 'queue', k: 'kill' },
  queued: { x: 'launch:execute', k: 'kill' },
  building: { r: 'reset' },
  built: { s: 'launch:ship' },
};

export function keyAction(stage, key) {
  const m = MAP[stage];
  return (m && m[key]) || null;
}
