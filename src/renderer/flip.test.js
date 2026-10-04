import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flipDelta, shouldAnimate } from './flip.js';

test('flipDelta returns the from-minus-to offset', () => {
  assert.deepEqual(flipDelta({ left: 100, top: 40 }, { left: 20, top: 200 }), { dx: 80, dy: -160 });
});
test('shouldAnimate ignores sub-threshold moves', () => {
  assert.equal(shouldAnimate({ left: 0, top: 0 }, { left: 1, top: 1 }, 3), false);
  assert.equal(shouldAnimate({ left: 0, top: 0 }, { left: 0, top: 40 }, 3), true);
});
