#!/usr/bin/env node
// session-issue-gate.mjs: makes /session-issue hard to forget for sessions that push.
//
// Three modes, all fed hook JSON on stdin:
//   mark  (PostToolUse/Bash)  a `git push` writes a per-project debt marker
//                             carrying this session's id
//   clear (PostToolUse/Bash)  a `gh issue create ... session-log`, or a
//                             `gh issue edit|comment` updating an existing
//                             record (e.g. an idea issue), pays the debt
//   stop  (Stop)              if THIS session owes a marker, block the stop
//                             once with instructions, never twice
//
// The marker lives at $CLAUDE_PROJECT_DIR/.claude/.session-issue-due. Branch
// deletion and tag-only pushes don't create debt. Written in Node so it needs
// no jq. Fail-safe: any problem exits 0, because this is a gate on forgetting,
// not a jail.

import fs from 'node:fs';
import path from 'node:path';

const PUSH = /(^|&&|\|\||;|\()\s*git(\s+-C\s+("[^"]*"|'[^']*'|\S+))?\s+push\b/;
const NO_DEBT = /--delete|--tags\s*$/;
const REASON = 'This session pushed commits but never logged a session record. Run the /idea-pipeline:session-issue skill now to create or update the session record: a new closed session-log GitHub issue, or an update to an existing issue that already tracks this work (such as an open idea issue). The marker clears automatically when the issue is created or updated. If every push this session was genuinely trivial or docs-only and no record is warranted, say so to the user and remove .claude/.session-issue-due, then stop. This gate fires only once per session.';

function readMarker(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function run(mode, input) {
  const dir = path.join(process.env.CLAUDE_PROJECT_DIR || process.cwd(), '.claude');
  const marker = path.join(dir, '.session-issue-due');
  const cmd = String(input?.tool_input?.command || '');
  const sid = String(input?.session_id || '');

  if (mode === 'mark') {
    if (!cmd || !PUSH.test(cmd) || NO_DEBT.test(cmd) || !sid) return;
    // One nudge per session: never demote warned=true back to false.
    if (readMarker(marker)?.session_id === sid) return;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(marker, JSON.stringify({ session_id: sid, warned: false }) + '\n');
  } else if (mode === 'clear') {
    const paid = cmd.includes('gh issue create')
      ? cmd.includes('session-log')
      : /gh issue (edit|comment)/.test(cmd);
    if (paid) fs.rmSync(marker, { force: true });
  } else if (mode === 'stop') {
    const m = readMarker(marker);
    if (!m || !sid || m.session_id !== sid || input?.stop_hook_active === true || m.warned === true) return;
    fs.writeFileSync(marker, JSON.stringify({ session_id: sid, warned: true }) + '\n');
    return JSON.stringify({ decision: 'block', reason: REASON }) + '\n';
  }
  return '';
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { raw += chunk; });
process.stdin.on('end', () => {
  let out = '';
  try { out = run(process.argv[2], JSON.parse(raw || '{}')) || ''; } catch { /* fail open */ }
  // Exit only after stdout drains.
  process.stdout.write(out, () => process.exit(0));
});
