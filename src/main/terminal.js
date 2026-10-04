/**
 * Terminal launcher.
 *
 * This is the one place the app starts something rather than copying it to the
 * clipboard. It still writes nothing to any repo: it opens a terminal running
 * a Claude Code command, and Claude Code prompts before it touches a file.
 *
 * Nothing from the renderer reaches AppleScript. The caller names an ACTION
 * from a frozen list and an idea id; the command string is built here.
 */

import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { safeRepoName } from './git.js';
import { safeDirPath } from '../renderer/workspace-model.js';
import { MODELS } from '../../scripts/idea-fields.mjs';

/** action -> slash command. A caller cannot express anything not on this list. */
const ACTIONS = Object.freeze({
  brainstorm: 'idea-brainstorm',
  plan: 'idea-plan',
  review: 'idea-review',
  execute: 'idea-execute',
  ship: 'idea-ship',
  reset: 'idea-reset',
  revise: 'idea-revise',
  reopen: 'idea-reopen',
});

/**
 * Stage commands that exist as skills but are NOT launchable from the app,
 * because the board performs those two transitions itself through the store.
 * They are here only so the copy button can hand you the command a reviewed
 * card's decision would be typed as. Kept apart from ACTIONS so widening what
 * can be copied never widens what can be launched.
 */
const COPY_ONLY = Object.freeze({
  queue: 'idea-queue',
  kill: 'idea-kill',
});

const ID_RE = /^idea-[a-z0-9]+-[a-z0-9]+$/;

/**
 * Which Claude configuration runs the session. `work` is plain `claude`,
 * which reads ~/.claude. `personal` sets CLAUDE_CONFIG_DIR to the folder
 * named in Settings, because a shell alias is not something a
 * non-interactive shell has. The folder is validated in main twice (on save
 * and here) and shell-quoted, so nothing from the renderer reaches
 * AppleScript unchecked.
 */
export const CLI_KEYS = Object.freeze(['work', 'personal']);

/** The config folder a launched session reads, or null when personal has none. */
export function claudeConfigDir(cli, personalDir) {
  return cli === 'personal' ? (personalDir || null) : path.join(os.homedir(), '.claude');
}

/**
 * The stage actions whose skill exists in a config folder. A plain file
 * check: skills that arrive through a plugin are not seen, and the launch
 * falls back to the copy button for them.
 */
export function launchableActions(configDir) {
  if (!configDir) return [];
  return Object.keys(ACTIONS).filter((a) => fs.existsSync(path.join(configDir, 'skills', ACTIONS[a], 'SKILL.md')));
}

/** What `claude --effort` accepts. The UI calls this reasoning, to keep it apart from an idea's effort. */
export const EFFORTS = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']);

const WORKTREE_RE = /^[a-z0-9-]{1,64}$/;

/**
 * `idea-<slug>-<tail>`: the title, lowercased and reduced to hyphenated
 * alphanumerics and cut at forty, plus the last segment of the id so two
 * ideas with one title never share a checkout. Claude Code reuses a worktree
 * whose name already exists, so every stage of one idea lands in one place.
 */
export function worktreeName(title, ideaId) {
  const tail = String(ideaId).split('-').pop();
  const slug = String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return slug ? `idea-${slug}-${tail}` : `idea-${tail}`;
}

/**
 * What `claude -n` shows in the prompt box, the resume picker, and the
 * terminal title: the card's title. It is free text from ideas.json, so it is
 * reduced to printable characters, single-spaced, and capped before it is
 * shell-quoted. Empty falls back to the id so the session is still named.
 */
