import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyAction } from './idea-keys.js';

test('q queues a reviewed idea', () => assert.equal(keyAction('reviewed', 'q'), 'queue'));
test('k kills wherever the store allows it', () => {
  for (const stage of ['inbox', 'shaped', 'planned', 'reviewed', 'queued']) {
    assert.equal(keyAction(stage, 'k'), 'kill', stage);
  }
  for (const stage of ['building', 'built', 'killed']) {
    assert.equal(keyAction(stage, 'k'), null, stage);
  }
});
test('unknown key is null', () => assert.equal(keyAction('queued', 'z'), null));
test('r resets a building idea whose session died', () => {
  assert.equal(keyAction('building', 'r'), 'reset');
  assert.equal(keyAction('building', 'q'), null);
});
test('single-key launches mirror the buttons', () => {
  assert.equal(keyAction('inbox', 'b'), 'launch:brainstorm');
  assert.equal(keyAction('planned', 'r'), 'launch:review');
  assert.equal(keyAction('queued', 'x'), 'launch:execute');
  assert.equal(keyAction('built', 's'), 'launch:ship');
});
test('e edits an inbox idea and nothing else', () => {
  assert.equal(keyAction('inbox', 'e'), 'edit');
  for (const stage of ['shaped', 'planned', 'reviewed', 'queued', 'building', 'built', 'killed']) {
    assert.equal(keyAction(stage, 'e'), null, stage);
  }
});
