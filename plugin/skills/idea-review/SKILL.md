---
name: idea-review
description: Adversarially review a planned idea's plan with an independent reviewer (Codex, Gemini, or a Claude subagent), fold confirmed findings in, and record the verdict. Use when the user says "review the plan for X" or invokes /idea-review. Moves an idea from planned to reviewed.
---

# /idea-review <id>

Attack the plan before the plan attacks production. `planned` to `reviewed`.

The store CLI is `ideas`. If the shell cannot find it, run `node "${CLAUDE_PLUGIN_ROOT}/lib/ideas.mjs"` in its place.

Read `${CLAUDE_PLUGIN_ROOT}/shared/ideas-store.md` and
`${CLAUDE_PLUGIN_ROOT}/shared/policies.md` first.

## The cap

At most ten ideas may sit at `reviewed` waiting on the user's queue-or-kill
call. The CLI refuses an eleventh and names which are waiting. That refusal is
correct behavior, not an obstacle. Relay it and stop.

The pile is capped because the user's reading capacity is the bottleneck in this
whole system, not AI throughput. Do not suggest raising the cap to get past it.

## Steps

1. **Load it.** `ideas get <id>`. Read `planPath` and open the plan. A relative
   `planPath` is relative to `"$(ideas root)/<repos[0]>"`. If that folder does not
   exist, stop and tell the user to open the app and set Repo Folder in
   Settings, because a review without the code is worth nothing.

2. **Write the review prompt** to `/tmp/review-prompt.txt`. Point it at the plan
   and the code the plan claims things about. It must ask the reviewer to:

   - Verify every claim the plan makes about existing code, by reading it.
   - Find state machine holes, unreachable states, stranded work.
   - Find concurrency and data loss paths.
   - Find internal contradictions and anything underspecified enough that two
     implementers would build different things.
   - Rank CRITICAL / HIGH / MEDIUM / LOW, cite file:line, and not restate the
     plan back.

3. **Pick the reviewers.** The reviewer must not be the session that wrote the
   plan. Check what is installed with `command -v codex` and `command -v gemini`.

   An external CLI sends the plan and the source it reads to that vendor, so
   ask the user first, naming the tool and what it will read, per "Code leaving
   the machine" in `policies.md`. If the user declines, or neither CLI is
   installed, use the Claude reviewer alone.

   - **Codex**, when installed and approved. Use high reasoning effort when
     `planEffort` is high or the plan covers security, privacy, auth, payments,
     migrations, concurrency, or cross-repository contracts, and medium
     otherwise:

     ```bash
     cd "$(ideas root)/<repos[0]>" && codex exec -c model_reasoning_effort=medium --sandbox read-only < /tmp/review-prompt.txt
     ```

   - **Gemini**, when installed and approved, as a second, differently-shaped
     read. The admin policy file allows only read and search tools, so Gemini
     cannot write or run shell commands in any mode:

     ```bash
     cd "$(ideas root)/<repos[0]>" && gemini -p "$(cat /tmp/review-prompt.txt)" --approval-mode plan --admin-policy "${CLAUDE_PLUGIN_ROOT}/shared/gemini-review-readonly.toml" -o text
     ```

   - **Claude**, always available. Dispatch the `idea-pipeline:planner-reviewer`
     agent with the prompt file's contents, the plan path, and the repo path.
     It is read-only and runs in a fresh context, so it has not seen the plan
     being written. Use it when no external reviewer runs, or alongside one
     when the plan is high effort.

   If a reviewer fails or is unavailable, say so once and continue with the
   others. Never report an unavailable reviewer as a clean review.

4. **Triage before fixing.** This is the step that matters. For every medium
   and above finding, confirm it is real by reading the code or tracing it to a
   concrete failing input. **Drop the ones you cannot confirm** rather than
   changing a working plan to satisfy a false positive. Then apply the value
   gate in `policies.md`: fix a confirmed finding only when it has a concrete
   user, data, security or cost consequence. A real race or state hole with no
   such consequence is listed as accepted in the verdict, not folded into the
   plan. Validate advice, act only if needed.

   **Stop and ask** instead of fixing when a reviewer says the approach is
   wrong, or when the fixes would materially grow the plan (a schema change, a
   new repo, or roughly doubling the work). Give the user the harm line and a
   recommendation (usually kill) as labeled options.

5. **Fold confirmed findings into the plan file itself**, in place. The plan is
   the artifact `/idea-execute` reads, so a finding that lives only in a review
   comment has not been fixed. Where a finding changed a decision, say so in
   the plan and say what the earlier draft got wrong. A plan that records its
   own corrections is one a later session can trust.

6. **Re-rate if the review changed the shape.** A review that surfaces a
   migration turns a medium into a high.

7. **Write the verdict and move.**

   ```bash
   ideas set <id> --review-verdict=@/tmp/verdict.md
   ideas move <id> --to=reviewed
   ```

   The verdict is a short summary for the user: which reviewers ran, how many
   findings, how many confirmed, which ones changed the plan, and anything you
   dropped and why.

8. **Report** with the count and:

   ```
   Next: /idea-pipeline:idea-queue a4f1   or   /idea-pipeline:idea-kill a4f1 "<reason>"
   ```

## If the review says the plan is wrong

Not merely incomplete, but wrong in its approach. Then the plan does not need
patching, it needs rewriting from the brief:

```
/idea-pipeline:idea-revise a4f1 "review found the approach doesn't hold: <why>"
```

This is the user's call, not an automatic loop. Stop and ask them, with the
harm line, what the rewrite would cost, and a recommendation, as labeled
options (kill, rewrite, or accept the plan as is). Only on "rewrite": run
`/idea-revise` with the confirmed reason, preserve the rejected plan file, use
`/idea-plan` to write a replacement from the brief, and review the replacement
once.

For amendments to a sound approach, make one amendment pass with the findings
that passed the value gate, recheck only the material ones, and record the
verdict. Do not re-review in a loop until no finding remains. Record any
limitation honestly. Update the idea's plan path, tasks, effort and verdict
through the CLI. Do not queue or implement as part of review completion.
