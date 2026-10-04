/**
 * Scrub check for the public snapshot. Greps every file that would be public
 * (tracked, or untracked and not ignored, minus scripts/private-paths.txt)
 * against a denylist kept outside the repo, because a committed denylist would
 * publish the names it guards. A missing or empty denylist is an error, never
 * a pass. A tracked file is scanned from its index blob and, when it differs,
 * from its working copy, so a staged leak cannot hide behind a clean file.
 *
 * Denylist, one entry per line, blank lines and # comments ignored:
 *   /source/flags         a regular expression
 *   any other text        a case-insensitive literal
 *   allow <path> <text>   in <path> only, the first occurrence of <text> is
 *                         removed before matching, so a second copy is a hit
 *
 * Exit 0 clean, 1 hits, 2 configuration or read error.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const DEFAULT_DENYLIST = path.join(os.homedir(), '.config', 'public-scrub', 'denylist.txt');
export const PRIVATE_LIST = 'scripts/private-paths.txt';
// The copyright line names the author by necessity (plan decision 1). Only a
// year and a plain name pass, so a host or URL on that line is still a hit.
const COPYRIGHT_LINE = /^Copyright \(c\) \d{4} [A-Za-z][A-Za-z '-]*$/;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function parseDenylist(text) {
  const patterns = [];
  const allows = [];
  text.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const allow = line.match(/^allow\s+(\S+)\s+(.+)$/);
    if (allow) {
      allows.push({ file: allow[1], text: allow[2] });
      return;
    }
    try {
      if (line.startsWith('/')) {
        const re = line.match(/^\/(.+)\/([a-z]*)$/);
        if (!re) throw new Error('a line starting with / must be /source/flags');
        // g and y make test() stateful across lines, so they are dropped.
        patterns.push(new RegExp(re[1], re[2].replace(/[gy]/g, '')));
      } else {
        patterns.push(new RegExp(escapeRe(line), 'i'));
      }
    } catch (e) {
      throw new Error(`denylist line ${i + 1}: ${e.message}`);
    }
  });
  if (!patterns.length) throw new Error('denylist has no patterns');
  return { patterns, allows };
}

export function parsePrivatePaths(text) {
  return text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
}

export function isPublic(file, privatePaths) {
  return !privatePaths.some((p) => (p.endsWith('/') ? file.startsWith(p) : file === p));
}

/** Line 0 is the file's own path. */
export function findHits(file, text, { patterns, allows }) {
  // Each allow covers one occurrence in the file, the first one met.
  const unused = allows.filter((a) => a.file === file).map((a) => a.text);
  const hits = [];
  const check = (line, n) => {
    if (file === 'LICENSE' && n > 0 && COPYRIGHT_LINE.test(line.trim())) return;
    let s = line;
    for (let k = unused.length - 1; k >= 0; k--) {
      if (n > 0 && s.includes(unused[k])) { s = s.replace(unused[k], ''); unused.splice(k, 1); }
    }
    const p = patterns.find((re) => re.test(s));
    if (p) hits.push({ file, line: n, pattern: String(p), text: line.trim().slice(0, 160) });
  };
  check(file, 0);
  text.split('\n').forEach((l, i) => check(l, i + 1));
  return hits;
}

const gitList = (root, args) =>
  execFileSync('git', ['ls-files', '-z', ...args], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);

/** Every version of a public file that could be exported: index blob and working copy. */
function versions(root, file, tracked) {
  const abs = path.join(root, file);
  const disk = fs.existsSync(abs) ? fs.readFileSync(abs) : null;
  if (!tracked) return [disk];
  const blob = execFileSync('git', ['show', `:${file}`], { cwd: root, maxBuffer: 256 * 1024 * 1024 });
  return disk && !disk.equals(blob) ? [blob, disk] : [blob];
}

function scan(root, privatePaths, deny) {
  const tracked = new Set(gitList(root, ['--cached']));
  const files = [...new Set([...tracked, ...gitList(root, ['--others', '--exclude-standard'])])]
    .filter((f) => isPublic(f, privatePaths)).sort();
  const hits = [];
  const binary = [];
  for (const f of files) {
    const seen = new Set();
    for (const buf of versions(root, f, tracked.has(f))) {
      const isBinary = buf.subarray(0, 8000).includes(0);
      if (isBinary && !binary.includes(f)) binary.push(f);
      for (const h of findHits(f, isBinary ? '' : buf.toString('utf8'), deny)) {
        const key = `${h.line}:${h.text}`;
        if (!seen.has(key)) { seen.add(key); hits.push(h); }
      }
    }
  }
  return { files, hits, binary };
}

function main() {
  const denyPath = process.env.SCRUB_DENYLIST || DEFAULT_DENYLIST;
  let deny;
  try {
    deny = parseDenylist(fs.readFileSync(denyPath, 'utf8'));
  } catch (e) {
    process.stderr.write(`scrub: cannot use denylist ${denyPath}: ${e.message}\n`);
    return 2;
  }
  let result;
  try {
    const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
    const privatePaths = parsePrivatePaths(fs.readFileSync(path.join(root, PRIVATE_LIST), 'utf8'));
    result = scan(root, privatePaths, deny);
  } catch (e) {
    process.stderr.write(`scrub: cannot scan this checkout: ${e.message}\n`);
    return 2;
  }
  const { files, hits, binary } = result;
  for (const h of hits) process.stdout.write(`${h.file}:${h.line}: ${h.pattern}  ${h.text}\n`);
  if (binary.length) process.stdout.write(`scrub: content not checked in ${binary.length} binary file(s), look at them: ${binary.join(', ')}\n`);
  if (deny.allows.length) {
    process.stdout.write(`scrub: ${deny.allows.length} allow exception(s) active, decide each before export: ${deny.allows.map((a) => `${a.file} ${a.text}`).join('; ')}\n`);
  }
  process.stdout.write(`scrub: ${files.length} public files, ${deny.patterns.length} patterns, ${hits.length} hit(s)\n`);
  return hits.length ? 1 : 0;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = main();
}
