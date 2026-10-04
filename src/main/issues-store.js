/**
 * The local copy of every repo's GitHub issues, one JSON file per repo under
 * the store folder's issues/. The first fetch writes everything; later fetches merge
 * only what changed, so a failed fetch leaves the file exactly as it was.
 * The directory sits inside the ideas repo, which stages ideas.json by name,
 * so a nested .gitignore is enough to keep these files out of its commits.
 */
import fs from 'fs/promises';
import path from 'path';
import { safeRepoName } from './git.js';
import { isSessionRecord, sessionStamp, isPullRequest } from '../renderer/issue-model.js';
import { issuesDir } from '../../scripts/store-dir.mjs';

export { issuesDir };

export async function ensureIssuesDir() {
  const dir = issuesDir();
  await fs.mkdir(dir, { recursive: true });
  const ignore = path.join(dir, '.gitignore');
  try { await fs.access(ignore); } catch { await fs.writeFile(ignore, '*\n'); }
}

// The one place a repo name becomes a path, so the one place it is checked.
function file(repo) {
  if (!safeRepoName(repo)) throw new Error(`unsafe repo name: ${repo}`);
  return path.join(issuesDir(), repo + '.json');
}

export async function readRepoIssues(repo) {
  try {
    const doc = JSON.parse(await fs.readFile(file(repo), 'utf8'));
    return doc && typeof doc.issues === 'object' ? doc : null;
  } catch { return null; }
}

export async function writeRepoIssues(doc) {
  await ensureIssuesDir();
  const tmp = file(doc.repo) + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(doc));
  await fs.rename(tmp, file(doc.repo));
}

/**
 * Bumped when a file written by an older app is missing something only a full
 * pull can supply. 2 added pull requests: a file from before that has a cursor,
 * so a delta would only ever see PRs updated from now on.
 */
export const DOC_VERSION = 2;

/** `full` means the rows are everything GitHub has, so a deleted or transferred issue drops out. */
export function mergeRows(doc, rows, fetchedAt, { full = false } = {}) {
  const issues = full ? {} : { ...(doc?.issues || {}) };
  for (const r of rows) issues[r.number] = r;
  return { repo: doc?.repo || rows[0]?.repo, version: DOC_VERSION, fetchedAt, issues };
}

const readAll = (repoNames) => Promise.all(repoNames.map(readRepoIssues));

export async function projectSnapshot(repoNames, errors = {}) {
  const docs = await readAll(repoNames);
  const repos = {};
  let complete = true;
  let fetchedAt = null;
  docs.forEach((doc, i) => {
    repos[repoNames[i]] = doc ? Object.values(doc.issues) : null;
    if (!doc) complete = false;
    else if (!fetchedAt || doc.fetchedAt < fetchedAt) fetchedAt = doc.fetchedAt;
  });
  return { fetchedAt: complete ? fetchedAt : null, repos, errors };
}

const rowsOf = (docs, keep, shape) => docs.flatMap((doc) => Object.values(doc?.issues || {}).filter(keep).map(shape));
const sessionShape = (r) => ({ key: r.key, repo: r.repo, number: r.number, title: r.title, at: sessionStamp(r), url: r.url });
const prShape = (r) => ({ key: r.key, repo: r.repo, number: r.number, title: r.title, url: r.url, openedAt: r.createdAt, closedAt: r.closedAt || null, mergedAt: r.mergedAt || null });
const isPlainIssue = (r) => !isPullRequest(r) && !isSessionRecord(r);
const issueShape = (r) => ({ key: r.key, repo: r.repo, number: r.number, title: r.title, state: r.state, createdAt: r.createdAt, closedAt: r.closedAt || null, url: r.url });

export async function sessionRows(repoNames) { return rowsOf(await readAll(repoNames), isSessionRecord, sessionShape); }
export async function prRows(repoNames) { return rowsOf(await readAll(repoNames), isPullRequest, prShape); }
export async function issueRows(repoNames) { return rowsOf(await readAll(repoNames), isPlainIssue, issueShape); }

/** All three row kinds from one read of the files, for the Timeline and Summary loaders. */
export async function activityRows(repoNames) {
  const docs = await readAll(repoNames);
  return { sessions: rowsOf(docs, isSessionRecord, sessionShape), prs: rowsOf(docs, isPullRequest, prShape), issues: rowsOf(docs, isPlainIssue, issueShape) };
}

export async function openCounts(repoNames) {
  const docs = await readAll(repoNames);
  const out = {};
  for (const doc of docs) {
    if (!doc) continue;
    const open = Object.values(doc.issues).filter((r) => r.state === 'open');
    const prs = open.filter(isPullRequest).length;
    out[doc.repo] = { issues: open.length - prs, prs };
  }
  return out;
}

/** Files for repos that left the workspace are cache, not history: drop them. */
export async function pruneIssueFiles(keep) {
  const dir = issuesDir();
  let names;
  try { names = await fs.readdir(dir); } catch { return []; }
  const wanted = new Set(keep);
  const removed = [];
  for (const f of names) {
    if (!f.endsWith('.json')) continue;
    const repo = f.slice(0, -5);
    if (wanted.has(repo) || !safeRepoName(repo)) continue;
    await fs.unlink(path.join(dir, f));
    removed.push(repo);
  }
  return removed;
}
