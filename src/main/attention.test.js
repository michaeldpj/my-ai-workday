import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeSince } from './attention.js';

const fresh = { dirty: '2026-09-03T10:00:00Z', unpushed: '2026-09-01T10:00:00Z', branches: {} };

test('first sighting stores the scan dates', () => {
  assert.deepEqual(mergeSince(undefined, fresh), { dirty: '2026-09-03T10:00:00Z', unpushed: '2026-09-01T10:00:00Z' });
});

test('an earlier memory wins over a fresher mtime', () => {
  const prev = { dirty: '2026-08-20T10:00:00Z', unpushed: null };
  assert.deepEqual(mergeSince(prev, fresh), { dirty: '2026-08-20T10:00:00Z', unpushed: '2026-09-01T10:00:00Z' });
});

test('an earlier scan date wins over a later memory', () => {
  const prev = { dirty: '2026-09-04T10:00:00Z', unpushed: '2026-09-02T10:00:00Z' };
  assert.deepEqual(mergeSince(prev, fresh), { dirty: '2026-09-03T10:00:00Z', unpushed: '2026-09-01T10:00:00Z' });
});

test('a clean scan clears the memory', () => {
  const prev = { dirty: '2026-08-20T10:00:00Z', unpushed: '2026-08-20T10:00:00Z' };
  assert.deepEqual(mergeSince(prev, { dirty: null, unpushed: null, branches: {} }), { dirty: null, unpushed: null });
});
