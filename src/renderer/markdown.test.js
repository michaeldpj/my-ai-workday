import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mdInline, renderMarkdown } from './markdown.js';

test('escapes html before formatting', () => {
  assert.equal(mdInline('<b>x</b> **y**'), '&lt;b&gt;x&lt;/b&gt; <strong>y</strong>');
});

test('renders http and https links, leaves other schemes as text', () => {
  assert.equal(
    mdInline('see [docs](https://example.com/a?b=1)'),
    'see <a href="https://example.com/a?b=1" target="_blank" rel="noopener">docs</a>',
  );
  assert.equal(mdInline('[x](javascript:alert(1))'), '[x](javascript:alert(1))');
});

test('link text and href are escaped', () => {
  assert.equal(
    mdInline('[<i>](https://e.com/"onclick="x)'),
    '<a href="https://e.com/&quot;onclick=&quot;x" target="_blank" rel="noopener">&lt;i&gt;</a>',
  );
});

test('underscores and asterisks inside a link href are left alone', () => {
  assert.equal(
    mdInline('[a](https://x.com/a_b_c) and _em_'),
    '<a href="https://x.com/a_b_c" target="_blank" rel="noopener">a</a> and <em>em</em>',
  );
});

test('fenced code is escaped verbatim with no inline formatting', () => {
  const html = renderMarkdown('before\n```bash\ngit log **HEAD** <x>\n```\nafter');
  assert.equal(html, '<p>before</p><pre><code>git log **HEAD** &lt;x&gt;</code></pre><p>after</p>');
});

test('an unterminated fence still closes at end of input', () => {
  assert.equal(renderMarkdown('```\na\nb'), '<pre><code>a\nb</code></pre>');
});

test('existing block forms are unchanged', () => {
  assert.equal(renderMarkdown('## H\n- a\n- b\n\n1. c'), '<h2>H</h2><ul><li>a</li><li>b</li></ul><ol><li>c</li></ol>');
});
