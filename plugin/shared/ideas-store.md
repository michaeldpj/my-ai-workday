# Idea store contract

`ideas.json` in the store folder is written by exactly one piece of code, the
`ideas` command this plugin puts on PATH. The store folder is shared with the
My AI Workday app, `~/.my-ai-workday` unless `MY_AI_WORKDAY_HOME` names another,
and `ideas home` prints it:

```
ideas <command>
```

If the shell cannot find `ideas`, the skill that sent you here names the full
`node .../lib/ideas.mjs` form to use in its place.

**Never** read or write `ideas.json` directly, with `cat`, `jq`, python, or an
Edit. The CLI holds an exclusive lock, re-reads inside it, bumps a revision,
writes through a unique temp file, and commits. Bypassing it loses other
sessions' writes, and several sessions run at once as a matter of course.

## Projects and repos

Projects are the cards on the My AI Workday board. The CLI reads them, and
never writes them, from the app's config beside the store:

```
ideas projects            id, name and repos, one card per line
ideas projects --json     [{ "id": "twig", "name": "Twig", "repos": ["twig-web", "twig-api"] }]
```

An idea's `projectId` is one of these ids, and its `repos` are folder names
under the folder `ideas root` prints, which is the app's Repo Folder setting
(`~/github` until it is changed). Repo names can contain spaces, so always
quote the joined path: `cd "$(ideas root)/<repo>"`. Read both fresh rather
than relying on an earlier read, because the board can change between steps.

When `ideas projects` prints nothing, the app has no cards yet or has never
run. Ask the user for a short lowercase project id and the repo folder names,
use them as given, and tell them the idea will show under that project on the
board once a card with that id exists.

When a skill needs to read a repo and `"$(ideas root)/<repo>"` does not exist,
it stops and tells the user to open the app and set Repo Folder in Settings.
Writing a brief or plan without having read the code is worse than waiting.

## Commands

```
ideas init                        create the store (idempotent)
ideas add --title="..."           capture; prints the new id
      [--notes="..."|@file] [--project=id] [--impact=1..5] [--effort=low|medium|high]
ideas list                        open ideas
      [--stage=X] [--mine] [--project=id] [--all] [--json]
ideas get <id> [--json]           one idea in full
ideas set <id> --field=value      write fields
ideas move <id> --to=<stage>      transition; all gates enforced
      [--note="..."]
ideas next                        what is waiting on the user
ideas stages                      print the state machine
ideas home                        print the store folder
ideas projects [--json]           the app's project cards
ideas root                        the folder repos live in
ideas sync                        drain phone captures, publish projection
                                  (needs MY_AI_WORKDAY_URL and a token, and
                                  refuses cleanly without them)
```

An id may be given in full (`idea-mt3k9x2p-a4f1`) or by its trailing segment
(`a4f1`). An ambiguous short id is refused rather than guessed.

### Passing prose

Any value may be `@path` to read a file. Use this for briefs, plans, and
verdicts rather than trying to quote multi-line text through a shell:

```
ideas set a4f1 --brief=@/tmp/brief.md --plan-effort=medium
```

Write those files with a quoted heredoc in the shell (`cat > /tmp/brief.md
<<'EOF'`), not with a file-editing tool.

### Settable fields

`title notes projectId impact effort planEffort proposalPending brief
proposedTasks planPath reviewVerdict killCriteria killedReason repos batchId github`

`repos` is comma-separated. `proposedTasks` is newline-separated. `github` is
JSON. **`stage` is not settable** — use `ideas move`, which is the only path
that enforces the state machine.

## The state machine

```
inbox -> shaped -> planned -> reviewed -> queued -> building -> built -> shipped
                     `-------- shaped <-'              ^          |
killed <- (any)                                        `----------'
inbox <- killed
```

Legal moves and who may make them are declared in `ideas-store.mjs`
(`TRANSITIONS`). Do not reimplement them. Call `ideas move` and read the error:
a refusal always names the current stage and what would advance it.

Three moves require `--note`: `planned`/`reviewed` back to `shaped` (revise),
`building` back to `queued` (reset), and `killed` back to `inbox` (reopen).

## Gates the CLI enforces for you

- **Project before shaping.** An idea with no `projectId` cannot reach
  `shaped`, because tasks live on a project.
- **Express lane.** `shaped -> queued` only when `planEffort` is `low`.
- **Review cap.** `planned -> reviewed` refuses when ten ideas already sit at
  `reviewed`, and names them. Enforced there, not at plan time, because
  `reviewed` is the pile that waits on the user.

## Failure modes worth knowing

- **Lock contention** returns a clear error after about five seconds. Retry.
  A lock whose owning process is gone is cleared automatically.
- **Push failures never block.** The commit lands locally and a warning prints.
  The next command carries both and says so.
- **No remote configured** is silent, not a warning. It is a legitimate state.
