// app.js builds the dashboard from strings, and no test can import it (it
// calls init() against window.electronAPI on load). These checks read the
// source and hold the rules from
// docs/plans/2026-10-01-workspace-validation-and-escaping.md: every
// inline-handler string argument goes through jsAttr, and every restricted
// workspace field or id reaches markup through esc or jsAttr.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
// Comments are blanked rather than removed, so reported line numbers match the file.
const lines = readFileSync(join(here, 'app.js'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ''))
  .replace(/^[ \t]*\/\/[^\n]*/gm, '')
  .split('\n');
// Toasts, confirm dialogs and querySelector strings are text, not markup.
const NOT_MARKUP = /showToast\(|confirm\(|querySelector\(/;
const offending = (re) => lines.flatMap((l, i) => (re.test(l) && !NOT_MARKUP.test(l) ? [i + 1] : []));

test('jsEsc is gone', () => {
  assert.deepEqual(offending(/\bjsEsc\b/), []);
});

test('every inline-handler string argument goes through jsAttr', () => {
  assert.deepEqual(offending(/\\'' \+ (?!jsAttr\()/), [], "write \\'' + jsAttr(x) + '\\'");
  assert.deepEqual(offending(/\\'[\w-]+' \+ /), [], "build the whole id inside jsAttr('cm-' + k)");
});

test('restricted fields and ids reach markup through esc', () => {
  assert.deepEqual(offending(/' \+ \(?(?:(?:p|r|l)\.(?:id|status|platform|priority|focusTone|blockedSince)\b|SL\[)/), []);
  assert.deepEqual(offending(/' \+ (?:pid|lid|k|pl) \+ '/), []);
});

test('clipboard lines take repo paths from shellRepoPath, never a literal root', () => {
  assert.deepEqual(offending(/~\/github/), []);
  const timeline = readFileSync(join(here, 'timeline-ui.js'), 'utf8');
  assert.equal(/~\/github/.test(timeline), false, 'timeline-ui.js copies through window.repoPath');
});
