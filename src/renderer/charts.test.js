import { test } from 'node:test';
import assert from 'node:assert/strict';
import { barStrip, hBars, pairedWeeks, stackedRows } from './charts.js';

test('barStrip renders one path per non-zero segment and skips zero segments', () => {
  const svg = barStrip({
    series: [{ key: 'commit', values: [2, 0] }, { key: 'session', values: [0, 1] }],
    labels: ['2026-09-01', '2026-09-02'],
  });
  assert.equal((svg.match(/class="ch-commit"/g) || []).length, 1);
  assert.equal((svg.match(/class="ch-session"/g) || []).length, 1);
  assert.match(svg, /<svg/);
});

test('barStrip labels only every 7th day', () => {
  const labels = Array.from({ length: 14 }, (_, i) => `d${i}`);
  const svg = barStrip({ series: [{ key: 'commit', values: labels.map(() => 1) }], labels });
  const count = (svg.match(/class="ch-label"/g) || []).length;
  assert.equal(count, 2, 'labels at index 0 and 7');
});

test('barStrip on empty input returns an svg with a muted No data text', () => {
  const svg = barStrip({ series: [], labels: [] });
  assert.match(svg, /<svg/);
  assert.match(svg, /No data/);
  assert.match(svg, /class="ch-empty"/);
});

test('hBars escapes a label containing <', () => {
  const svg = hBars({ rows: [{ label: '<script>', value: 3 }] });
  assert.doesNotMatch(svg, /<script>/);
  assert.match(svg, /&lt;script&gt;/);
});

test('hBars uses the given key class, defaulting to ch-commit', () => {
  const svg = hBars({ rows: [{ label: 'a', value: 1 }, { label: 'b', value: 2, key: 'pr' }] });
  assert.match(svg, /class="ch-commit"/);
  assert.match(svg, /class="ch-pr"/);
});

test('hBars on empty input returns No data', () => {
  const svg = hBars({ rows: [] });
  assert.match(svg, /No data/);
});

test('pairedWeeks draws a bar per non-zero value', () => {
  const svg = pairedWeeks({ weeks: [{ label: 'w1', a: 2, b: 1 }, { label: 'w2', a: 0, b: 3 }], keys: ['pr', 'pr'] });
  assert.equal((svg.match(/class="ch-pr"/g) || []).length, 3);
});

test('pairedWeeks on empty input returns No data', () => {
  const svg = pairedWeeks({ weeks: [] });
  assert.match(svg, /No data/);
});

test('stackedRows renders one path per non-zero part and a 0 label for an empty row', () => {
  const svg = stackedRows({
    rows: [
      { label: 'twig', parts: [{ key: 'commit', value: 3 }, { key: 'idea', value: 0 }] },
      { label: 'empty', parts: [{ key: 'commit', value: 0 }] },
    ],
  });
  assert.equal((svg.match(/class="ch-commit"/g) || []).length, 1);
  assert.equal((svg.match(/class="ch-idea"/g) || []).length, 0);
  assert.match(svg, /class="ch-value">0</);
});

test('stackedRows on empty input returns No data', () => {
  const svg = stackedRows({ rows: [] });
  assert.match(svg, /No data/);
});

test('barStrip labelEvery controls the x-axis label cadence', () => {
  const svg = barStrip({ series: [{ key: 'commit', values: [1, 1, 1] }], labels: ['a', 'b', 'c'], labelEvery: 1 });
  assert.equal((svg.match(/class="ch-label"/g) || []).length, 3);
});

test('pairedWeeks draws nothing for a zero value', () => {
  const svg = pairedWeeks({ weeks: [{ label: 'w', a: 0, b: 2 }], keys: ['pr', 'idea'] });
  assert.equal((svg.match(/<path/g) || []).length, 1);
});
