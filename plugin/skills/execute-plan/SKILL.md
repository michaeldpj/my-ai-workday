---
name: execute-plan
description: Execute an existing implementation plan with cost-aware subagent assignments, integration, and independent review. Use when the user asks to execute or implement a plan, including a supplied plan path. Do not activate for drafting or reviewing a plan alone, or for a small standalone fix.
---

# Execute a plan

Own assessment, decomposition, coordination, integration, and final acceptance.
Delegate substantial investigation, implementation, testing, and review to
subagents when available. The user authorizes choosing different available
models and reasoning efforts for those workers according to complexity and
cost. This authorization does not extend the plan's scope or authorize a push,
deployment, paid service, or production mutation.

## Assess and start

1. Read the plan and applicable repository instructions. Inspect relevant code
   and current git status to validate the plan and preserve existing work.
2. Check assumptions, completeness, dependencies, risks, and acceptance criteria.
   Resolve routine gaps. Ask only about material ambiguities that block safe
   progress. Do not turn a request to execute the plan into another approval gate.
3. Recommend the orchestrator model/effort, primary implementation model/effort,
   and exceptions, using models available in this environment. Briefly explain
   the choices. If changing your own setting needs user action, say so and
   continue with the actual setting when suitable. Never claim an unconfirmed switch.
4. Present a compact assignment table: task, dependencies, file ownership,
   model, reasoning effort, and verification. Then proceed unless blocked.

## Model selection

Use the runtime's available model list and supported effort levels. Cost means
expected cost to finish reliably, including retries and coordination. Do not
invent prices, usage figures, or savings.

| Responsibility | Worker | Setting |
| --- | --- | --- |
| Plan assessment and orchestration | This session | Opus-class at medium, high for architectural ambiguity or cross-repository dependencies |
| Factual lookup, documentation, mechanical edits | `Explore` or a general worker | Smallest capable model at low |
| Low-risk implementation: copy, local refactors, pattern-following edits, tests only | `idea-pipeline:plan-implementer-light` | Sonnet at medium |
| Everything else | `idea-pipeline:plan-implementer` | Opus at medium |
| Independent review of the diff | `idea-pipeline:plan-reviewer` | Opus at high |

Always use `idea-pipeline:plan-implementer`, never the light worker, for security, privacy,
auth, data migrations, bulk data writes, concurrency, integration flows, and
cross-repository contracts. Raise it to high effort for security, migrations,
concurrency, or difficult debugging, and to the highest effort only after a
failed attempt at high. A light-worker task that fails verification or turns
out to cross the risk line moves to `idea-pipeline:plan-implementer` rather than retrying on
the same model.

The reviewer never edits and always runs in a fresh context, so it has not seen
the implementation being written. For high-risk diffs, add a second read from
the Codex or Gemini CLI when one is installed and the user approves sending the
diff, per "Code leaving the machine" in `${CLAUDE_PLUGIN_ROOT}/shared/policies.md`.
Report any unavailable reviewer once and use the next option, and never report
an unavailable reviewer as a clean review.

Reserve the highest efforts for demonstrated need. After a failed attempt, use
the evidence to refine the task or escalate instead of repeating blind retries.
If delegation or model selection is unavailable, explain once and use the best
supported workflow. Report only delegation that actually occurred.

## Keep context and coordination small

- Search paths and symbols first, then read the relevant complete section.
  Include enough surrounding code for correctness. Read mandatory instructions
  directly and preserve their requirements.
- For large factual surveys that remain necessary, use a read-only worker with
  an explicit question, file scope, and concise report. Require file/symbol
  references and uncertainty. Verify citations against current source before
  editing or making a consequential conclusion. Summaries are navigation aids.
- Prefer deterministic tools for extraction, counting, formatting, and scaffolding.
  Do not send trivial I/O to another model merely because a file is large.
- Give each worker a focused brief: objective, dependencies, relevant context,
  owned files, constraints, acceptance criteria, and checks. Use fresh context,
  never a full conversation fork. Include necessary instructions and contract
  decisions explicitly.
- Parallelize independent tasks within the environment's limits. Serialize
  dependencies and overlapping edits. Keep shared contracts coordinated centrally.
- Work on integration or unresolved coordination while workers run. Do not repeat
  their investigation or rewrite accepted work without evidence of a problem.
- Handle small tasks and integration fixes directly when another worker would
  add more overhead than value. Do not spawn agents solely to fill a table.
- Workers return affected files, changes/findings, checks with results, and
  unresolved issues. Keep full logs on disk and return useful excerpts.

## Integrate and verify

- Track every plan requirement through implementation and acceptance.
- Inspect the actual diff and integrated behavior. A worker's success report is
  insufficient. Generated files still require review and meaningful checks.
- Use an independent review worker for substantial changes with the model policy
  above. Scope it to the diff, relevant surrounding code, and acceptance criteria.
  Re-review only new changes or unresolved findings, not the unchanged branch.
  Cap review at two rounds. A third round goes to the user instead of looping.
- Have the implementation worker write focused tests for the changed behavior.
  Use the test runner for pass/fail evidence, then have the independent reviewer
  check whether important failure cases are missing. Escalate difficult test
  design or failed integration gates to the orchestration or review model.
- Run appropriate checks and all repository-required gates. Fix failures and
  actionable findings before completion. Do not add redundant tests or repeat
  successful checks without a new change, failure, or unresolved concern.
- Preserve other contributors' changes. Follow repository review, commit, and
  documentation rules. Do not push or deploy without authorization.

Continue until the plan is implemented and verified or a concrete blocker needs
the user's input. Give concise progress updates on decisions, milestones, and
blockers. Finish with what shipped in the working scope, verification, remaining
limitations, and models/efforts actually used. Report measured usage only if available.
