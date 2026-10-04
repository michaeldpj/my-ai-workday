import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeRepoName } from './git.js';

// Checkout directory names can contain a space. The original guard used a
// character class without one, so every git call for such a repo returned
// early and its card reported nothing, silently and forever.
test('accepts the directory names that actually exist', () => {
  for (const name of ['Orion Works', 'Nova Solutions', 'Tycho Solutions',
                      'hollow-admin', 'hollow.example.com', 'LUX-MAPS', 'bramble.example.com']) {
    assert.equal(safeRepoName(name), true, name + ' should be scannable');
  }
});

// The name is joined onto the github root, so a traversal segment would point
// git at a directory outside it. Both of these passed the original guard.
test('refuses names that walk out of the repo root', () => {
  for (const name of ['.', '..', '../..', 'a/b', 'a\\b']) {
    assert.equal(safeRepoName(name), false, name + ' should be refused');
  }
});

test('refuses padding, empty, and non-strings', () => {
  for (const name of [' leading', 'trailing ', '', ' ', null, undefined, 42, {}]) {
    assert.equal(safeRepoName(name), false, JSON.stringify(name) + ' should be refused');
  }
});
