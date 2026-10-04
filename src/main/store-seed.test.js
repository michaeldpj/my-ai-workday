import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_WS, DEFAULT_LISTS } from './store.js';
import { DEFAULT_WORK } from '../renderer/scope-model.js';
import { validateWorkspace } from '../renderer/workspace-model.js';

// A fresh install starts empty. conf applies defaults only to top-level keys
// missing from the file, so an existing config keeps its own workspace and
// work list whatever these say.
test('the first-run seed is empty and passes the workspace validator', () => {
  assert.deepEqual(DEFAULT_WS, []);
  assert.deepEqual(DEFAULT_LISTS, []);
  assert.deepEqual(DEFAULT_WORK, []);
  const seed = { ws: DEFAULT_WS, lists: DEFAULT_LISTS, today: [], doneToday: [], inbox: [], todayDate: '' };
  assert.deepEqual(validateWorkspace(seed), { ok: true });
});
