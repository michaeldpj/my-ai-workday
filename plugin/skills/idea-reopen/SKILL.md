---
name: idea-reopen
description: Bring a killed idea back to the inbox. Use when the user says "reopen idea X", "let's revisit that one", or invokes /idea-reopen.
---

# /idea-reopen <id> "<reason>"

`killed` back to `inbox`. Ideas get killed for reasons that expire.

The store CLI is `ideas`. If the shell cannot find it, run `node "${CLAUDE_PLUGIN_ROOT}/lib/ideas.mjs"` in its place.

Read `${CLAUDE_PLUGIN_ROOT}/shared/ideas-store.md` first.

```bash
ideas move <id> --to=inbox --note="<reason>"
```

Before reopening, read why it was killed:

```bash
ideas get <id>
```

If the original kill reason still holds, say so rather than reopening quietly.
The reason for reopening should engage with the reason for killing, and "we
changed our mind" is worth writing down as much as anything else.

It lands in `inbox`, not back where it left. The brief is stale by definition
if enough changed to make it worth revisiting, so it gets brainstormed again.
