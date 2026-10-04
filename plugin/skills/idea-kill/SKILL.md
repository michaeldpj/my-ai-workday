---
name: idea-kill
description: Kill an idea with a recorded reason, from any stage. Use when the user says "kill idea X", "drop that one", "not doing this", or invokes /idea-kill.
---

# /idea-kill <id> "<reason>"

The store CLI is `ideas`. If the shell cannot find it, run `node "${CLAUDE_PLUGIN_ROOT}/lib/ideas.mjs"` in its place.

Read `${CLAUDE_PLUGIN_ROOT}/shared/ideas-store.md` first.

```bash
ideas move <id> --to=killed --note="<reason>"
ideas set <id> --killed-reason="<reason>"
```

The reason is required and it is the whole point. An idea killed without one
comes back in six weeks and gets brainstormed again from scratch.

If the idea has kill criteria on it and one of them is what fired, say so in the
reason. That is the criteria doing their job, and it is worth recording that
they worked.

Killing is reversible: `/idea-pipeline:idea-reopen <id>`. Say so once, then stop. Do not
argue for an idea the user has decided against.
