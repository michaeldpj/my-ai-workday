---
name: idea-ship
description: Mark a built idea as shipped after the user has deployed or accepted it, closing its GitHub Issue. Use when they say "shipped X", "that's deployed", "close out idea X", or invokes /idea-ship.
---

# /idea-ship <id>

The last step, and it is the user's. An idea sits at `built` with a pushed
branch and an open issue until they deploy it or accept it.

The store CLI is `ideas`. If the shell cannot find it, run `node "${CLAUDE_PLUGIN_ROOT}/lib/ideas.mjs"` in its place.

Read `${CLAUDE_PLUGIN_ROOT}/shared/ideas-store.md` first.

## Steps

1. Confirm the idea is `built`. If it is not, say what stage it is in.

2. **Do not deploy.** If the user has not deployed yet and the repo deploys,
   say so and stop. Nothing in this pipeline runs a deploy, including this
   command.

3. Close the issue with one line saying what shipped and what is still dark:

   ```bash
   gh issue close <number> -R <repo> --comment "Shipped <YYYY-MM-DD>: <commit sha, or accepted without deploy>. <Nothing dark. | Dark: <flag> (<reason>, on when <condition>)>"
   ```

   Read flag state from the running system at ship time, never from memory or
   the CHANGELOG. If this session or its session record already says what
   deployed, reuse it. If nothing says what deployed, ask the user once.

4. Move it:

   ```bash
   ideas move <id> --to=shipped
   ```

5. If this was part of a batch, the siblings ship independently. One member
   shipping says nothing about the others.
