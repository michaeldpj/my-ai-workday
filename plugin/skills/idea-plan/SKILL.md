---
name: idea-plan
description: Write the implementation plan for a shaped idea into the target repo's docs/plans/ and refine its tasks. Use when the user says "plan idea X" or invokes /idea-plan. Moves an idea from shaped to planned.
---

# /idea-plan <id>

Turn a brief into a plan an autonomous session could execute. `shaped` to
`planned`.

The store CLI is `ideas`. If the shell cannot find it, run `node "${CLAUDE_PLUGIN_ROOT}/lib/ideas.mjs"` in its place.

Read first:

- `${CLAUDE_PLUGIN_ROOT}/shared/ideas-store.md`
- `${CLAUDE_PLUGIN_ROOT}/shared/idea-effort.md`
- `${CLAUDE_PLUGIN_ROOT}/shared/policies.md`

Write the plan on an Opus-class model at high effort. When the session runs a
smaller model, delegate the plan to the `idea-pipeline:plan-writer` agent
rather than switching silently, and say which model wrote it.

## Steps

1. **Load it.** `ideas get <id>`. Refuse politely if it is not `shaped`; the
   CLI will refuse anyway and name what would advance it.

   If `planEffort` is low, the CLI prints a note that the express lane exists.
   Planning a low idea anyway is legal, and sometimes right. Mention it once
   and carry on.

2. **Read the code again, properly.** The brief sketched. The plan commits. Go
   deeper than the brainstorm did: find every call site that changes, every
   test that will need to move, every consumer of a contract you are touching.
   If `"$(ideas root)/<repos[0]>"` does not exist, stop and tell the user to
   open the app and set Repo Folder in Settings, because a plan written without
   reading the code is worse than waiting. Grep before you write. A plan lists all call
   sites before it proposes a mutation.

3. **Write the plan** to the first repo in `repos`:

   ```
   "$(ideas root)/<repos[0]>/docs/plans/YYYY-MM-DD-<slug>.md"
   ```

   Never overwrite an existing plan file. A new task gets a new file.

   The plan must carry, near the top:

   - A one-line statement of scope in plain terms, roughly how many sessions of
     what kind of work. The user reads this to decide whether to run it. It is a
     sentence in a document, not a number anything tracks.
   - The idea id, so the two are linked from both directions.
   - Explicit design decisions, numbered, each with its reasoning. This is what
     `/idea-execute` reads when it needs to answer a question as the user would.
   - A `Rollout:` line, `live` by default. `dark` is allowed only when the
     feature would break a client build that has not shipped, and `trial` only
     for high-risk work, per "Ship live by default" in `policies.md`. Either
     names the flip condition and date.

   **Write for an autonomous executor.** Every ambiguity you leave becomes a
   decision the session makes on the user's behalf and logs afterward. Name the
   files. Name the functions. State what happens in the failure cases. A plan
   that says "handle errors appropriately" has delegated a decision it should
   have made.

4. **Re-rate if the plan changed your mind.** Writing it out often reveals a
   migration or a second repo. If so, update `planEffort` and say why out loud.
   Rounding up here is cheap; rounding down routes work past review.

5. **Refine the tasks.** Replace the coarse tasks with the plan's real steps.

   ```bash
   ideas set <id> \
     --plan-path=docs/plans/2026-08-21-slug.md \
     --proposed-tasks=@/tmp/tasks.txt \
     --plan-effort=high
   ```

6. **Move it and report.**

   ```bash
   ideas move <id> --to=planned
   ```

   Tell the user the path, the scope line, the rating, and:

   ```
   Next: /idea-pipeline:idea-review a4f1
   ```

## What this command must not do

- **Do not implement anything.** No edits outside `docs/plans/`.
- **Do not commit.** The plan file stays uncommitted for the user to read, and
  `/idea-execute` commits it alongside the work.
- **Do not review your own plan.** That is the next stage and it exists because
  a plan reviewed by its author is barely reviewed.
