---
name: idea-queue
description: Queue an idea for execution, from reviewed or via the express lane from shaped. Use when the user says "queue idea X", "that's ready to build", or invokes /idea-queue.
---

# /idea-queue <id>

The user's decision, never the model's. This is one of only three stages a human
moves an idea into, and it is the gate that stands between planning and code.

The store CLI is `ideas`. If the shell cannot find it, run `node "${CLAUDE_PLUGIN_ROOT}/lib/ideas.mjs"` in its place.

Read `${CLAUDE_PLUGIN_ROOT}/shared/ideas-store.md` first.

```bash
ideas move <id> --to=queued
```

Two legal entries:

- **From `reviewed`**, the ordinary path, after a plan has been written and
  attacked.
- **From `shaped` with `planEffort: 'low'`**, the express lane, skipping plan
  and review. The CLI refuses this for anything not rated low.

The express lane is the reason the rating is a proposal rather than a decision.
A model rating something low does not route it past review; the user queueing it
does. If they queue a low idea, that is them choosing to skip review, which is
theirs to choose.

Then report:

```
Next: /idea-pipeline:idea-execute <id>
```

If several low ideas are queued, mention they can be batched into one session.
