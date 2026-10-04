// src/renderer/card-model.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  projectIdFor, newProject, cardNameError, deleteBlocker, deleteConfirmText,
  moveRepo, buildDepChoices, liveWorkIds,
} from './card-model.js';
import { validateWorkspace, WORKSPACE_ID } from './workspace-model.js';

// Invented records shaped like the live workspace. Never paste live data here.
const repo = (name, over = {}) => ({
  name, status: 'stable', platform: 'web', ship: false, buildTracked: false,
  buildDeps: [], notes: 'clean', buildStale: false, ...over,
});
const card = (id, name, over = {}) => ({ ...newProject(id, name), ...over });

test('projectIdFor slugs the name', () => {
  assert.equal(projectIdFor('Games', []), 'games');
  assert.equal(projectIdFor('Forked Repos!', []), 'forked-repos');
  assert.equal(projectIdFor('  Café / Bar  ', []), 'cafe-bar');
  assert.equal(projectIdFor('---', []), 'card');
  assert.equal(projectIdFor('\u{1F3AE}', []), 'card');
});

test('projectIdFor suffixes a collision', () => {
  assert.equal(projectIdFor('Games', ['games']), 'games-2');
  assert.equal(projectIdFor('Games', ['games', 'games-2']), 'games-3');
  assert.equal(projectIdFor('---', ['card']), 'card-2');
});

test('projectIdFor always satisfies WORKSPACE_ID', () => {
  const long = 'A very long card name '.repeat(10);
  for (const name of ['Games', long, 'x', '9 Lives', 'ÅÄÖ', 'tab\tname', long + '!']) {
    const id = projectIdFor(name, [projectIdFor(name, [])]);
    assert.match(id, WORKSPACE_ID, name);
    assert.ok(!id.startsWith('-') && !id.endsWith('-'), id);
  }
});

test('newProject passes the workspace validator', () => {
  const p = newProject('games', 'Games');
  assert.deepEqual(p, {
    id: 'games', name: 'Games', status: 'active', priority: 'low', focus: '',
    focusTone: 'info', blockedSince: null, parity: null, repos: [], tasks: [],
  });
  assert.deepEqual(validateWorkspace({ ws: [p] }), { ok: true });
});

test('cardNameError requires a name and refuses a duplicate ignoring case', () => {
  const ws = [card('alpha', 'Alpha'), card('beta', 'Beta')];
  assert.equal(cardNameError(ws, 'Gamma'), null);
  assert.match(cardNameError(ws, '   '), /needs a name/);
  assert.match(cardNameError(ws, ' alpha '), /already/);
  assert.equal(cardNameError(ws, 'ALPHA', 'alpha'), null, 'a card may keep its own name');
  assert.match(cardNameError(ws, 'beta', 'alpha'), /already/);
});

test('deleteBlocker refuses open tasks and in-flight ideas, in that order', () => {
  const ideas = [{ projectId: 'beta', stage: 'planned' }, { projectId: 'gamma', stage: 'inbox' }];
  assert.match(deleteBlocker(card('alpha', 'Alpha', { tasks: [{ done: false, text: 'x' }] }), ideas), /1 open task/);
  assert.match(deleteBlocker(card('beta', 'Beta'), ideas), /1 idea in flight/);
  assert.equal(deleteBlocker(card('gamma', 'Gamma', { tasks: [{ done: true, text: 'y' }] }), ideas), null);
});

test('deleteConfirmText names what goes with the card', () => {
  const p = card('gamma', 'Gamma', {
    repos: [repo('shared-lib'), repo('gamma-web')],
    tasks: [{ done: true, text: 'a' }, { done: true, text: 'b' }],
    parity: { platforms: ['web'], features: [{ name: 'Sync', cov: { web: 'done' } }] },
  });
  const text = deleteConfirmText(p, [{ projectId: 'gamma', stage: 'inbox' }, { projectId: 'gamma', stage: 'shipped' }]);
  assert.match(text, /Delete the Gamma card/);
  assert.match(text, /shared-lib, gamma-web/);
  assert.match(text, /untouched/);
  assert.match(text, /2 done tasks/);
  assert.match(text, /1 parity feature/);
  assert.match(text, /2 ideas/);
  assert.doesNotMatch(deleteConfirmText(card('empty', 'Empty'), []), /repo|task|parity|idea/i);
});

test('moveRepo moves the row object whole and inserts at the index', () => {
  const moving = repo('beta-api', { status: 'needs-push', notes: '1 to push', since: { dirty: null, unpushed: '2026-10-01T00:00:00Z' } });
  const ws = [card('beta', 'Beta', { repos: [moving, repo('beta-web')] }), card('alpha', 'Alpha', { repos: [repo('a1'), repo('a2')] })];
  const res = moveRepo(ws, 'beta', 0, 'alpha', 1);
  assert.equal(res.ok, true);
  assert.equal(res.repo, moving);
  assert.equal(res.to, ws[1]);
  assert.deepEqual(ws[0].repos.map((r) => r.name), ['beta-web']);
  assert.deepEqual(ws[1].repos.map((r) => r.name), ['a1', 'beta-api', 'a2']);
  assert.equal(ws[1].repos[1], moving, 'same object, so since and notes travel');
});

test('moveRepo clamps the index and appends to an empty card', () => {
  const ws = [card('beta', 'Beta', { repos: [repo('beta-api')] }), card('empty', 'Empty')];
  assert.equal(moveRepo(ws, 'beta', 0, 'empty', 99).ok, true);
  assert.deepEqual(ws[1].repos.map((r) => r.name), ['beta-api']);
});

test('moveRepo refuses a duplicate and changes nothing', () => {
  const ws = [card('beta', 'Beta', { repos: [repo('shared-lib')] }), card('gamma', 'Gamma', { repos: [repo('shared-lib')] })];
  const res = moveRepo(ws, 'beta', 0, 'gamma', 0);
  assert.equal(res.ok, false);
  assert.match(res.error, /shared-lib is already on Gamma/);
  assert.equal(ws[0].repos.length, 1);
  assert.equal(ws[1].repos.length, 1);
});

test('moveRepo refuses a missing card, a missing row, and the same card', () => {
  const ws = [card('beta', 'Beta', { repos: [repo('beta-api')] })];
  assert.equal(moveRepo(ws, 'beta', 0, 'nope', 0).ok, false);
  assert.equal(moveRepo(ws, 'beta', 5, 'beta', 0).ok, false);
  assert.equal(moveRepo(ws, 'beta', 0, 'beta', 0).ok, false);
  assert.equal(ws[0].repos.length, 1);
});

test('buildDepChoices offers the other repos on the card plus existing deps', () => {
  const app = repo('alpha-app', { buildDeps: ['far-api'] });
  const p = card('alpha', 'Alpha', { repos: [repo('alpha-web'), app, repo('alpha-admin')] });
  assert.deepEqual(buildDepChoices(p, app), ['alpha-web', 'alpha-admin', 'far-api']);
  assert.deepEqual(buildDepChoices(card('solo', 'Solo', { repos: [repo('only')] }), repo('only')), []);
});

test('liveWorkIds drops ids not in the workspace and duplicates', () => {
  const ws = [card('alpha', 'Alpha'), card('gamma', 'Gamma')];
  assert.deepEqual(liveWorkIds(['alpha', 'gone', 'gamma', 'alpha'], ws), ['alpha', 'gamma']);
  assert.deepEqual(liveWorkIds([], ws), []);
});
