# Pipeline policies

These are the working rules the idea skills cite. Edit them to fit how you
work. Each skill that applies one of them points here by section name.

## Value gate: edge cases are not projects

- Harm test first. Before proposing, capturing, planning or fixing a residual,
  state in one line who is affected, how often, the worst outcome, and whether
  it heals on its own. If the harm is bounded, self-healing, cosmetic, or needs
  an already-authorized actor, recommend accepting it and say so plainly,
  without sketching a build for it.
- Still open means must act. A closing summary, handoff, status entry or
  session log lists an item as still open only when it needs follow-up:
  something shipped is broken or unverified in a way that can hurt users or
  data, a step of the requested task was not done, or a decision or action
  only the user can take is blocking. Each item names the concrete action and
  who takes it. Never list "look at X", "test X", "consider X", "monitor X",
  "capture an idea for X", optional hardening, cleanup suggestions, or
  hypothetical races. If nothing needs follow-up, say "Nothing open." A
  residual worth knowing about but not acting on gets at most one "Accepted:"
  line and is never captured as an idea.
- Review findings need an outcome. A confirmed finding is folded into a plan or
  fixed only when it has a concrete user, data, security or cost consequence.
  Races and state-machine holes with no such consequence are listed as
  accepted in the verdict, not fixed.

## Ship live by default

- A new feature ships enabled for everyone. The only reason to ship dark is to
  protect users on a client build that the feature would break, and the flag
  turns on when the supporting build is out.
- Low and medium risk work goes straight to everyone. A limited trial is
  reserved for high-risk changes, such as bulk rewrites of existing user data
  or anything that widens who can see something, and it names its end date and
  what ends it.
- A plan that ships dark or runs a trial says why under these rules, and names
  the condition and the date for turning it on. A kill switch is fine.

## Review completion includes updating the plan

When a requested plan review finishes, assess its findings against the source
and amend the plan with the confirmed corrections that pass the value gate,
without waiting for a separate revision command. Run one review pass and one
amendment, not a loop. If a reviewer says the approach is wrong, or the fixes
would materially grow the plan (a schema change, a new repo, or roughly
doubling the work), stop and ask the user whether the idea is still worth
doing, with the harm line and a recommendation. Queueing, implementation and
deployment still need their own instruction from the user.

## Execution ends at a pushed branch

`/idea-execute` may commit and push a branch and open or update the idea's
GitHub Issue. It never deploys, imports a solution, publishes, releases, or
changes a production system, and it never creates a second issue for the same
idea. Deployment is the user's call, and `/idea-ship` records it afterwards.

## Code leaving the machine

The plan review in `/idea-review` can send the plan and relevant source to an
external reviewer (the Codex CLI or the Gemini CLI) when those are installed.
Ask the user before each such review, naming the tool and what will be sent,
unless the user has recorded a standing approval in their own `CLAUDE.md`.
Never send secrets, credentials, or environment variable values.
