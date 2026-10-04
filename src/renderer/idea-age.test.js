import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildingSince, buildingAge, formatAge, buildingStale,
  enteredStageAt, launchActive, launchAge, launchStale, builtStamp, builtAge, orderDone,
} from './idea-age.js';

const NOW = Date.parse('2026-09-03T12:00:00Z');
const ago = (ms) => new Date(NOW - ms).toISOString();
const HOUR = 3600000;

const building = (h, extra = {}) => ({
  stage: 'building',
  updatedAt: ago(h * HOUR),
  history: [
    { at: ago(9 * HOUR), from: 'reviewed', to: 'queued' },
    { at: ago(h * HOUR), from: 'queued', to: 'building' },
  ],
  ...extra,
});

test('the building moment comes from history, not the last edit', () => {
  const i = building(2, { updatedAt: ago(5 * 60000) });
  assert.equal(buildingSince(i), NOW - 2 * HOUR);
});

test('a later transition wins over an earlier one', () => {
  // Reset then re-execute: the card is building again, and the age is the
  // second run's, not the first.
  const i = {
    history: [
      { at: ago(20 * HOUR), from: 'queued', to: 'building' },
      { at: ago(19 * HOUR), from: 'building', to: 'queued' },
      { at: ago(30 * 60000), from: 'queued', to: 'building' },
    ],
  };
  assert.equal(buildingSince(i), NOW - 30 * 60000);
});

test('updatedAt is the fallback when there is no history', () => {
  assert.equal(buildingSince({ updatedAt: ago(HOUR) }), NOW - HOUR);
});

test('an age that cannot be told is null, not zero', () => {
  assert.equal(buildingSince({}), null);
  assert.equal(buildingSince({ updatedAt: 'not a date' }), null);
  assert.equal(buildingAge({}, NOW), null);
});

test('a stamp in the future reads as fresh rather than negative', () => {
  assert.equal(buildingAge({ updatedAt: new Date(NOW + HOUR).toISOString() }, NOW), 0);
});

test('formatAge is coarse on purpose', () => {
  assert.equal(formatAge(30 * 1000), 'just now');
  assert.equal(formatAge(12 * 60000), '12m');
  assert.equal(formatAge(59 * 60000), '59m');
  assert.equal(formatAge(6 * HOUR), '6h');
  assert.equal(formatAge(50 * HOUR), '2d');
  assert.equal(formatAge(null), '');
});

test('the stale threshold follows the effort rating', () => {
  assert.equal(buildingStale(building(2, { planEffort: 'low' }), NOW), true);
  assert.equal(buildingStale(building(2, { planEffort: 'medium' }), NOW), false);
  assert.equal(buildingStale(building(4, { planEffort: 'medium' }), NOW), true);
  assert.equal(buildingStale(building(4, { planEffort: 'high' }), NOW), false);
  assert.equal(buildingStale(building(7, { planEffort: 'high' }), NOW), true);
});

test('planEffort wins over the capture-time effort, and an unrated idea gets the default', () => {
  assert.equal(buildingStale(building(2, { effort: 'low', planEffort: 'high' }), NOW), false);
  assert.equal(buildingStale(building(2), NOW), false);
  assert.equal(buildingStale(building(4), NOW), true);
});

test('an unknown age is never stale, because an unknown is not evidence', () => {
  assert.equal(buildingStale({ stage: 'building' }, NOW), false);
});

// ── launch markers ───────────────────────────────────────────────────────────

const MIN = 60000;
const planned = (extra = {}) => ({
  stage: 'planned',
  createdAt: ago(30 * HOUR),
  history: [{ at: ago(10 * HOUR), from: 'shaped', to: 'planned' }],
  ...extra,
});

test('enteredStageAt reads the last entry into the current stage, else createdAt', () => {
  assert.equal(enteredStageAt(planned()), NOW - 10 * HOUR);
  assert.equal(enteredStageAt({ stage: 'inbox', createdAt: ago(2 * HOUR) }), NOW - 2 * HOUR);
  assert.equal(enteredStageAt({ stage: 'inbox' }), null);
});

test('a marker lights the rail while its stage matches and it postdates the stage entry', () => {
  const m = { action: 'review', stage: 'planned', at: NOW - 5 * MIN };
  assert.equal(launchActive(planned(), m), true);
});

