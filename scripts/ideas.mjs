#!/usr/bin/env node
/**
 * ideas: the command-line surface over ideas-store.
 *
 * Every /idea-* skill shells out to this. It never decides anything; the gates
 * and the state machine live in ideas-store.js so there is exactly one copy.
 *
 *   ideas init
 *   ideas add --title="..." [--notes="..."] [--project=id] [--impact=3] [--effort=low]
 *   ideas list [--stage=queued] [--mine] [--json]
 *   ideas get <id> [--json]
 *   ideas set <id> --brief=@file --plan-effort=low --repos=a,b ...
 *   ideas move <id> --to=queued [--note="..."]
 *   ideas next
 *   ideas sync [--publish-only] [--drain-only]
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  transact, read, newIdea, findIdea, applyTransition,
  waitingOn, nextAction, STAGES, REVIEW_CAP, ROOT, STORE,
} from './ideas-store.mjs';
import { publish as publishIdeas, drain as drainIdeas } from './ideas-sync.mjs';
import { resolveSyncEnv } from './store-dir.mjs';

// ------------------------------------------------------------------- args

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const [k, ...rest] = arg.slice(2).split('=');
      const v = rest.join('=');
      flags[k] = v === '' ? true : v;
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

/** `--brief=@path` reads the file, so skills can hand over multi-line prose. */
function resolveValue(v) {
  if (typeof v === 'string' && v.startsWith('@')) {
    return fs.readFileSync(v.slice(1), 'utf8');
  }
  return v;
}

const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

// ---------------------------------------------------------------- reporting

function reportWrite(result) {
  if (!result.changed) return;
  if (result.warning) process.stderr.write(`warning: ${result.warning}\n`);
  else if (result.committed && !result.pushed && !result.noRemote) {
    process.stderr.write('warning: committed locally, not pushed\n');
  }
}

function fmtRow(i) {
  const eff = i.planEffort || i.effort || '-';
  const imp = i.impact == null ? '-' : String(i.impact);
  return [
    i.id.padEnd(20),
    i.stage.padEnd(9),
    eff.padEnd(6),
    `i${imp}`.padEnd(4),
    (i.projectId || '-').padEnd(10),
    i.title,
  ].join('  ');
}

// ---------------------------------------------------------------- commands

