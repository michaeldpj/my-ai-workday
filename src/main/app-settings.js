/**
 * The three app settings that used to be hardcoded for one machine: the repo
 * folder clipboard lines and scans use, a second Claude Code config folder
 * for the personal CLI, and the header's dashboard link. Pure so the rules
 * are tested without electron. Values are stored as typed (a leading ~ kept)
 * and expanded where a path is needed.
 */
import os from 'node:os';
import { safeDirPath } from '../renderer/workspace-model.js';

export const SETTING_KEYS = ['githubPath', 'personalClaudeDir', 'dashboardUrl'];

const LABELS = { githubPath: 'Repo folder', personalClaudeDir: 'Personal Claude folder', dashboardUrl: 'Dashboard link' };

export function expandHome(p) {
  return String(p).replace(/^~(?=\/|$)/, os.homedir());
}

function httpsUrl(v) {
  if (!v.startsWith('https://')) return false;
  try { return Boolean(new URL(v).hostname); } catch { return false; }
}

/**
 * @param {{githubPath: string, personalClaudeDir: string, dashboardUrl: string}} current
 * @param {object} partial  keys from SETTING_KEYS, string values
 * @param {(raw: string) => boolean} isDir  whether a stored-form folder exists
 */
export function applySettings(current, partial, isDir) {
  const next = { ...current };
  for (const [key, raw] of Object.entries(partial || {})) {
    if (!SETTING_KEYS.includes(key) || typeof raw !== 'string') return { ok: false, error: `${key} cannot be set` };
    const v = raw.trim().replace(/(.)\/+$/, '$1');
    const label = LABELS[key];
    if (key === 'dashboardUrl') {
      if (v && !httpsUrl(v)) return { ok: false, error: `${label} must be an https:// address` };
    } else if (!v && key === 'githubPath') {
      return { ok: false, error: `${label} cannot be empty` };
    } else if (v && !(safeDirPath(v) && safeDirPath(expandHome(v)) && isDir(v))) {
      return { ok: false, error: `${label} must be an existing folder written as ~/… or /…, with letters, digits, dot, dash or underscore in each part` };
    }
    next[key] = v;
  }
  return { ok: true, next };
}
