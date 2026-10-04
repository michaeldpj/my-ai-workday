import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inFlightCount, IN_FLIGHT_STAGES } from './idea-model.js';

test('in flight is everything between inbox and built for one project', () => {
  const ideas = [
    { projectId: 'p', stage: 'inbox' }, { projectId: 'p', stage: 'shaped' }, { projectId: 'p', stage: 'building' },
    { projectId: 'p', stage: 'built' }, { projectId: 'p', stage: 'killed' }, { projectId: 'q', stage: 'queued' }, { projectId: null, stage: 'planned' },
  ];
  assert.equal(inFlightCount(ideas, 'p'), 2);
  assert.equal(inFlightCount(ideas, 'zzz'), 0);
  assert.deepEqual(IN_FLIGHT_STAGES, ['shaped', 'planned', 'reviewed', 'queued', 'building']);
});
