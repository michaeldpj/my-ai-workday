// Hunt: .claude/hunt-bug/kill-reset-buttons-do-nothing/report.md
// Electron's renderer implements window.alert and window.confirm but refuses
// window.prompt, throwing from the call site. A prompt-gated card action in the
// Ideas board therefore dies silently in the installed app while working in a
// browser. This guards the board module against a prompt() creeping back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

test('Ideas board never calls window.prompt, which Electron refuses', () => {
  const src = stripComments(readFileSync(join(here, 'ideas-ui.js'), 'utf8'));
  const calls = [...src.matchAll(/(?<![\w.])prompt\(/g)].map((m) => src.slice(0, m.index).split('\n').length);
  assert.deepEqual(calls, [], `prompt() called at ideas-ui.js lines ${calls.join(', ')}`);
});
