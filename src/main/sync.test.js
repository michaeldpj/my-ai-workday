import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pullDecision } from './sync.js';

const good = { ws: [{ id: 'hollow', repos: [], tasks: [] }] };

test('an unchanged answer adopts nothing and stays connected', () => {
  assert.deepEqual(pullDecision({ changed: false, version: 7 }),
    { adopt: null, version: null, status: 'connected', reason: null });
});

test('a valid changed workspace is adopted with its version', () => {
  assert.deepEqual(pullDecision({ changed: true, version: 8, workspace: good }),
    { adopt: good, version: 8, status: 'connected', reason: null });
});

test('a failing workspace is refused whole and carries the reason', () => {
  const d = pullDecision({ changed: true, version: 9, workspace: { ws: [{ id: "x');alert(1);('", repos: [], tasks: [] }] } });
  assert.equal(d.adopt, null);
  assert.equal(d.version, null);
  assert.equal(d.status, 'rejected');
  assert.match(d.reason, /^ws\[0\]\.id /);
});

test('a changed answer with no workspace is refused, not read as connected', () => {
  const d = pullDecision({ changed: true, version: 9, workspace: null });
  assert.equal(d.adopt, null);
  assert.equal(d.status, 'rejected');
});

test('a version that is not a whole number is refused', () => {
  const d = pullDecision({ changed: true, version: '9; drop', workspace: good });
  assert.equal(d.adopt, null);
  assert.equal(d.status, 'rejected');
  assert.match(d.reason, /^version /);
});
