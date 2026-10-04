import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePrStates } from './git.js';

test('maps head branches to states, newest wins on duplicates', () => {
  const json = JSON.stringify([
    { number: 9, headRefName: 'claude/fix', state: 'OPEN' },
    { number: 3, headRefName: 'claude/fix', state: 'CLOSED' },
    { number: 5, headRefName: 'claude/old', state: 'MERGED' },
  ]);
  assert.deepEqual(parsePrStates(json), { 'claude/fix': 'OPEN', 'claude/old': 'MERGED' });
});

test('newest wins regardless of gh output order', () => {
  const json = JSON.stringify([
    { number: 3, headRefName: 'claude/fix', state: 'MERGED' },
    { number: 9, headRefName: 'claude/fix', state: 'OPEN' },
  ]);
  assert.deepEqual(parsePrStates(json), { 'claude/fix': 'OPEN' });
});

test('malformed input yields an empty map', () => {
  assert.deepEqual(parsePrStates('not json'), {});
  assert.deepEqual(parsePrStates('{"a":1}'), {});
});
