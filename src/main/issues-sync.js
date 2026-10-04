import { syncRepoIssues } from './issues.js';
import { pruneIssueFiles } from './issues-store.js';
import { haveGh } from './git.js';

const FIRST_TICK_MS = 20_000;
const TICK_MS = 10 * 60_000;
let timer = null;
let running = false;

async function tick(getWin, getRepos, getKeep, basePath) {
  if (running || !(await haveGh())) return;
  running = true;
  const changed = [];
  try {
    // Sequential on purpose: a full first pull of a large repo takes half a
    // minute, and 31 of them at once is a rate-limit conversation with GitHub.
    for (const name of getRepos()) {
      const r = await syncRepoIssues(name, basePath);
      if (r.ok && r.changed) changed.push(name);
    }
    // Prune against every workspace repo, not only the synced ones, so an
    // upstream clone's file stays for its Issues view to open on demand.
    await pruneIssueFiles(getKeep());
  } finally { running = false; }
  const w = getWin();
  if (changed.length && w && !w.isDestroyed()) {
    try { w.webContents.send('issues:changed', { repos: changed }); } catch { /* torn down */ }
  }
}

export function startIssuesSync(getWin, getRepos, getKeep, basePath) {
  stopIssuesSync();
  timer = setTimeout(() => {
    tick(getWin, getRepos, getKeep, basePath);
    timer = setInterval(() => tick(getWin, getRepos, getKeep, basePath), TICK_MS);
  }, FIRST_TICK_MS);
}

export function stopIssuesSync() {
  if (timer) { clearTimeout(timer); clearInterval(timer); timer = null; }
}
