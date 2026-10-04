---
name: session-issue
description: Document the current session as a closed GitHub Issue, or update the open issue that already tracks the work (such as an idea issue) — summary, commits, changed files, artifact permalinks — labeled by work type (bug/enhancement/maintenance/etc) plus a constant session-log label. Use when the user says "log this session", "session issue", "document this session", or invokes /session-issue. Also used by /idea-execute to record a session on an idea's open issue, and prompted by the plugin's stop hook after a session pushes. Works in any repo whose origin is on GitHub; skips cleanly otherwise.
---

Creates one GitHub Issue per work session as a permanent record of what was asked, what shipped, and where the artifacts live. Issues are created CLOSED (they record completed work, not todos) and carry a constant `session-log` label so the running list is one filter away: `gh issue list --state all --label session-log`.

## Create or update

Create a new closed `session-log` issue by default. When an open issue already tracks this work, such as the idea issue `/idea-execute` opens and records in the idea's `github` field, update that issue instead. Append a `## Session record (<date>)` section to its body with the same facts (summary, commits, verification, what is still pending) through `gh issue edit --body-file`, preserve the existing body and its `## Decisions` log, and leave the issue open, since `/idea-ship` closes it. Do not create a second issue for the same session. Either path clears the stop-hook marker.

## Non-fatal contract (CRITICAL)

This skill NEVER fails its caller. When invoked from another workflow such as `/idea-execute`, any error here (no GitHub remote, gh auth problem, label or issue API failure) prints a one-line warning and returns success. The work already happened; this is bookkeeping.

## Steps

1. **Preconditions.** Run `gh repo view --json nameWithOwner -q .nameWithOwner`. If it fails (no origin, origin not GitHub, gh unauthenticated), print `session-issue: no GitHub repo detected, skipping` and stop. Record the `owner/repo` value for permalinks.

2. **Gather session facts.** You are running inside the session being documented, so most of this is already in your context:
   - The original request(s), in one or two sentences each.
   - The commits created during this session. You know their SHAs from your own `git commit` output; verify with `git log --oneline -15`. Do NOT include commits from prior sessions.
   - Changed files: `git diff --stat <first-session-commit>^..<last-session-commit>` (or the equivalent across a merge).
   - Verification status: which test/build/deploy checks ran and their pass/fail results.
   - Artifacts produced this session: plan files (e.g. `docs/plans/*.md`), documents, images. Note which are committed and which are not.

3. **Derive labels from the session's conventional-commit subjects.** Map every distinct type that appears:

   | Commit type | Label | Color |
   | --- | --- | --- |
   | `fix` | `bug` | `d73a4a` |
   | `feat` | `enhancement` | `a2eeef` |
   | `refactor`, `chore`, `ci` | `maintenance` | `fbca04` |
   | `docs` | `documentation` | `0075ca` |
   | `perf` | `performance` | `5319e7` |
   | `test` | `testing` | `0e8a16` |

   Always add `session-log` (color `6f42c1`, description "Automated session record"). Create each label idempotently before use: `gh label create <name> --color <color> --force` (add `--description` for `session-log`). A label-create failure downgrades to using whatever labels already exist.

4. **Compose the issue body** in plain prose (plain vocabulary, no em dashes, no headers where a sentence does the job). Structure:

   ```markdown
   ## Request
   <what was asked, verbatim-adjacent>

   ## What shipped
   <2-6 sentences: outcome first, then the how. Include anything NOT shipped and why.>

   ## Commits
   - `<sha>` <subject>   (one line per session commit; full SHAs so GitHub auto-links)

   ## Files changed
   <the --stat summary, trimmed to the meaningful entries>

   ## Artifacts
   - [<name>](https://github.com/<owner>/<repo>/blob/<sha>/<path>)   (committed artifacts only)
   - <name> (uncommitted, local only)

   ## Verification
   <each check run and its result, e.g. "PHPUnit: pass. Deploy smoke: 200 on /api/health.php.">

   ## Follow-ups
   <only items that NEED follow-up, each as a concrete action and who takes it,
   or "None.">

   Accepted: <optional, one line naming residuals not worth acting on>
   ```

   Value gate ("Still open means must act" in
   `${CLAUDE_PLUGIN_ROOT}/shared/policies.md`): Follow-ups holds only shipped breakage that can hurt users or
   data, an unfinished step of the requested task, or a decision only the user
   can make. No "look at", "test", "consider", "monitor", "capture an idea",
   optional hardening or hypothetical races. Nothing here becomes an idea.

   Permalink rule: link an artifact ONLY at a SHA that is pushed to origin (`git branch -r --contains <sha>` is non-empty). An unpushed commit's artifacts are listed as plain paths with an "(unpushed)" note — a dead permalink is worse than no link.

5. **Create and close the issue**, only on the create path. When updating an existing open issue under "Create or update", skip this step and step 6, write the record into that issue with `gh issue edit --body-file`, and leave it open. Otherwise write the body to a scratch file, then:

   ```bash
   gh issue create --title "Session: <short summary> (<YYYY-MM-DD>)" --body-file <scratch> --label session-log --label <derived...>
   gh issue close <number> --reason completed
   ```

   Print the issue URL as the final line.

6. **Add to the project board (non-fatal, best-effort).** Look for a `session-project: <N>` line in the repo-root `CLAUDE.md` (then `AGENTS.md`, then `docs/project-context.md`) — a plain line, not inside a fenced code block, e.g. `session-project: 1`. If found:

   ```bash
   gh project item-add <N> --owner <owner> --url <issue-url>
   ```

   `<owner>` is the owner half of the `owner/repo` from step 1. No marker present → skip silently, no warning (most repos will never have one). Marker present but `gh project item-add` fails (wrong number, board deleted, scope missing) → print a one-line warning and continue; never treat this as a reason to reopen or otherwise touch the issue.

   If the add succeeded, also set the board's `Work Type` single-select field to match the primary derived label (the type of the majority of the session's commits — `bug`→Bug, `enhancement`→Enhancement, `maintenance`→Maintenance, `documentation`→Documentation, `performance`→Performance, `testing`→Testing; if multiple types are equally represented, pick the one from the most recent commit):

   ```bash
   gh project item-edit <N> --owner <owner> --url <issue-url> --field "Work Type" --value <Bug|Enhancement|Maintenance|Documentation|Performance|Testing>
   ```

   Same best-effort, non-fatal case as the item-add itself — warn and continue on failure, the issue and its labels already exist regardless.

7. **Nothing found?** If the session produced no commits and no artifacts (a pure Q&A session), ask whether to log it anyway when invoked directly; when invoked from another workflow, skip silently.

## Red flags

- Failing or blocking the caller because this skill errored — forbidden, see the non-fatal contract.
- Leaving a newly created session record open. Session records are closed on creation. An existing idea issue that you updated stays open until `/idea-ship`.
- Permalinking an unpushed SHA.
- Including commits from a previous session because `git log` was read without cross-checking what THIS session actually committed.
- Pasting whole plan documents into the body instead of linking them.
- Failing the skill (or the workflow it's called from) because `gh project item-add` errored — that step is best-effort, same as the rest of this skill.
