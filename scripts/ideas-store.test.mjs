import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// The store folder is resolved once at import, so the env must be set before
// the dynamic import below. applyTransition itself never touches disk.
const dir = await mkdtemp(path.join(tmpdir(), 'ideas-store-'));
delete process.env.MY_DAY_HOME;
process.env.MY_AI_WORKDAY_HOME = dir;
const { newIdea, applyTransition } = await import('./ideas-store.mjs');

after(async () => { await rm(dir, { recursive: true, force: true }); });

/** An idea at `stage` carrying every artifact, so only the note rule can refuse it. */
const at = (stage) => ({
  ...newIdea({ title: 'x', projectId: 'p' }),
  stage, brief: 'b', planPath: 'docs/plans/x.md', reviewVerdict: 'v', github: { number: 1 },
});
const doc = () => ({ rev: 0, ideas: [] });

for (const from of ['inbox', 'shaped', 'planned', 'reviewed', 'queued', 'built']) {
  test(`${from} to killed without a reason is refused`, () => {
    assert.throws(() => applyTransition(doc(), at(from), 'killed'), /requires a reason/);
    assert.throws(() => applyTransition(doc(), at(from), 'killed', { note: '' }), /requires a reason/);
    assert.throws(() => applyTransition(doc(), at(from), 'killed', { note: '   ' }), /requires a reason/);
  });

  test(`${from} to killed with a reason records it as killedReason`, () => {
    const i = applyTransition(doc(), at(from), 'killed', { note: 'not worth it' });
    assert.equal(i.stage, 'killed');
    assert.equal(i.killedReason, 'not worth it');
    assert.equal(i.history.at(-1).note, 'not worth it');
  });
}
