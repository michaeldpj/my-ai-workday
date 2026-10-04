import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    outDir: 'dist/main',
    lib: {
      entry: {
        index: resolve(__dirname, 'src/main/index.js'),
        preload: resolve(__dirname, 'src/main/preload.js'),
      },
      formats: ['cjs'],
    },
    rollupOptions: {
      external: [
        'electron',
        'electron-store',
        'keytar',
        '@anthropic-ai/sdk',
        'child_process',
        'path',
        'os',
        'fs',
        'fs/promises',
        // scripts/ideas-store.mjs imports builtins with the `node:` prefix,
        // which Rollup treats as different specifiers from the bare names
        // above. Without these it tries to bundle Node builtins and the build
        // fails. The store itself is deliberately NOT external: electron-builder
        // ships only dist/main and src/renderer, so an external scripts/ path
        // would resolve in dev and be missing from the installed app.
        'node:child_process',
        'node:path',
        'node:os',
        'node:fs',
        'node:fs/promises',
      ],
      output: {
        entryFileNames: '[name].js',
      },
    },
    minify: false,
    emptyOutDir: true,
  },
});
