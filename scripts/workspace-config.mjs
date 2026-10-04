/**
 * workspace-config: what the CLI may read from the desktop app's config.
 *
 * The app owns my-day-config.json (electron-store, src/main/store.js) in the
 * store folder. The CLI and the plugin's skills read the project cards and the
 * Repo Folder setting from it, so a project is defined once, on the board.
 * Read-only, and copied into plugin/lib by scripts/sync-plugin-lib.mjs, so it
 * imports nothing but node builtins.
 */
import fs from 'node:fs';
import os from 'node:os';

export const DEFAULT_REPO_ROOT = '~/github';

/** Missing is a legitimate state (the app has not run). Corrupt is an error. */
export function readConfig(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return { ok: false, missing: true };
    return { ok: false, error: `cannot read ${file}: ${e.message}` };
  }
  try {
    return { ok: true, config: JSON.parse(text) };
  } catch (e) {
    return { ok: false, error: `cannot parse ${file}: ${e.message}` };
  }
}

/** The board's cards, skipping anything without a string id. */
export function projectsFrom(config) {
  const ws = Array.isArray(config?.workspace?.ws) ? config.workspace.ws : [];
  return ws
    .filter((p) => p && typeof p.id === 'string')
    .map((p) => ({
      id: p.id,
      name: typeof p.name === 'string' ? p.name : p.id,
      repos: (Array.isArray(p.repos) ? p.repos : [])
        .map((r) => r?.name)
        .filter((n) => typeof n === 'string'),
    }));
}

/**
 * The Repo Folder setting with a leading ~ expanded, else ~/github. The same
 * rule as expandHome in src/main/app-settings.js, repeated because that module
 * imports renderer code that cannot travel into plugin/lib.
 */
export function repoRootFrom(config, home = os.homedir()) {
  const set = typeof config?.githubPath === 'string' ? config.githubPath.trim() : '';
  return (set || DEFAULT_REPO_ROOT).replace(/^~(?=\/|$)/, home);
}