test('a marker for another stage never lights the rail', () => {
  const m = { action: 'plan', stage: 'shaped', at: NOW - 5 * MIN };
  assert.equal(launchActive(planned(), m), false);
});

test('a marker older than the stage entry is a finished or reset session, not a live one', () => {
  const m = { action: 'review', stage: 'planned', at: NOW - 11 * HOUR };
  assert.equal(launchActive(planned(), m), false);
});

test('with no history the createdAt fallback still admits a fresh marker', () => {
  const idea = { stage: 'inbox', createdAt: ago(2 * HOUR) };
  assert.equal(launchActive(idea, { action: 'brainstorm', stage: 'inbox', at: NOW - MIN }), true);
});

test('a marker missing or malformed is not active', () => {
  assert.equal(launchActive(planned(), null), false);
  assert.equal(launchActive(planned(), { action: 'review', stage: 'planned', at: 'soon' }), false);
  assert.equal(launchActive(null, { action: 'review', stage: 'planned', at: NOW }), false);
});

test('the launch rail goes stale at twenty minutes, and an unknown age never does', () => {
  assert.equal(launchStale({ at: NOW - 19 * MIN }, NOW), false);
  assert.equal(launchStale({ at: NOW - 20 * MIN }, NOW), true);
  assert.equal(launchStale({ at: 'nope' }, NOW), false);
  assert.equal(launchAge({ at: NOW - 3 * MIN }, NOW), 3 * MIN);
  assert.equal(launchAge({}, NOW), null);
});

const DAY = 24 * HOUR;
const builtCard = (id, days, extra = {}) => ({
  id, stage: 'built', impact: 1, createdAt: '2026-08-01T00:00:00Z', updatedAt: ago(0),
  history: [{ at: ago(days * DAY + HOUR), to: 'building' }, { at: ago(days * DAY), to: 'built' }], ...extra,
});
const shippedCard = (id, impact, createdAt = '2026-08-01T00:00:00Z') => ({ id, stage: 'shipped', impact, createdAt, history: [] });
const byImpact = (a, b) => (b.impact - a.impact) || a.createdAt.localeCompare(b.createdAt);

test('builtStamp is the last entry into built, as an ISO string', () => {
  const i = builtCard('a', 4);
  i.history.push({ at: ago(DAY), to: 'killed' }, { at: ago(2 * DAY), to: 'built' });
  assert.equal(builtStamp(i), ago(2 * DAY));
});

test('builtStamp falls back to updatedAt, then to empty', () => {
  assert.equal(builtStamp({ stage: 'built', history: [], updatedAt: ago(HOUR) }), ago(HOUR));
  assert.equal(builtStamp({ stage: 'built' }), '');
});

test('builtAge reads the same stamp, clamps a future one to zero, and is null without one', () => {
  assert.equal(builtAge(builtCard('a', 2), NOW), 2 * DAY);
  assert.equal(builtAge({ stage: 'built', updatedAt: new Date(NOW + HOUR).toISOString() }, NOW), 0);
  assert.equal(builtAge({ stage: 'built' }, NOW), null);
});

test('Done puts built cards first, longest waiting first, above higher-impact shipped cards', () => {
  const rows = [shippedCard('s5', 5), builtCard('b1', 1), shippedCard('s2', 2), builtCard('b8', 8), builtCard('b3', 3)];
  assert.deepEqual(orderDone(rows, byImpact).map((i) => i.id), ['b8', 'b3', 'b1', 's5', 's2']);
});

test('Done breaks a built tie on createdAt and puts an undatable built card last among built', () => {
  const twin = (id, createdAt) => ({ ...builtCard(id, 2), createdAt });
  const rows = [twin('later', '2026-08-02T00:00:00Z'), { id: 'nodate', stage: 'built', createdAt: '2026-07-01T00:00:00Z' }, twin('earlier', '2026-08-01T00:00:00Z')];
  assert.deepEqual(orderDone(rows, byImpact).map((i) => i.id), ['earlier', 'later', 'nodate']);
});

test('orderDone does not reorder the input array', () => {
  const rows = [shippedCard('s', 1), builtCard('b', 1)];
  orderDone(rows, byImpact);
  assert.deepEqual(rows.map((i) => i.id), ['s', 'b']);
});
