import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkField, buildCaptureFields, MODELS, WRITABLE } from '../../scripts/idea-fields.mjs';

test('MODELS is the four aliases the launcher passes to --model', () => {
  assert.deepEqual(MODELS, ['fable', 'opus', 'sonnet', 'haiku']);
});

test('model is writable from the app', () => {
  assert.ok(WRITABLE.has('model'));
});

test('checkField accepts each model alias and empty means inherit', () => {
  for (const m of MODELS) assert.equal(checkField('model', m), m);
  assert.equal(checkField('model', ''), null);
  assert.equal(checkField('model', null), null);
});

test('checkField refuses a model that is not an alias', () => {
  assert.throws(() => checkField('model', 'claude-fable-5-1'), /model must be one of/);
  assert.throws(() => checkField('model', 'gpt'), /model must be one of/);
  assert.throws(() => checkField('model', 'fable; rm -rf /'), /model must be one of/);
});

test('a capture carries model, and a capture without one stores null', () => {
  assert.equal(buildCaptureFields({ title: 'x', model: 'sonnet' }).model, 'sonnet');
  assert.equal(buildCaptureFields({ title: 'x' }).model, null);
});

test('the command-produced fields are still unreachable', () => {
  for (const key of ['stage', 'brief', 'planPath', 'reviewVerdict', 'github']) {
    assert.throws(() => checkField(key, 'x'), /not settable/);
  }
});

test('repos accepts a short list of safe names, from an array or a comma string', () => {
  assert.deepEqual(checkField('repos', ['hollow-app', 'hollow-app', 'my-day-api']), ['hollow-app', 'my-day-api']);
  assert.deepEqual(checkField('repos', 'a, b ,,'), ['a', 'b']);
  assert.deepEqual(checkField('repos', ''), []);
  assert.deepEqual(checkField('repos', null), []);
  assert.throws(() => checkField('repos', ['../x']), /repo/);
  assert.throws(() => checkField('repos', ['.hidden']), /repo/);
  assert.throws(() => checkField('repos', Array.from({ length: 11 }, (_, i) => 'r' + i)), /10/);
  assert.deepEqual(buildCaptureFields({ title: 't' }).repos, []);
  assert.deepEqual(buildCaptureFields({ title: 't', repos: 'x' }).repos, ['x']);
});
