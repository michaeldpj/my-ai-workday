import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ideaComparator, SORT_MODES, DEFAULT_SORT, effortOf, EFFORT_RANK } from './idea-sort.js';

/** Terse fixture: an id doubling as the created stamp keeps tie-breaks readable. */
const idea = (id, o = {}) => ({ id, createdAt: `2026-01-${id}T00:00:00.000Z`, ...o });
const order = (rows, mode) => rows.slice().sort(ideaComparator(mode)).map((i) => i.id);

test('the default is impact and it is one of the offered modes', () => {
  assert.equal(DEFAULT_SORT, 'impact');
  assert.ok(SORT_MODES.includes(DEFAULT_SORT));
});

test('impact sorts high at the top', () => {
  const rows = [idea('01', { impact: 2 }), idea('02', { impact: 5 }), idea('03', { impact: 3 })];
  assert.deepEqual(order(rows, 'impact'), ['02', '03', '01']);
});

test('a card with no impact sorts last, not among the ones', () => {
  const rows = [idea('01'), idea('02', { impact: 1 }), idea('03', { impact: 4 })];
  assert.deepEqual(order(rows, 'impact'), ['03', '02', '01']);
});

test('effort sorts high first and prefers planEffort over the capture guess', () => {
  const rows = [
    idea('01', { effort: 'low' }),
    idea('02', { effort: 'low', planEffort: 'high' }),
    idea('03', { effort: 'medium' }),
  ];
  assert.deepEqual(order(rows, 'effort'), ['02', '03', '01']);
});

test('an unrated card sorts last under effort', () => {
  const rows = [idea('01'), idea('02', { effort: 'low' })];
  assert.deepEqual(order(rows, 'effort'), ['02', '01']);
});

test('project sorts on the id the card displays', () => {
  // The chip renders projectId raw, so the column has to order by that or the
  // order is invisible. Real ids can diverge hard from names.
  const rows = [idea('01', { projectId: 'myday' }), idea('02', { projectId: 'birch' }), idea('03', { projectId: 'twig' })];
  assert.deepEqual(order(rows, 'project'), ['02', '01', '03']);
});

test('project sorting is case-insensitive', () => {
  const rows = [idea('01', { projectId: 'Zebra' }), idea('02', { projectId: 'apple' })];
  assert.deepEqual(order(rows, 'project'), ['02', '01']);
});

test('a card with no project sorts last', () => {
  const rows = [idea('01'), idea('02', { projectId: 'myday' })];
  assert.deepEqual(order(rows, 'project'), ['02', '01']);
});

test('effortOf prefers the plan rating and reports nothing as empty', () => {
  assert.equal(effortOf({ effort: 'low', planEffort: 'high' }), 'high');
  assert.equal(effortOf({ effort: 'low' }), 'low');
  assert.equal(effortOf({}), '');
  assert.equal(effortOf(null), '');
});

test('EFFORT_RANK is the scale the card meter lights, low to high', () => {
  assert.deepEqual(EFFORT_RANK, { low: 1, medium: 2, high: 3 });
});

test('every mode breaks ties on createdAt, oldest first', () => {
  for (const mode of SORT_MODES) {
    const rows = [
      idea('03', { impact: 3, effort: 'low', projectId: 'myday' }),
      idea('01', { impact: 3, effort: 'low', projectId: 'myday' }),
      idea('02', { impact: 3, effort: 'low', projectId: 'myday' }),
    ];
    assert.deepEqual(order(rows, mode), ['01', '02', '03'], mode);
  }
});

test('a stale or unknown mode degrades to impact rather than emptying the column', () => {
  const rows = [idea('01', { impact: 2 }), idea('02', { impact: 5 })];
  assert.deepEqual(order(rows, 'nonsense'), ['02', '01']);
  assert.deepEqual(order(rows, undefined), ['02', '01']);
});

test('no mode mutates the ideas it compares', () => {
  // Frozen rows in an ES module (strict mode) throw on any write, so a
  // comparator that reached for a cached key on the idea would fail here.
  for (const mode of SORT_MODES) {
    const rows = [
      Object.freeze(idea('01', { impact: 1, effort: 'high', projectId: 'twig' })),
      Object.freeze(idea('02', { impact: 9, effort: 'low', projectId: 'birch' })),
      Object.freeze(idea('03')),
    ];
    assert.doesNotThrow(() => rows.slice().sort(ideaComparator(mode)), mode);
  }
});
