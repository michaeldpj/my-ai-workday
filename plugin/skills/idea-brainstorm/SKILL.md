---
name: idea-brainstorm
description: Scope a captured idea into a brief with kill criteria, an effort rating, and coarse tasks, by reading the actual repos. Use when the user says "brainstorm idea X", "scope this idea", or invokes /idea-brainstorm. Moves an idea from inbox to shaped.
---

# /idea-brainstorm <id>

Turn a sentence into something that can be judged. `inbox` to `shaped`.

The store CLI is `ideas`. If the shell cannot find it, run `node "${CLAUDE_PLUGIN_ROOT}/lib/ideas.mjs"` in its place.

Read first:

- `${CLAUDE_PLUGIN_ROOT}/shared/ideas-store.md` (store contract)
- `${CLAUDE_PLUGIN_ROOT}/shared/idea-brief.md` (brief template and rules)
- `${CLAUDE_PLUGIN_ROOT}/shared/idea-effort.md` (rating rubric)

## Steps

1. **Load it.**

   ```bash
   ideas get <id>
   ```

   If `projectId` is null, ask the user which project, set it, and continue.
   The CLI refuses to shape a projectless idea because tasks live on a project.

2. **Read the actual code.** This is the step that makes the brief worth
   anything, and it is the step there is a temptation to skip. Open the repos
   the idea touches. Find the files that would change. Check whether the thing
   already half-exists. A brief written from the title alone produces a wrong
   blast radius, which produces a wrong effort rating, which can route work
   past review that needed it.

   Repos live in the folder `ideas root` prints. The project's repos are
   listed by `ideas projects`, on the line for its id. If it prints nothing,
   follow the empty-list rule in `${CLAUDE_PLUGIN_ROOT}/shared/ideas-store.md`.
   If `"$(ideas root)/<repo>"` does not exist, stop and tell the user to open
   the app and set Repo Folder in Settings, because a brief written without
   reading the code is worse than waiting.

2b. **Run the harm test before writing anything.** From what the code shows,
   write the one-line harm: who is affected, how often, the worst outcome, and
   whether it heals on its own. If it is bounded, self-healing, cosmetic, or
   needs an already-authorized actor, the brief is a short "Recommend: accept,
   don't build" with the evidence, no sketch and no effort rating, and step 7
   offers `/idea-pipeline:idea-kill`. Do not build a case for work the harm line does not
   justify. Rounding up on effort is about scrutiny, never about whether the
   thing is worth doing.

3. **Write the brief** to a temp file, following the template exactly. The
   blast radius section must reflect what you actually read, not what you
   assume.

4. **Rate the effort** against the rubric, only for a "Recommend: build"
   brief. Round up when between two. Remember this is a proposal about how much
   scrutiny the work gets, so err toward more.

5. **Write it back**, all in one call so the idea is never half-updated:

   ```bash
   ideas set <id> \
     --brief=@/tmp/brief.md \
     --kill-criteria=@/tmp/kill.md \
     --proposed-tasks=@/tmp/tasks.txt \
     --plan-effort=medium \
     --repos="twig-web,twig-api" \
     --proposal-pending=true
   ```

6. **Move it.**

   ```bash
   ideas move <id> --to=shaped
   ```

7. **Show the user the brief in full** and say what happens next. If you rated
   it low, say the express lane is available and that taking it is their call:

   ```
   Rated low. It can go straight to queued, skipping plan and review:
     /idea-pipeline:idea-queue a4f1
   Or plan it anyway:
     /idea-pipeline:idea-plan a4f1
   ```

   For medium or high, the next step is `/idea-pipeline:idea-plan <id>`.

## What this command must not do

- **Do not write a plan.** Sketch the approach. Naming the mechanism is the
  job; specifying the implementation is the next command's job.
- **Do not touch code.** Not one edit, not even an obvious one-line fix you
  noticed on the way. Note it in the brief instead.
- **Do not rewrite `notes`.** The raw capture is permanent.
- **Do not decide the rating is settled.** It is a proposal. The user queues.

## If the idea turns out to be a bad one

Say so, in the brief, plainly. A brief whose honest conclusion is "this is not
worth building, and here is why" is the pipeline working. Then tell the user:

```
/idea-pipeline:idea-kill a4f1 "<reason>"
```

Do not kill it yourself. That is their move.