const commands = {
  init() {
    fs.mkdirSync(ROOT, { recursive: true });
    if (!fs.existsSync(path.join(ROOT, '.git'))) {
      execFileSync('git', ['init', '--quiet', '-b', 'main'], { cwd: ROOT });
    }
    if (!fs.existsSync(STORE)) {
      fs.writeFileSync(STORE, JSON.stringify({ rev: 0, ideas: [] }, null, 2) + '\n');
    }
    // my-day-config.json is the desktop app's live state, which also lives
    // here. It is deliberately not tracked.
    const ignore = path.join(ROOT, '.gitignore');
    if (!fs.existsSync(ignore)) {
      fs.writeFileSync(ignore, '.lock\n*.tmp\nmy-day-config.json\nmy-day-config.json.bak.*\n');
    }
    try {
      execFileSync('git', ['add', '.gitignore', 'ideas.json'], { cwd: ROOT });
      execFileSync('git', ['commit', '--quiet', '-m', 'chore: init idea store'], { cwd: ROOT, stdio: 'ignore' });
    } catch { /* already committed */ }
    console.log(`store ready at ${ROOT}`);
    let hasRemote = false;
    try {
      execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: ROOT, stdio: 'ignore' });
      hasRemote = true;
    } catch { /* none */ }
    if (!hasRemote) {
      console.log('\nNo remote yet. To keep history off this machine, create a private repo and push to it, for example:');
      console.log(`  gh repo create <name> --private --source ${ROOT} --push`);
    }
  },

  add(positional, flags) {
    if (!flags.title) throw new Error('--title is required');
    const idea = newIdea({
      title: resolveValue(flags.title),
      notes: flags.notes ? resolveValue(flags.notes) : '',
      projectId: flags.project || null,
      impact: flags.impact ? Number(flags.impact) : null,
      effort: flags.effort || null,
    });
    const result = transact((doc) => {
      doc.ideas.push(idea);
      return `${idea.id}: captured`;
    });
    reportWrite(result);
    console.log(idea.id);
  },

  list(_positional, flags) {
    const doc = read();
    let rows = doc.ideas;
    if (flags.stage) rows = rows.filter((i) => i.stage === flags.stage);
    else if (!flags.all) rows = rows.filter((i) => i.stage !== 'shipped' && i.stage !== 'killed');
    if (flags.mine) rows = rows.filter((i) => waitingOn(i) === 'you');
    if (flags.project) rows = rows.filter((i) => i.projectId === flags.project);

    rows.sort((a, b) => {
      const ai = a.impact == null ? 0 : a.impact;
      const bi = b.impact == null ? 0 : b.impact;
      if (ai !== bi) return bi - ai;
      return a.createdAt.localeCompare(b.createdAt);
    });

    if (flags.json) { console.log(JSON.stringify(rows, null, 2)); return; }
    if (rows.length === 0) { console.log('nothing here'); return; }
    for (const i of rows) console.log(fmtRow(i));

    const reviewed = doc.ideas.filter((i) => i.stage === 'reviewed').length;
    if (reviewed >= REVIEW_CAP) {
      console.log(`\n${reviewed}/${REVIEW_CAP} at reviewed. Review is blocked until you queue or kill one.`);
    }
  },

  get(positional, flags) {
    const doc = read();
    const idea = findIdea(doc, positional[0]);
    if (flags.json) { console.log(JSON.stringify(idea, null, 2)); return; }
    console.log(`${idea.id}  ${idea.title}`);
    console.log(`  stage       ${idea.stage}   (waiting on: ${waitingOn(idea)})`);
    console.log(`  next        ${nextAction(idea)}`);
    console.log(`  project     ${idea.projectId || '-'}`);
    console.log(`  repos       ${idea.repos.length ? idea.repos.join(', ') : '-'}`);
    console.log(`  impact      ${idea.impact ?? '-'}`);
    console.log(`  effort      you: ${idea.effort || '-'}   plan: ${idea.planEffort || '-'}`);
    if (idea.planPath) console.log(`  plan        ${idea.planPath}`);
    if (idea.github) console.log(`  issue       ${idea.github.url}`);
    if (idea.killedReason) console.log(`  killed      ${idea.killedReason}`);
    if (idea.notes) console.log(`\n${idea.notes}\n`);
    if (idea.brief) console.log(`--- brief ---\n${idea.brief}\n`);
    if (idea.proposedTasks?.length) {
      console.log('--- tasks ---');
      for (const t of idea.proposedTasks) console.log(`  - ${t}`);
    }
  },

  set(positional, flags) {
    const id = positional[0];
    if (!id) throw new Error('usage: ideas set <id> --field=value');
    const writable = new Set([
      'title', 'notes', 'projectId', 'impact', 'effort', 'planEffort',
      'proposalPending', 'brief', 'proposedTasks', 'planPath',
      'reviewVerdict', 'killCriteria', 'killedReason', 'repos', 'batchId', 'github',
    ]);
    const result = transact((doc) => {
      const idea = findIdea(doc, id);
      const applied = [];
      for (const [rawKey, rawVal] of Object.entries(flags)) {
        const key = camel(rawKey);
        if (!writable.has(key)) throw new Error(`${key} is not settable (or is stage — use \`ideas move\`)`);
        let val = resolveValue(rawVal);
        if (key === 'impact') val = Number(val);
        if (key === 'repos' || key === 'proposedTasks') {
          val = String(val).split(key === 'repos' ? ',' : '\n').map((s) => s.trim()).filter(Boolean);
        }
        if (key === 'github') val = JSON.parse(val);
        if (key === 'proposalPending') val = val === true || val === 'true';
        if (['planEffort', 'effort'].includes(key) && !['low', 'medium', 'high'].includes(val)) {
          throw new Error(`${key} must be low, medium, or high`);
        }
        idea[key] = val;
        applied.push(key);
      }
      if (applied.length === 0) return null;
      idea.updatedAt = new Date().toISOString();
      return `${idea.id}: set ${applied.join(', ')}`;
    });
    reportWrite(result);
    if (result.changed) console.log('ok');
  },

  move(positional, flags) {
    const id = positional[0];
    if (!id || !flags.to) throw new Error('usage: ideas move <id> --to=<stage> [--note="..."]');
    let moved;
    const result = transact((doc) => {
      const idea = findIdea(doc, id);
      applyTransition(doc, idea, flags.to, { note: flags.note ? String(flags.note) : null });
      moved = idea;
      return `${idea.id}: ${flags.to}`;
    });
    reportWrite(result);
    console.log(`${moved.id} -> ${moved.stage}`);
    console.log(`next: ${nextAction(moved)}`);
  },

  next() {
    const doc = read();
    const mine = doc.ideas.filter((i) => waitingOn(i) === 'you' && i.stage !== 'shipped' && i.stage !== 'killed');
    if (mine.length === 0) { console.log('Nothing waiting on you.'); return; }
    mine.sort((a, b) => (b.impact ?? 0) - (a.impact ?? 0));
    const reviewing = mine.filter((i) => i.stage === 'reviewed');
    if (reviewing.length) {
      console.log(`${reviewing.length} plan(s) ready to read.\n`);
    }
    for (const i of mine) {
      console.log(`${i.id.padEnd(20)} ${i.title}`);
      console.log(`${''.padEnd(20)} ${nextAction(i)}\n`);
    }
  },

  stages() {
    console.log(STAGES.join(' -> '));
  },

  /** The resolved store folder, so skills and shells never hardcode it. */
  home() {
    console.log(ROOT);
  },

  /**
   * Move captures down and the projection up.
   *
   * Exists so the pipeline still reaches the phone with the desktop app shut,
   * which matters because the desktop is not always the thing that is running
   * when an idea gets captured on the move.
   */
  async sync(_pos, flags) {
    const { url, token } = resolveSyncEnv(process.env);
    if (!url || !token) {
      throw new Error('set MY_AI_WORKDAY_URL and MY_AI_WORKDAY_TOKEN (or MY_AI_WORKDAY_PUBLISH_TOKEN) to sync. The MY_DAY_* names still work.');
    }
    const cfg = { url, token };

    if (!flags['publish-only']) {
      const d = await drainIdeas(cfg);
      if (!d.ok) console.log(`drain failed: ${d.error}`);
      else {
        console.log(`drained ${d.written} new, ${d.duplicates} already had`);
        for (const r of d.rejected || []) console.log(`  refused capture ${r.captureId}: ${r.error}`);
        if (d.remaining) console.log(`  ${d.remaining} more queued, next run takes them`);
        if (d.ackFailed) console.log(`  ack failed, will replay: ${d.ackFailed}`);
      }
    }

    if (!flags['drain-only']) {
      const p = await publishIdeas(cfg);
      if (p.ok) console.log(`published rev ${p.rev}, ${p.pendingCaptures} capture(s) pending`);
      else console.log(`publish failed: ${p.error}`);
    }
  },
};

// --------------------------------------------------------------------- main

const [, , cmd, ...rest] = process.argv;
if (!cmd || cmd === '--help' || !commands[cmd]) {
  console.log(`ideas <command>

  init                     create the store folder as a git repo
  add --title="..."        capture an idea            [--notes --project --impact --effort]
  list                     open ideas                 [--stage= --mine --project= --all --json]
  get <id>                 one idea in full           [--json]
  set <id> --field=value   write fields (@file reads a file)
  move <id> --to=<stage>   transition, gates enforced [--note="..."]
  next                     what is waiting on you
  stages                   the state machine
  home                     print the store folder
  sync                     drain phone captures, publish projection`);
  process.exit(cmd && cmd !== '--help' ? 1 : 0);
}

const { positional, flags } = parseArgs(rest);
try {
  await commands[cmd](positional, flags);
} catch (e) {
  process.stderr.write(`${e.message}\n`);
  process.exit(1);
}
