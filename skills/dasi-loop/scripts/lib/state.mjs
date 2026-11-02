import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readlinkSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { normalizeRubric } from './scoring.mjs';

export const nonempty = value => typeof value === 'string' && value.trim().length > 0;
export const now = () => new Date().toISOString();
export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
export function writeJson(path, value) {
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    renameSync(temp, path);
  } finally { if (existsSync(temp)) unlinkSync(temp); }
}
export function snapshot(workspace) {
  const git = args => execFileSync('git', args, { cwd: workspace, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 32 * 1024 * 1024 });
  try { git(['rev-parse', '--show-toplevel']); } catch { return null; }
  let head = '';
  try { head = git(['rev-parse', '--verify', 'HEAD']).toString().trim(); } catch { /* Unborn branch. */ }
  const hash = createHash('sha256').update(head);
  const files = git(['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '.']).toString().split('\0').filter(Boolean);
  for (const file of [...new Set(files)].sort()) {
    const content = createHash('sha256');
    try {
      const path = join(workspace, file);
      const stat = lstatSync(path);
      content.update(String(stat.mode));
      if (stat.isSymbolicLink()) content.update(readlinkSync(path));
      else if (stat.isFile()) content.update(readFileSync(path));
      else content.update('non-file');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      content.update('deleted');
    }
    hash.update(JSON.stringify([file, content.digest('hex')]));
  }
  return { head, digest: hash.digest('hex') };
}
export function normalizeTask(input) {
  if (!input || !nonempty(input.goal) || !nonempty(input.workspace) || !Array.isArray(input.criteria) || !input.criteria.length) throw new Error('Task requires goal, workspace, and criteria.');
  const workspace = realpathSync(resolve(input.workspace));
  if (!lstatSync(workspace).isDirectory()) throw new Error('Workspace must be a directory.');
  const kind = input.kind ?? 'feature';
  if (!['feature', 'change', 'plan', 'fix', 'simple'].includes(kind)) throw new Error('Task kind must be feature|change|plan|fix|simple.');
  if (['fix', 'simple'].includes(kind)) {
    if (!nonempty(input.impact_review)) throw new Error('A lightweight task requires impact_review explaining the bounded change, expected behavior and regression risks.');
  } else if (!nonempty(input.request) || !nonempty(input.proposal)) throw new Error('Planning requires the original request and a proposal covering users, flows, exceptions, assumptions and verification.');
  const criteria = input.criteria.map((value, index) => {
    const item = typeof value === 'string' ? { id: `AC-${index + 1}`, description: value } : value;
    if (!item || !nonempty(item.id) || !nonempty(item.description) || (item.required !== undefined && typeof item.required !== 'boolean')) throw new Error('Each criterion needs id, description and optional boolean required.');
    return { ...item, required: item.required ?? true };
  });
  if (new Set(criteria.map(item => item.id)).size !== criteria.length || !criteria.some(item => item.required)) throw new Error('Criterion IDs must be unique and at least one must be required.');
  if (input.limits !== undefined && (!input.limits || typeof input.limits !== 'object' || Array.isArray(input.limits))) throw new Error('Limits must be an object.');
  const limits = { attempts: 3, minutes: 45, plan_reviews: 3, ...input.limits };
  if (!Number.isSafeInteger(limits.plan_reviews) || limits.plan_reviews < 1 || limits.plan_reviews > 20) throw new Error('limits.plan_reviews must be an integer in [1,20].');
  if (!Number.isSafeInteger(limits.attempts) || limits.attempts < 1 || !Number.isFinite(limits.minutes) || limits.minutes <= 0 || limits.minutes > 525600) throw new Error('Limits require positive integer attempts and minutes in (0,525600].');
  if (input.reviewer !== undefined && (!input.reviewer || typeof input.reviewer !== 'object' || Array.isArray(input.reviewer))) throw new Error('Reviewer must be an object.');
  const reviewer = { kind: 'codex', timeout_seconds: 300, ...input.reviewer };
  if (!['codex', 'command'].includes(reviewer.kind) || !Number.isFinite(reviewer.timeout_seconds) || reviewer.timeout_seconds <= 0 || reviewer.timeout_seconds > 3600) throw new Error('Reviewer requires kind codex|command and timeout_seconds in (0,3600].');
  if (reviewer.kind === 'command' && (!Array.isArray(reviewer.argv) || !reviewer.argv.length || !reviewer.argv.every(nonempty))) throw new Error('Command reviewer requires a nonempty argv array.');
  return { ...input, kind, workspace, criteria, limits, reviewer, rubric: normalizeRubric(input.rubric, criteria) };
}
export function loadState(path) {
  const state = readJson(path);
  if (![2, 3].includes(state.version)) throw new Error('Unsupported state version.');
  if (state.version === 3 && digest(state.task) !== state.contract_hash) throw new Error('Task contract changed. Start a new run instead of modifying its rubric or reviewer.');
  return state;
}
export function budget(state) {
  if (state.planning && !state.planning.agreement) return { attempts_remaining: state.task.limits.attempts, deadline: null, milliseconds_remaining: state.task.limits.minutes * 60000, time_exhausted: false, implementation_pending: true };
  const deadline = Date.parse(state.implementation_started_at ?? state.created_at) + state.task.limits.minutes * 60000;
  return {
    attempts_remaining: Math.max(0, state.task.limits.attempts - state.attempts.length),
    deadline: new Date(deadline).toISOString(),
    milliseconds_remaining: Math.max(0, deadline - Date.now()),
    time_exhausted: Date.now() >= deadline,
  };
}
export function validateChecks(input, task) {
  if (!input || !nonempty(input.summary) || !Array.isArray(input.checks)) throw new Error('Assessment requires summary and checks.');
  if (input.checks.length !== task.criteria.length || new Set(input.checks.map(check => check?.criterion)).size !== task.criteria.length) throw new Error('Provide exactly one check for every criterion.');
  for (const check of input.checks) {
    if (!check || !task.criteria.some(item => item.id === check.criterion) || !['passed', 'failed', 'unverified'].includes(check.status) || !nonempty(check.evidence)) throw new Error('Check requires a known criterion, status and evidence.');
    if (check.status !== 'unverified') {
      if (!['command', 'inspection', 'human'].includes(check.method)) throw new Error('Verified check requires method command|inspection|human.');
      if (check.method === 'command' && (!nonempty(check.command) || !Number.isInteger(check.exit_code) || (check.status === 'passed' && check.exit_code !== 0))) throw new Error('Command evidence requires command and integer exit_code; passed requires exit_code 0.');
      if (check.method === 'human' && !nonempty(check.confirmed_by)) throw new Error('Human evidence requires confirmed_by from an actual confirmation.');
    }
  }
}