export function sessionName(title, ideaId) {
  const clean = String(title || '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .trim();
  return clean || ideaId;
}

/**
 * The command a stage session is started with, from validated parts. Pure so
 * it can be tested without AppleScript. `cwd` and `slash` are trusted here
 * because launchSession has already resolved and confined them; `name` is
 * free text and is only ever shell-quoted; everything else is checked against
 * an enum or a character class before it is used.
 */
export function buildCommand({ cwd, cli, personalDir, model, effort, worktree, name, slash, ideaId }) {
  if (!CLI_KEYS.includes(cli)) return { ok: false, error: `unknown cli "${cli}"` };
  if (cli === 'personal' && !personalDir) return { ok: false, error: 'no personal Claude folder is set in Settings' };
  if (cli === 'personal' && !safeDirPath(personalDir)) return { ok: false, error: 'the personal Claude folder is not a safe path' };
  if (!MODELS.includes(model)) return { ok: false, error: `unknown model "${model}"` };
  if (!EFFORTS.includes(effort)) return { ok: false, error: `unknown effort "${effort}"` };
  if (!WORKTREE_RE.test(worktree || '')) return { ok: false, error: 'malformed worktree name' };
  if (!ID_RE.test(ideaId)) return { ok: false, error: 'malformed idea id' };
  const env = cli === 'personal' ? `CLAUDE_CONFIG_DIR=${shq(personalDir)} ` : '';
  return {
    ok: true,
    command: `cd ${shq(cwd)} && ${env}claude -w ${worktree} -n ${shq(sessionName(name, ideaId))} --model ${model} --effort ${effort} /${slash} ${ideaId}`,
  };
}

/** AppleScript string literal escaping: backslash and double quote only. */
function asStr(s) {
  return `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** POSIX single-quote a value for the shell inside `do script`. */
function shq(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

function haveITerm() {
  try {
    execFileSync('osascript', ['-e', 'exists application id "com.googlecode.iterm2"'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });
    return fs.existsSync('/Applications/iTerm.app');
  } catch {
    return false;
  }
}

/**
 * Which directory a stage session opens in.
 *
 * An idea's own `repos` is written by /idea-brainstorm, so brainstorm is the
 * one action guaranteed to have none when it is clicked. The idea's project
 * carries a repo list the board already holds, and the working directory is
 * only where the session starts: the brainstorm skill reads the project's full
 * repo list for itself. Falling back to it is what makes the button work at
 * all, and it costs nothing for the later stages, which have their own repos
 * by then.
 *
 * Returns `{ repo }` or `{ error }`. The three refusals read differently
 * because they need different things done about them: assign a project, fix a
 * stale project id, or give the project a repo.
 *
 * @param {object} idea  an idea from the store
 * @param {Array}  ws    the dashboard's projects, each with `{ id, repos: [{ name }] }`
 */
export function resolveLaunchRepo(idea, ws) {
  const own = idea?.repos?.[0];
  if (own) return { repo: own };

  const projectId = idea?.projectId;
  if (!projectId) return { error: 'this idea has no repo and no project yet' };

  const project = (ws || []).find(p => p.id === projectId);
  if (!project) return { error: `no repo yet, and project "${projectId}" is not on the board` };

  const repo = project.repos?.[0]?.name;
  if (!repo) return { error: `no repo yet, and project "${projectId}" has no repos` };
  return { repo };
}

/**
 * @param {string} action  key of ACTIONS
 * @param {string} ideaId  full idea id
 * @param {string} repo    repo directory name, validated
 * @param {string} basePath  configured repo root
 * @param {{cli: string, personalDir: string, model: string, effort: string, worktree: string, name: string}} opts  enumerated launch settings, the expanded personal Claude folder ('' when unset), and the session name
 */
export function launchSession(action, ideaId, repo, basePath, opts = {}) {
  const slash = ACTIONS[action];
  if (!slash) return { ok: false, error: `unknown action "${action}"` };
  if (!ID_RE.test(ideaId)) return { ok: false, error: 'malformed idea id' };
  // Shared with the git scanner rather than re-derived: several real checkouts
  // have a space in the directory name, the repo name reaches AppleScript
  // shell-quoted and never through a shell of its own, and what actually has
  // to be refused is a name that walks out of the root, which the realpath
  // confinement below catches for good.
  if (!safeRepoName(repo)) return { ok: false, error: 'malformed repo name' };
  if (!launchableActions(claudeConfigDir(opts.cli, opts.personalDir)).includes(action)) {
    return { ok: false, error: `/${slash} is not installed for the ${opts.cli} CLI` };
  }

  // A name guard is not a location guard: an ordinary-looking child can be a
  // symlink pointing anywhere. ideas.json is writable by anything on the
  // machine, so the repo name is untrusted input: resolve both sides and
  // require the target to be a real directory strictly beneath the root.
  let base;
  let cwd;
  try {
    base = fs.realpathSync(basePath);
    cwd = fs.realpathSync(path.join(base, repo));
  } catch {
    return { ok: false, error: `${repo} is not a directory under ${basePath}` };
  }
  if (!fs.statSync(cwd).isDirectory()) return { ok: false, error: `${repo} is not a directory` };
  if (cwd === base || !cwd.startsWith(base + path.sep)) {
    return { ok: false, error: `${repo} resolves outside ${basePath}` };
  }

  const built = buildCommand({ cwd, slash, ideaId, ...opts });
  if (!built.ok) return built;
  const command = built.command;

  const script = haveITerm()
    ? `tell application "iTerm"
         activate
         set w to (create window with default profile)
         tell current session of w to write text ${asStr(command)}
       end tell`
    : `tell application "Terminal"
         activate
         do script ${asStr(command)}
       end tell`;

  return new Promise((resolve) => {
    execFile('osascript', ['-e', script], (err) => {
      resolve(err ? { ok: false, error: err.message } : { ok: true, cli: opts.cli, model: opts.model, effort: opts.effort });
    });
  });
}

/**
 * The slash command for a stage action, as text for the clipboard rather than
 * something to run. It resolves through the same ACTIONS map and the same id
 * guard as launchSession, so what you paste into a Claude session and what the
 * terminal button would have run can never drift apart.
 *
 * No `cd` prefix and no repo: this is meant for a session that is already open
 * somewhere. The caller gets the repo separately and says it in the toast.
 */
export function stageCommand(action, ideaId) {
  const slash = ACTIONS[action] || COPY_ONLY[action];
  if (!slash) return { ok: false, error: `unknown action "${action}"` };
  if (!ID_RE.test(ideaId)) return { ok: false, error: 'malformed idea id' };
  return { ok: true, command: `/${slash} ${ideaId}` };
}

export const LAUNCH_ACTIONS = Object.keys(ACTIONS);
