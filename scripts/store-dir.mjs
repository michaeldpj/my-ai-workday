/**
 * store-dir: the one rule for where the app and the CLI keep their state.
 *
 * The Electron main process and every Claude Code session running the CLI
 * must agree on this directory, or ideas captured by one land in a store the
 * other never reads. So the rule lives here once, Vite bundles it into
 * dist/main like ideas-store.mjs, and the CLI imports the same file.
 *
 * Order: MY_AI_WORKDAY_HOME, then MY_DAY_HOME, then ~/.my-day if it holds
 * ideas.json or my-day-config.json, else ~/.my-ai-workday. An env value is
 * used as given (no ~ expansion, no existence check). The answer is computed
 * once per process.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const NEW_DIR = '.my-ai-workday';
export const LEGACY_DIR = '.my-day';
export const CONFIG_NAME = 'my-day-config';
export const CONFIG_FILE = `${CONFIG_NAME}.json`;

/** New name first, legacy name second, in every role. */
export const ENV = {
  home: ['MY_AI_WORKDAY_HOME', 'MY_DAY_HOME'],
  issuesDir: ['MY_AI_WORKDAY_ISSUES_DIR', 'MY_DAY_ISSUES_DIR'],
  url: ['MY_AI_WORKDAY_URL', 'MY_DAY_URL'],
  token: ['MY_AI_WORKDAY_TOKEN', 'MY_DAY_TOKEN'],
  publishToken: ['MY_AI_WORKDAY_PUBLISH_TOKEN', 'MY_DAY_PUBLISH_TOKEN'],
};

/** The first non-blank value among `names`, trimmed, or ''. */
export function envFirst(env, names) {
  for (const name of names) {
    const v = env[name];
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
  }
  return '';
}

/** A directory holding the ideas store or the app config, as regular files. */
export function isPopulatedStore(dir) {
  const isFile = (f) => { try { return fs.statSync(path.join(dir, f)).isFile(); } catch { return false; } };
  return isFile('ideas.json') || isFile(CONFIG_FILE);
}

/**
 * Pure. `env`, `home` and `isPopulated` are injected so tests never touch the
 * real home. A populated legacy store always wins, so an empty
 * ~/.my-ai-workday appearing beside it can never move a process off it.
 */
export function resolveStoreDir({ env, home, isPopulated = isPopulatedStore }) {
  const override = envFirst(env, ENV.home);
  if (override) return override;
  const legacy = path.join(home, LEGACY_DIR);
  if (isPopulated(legacy)) return legacy;
  return path.join(home, NEW_DIR);
}

export function resolveIssuesDir({ env, storeDir }) {
  return envFirst(env, ENV.issuesDir) || path.join(storeDir, 'issues');
}

/** The CLI's sync credentials. Publish tokens outrank the shared token. */
export function resolveSyncEnv(env) {
  return {
    url: envFirst(env, ENV.url),
    token: envFirst(env, [...ENV.publishToken, ...ENV.token]),
  };
}

let resolved = null;

export function storeDir() {
  if (resolved === null) resolved = resolveStoreDir({ env: process.env, home: os.homedir() });
  return resolved;
}

export function configPath() {
  return path.join(storeDir(), CONFIG_FILE);
}

export function issuesDir() {
  return resolveIssuesDir({ env: process.env, storeDir: storeDir() });
}
