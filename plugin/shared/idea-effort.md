# Idea effort rubric

Read this before assigning `planEffort`. Every command that rates, re-rates, or
gates on a rating uses this file so the words mean the same thing every time.

The rating describes **the shape of the session**, not how long it takes. Do
not think in hours.

## low

- Touches **one** repo.
- No schema change, no migration, no API contract change.
- No new dependency.
- The plan for it fits on a page.
- Existing tests cover the surface, or the change is not test-bearing.

A low idea takes the express lane: it may go from `shaped` straight to
`queued`, skipping plan and review. The user makes that move, never the model.

## medium

- Touches one repo deeply, or two repos lightly.
- Changes a contract that has exactly one consumer.
- Adds a dependency, or a new endpoint with no schema behind it.
- Needs new tests, but not a new test strategy.

## high

Any **one** of these is sufficient:

- Crosses repos (backend plus a client, or two clients).
- Changes a shared API contract that a shipped mobile client consumes.
- Needs a schema change or a migration.
- Carries a rollback plan.
- Touches production data in any way. **This one is absolute**: a two-line
  change that writes to a production table is high, no matter how small the
  diff looks.
- Touches auth, payments, or privacy gating.

## When you are between two ratings

Round **up**. The cost of over-rating is one extra planning session. The cost
of under-rating is work that skipped adversarial review and should not have.

## What the rating controls

- **Scheduling.** Low ideas may be batched into one execute session; medium and
  high never are.
- **Scrutiny.** Low may skip `/idea-plan` and `/idea-review`.

Because it controls scrutiny, the rating is a **proposal** when a model assigns
it. The user decides whether to act on it by choosing to queue. Never describe a
rating as settling what happens next.
