# Idea brief template

The brief is what the user reads to decide whether an idea is worth planning. It
is written by `/idea-brainstorm` after reading the actual repos, and it is read
again by `/idea-plan`, `/idea-review`, and `/idea-execute`, so its shape must
not drift.

Write it in plain vocabulary, with no em dashes and at most one semicolon (only
to join a correction). Prefer long additive sentences of 20 to 30 words, with
occasional shorter ones that finish a thought rather than punch it.

Aim for 250 to 500 words. A brief that runs past a page is a plan wearing a
brief's clothes, and it means the idea should have been split.

---

## Template

```markdown
**Recommend: build** or **Recommend: accept, don't build**

**Harm:** one line. Who is affected, how often, the worst outcome, and whether
it heals on its own (for example "an already-authorized viewer keeps a URL for
up to 4h, then it expires").

## The problem

What is actually wrong today, stated concretely. Not the feature. The problem
the feature would solve. If you cannot name a moment where the current
behavior costs something, say so plainly, because that is itself the finding.

## Who it hurts

The user, a user of one of the apps, or a future session working in the code.
Be specific about which, because it changes what "done" means.

## Sketch

Two or three paragraphs on the approach. Enough that a plan could be written
from it, not so much that the plan is already written. Name the mechanism, not
the implementation.

## Blast radius

- **Repos**: every repo that changes
- **Endpoints**: API surfaces added, changed, or removed
- **Tables**: schema touched, and whether a migration is needed
- **Clients**: whether a shipped mobile build consumes any of this

This section decides the effort rating, so it is not optional and it is not a
guess. Read the code and list what is really there.

## Open questions

Things a plan cannot resolve on its own and that the user has to answer. If
there are none, say none. Do not manufacture them.

## Kill criteria

What would make this not worth doing. Write two or three, and make them
testable. "It turns out nobody uses trip albums" is a kill criterion.
"It gets complicated" is not.

## Tasks

One to three coarse tasks, present tense, imperative. These become real tasks
on the project when the user accepts the brief, and `/idea-plan` later replaces
them with the plan's actual steps.
```

---

## Rules

- **The harm line decides the recommendation.** If the harm is bounded,
  self-healing, cosmetic, or needs an already-authorized actor, the brief
  recommends accepting it and stops at The problem, Who it hurts and Kill
  criteria. It does not sketch a build or rate effort. This is the value gate
  in `policies.md` (same folder), and it outranks completeness.
- **Do not rewrite `notes`.** The raw capture stays verbatim forever. The brief
  is a separate field.
- **Read the repos before writing.** A brief written without opening the code
  is worthless, and the blast radius section will be wrong, which means the
  effort rating will be wrong, which means work may skip review that should not
  have.
- **The brief is a proposal.** It lands with `proposalPending: true` and
  the user accepts or edits it. Say what you are unsure about rather than
  writing confidently around a gap.
- **Kill criteria are the point.** They are the thing that makes triage
  possible three weeks later when the idea no longer sounds as good. Write them
  as though you will be the one arguing against yourself.
