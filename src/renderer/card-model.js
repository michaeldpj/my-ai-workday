// src/renderer/card-model.js
/**
 * Card management rules the dashboard needs without the DOM: what id a new
 * card gets, what shape it starts with, which names are legal, what blocks a
 * delete, and how a repo row moves between cards. Renderer-only, never
 * imported by main. moveRepo mutates ws in place, the way every mutation in
 * app.js does, so the caller's autoSave sees the change.
 */
import { IN_FLIGHT_STAGES, inFlightCount } from './idea-model.js';

const ID_BASE_MAX = 60; // leaves room for a -NNN suffix inside WORKSPACE_ID's 64

const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');

export function projectIdFor(name, takenIds) {
  const base = String(name ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, ID_BASE_MAX).replace(/-+$/, '') || 'card';
  const taken = new Set(takenIds);
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(base + '-' + n)) n++;
  return base + '-' + n;
}

/** The shape the 2026-10-03 hand edit used for Games and Forked. */
export function newProject(id, name) {
  return {
    id, name, status: 'active', priority: 'low', focus: '', focusTone: 'info',
    blockedSince: null, parity: null, repos: [], tasks: [],
  };
}

export function cardNameError(ws, name, exceptId) {
  const want = String(name ?? '').trim();
  if (!want) return 'A card needs a name';
  const clash = ws.find((p) => p.id !== exceptId && String(p.name ?? '').trim().toLowerCase() === want.toLowerCase());
  return clash ? 'A card named ' + clash.name + ' already exists' : null;
}

export function deleteBlocker(project, ideas) {
  const open = project.tasks.filter((t) => !t.done).length;
  if (open) return project.name + ' has ' + plural(open, 'open task') + '. Finish or delete them first.';
  const inFlight = inFlightCount(ideas, project.id);
  if (inFlight) return project.name + ' has ' + plural(inFlight, 'idea') + ' in flight. Finish them or move them to another project first.';
  return null;
}

export function deleteConfirmText(project, ideas) {
  const lines = ['Delete the ' + project.name + ' card?'];
  if (project.repos.length) {
    lines.push('It stops tracking ' + plural(project.repos.length, 'repo') + ' (' + project.repos.map((r) => r.name).join(', ') + '). The checkouts on disk are untouched.');
  }
  const done = project.tasks.filter((t) => t.done).length;
  if (done) lines.push('It also removes ' + plural(done, 'done task') + '.');
  const features = project.parity?.features?.length || 0;
  if (features) lines.push('It also removes the parity table (' + plural(features, 'parity feature') + ').');
  const resting = (ideas || []).filter((i) => i.projectId === project.id && !IN_FLIGHT_STAGES.includes(i.stage)).length;
  if (resting) lines.push(plural(resting, 'idea') + ' not in flight will keep "' + project.id + '" as a project id that no card has.');
  return lines.join('\n\n');
}

export function moveRepo(ws, fromPid, fromIdx, toPid, toIdx) {
  const src = ws.find((p) => p.id === fromPid);
  const dst = ws.find((p) => p.id === toPid);
  if (!src || !dst) return { ok: false, error: 'That card is no longer on the dashboard' };
  if (src === dst) return { ok: false, error: 'Already on this card' };
  const repo = src.repos[fromIdx];
  if (!repo) return { ok: false, error: 'That repo is no longer on ' + src.name };
  if (dst.repos.some((r) => r.name === repo.name)) return { ok: false, error: repo.name + ' is already on ' + dst.name };
  src.repos.splice(fromIdx, 1);
  dst.repos.splice(Math.max(0, Math.min(toIdx, dst.repos.length)), 0, repo);
  return { ok: true, repo, to: dst };
}

export function buildDepChoices(project, repo) {
  const names = [...project.repos.map((r) => r.name), ...(repo.buildDeps || [])];
  return [...new Set(names)].filter((n) => n !== repo.name);
}

export function liveWorkIds(work, ws) {
  const ids = new Set(ws.map((p) => p.id));
  return [...new Set(work)].filter((id) => ids.has(id));
}
