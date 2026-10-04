---
name: idea-revise
description: Send a planned or reviewed idea back to shaped when the plan's approach turns out to be wrong. Use when the user says "the plan is wrong", "revise idea X", or invokes /idea-revise.
---

# /idea-revise <id> "<reason>"

`planned` or `reviewed` back to `shaped`. For when the plan is wrong in its
approach, not merely incomplete.

The store CLI is `ideas`. If the shell cannot find it, run `node "${CLAUDE_PLUGIN_ROOT}/lib/ideas.mjs"` in its place.

Read `${CLAUDE_PLUGIN_ROOT}/shared/ideas-store.md` first.

```bash
ideas move <id> --to=shaped --note="<reason>"
```

## Incomplete versus wrong

An **incomplete** plan gets amended in place by `/idea-review`. A missing edge
case, an unlisted call site, a thin test section: fix it where it stands.

A **wrong** plan gets revised. The approach does not hold, the mechanism was
the wrong one, the brief itself misread the problem. Patching a wrong plan
produces a plan with a broken spine and a lot of scar tissue.

## What to do with the old plan file

Leave it. Do not delete it and do not overwrite it. The standing rule is that a
new task gets a new plan file, and the same holds here: the next
`/idea-plan` writes a new dated file, and the old one is the record of an
approach that was tried and rejected. Note in the reason which file was
abandoned.

Revising clears nothing else. The brief, the rating, and the kill criteria all
survive, because the idea is still the idea. Only the approach failed.

## Revision during a requested review

"Review completion includes updating the plan" in
`${CLAUDE_PLUGIN_ROOT}/shared/policies.md` authorizes the reviewing agent to
run this transition when source verification shows the approach fails. Continue
with `/idea-plan` and independent review of the replacement in the same task.
Preserve the old file and update the idea's plan reference through the CLI.
Do not require the user to run the follow-up commands. This authorizes plan
maintenance, not queueing or application implementation.
