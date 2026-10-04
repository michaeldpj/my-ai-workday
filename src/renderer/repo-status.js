/**
 * A repo's status and notes from one scan. An item reaches the status only
 * when it needs the user to act: local-only commits on a branch at risk, a
 * branch with content the default branch lacks, or a worktree with files
 * that exist nowhere else. Dirt with nothing unique is a quiet note, and a
 * worktree held by a live session is not counted at all. The enum is the
 * synced workspace's, so the states live in the notes, not in new statuses.
 */
import { liveBranches } from './repo-age.js';

const count = (n, one, many) => n + ' ' + (n === 1 ? one : many);

export function deriveRepoStatus(s, { prs = {}, ignore = [], ship = false } = {}) {
  const unmerged = liveBranches(s.unmergedBranches, prs, ignore);
  const openPRs = unmerged.filter((b) => prs[b] === 'OPEN').length;
  const wts = (s.worktrees || []).filter((w) => !w.inUse);
  const uniqueWt = wts.filter((w) => w.unique).length;
  const routineWt = wts.filter((w) => w.dirty && !w.unique).length;
  const otherPush = (s.unpushedBranches || []).filter((b) => b !== s.defaultBranch);

  const parts = [];
  if (s.uncommitted > 0) parts.push(s.uncommitted + ' uncommitted');
  if (s.unpushed > 0) parts.push(s.unpushed + ' to push' + (otherPush.length ? ' (' + otherPush.join(', ') + ')' : ''));
  if (unmerged.length) parts.push(count(unmerged.length, 'branch', 'branches') + ' with unique work' + (openPRs ? ' (' + openPRs + ' PR open)' : ''));
  if (uniqueWt) parts.push(count(uniqueWt, 'worktree', 'worktrees') + ' with unique files');

  let status = 'stable';
  if (s.uncommitted > 0) status = ship ? 'active' : 'needs-commit';
  else if (s.unpushed > 0) status = 'needs-push';
  else if (unmerged.length || uniqueWt) status = 'needs-merge';

  const quiet = routineWt ? count(routineWt, 'worktree', 'worktrees') + ', nothing unique' : 'clean';
  return { status, notes: parts.length ? parts.join(', ') : quiet };
}
