---
name: idea-list
description: Show ideas in the cross-repo pipeline, filtered by stage or by what needs the user. Use when they say "what's in the pipeline", "what's waiting on me", "show my ideas", or invokes /idea-list.
---

# /idea-list

The store CLI is `ideas`. If the shell cannot find it, run `node "${CLAUDE_PLUGIN_ROOT}/lib/ideas.mjs"` in its place.

Read `${CLAUDE_PLUGIN_ROOT}/shared/ideas-store.md` first.

```bash
ideas list           # open ideas
ideas list --mine    # waiting on the user
ideas list --stage=queued
ideas next           # your-move, with next actions
```

When the user asks what needs them, use `next`. It sorts by impact and prints the
exact command for each. That is the answer to "I have twenty minutes."

Do not editorialize the list into a recommendation about what to work on unless
they ask. Showing the board is the job.

If the review cap is full, the list says so. Relay that plainly: review is
blocked until they queue or kill one, and it is a deliberate limit rather than
a fault.
