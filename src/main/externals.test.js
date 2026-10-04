import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const mainDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(mainDir, '..', '..');

/**
 * Vite bundles the main process, and a Node builtin that is not externalized is
 * silently replaced with an empty object rather than failing the build. That is
 * how `fs/promises` shipped as `const fs = {}`, turning every call into a
 * caught exception. The build stays green, the unit tests stay green, and the
 * feature is dead only in the installed app.
 */
test('every node builtin imported by the main process is externalized', async () => {
  const config = await readFile(path.join(root, 'vite.config.js'), 'utf8');
  const external = new Set([...config.matchAll(/'([^']+)'/g)].map((m) => m[1]));

  const files = (await readdir(mainDir)).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'));
  const missing = [];

  for (const file of files) {
    const src = await readFile(path.join(mainDir, file), 'utf8');
    for (const m of src.matchAll(/^import\s[^;]*?\sfrom\s'([^']+)';/gm)) {
      const spec = m[1];
      const bare = spec.startsWith('node:') ? spec.slice(5) : spec;
      if (!builtinModules.includes(bare)) continue;
      if (!external.has(spec)) missing.push(`${file}: ${spec}`);
    }
  }

  assert.deepEqual(missing, [], 'add these to rollupOptions.external in vite.config.js');
});
