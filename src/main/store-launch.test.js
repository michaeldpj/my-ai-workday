import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adoptLaunchPolicy, POLICY_MARK } from './store.js';

/** The two calls adoptLaunchPolicy makes on an electron-store, over a plain object. */
function fakeStore(data) {
  return { data, get: (k, d) => (k in data ? data[k] : d), set: (k, v) => { data[k] = v; } };
}

test('the first start puts the bar on policy and keeps cli and reasoning', () => {
  const s = fakeStore({ launchPrefs: { cli: 'personal', model: 'fable', effort: 'xhigh' } });
  adoptLaunchPolicy(s);
  assert.deepEqual(s.data.launchPrefs, { cli: 'personal', model: 'policy', effort: 'xhigh' });
  assert.equal(s.data[POLICY_MARK], true);
});

test('a later explicit choice survives every later start', () => {
  const s = fakeStore({ launchPrefs: { cli: 'work', model: 'fable', effort: 'medium' } });
  adoptLaunchPolicy(s);
  s.set('launchPrefs', { cli: 'work', model: 'opus', effort: 'medium' });
  adoptLaunchPolicy(s);
  assert.equal(s.data.launchPrefs.model, 'opus');
});

test('a config with no launchPrefs gets the defaults with policy', () => {
  const s = fakeStore({});
  adoptLaunchPolicy(s);
  assert.deepEqual(s.data.launchPrefs, { cli: 'work', model: 'policy', effort: 'medium' });
});
