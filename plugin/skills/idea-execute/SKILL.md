---
name: idea-execute
description: Build one queued idea, or a batch of low ones, to a pushed branch and an open GitHub Issue. Runs unattended to completion within objective limits and never deploys. Use when the user says "execute idea X", "build X", or invokes /idea-execute.
---

# /idea-execute <id> [<id>...]

Build it. `queued` to `building` to `built`. Runs to completion without asking.

An explicit invocation authorizes the queued idea workflow below, including its
issue updates and branch push, but never deployment. A question about this
skill does not execute an idea.

The store CLI is `ideas`. If the shell cannot find it, run `node "${CLAUDE_PLUGIN_ROOT}/lib/ideas.mjs"` in its place.

Read `${CLAUDE_PLUGIN_ROOT}/shared/ideas-store.md`,
`${CLAUDE_PLUGIN_ROOT}/shared/idea-effort.md` and
`${CLAUDE_PLUGIN_ROOT}/shared/policies.md` first.

## The boundary that cannot move

**This command never deploys.** It ends at push.

Run the review, verification, commit, and branch-push steps below and stop,
per "Execution ends at a pushed branch" in `policies.md`. Stop before any
deployment, solution import or publish, release, or production change,
regardless of what deploy commands the repository documents. Keep the existing
idea issue open.

`built` means pushed. Deploying is the user's move, always.

## Batching

Several ids run in one session **only when every one is rated low**. Refuse a
batch containing a medium or high and name which. A session that exhausts its
context partway through the third change leaves two repos half-done.

A batch shares one worktree, one branch, one issue, and a `batchId`. Every
member gets its own outcome. The batch is a scheduling convenience, never a
unit of success.

## Steps

1. **Check every idea is `queued`.** `ideas get <id>` for each. Refuse
   otherwise, naming the stage and what would advance it.

2. **Move to `building` before doing anything.** If the session dies later,
   this is what tells the user where it got to.

   ```bash
   ideas move <id> --to=building
   ```

3. **Write the plan first if there is none.** An express-lane idea reaches
   `queued` with no `planPath`. Write one now, into
   `docs/plans/YYYY-MM-DD-<slug>.md` in the worktree from step 4, and set
   `planPath`. It is a low idea so the plan is short, but it exists, because
   the record of what was built has to survive the session.

4. **Worktree.** One per run, named for the idea or batch, in
   `"$(ideas root)/<repos[0]>"`. If that folder does not exist, move the idea back with
   `ideas move <id> --to=queued --note="stopped: repo folder missing"` and tell
   the user to open the app and set Repo Folder in Settings. Feature work never happens
   in a primary checkout, because concurrent sessions sharing one `.git/index`
   cross-commit each other's staged files. When the session is already inside
   a linked worktree, use that worktree and its branch instead of creating
   another. Detect this with `git worktree list --porcelain`, not a path
   convention. If step 3 needs a new plan file, create the worktree first and
   write that file there. A new worktree branches from the remote default
   branch after a `git fetch`, and an existing one is brought up to date with
   it first. `/idea-plan` leaves its plan uncommitted, so when the plan file is
   not on the branch, copy it in from where it was written and commit it with
   the work.

5. **Open the issue** in `repos[0]`, before the work. If `ideas get <id>`
   already shows a `github` issue, an earlier session that was reset opened it.
   Reuse that issue, append to its `## Decisions` section, and skip creating
   one. Otherwise open it with the brief, the plan path, and an empty
   `## Decisions` section. Record it:

   ```bash
   ideas set <id> \
     --github='{"repo":"<owner>/<repo>","number":123,"url":"..."}'
   ```

6. **Build it through `execute-plan`.** Read
   `${CLAUDE_PLUGIN_ROOT}/skills/execute-plan/SKILL.md` and use its assessment,
   bounded subagent assignments, model and effort selection, integration, and
   independent review workflow for the idea's `planPath`. Keep the orchestrator
   responsible for the idea lifecycle and decision log. The idea scope, four
   stops, batching rules, and no-deploy boundary below still apply. After
   integrated acceptance, continue to steps 7 to 9, and do not end the idea run
   at the helper's completion.

7. **Verify, commit, and push only.** Run the checks the repo's `CLAUDE.md` or
   `CONTRIBUTING.md` names (build, tests, lint), a simplification pass over the
   diff (`/simplify` when available), and the independent review from
   `execute-plan`. Fix confirmed findings, then commit and push this idea's
   branch. Reuse a completed check or review only when it covers the same
   unchanged diff. Never mark `built` after a failed push.

8. **Record the session on the existing idea issue and keep it open.** Use
   `${CLAUDE_PLUGIN_ROOT}/skills/session-issue/SKILL.md` for the facts and
   verification format, but update the issue recorded in step 5, preserving
   its brief and Decisions log. Do not run the generic create-and-close
   sequence or create a second session issue. The idea issue stays open
   through `built` and closes only at `/idea-ship`.

9. **Move to `built`** and report per idea.

## Answering as the user would

Answer from three sources, in this order: the plan, the repo's CLAUDE.md, and
the conventions already in the code. Do not pause for anything those settle.
Not every session deserves their attention.

## The four stops

Stop for these and nothing else. They are written as tests, not judgments, so
that this session is not the sole arbiter of its own limits.

1. **Any production action.** A deploy, a solution import or publish, a data
   write, or a configuration change against a production system. Never take
   one. Not once, not with a good reason.
2. **A file the plan does not name needs a change**, beyond an import or a call
   site your own change orphaned.
3. **The test suite was red before you started**, or a reviewer returns a
   confirmed CRITICAL you cannot fix inside the plan's scope.
4. **A schema or migration change appears that the plan did not anticipate.**

On any stop: write why on the issue, then

```bash
ideas move <id> --to=queued --note="stopped: <reason>"
```

so the idea is picked back up rather than stranded in `building`.

## The decision log is not optional

Append to the issue's `## Decisions` section **as you go**, not at the end. One
entry per decision you made on the user's behalf:

```markdown
- **[taste] Reused the existing status choice column rather than adding a new one.**
  Rejected: a new column, which would have needed a solution change and made a
  second place the status lives.
```

Tag every entry with one of two kinds, so the user can read the ones that need
judgment and skim the rest:

- **[mechanical]**: the plan, the repo's CLAUDE.md or an existing convention
  settled it, and any careful implementer would have chosen the same.
- **[taste]**: two or more options were viable with different tradeoffs and
  you picked one. Name the rejected option every time.

When the step 8 issue update summarizes the log, list the taste entries first
with their count. A decision that would change the plan's stated direction is
neither kind; it is a stop under the four stops, not a log entry.

This log is the only thing that makes unattended execution reviewable instead
of mysterious. The user accepted the largest authority transfer in this system
on the understanding that they can read afterward exactly what was decided for
them. A session that builds correctly and logs nothing has broken the deal.

## Partial batch failure

If A builds, B fails its tests, and C is never reached: A goes `built`, B and C
go back to `queued` with the reason recorded, and the issue lists all three
with their outcomes. Never mark an untouched idea `built` because a sibling
succeeded.
