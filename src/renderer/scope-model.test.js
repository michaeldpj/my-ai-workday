import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inScope, scopedProjects, SCOPES, DEFAULT_SCOPE } from './scope-model.js';

const ws = [{ id: 'twig' }, { id: 'lux' }, { id: 'tools' }, { id: 'moss' }];
const ids = (list) => list.map((p) => p.id);

test('the default is all and it is one of the offered scopes', () => {
  assert.equal(DEFAULT_SCOPE, 'all');
  assert.ok(SCOPES.includes(DEFAULT_SCOPE));
});

test('all shows every project', () => {
  assert.deepEqual(ids(scopedProjects(ws, 'all', ['lux'])), ['twig', 'lux', 'tools', 'moss']);
});

test('work shows only listed projects, in workspace order', () => {
  assert.deepEqual(ids(scopedProjects(ws, 'work', ['tools', 'lux'])), ['lux', 'tools']);
});

test('personal is everything not on the work list', () => {
  assert.deepEqual(ids(scopedProjects(ws, 'personal', ['lux', 'tools'])), ['twig', 'moss']);
});

test('a listed id with no matching project changes nothing', () => {
  assert.deepEqual(ids(scopedProjects(ws, 'work', ['myday'])), []);
  assert.equal(scopedProjects(ws, 'personal', ['myday']).length, 4);
});

test('an empty work list makes work empty and personal everything', () => {
  assert.equal(scopedProjects(ws, 'work', []).length, 0);
  assert.equal(scopedProjects(ws, 'personal', []).length, 4);
});

test('an entry with no project counts as personal', () => {
  assert.equal(inScope(undefined, 'work', ['lux']), false);
  assert.equal(inScope(undefined, 'personal', ['lux']), true);
  assert.equal(inScope('', 'all', ['lux']), true);
});

test('a missing workspace yields no projects', () => {
  assert.deepEqual(scopedProjects(undefined, 'all', []), []);
});
