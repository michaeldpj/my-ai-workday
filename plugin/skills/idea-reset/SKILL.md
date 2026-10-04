---
name: idea-reset
description: Return a stranded building idea to queued after an interrupted, crashed, or stopped execute session. Use when the user says "reset idea X", "that session died", or invokes /idea-reset.
---

# /idea-reset <id> "<reason>"

`building` back to `queued`. Without this, a crashed session leaves a card no
command will ever touch again, because execute only accepts `queued`.

The store CLI is `ideas`. If the shell cannot find it, run `node "${CLAUDE_PLUGIN_ROOT}/lib/ideas.mjs"` in its place.

Read `${CLAUDE_PLUGIN_ROOT}/shared/ideas-store.md` first.

```bash
ideas move <id> --to=queued --note="<reason>"
```

The reason is required. "session died", "stopped: schema change the plan didn't
anticipate", "ran out of context".

## Before resetting, check what the dead session left behind

A session that died partway may have left a worktree, a branch, commits, or an
open issue. Look before you reset, and tell the user what is there:

```bash
git -C "$(ideas root)/<repo>" worktree list
gh issue list -R <repo> --state open --limit 5
```

Resetting the card is not cleanup. If there is a half-finished branch, say so
and let them decide whether to keep it, since the next execute run will start
from the plan again.
