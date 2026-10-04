---
name: idea
description: Capture an idea into the cross-repo pipeline without planning or building it. Use when the user says "capture this idea", "new idea", "add to the pipeline", or invokes /idea. Captures only — it must not brainstorm, plan, or write code.
---

# /idea

Capture, and nothing else.

The store CLI is `ideas`. If the shell cannot find it, run `node "${CLAUDE_PLUGIN_ROOT}/lib/ideas.mjs"` in its place.

Read `${CLAUDE_PLUGIN_ROOT}/shared/ideas-store.md` for the store contract.

## The hard rule

This command **captures**. It does not brainstorm, does not read repos, does
not write a plan, and does not touch code. The whole point of the pipeline is
that there is a stage between an idea and a branch, and this is that stage.

If the user's notes are clearly a request to build something right now, say so
and ask whether they want it captured or built. Do not silently do both.

## Steps

1. **Title.** Distill the notes to a short imperative noun phrase, under about
   sixty characters. "Batch low ideas into one execute session", not "Idea
   about maybe batching things".

2. **Project.** Map the idea to one of the projects on the board. Read them
   with `ideas projects`.

   If nothing fits, leave it unset. An unassigned idea is legal and can be
   assigned later. Do not force a bad fit. If it prints nothing, follow the
   empty-list rule in `${CLAUDE_PLUGIN_ROOT}/shared/ideas-store.md`.

3. **Impact.** Ask the user for 1 to 5 if they did not say. Do not guess it —
   impact is their judgment about their own priorities and the model has no
   standing to assign it.

4. **Effort.** Ask for low, medium, or high. This is their gut read, and it is a
   separate field from the rating a brainstorm will later propose. Both are
   kept so a divergence is visible.

5. **Capture.** Notes go in verbatim. Never paraphrase them, never clean them
   up. Write them to a file and pass `@file` if they are multi-line.

   ```bash
   ideas add \
     --title="..." --notes=@/tmp/notes.txt --project=twig --impact=4 --effort=medium
   ```

6. **Report.** Print the id and the next command:

   ```
   idea-mt3k9x2p-a4f1 captured.
   Next: /idea-pipeline:idea-brainstorm a4f1
   ```

## If several ideas arrive at once

Capture each separately. One idea per row. A row holding three ideas cannot be
rated, queued, or killed independently, and it will be split painfully later.
