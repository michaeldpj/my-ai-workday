/**
 * Static server for the preview harness. Dev-only, never shipped.
 *
 * Its whole reason for existing is `Cache-Control: no-store`. The harness
 * cache-busts the module it imports, but a relative import inside that module
 * resolves against the importing file's path with the query dropped, so
 * idea-keys.js and flip.js kept coming back from cache after they changed. A
 * correct change then looks broken in the harness and nowhere else, because
 * Electron reloads the whole renderer and never sees a stale module. Busting
 * the entry cannot fix the graph. Refusing to cache anything can.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 8799;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

http.createServer((req, res) => {
  // decodeURIComponent throws on a malformed escape, and an uncaught throw in
  // here takes the process down. A server that dies on one stray prefetch
  // reintroduces exactly the failure this file exists to prevent: the harness
  // stops answering and the change under test looks broken.
  let file;
  try {
    file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
  } catch {
    res.writeHead(400).end('bad request');
    return;
  }

  // Serving the repo means serving whatever a crafted path resolves to, so
  // confine it. realpath rather than the joined string: a symlink under the
  // root can still point outside it.
  let real;
  try {
    real = fs.realpathSync(file);
  } catch {
    res.writeHead(404).end('not found');
    return;
  }
  if (!real.startsWith(ROOT + path.sep) || !fs.statSync(real).isFile()) {
    res.writeHead(403).end('forbidden');
    return;
  }

  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(real)] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  res.end(fs.readFileSync(real));
}).listen(PORT, () => {
  process.stdout.write(`harness: http://localhost:${PORT}/dev/ideas-preview.html?state=full\n`);
});
