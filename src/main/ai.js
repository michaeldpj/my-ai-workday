import Anthropic from '@anthropic-ai/sdk';
import { getDiff } from './git.js';

// One place for the model. Kept on Sonnet 4.6, which is current: Sonnet 5.5
// thinks by default, which the 100- and 200-token budgets below and
// analyzeStatuses' content[0].text read are not written for.
const MODEL = 'claude-sonnet-4-6';

let client = null;
let clientKey = null;

function getClient(apiKey) {
  if (!client || clientKey !== apiKey) {
    client = new Anthropic({ apiKey });
    clientKey = apiKey;
  }
  return client;
}

const STATUS_SYSTEM = `You are a workspace status analyzer. Given project data with repo scan results, determine if any project-level statuses should change.

Valid project statuses: active, blocked, parked, stable.
Rules: if all repos are stable/clean → project should be stable. If any repo has uncommitted work on a ship=true repo → active. If the focus line says BLOCKED → blocked. If all repos parked → parked.

Return ONLY a JSON array of suggested changes: [{"id":"projectId","current":"active","suggested":"stable","reason":"all repos clean"}]
If no changes needed, return []. No other text.`;

const DECOMPOSE_SYSTEM = `Break the given task into 3-5 concrete, actionable subtasks. Output each on its own line starting with "- ". No other text, no numbering, no headers.`;

const WEEKLY_SYSTEM = `You are a workspace assistant. Given a developer's git commit history from the past week and current project state, write a concise weekly digest:

1. Summary of what was accomplished (group by project)
2. Most active projects/repos
3. What's still pending or blocked
4. Momentum assessment — what has energy, what's stalling

Be concise. Use markdown. Keep under 500 words.`;

const BRIEFING_SYSTEM = `You are a workspace dashboard assistant for a developer managing multiple projects and git repos. Given the current state of all projects, repos, and tasks, provide a concise daily briefing:

1. Projects blocked or needing immediate attention
2. Repos with uncommitted or unpushed changes (group by project)
3. Suggested priority order for today
4. Any patterns or concerns worth noting

Be concise and actionable. Use markdown formatting. Keep it under 400 words.`;

function safeSend(win, channel, data) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}

export async function suggestCommitMessage(repoName, basePath, apiKey, win) {
  const diff = await getDiff(repoName, basePath);
  if (!diff.trim()) {
    safeSend(win, 'suggest-commit-message:chunk', 'No changes found');
    safeSend(win, 'suggest-commit-message:done');
    return;
  }
  const c = getClient(apiKey);
  const stream = c.messages.stream({
    model: MODEL,
    max_tokens: 200,
    messages: [{
      role: 'user',
      content: `Generate a concise conventional commit message for these changes. Output ONLY the commit message, no explanation or code fences.\n\n${diff.substring(0, 8000)}`,
    }],
  });
  stream.on('text', (text) => safeSend(win, 'suggest-commit-message:chunk', text));
  try { await stream.finalMessage(); } finally { safeSend(win, 'suggest-commit-message:done'); }
}

export async function getDailyBriefing(wsData, apiKey, win) {
  const c = getClient(apiKey);
  const stream = c.messages.stream({
    model: MODEL,
    max_tokens: 1000,
    system: [{
      type: 'text',
      text: BRIEFING_SYSTEM,
      cache_control: { type: 'ephemeral' },
    }],
    messages: [{
      role: 'user',
      content: JSON.stringify(wsData),
    }],
  });
  stream.on('text', (text) => safeSend(win, 'daily-briefing:chunk', text));
  try { await stream.finalMessage(); } finally { safeSend(win, 'daily-briefing:done'); }
}

export async function suggestFocusLine(projectId, wsData, apiKey, win) {
  const project = wsData.find(p => p.id === projectId);
  if (!project) {
    safeSend(win, 'suggest-focus-line:done');
    return;
  }
  const c = getClient(apiKey);
  const stream = c.messages.stream({
    model: MODEL,
    max_tokens: 100,
    messages: [{
      role: 'user',
      content: `Based on this project's current state, suggest a concise focus line (one sentence, under 80 chars). Be specific about what needs attention most.\n\nProject: ${JSON.stringify(project)}`,
    }],
  });
  stream.on('text', (text) => safeSend(win, 'suggest-focus-line:chunk', text));
  try { await stream.finalMessage(); } finally { safeSend(win, 'suggest-focus-line:done'); }
}

export async function analyzeStatuses(wsData, apiKey) {
  const c = getClient(apiKey);
  const msg = await c.messages.create({
    model: MODEL,
    max_tokens: 500,
    system: [{ type: 'text', text: STATUS_SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: JSON.stringify(wsData) }],
  });
  const text = msg.content[0]?.text || '[]';
  try {
    return JSON.parse(text);
  } catch {
    return [];
  }
}

export async function decomposeTask(taskText, projectContext, apiKey, win) {
  const c = getClient(apiKey);
  const stream = c.messages.stream({
    model: MODEL,
    max_tokens: 300,
    system: [{ type: 'text', text: DECOMPOSE_SYSTEM }],
    messages: [{
      role: 'user',
      content: `Project context: ${JSON.stringify(projectContext)}\n\nTask to decompose: ${taskText}`,
    }],
  });
  stream.on('text', (text) => safeSend(win, 'decompose-task:chunk', text));
  try { await stream.finalMessage(); } finally { safeSend(win, 'decompose-task:done'); }
}

export async function getWeeklyDigest(wsData, weeklyLog, apiKey, win) {
  const c = getClient(apiKey);
  const stream = c.messages.stream({
    model: MODEL,
    max_tokens: 1000,
    system: [{ type: 'text', text: WEEKLY_SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{
      role: 'user',
      content: JSON.stringify({ projects: wsData, commitsLastWeek: weeklyLog }),
    }],
  });
  stream.on('text', (text) => safeSend(win, 'weekly-digest:chunk', text));
  try { await stream.finalMessage(); } finally { safeSend(win, 'weekly-digest:done'); }
}
