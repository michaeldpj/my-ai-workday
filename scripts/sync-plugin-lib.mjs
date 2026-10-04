#!/usr/bin/env node
/**
 * sync-plugin-lib: copy the store modules into plugin/lib.
 *
 * scripts/ is canonical. The plugin cannot import it by path, because Claude
 * Code copies an installed plugin into its cache and copies nothing outside
 * the plugin folder, so plugin/lib carries byte-for-byte copies. Run
 * `npm run plugin:lib` after editing any file below. plugin-lib.test.mjs fails
 * on drift.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLUGIN_LIB = Object.freeze([
  'ideas.mjs',
  'ideas-store.mjs',
  'ideas-sync.mjs',
  'idea-fields.mjs',
  'store-dir.mjs',
  'workspace-config.mjs',
]);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SRC = path.join(ROOT, 'scripts');
export const DEST = path.join(ROOT, 'plugin', 'lib');

export function syncPluginLib() {
  fs.mkdirSync(DEST, { recursive: true });
  for (const f of fs.readdirSync(DEST)) {
    if (!PLUGIN_LIB.includes(f)) fs.rmSync(path.join(DEST, f), { recursive: true, force: true });
  }
  for (const f of PLUGIN_LIB) fs.copyFileSync(path.join(SRC, f), path.join(DEST, f));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  syncPluginLib();
  console.log(`plugin/lib: ${PLUGIN_LIB.length} files copied from scripts/`);
}
