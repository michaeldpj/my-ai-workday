/**
 * Regression: .claude/hunt-bug/brainstorm-launch-no-repo/report.md
 *
 * The launcher used the idea's own repo list as the session directory, and
 * that list is written by /idea-brainstorm itself, so Brainstorm was the one
 * action guaranteed to have nothing to launch into.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLaunchRepo, stageCommand } from './terminal.js';
import { safeRepoName } from './git.js';

const WS = [
  { id: 'hollow', name: 'Hollow', repos: [{ name: 'hollow-app' }, { name: 'hollow.example.com' }] },
  { id: 'empty', name: 'Empty', repos: [] },
];

test('an idea that has been brainstormed launches in its own first repo', () => {
  const idea = { projectId: 'hollow', repos: ['hollow.example.com', 'hollow-app'] };
  assert.deepEqual(resolveLaunchRepo(idea, WS), { repo: 'hollow.example.com' });
});

test('an inbox idea with no repos yet launches in its project first repo', () => {
  const idea = { projectId: 'hollow', repos: [] };
  assert.deepEqual(resolveLaunchRepo(idea, WS), { repo: 'hollow-app' });
});

test('an idea with no project at all is refused, and the error says so', () => {
  const { repo, error } = resolveLaunchRepo({ projectId: null, repos: [] }, WS);
  assert.equal(repo, undefined);
  assert.match(error, /no project/);
});

test('a project that is not on the board is refused by name', () => {
  const { error } = resolveLaunchRepo({ projectId: 'deleted', repos: [] }, WS);
  assert.match(error, /"deleted"/);
  assert.match(error, /not on the board/);
});

test('a project carrying no repos is refused, and reads differently from a missing one', () => {
  const { error } = resolveLaunchRepo({ projectId: 'empty', repos: [] }, WS);
  assert.match(error, /no repos/);
});

test('a missing workspace is a refusal, not a throw', () => {
  assert.doesNotThrow(() => resolveLaunchRepo({ projectId: 'hollow' }, undefined));
  assert.ok(resolveLaunchRepo({ projectId: 'hollow' }, undefined).error);
});

test('a project repo whose directory name has a space is still launchable', () => {
  // Three real checkouts have one. The launcher used to reject them by name
  // before the realpath confinement ever ran.
  const ws = [{ id: 'loom-logos', repos: [{ name: 'Orion Works' }] }];
  const { repo } = resolveLaunchRepo({ projectId: 'loom-logos', repos: [] }, ws);
  assert.equal(repo, 'Orion Works');
  assert.ok(safeRepoName(repo), 'the launcher must accept what the fallback resolves');
});

test('stageCommand builds the slash command a stage is typed as', () => {
  assert.deepEqual(stageCommand('brainstorm', 'idea-a1b2-c3d4'),
    { ok: true, command: '/idea-brainstorm idea-a1b2-c3d4' });
  assert.equal(stageCommand('reset', 'idea-a1b2-c3d4').command, '/idea-reset idea-a1b2-c3d4');
});

test('stageCommand covers the two transitions the board performs itself', () => {
  // queue and kill are not launchable, so they are absent from ACTIONS. The
  // copy button still has to be able to hand you the command for them.
  assert.equal(stageCommand('queue', 'idea-a1b2-c3d4').command, '/idea-queue idea-a1b2-c3d4');
  assert.equal(stageCommand('kill', 'idea-a1b2-c3d4').command, '/idea-kill idea-a1b2-c3d4');
});

test('stageCommand refuses what the launcher refuses', () => {
  assert.match(stageCommand('rm -rf', 'idea-a1b2-c3d4').error, /unknown action/);
  assert.match(stageCommand('plan', 'idea-a1b2-c3d4; rm -rf /').error, /malformed idea id/);
  assert.match(stageCommand('plan', 'nope').error, /malformed idea id/);
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CLI_KEYS, EFFORTS, worktreeName, sessionName, buildCommand, claudeConfigDir, launchableActions, launchSession } from './terminal.js';

const PARTS = {
  cwd: '/Users/me/github/hollow-app', cli: 'work', model: 'fable', effort: 'medium',
  worktree: 'idea-dark-mode-c3d4', name: 'Dark mode', slash: 'idea-brainstorm', ideaId: 'idea-a1b2-c3d4',
};

test('buildCommand for the work cli runs bare claude with a worktree, name, model, and effort', () => {
  assert.deepEqual(buildCommand(PARTS), {
    ok: true,
    command: "cd '/Users/me/github/hollow-app' && claude -w idea-dark-mode-c3d4 -n 'Dark mode' --model fable --effort medium /idea-brainstorm idea-a1b2-c3d4",
  });
});

test('buildCommand quotes a session name with an apostrophe so it cannot end the string', () => {
  const { command } = buildCommand({ ...PARTS, name: "Fix Sam's board" });
  assert.ok(command.includes(`-n 'Fix Sam'\\''s board' `));
});

test('buildCommand for the personal cli sets the configured folder itself, not through an alias', () => {
  const dir = '/Users/me/.claude-personal';
  const { command } = buildCommand({ ...PARTS, cli: 'personal', personalDir: dir });
  assert.equal(command,
    `cd '/Users/me/github/hollow-app' && CLAUDE_CONFIG_DIR='${dir}' claude -w idea-dark-mode-c3d4 -n 'Dark mode' --model fable --effort medium /idea-brainstorm idea-a1b2-c3d4`);
  assert.deepEqual(CLI_KEYS, ['work', 'personal']);
});

test('buildCommand refuses the personal cli without a safe folder', () => {
  assert.match(buildCommand({ ...PARTS, cli: 'personal' }).error, /no personal Claude folder/);
  assert.match(buildCommand({ ...PARTS, cli: 'personal', personalDir: "/x/it's" }).error, /personal Claude folder/);
  assert.match(buildCommand({ ...PARTS, cli: 'personal', personalDir: '/x/a b' }).error, /personal Claude folder/);
});

test('buildCommand for the work cli ignores any personal folder', () => {
  const { command } = buildCommand({ ...PARTS, personalDir: '/Users/me/.claude-personal' });
  assert.ok(!command.includes('CLAUDE_CONFIG_DIR'));
});

test('claudeConfigDir picks ~/.claude for work and the folder for personal', () => {
  assert.equal(claudeConfigDir('work', '/p'), path.join(os.homedir(), '.claude'));
  assert.equal(claudeConfigDir('personal', '/p'), '/p');
  assert.equal(claudeConfigDir('personal', ''), null);
});

test('launchableActions lists only the stage skills present on disk', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-'));
  for (const slash of ['idea-plan', 'idea-review']) {
    fs.mkdirSync(path.join(root, 'skills', slash), { recursive: true });
    fs.writeFileSync(path.join(root, 'skills', slash, 'SKILL.md'), '# x\n');
  }
  fs.mkdirSync(path.join(root, 'skills', 'idea-execute'), { recursive: true }); // folder without SKILL.md
  assert.deepEqual(launchableActions(root), ['plan', 'review']);
  assert.deepEqual(launchableActions(path.join(root, 'missing')), []);
  assert.deepEqual(launchableActions(null), []);
  fs.rmSync(root, { recursive: true, force: true });
});

test('launchSession refuses a stage whose skill the chosen CLI lacks, before any terminal opens', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'noskills-'));
  const res = await launchSession('plan', 'idea-a1b2-c3d4', 'hollow-app', root,
    { ...PARTS, cli: 'personal', personalDir: root });
  assert.deepEqual(res, { ok: false, error: '/idea-plan is not installed for the personal CLI' });
  fs.rmSync(root, { recursive: true, force: true });
});

test('buildCommand accepts every model and effort the enums list', () => {
  for (const model of ['fable', 'opus', 'sonnet', 'haiku']) {
    assert.ok(buildCommand({ ...PARTS, model }).command.includes(`--model ${model} `));
  }
  for (const effort of EFFORTS) {
    assert.ok(buildCommand({ ...PARTS, effort }).command.includes(`--effort ${effort} `));
  }
  assert.deepEqual(EFFORTS, ['low', 'medium', 'high', 'xhigh', 'max']);
});

test('buildCommand quotes a directory with a space', () => {
  const { command } = buildCommand({ ...PARTS, cwd: '/Users/me/github/Orion Works' });
  assert.ok(command.startsWith("cd '/Users/me/github/Orion Works' && "));
});

test('buildCommand refuses anything off the enums', () => {
  assert.match(buildCommand({ ...PARTS, cli: 'root' }).error, /unknown cli/);
  assert.match(buildCommand({ ...PARTS, cli: 'constructor' }).error, /unknown cli/);
  assert.match(buildCommand({ ...PARTS, model: 'claude-fable-5-1' }).error, /unknown model/);
  assert.match(buildCommand({ ...PARTS, effort: 'ultra' }).error, /unknown effort/);
  assert.match(buildCommand({ ...PARTS, worktree: 'idea x; rm -rf /' }).error, /malformed worktree/);
  assert.match(buildCommand({ ...PARTS, worktree: '' }).error, /malformed worktree/);
});

test('worktreeName slugs the title and keeps the id tail', () => {
  assert.equal(worktreeName('Dark mode for the board', 'idea-a1b2-c3d4'), 'idea-dark-mode-for-the-board-c3d4');
  assert.equal(worktreeName('  Fix: PR #12 (again!)  ', 'idea-a1b2-c3d4'), 'idea-fix-pr-12-again-c3d4');
});

test('worktreeName with no usable characters is just the tail', () => {
  assert.equal(worktreeName('!!!', 'idea-a1b2-c3d4'), 'idea-c3d4');
  assert.equal(worktreeName('', 'idea-a1b2-c3d4'), 'idea-c3d4');
  assert.equal(worktreeName('日本語のみ', 'idea-a1b2-c3d4'), 'idea-c3d4');
});

test('sessionName keeps an ordinary title and tidies whitespace', () => {
  assert.equal(sessionName('Dark mode', 'idea-a1b2-c3d4'), 'Dark mode');
  assert.equal(sessionName('  Dark   mode\tfor the\nboard  ', 'idea-a1b2-c3d4'), 'Dark mode for the board');
});

test('sessionName strips control characters and cuts at eighty', () => {
  assert.equal(sessionName('a\u0000b\u001bc', 'idea-a1b2-c3d4'), 'abc');
  assert.equal(sessionName('x'.repeat(100), 'idea-a1b2-c3d4'), 'x'.repeat(80));
});

test('sessionName falls back to the id when nothing is left', () => {
  assert.equal(sessionName('', 'idea-a1b2-c3d4'), 'idea-a1b2-c3d4');
  assert.equal(sessionName('\u0007\n', 'idea-a1b2-c3d4'), 'idea-a1b2-c3d4');
});

test('worktreeName cuts a long title at forty characters without a dangling hyphen', () => {
  // 39 a's then a hyphen: the cut at forty lands on the hyphen, which is stripped.
  const name = worktreeName('a'.repeat(39) + ' bb cc dd', 'idea-a1b2-c3d4');
  assert.equal(name, `idea-${'a'.repeat(39)}-c3d4`);
  assert.ok(/^[a-z0-9-]{1,64}$/.test(name));
});
