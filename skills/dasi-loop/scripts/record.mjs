#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

const usage = 'Usage: record.mjs start --input FILE [--root DIR] | add|finish --run DIR --input FILE | status|resume --run DIR';
const statuses = ['completed', 'needs_review', 'blocked', 'budget_exhausted', 'cancelled'];
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const now = () => new Date().toISOString();
function readJson(path) { return JSON.parse(readFileSync(path, 'utf8')); }
function writeJson(path, value) {
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    renameSync(temp, path);
  } finally { if (existsSync(temp)) unlinkSync(temp); }
}
function snapshot(workspace) {
  const git = args => execFileSync('git', args, { cwd: workspace, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 32 * 1024 * 1024 });
  try { git(['rev-parse', '--show-toplevel']); } catch { return null; }
  let head = '';
  try { head = git(['rev-parse', '--verify', 'HEAD']).toString().trim(); } catch { /* New repository. */ }
  const hash = createHash('sha256').update(head);
  const files = git(['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '.']).toString().split('\0').filter(Boolean);
  for (const file of [...new Set(files)].sort()) {
    hash.update(`\0${file}\0`);
    try {
      const path = join(workspace, file);
      const stat = lstatSync(path);
      hash.update(String(stat.mode));
      if (stat.isSymbolicLink()) hash.update(readlinkSync(path));
      else if (stat.isFile()) hash.update(readFileSync(path));
      else hash.update('non-file');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      hash.update('deleted');
    }
  }
  return { head, digest: hash.digest('hex') };
}
function taskFrom(input) {
  if (!nonempty(input.goal) || !nonempty(input.workspace) || !Array.isArray(input.criteria) || !input.criteria.length) throw new Error('Task requires goal, workspace, and criteria.');
  const workspace = realpathSync(resolve(input.workspace));
  if (!lstatSync(workspace).isDirectory()) throw new Error('Workspace must be a directory.');
  const criteria = input.criteria.map((value, index) => {
    const item = typeof value === 'string' ? { id: `AC-${index + 1}`, description: value } : value;
    if (!item || !nonempty(item.id) || !nonempty(item.description) || (item.required !== undefined && typeof item.required !== 'boolean')) throw new Error('Each criterion needs id, description, and an optional boolean required.');
    return { ...item, required: item.required ?? true };
  });
  if (new Set(criteria.map(item => item.id)).size !== criteria.length || !criteria.some(item => item.required)) throw new Error('Criterion IDs must be unique and at least one must be required.');
  if (input.limits !== undefined && (!input.limits || typeof input.limits !== 'object' || Array.isArray(input.limits))) throw new Error('Limits must be an object.');
  const limits = { attempts: 3, minutes: 45, ...input.limits };
  if (!Number.isSafeInteger(limits.attempts) || limits.attempts < 1 || !Number.isFinite(limits.minutes) || limits.minutes <= 0) throw new Error('Limits require positive attempts (integer) and minutes.');
  return { ...input, workspace, criteria, limits };
}
function budget(state) {
  return {
    attempts_remaining: Math.max(0, state.task.limits.attempts - state.attempts.length),
    deadline: new Date(Date.parse(state.created_at) + state.task.limits.minutes * 60000).toISOString(),
    time_exhausted: Date.now() - Date.parse(state.created_at) >= state.task.limits.minutes * 60000,
  };
}
function validateChecks(input, task) {
  if (!nonempty(input.summary) || !Array.isArray(input.checks)) throw new Error('Attempt requires summary and checks.');
  if (input.checks.length !== task.criteria.length || new Set(input.checks.map(check => check?.criterion)).size !== task.criteria.length) throw new Error('Provide exactly one check for every criterion in each attempt.');
  for (const check of input.checks) {
    if (!check || !task.criteria.some(item => item.id === check.criterion) || !['passed', 'failed', 'unverified'].includes(check.status) || !nonempty(check.evidence)) throw new Error('Check requires a known criterion, status passed|failed|unverified, and evidence (or reason unavailable).');
    if (check.status !== 'unverified') {
      if (!['command', 'inspection', 'human'].includes(check.method)) throw new Error('Verified check requires method command|inspection|human.');
      if (check.method === 'command' && (!nonempty(check.command) || !Number.isInteger(check.exit_code) || (check.status === 'passed' && check.exit_code !== 0))) throw new Error('Command evidence requires command and integer exit_code; passed requires exit_code 0.');
      if (check.method === 'human' && !nonempty(check.confirmed_by)) throw new Error('Human evidence requires confirmed_by from an actual confirmation.');
    }
  }
}
function view(state) {
  const workspaceAvailable = existsSync(state.task.workspace) && lstatSync(state.task.workspace).isDirectory();
  const current = workspaceAvailable ? snapshot(state.task.workspace) : null;
  const last = state.attempts.at(-1);
  return {
    ...state,
    budget: budget(state),
    workspace_available: workspaceAvailable,
    evidence_current: last?.workspace_snapshot && current ? last.workspace_snapshot.digest === current.digest : null,
    current_snapshot: current,
    unverified_required: state.task.criteria.filter(item => item.required && !last?.checks.some(check => check.criterion === item.id && check.status === 'passed')).map(item => item.id),
  };
}
function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes('--help')) { console.log(usage); return; }
  const command = args.shift();
  const allowed = { start: ['--input', '--root'], add: ['--run', '--input'], finish: ['--run', '--input'], status: ['--run'], resume: ['--run'] };
  if (!allowed[command]) throw new Error(usage);
  const options = {};
  while (args.length) {
    const key = args.shift();
    if (!allowed[command].includes(key) || !args.length || options[key]) throw new Error(usage);
    options[key] = args.shift();
  }
  if (command === 'start') {
    if (!options['--input']) throw new Error(usage);
    const task = taskFrom(readJson(options['--input']));
    const root = resolve(options['--root'] ?? join(homedir(), '.dasi-loop', 'runs'));
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const relativeRoot = relative(task.workspace, realpathSync(root));
    const rootInsideWorkspace = !relativeRoot || (relativeRoot !== '..' && !relativeRoot.startsWith(`..${sep}`) && !isAbsolute(relativeRoot));
    if (rootInsideWorkspace) throw new Error('Run storage must be outside the workspace so records cannot invalidate their own evidence.');
    const run = join(root, randomUUID());
    const state = { version: 2, created_at: now(), task, initial_snapshot: snapshot(task.workspace), attempts: [], result: null };
    mkdirSync(run, { mode: 0o700 });
    writeJson(join(run, 'state.json'), state);
    console.log(run);
    return;
  }
  if (!options['--run'] || (['add', 'finish'].includes(command) && !options['--input'])) throw new Error(usage);
  const run = resolve(options['--run']);
  const path = join(run, 'state.json');
  if (!existsSync(path)) throw new Error('No v2 state.json. For a v0.1 run, inspect its task.json/attempts.jsonl/result.json and start a new run referencing it.');
  if (['status', 'resume'].includes(command)) {
    const state = readJson(path);
    if (state.version !== 2) throw new Error('Unsupported state version.');
    console.log(JSON.stringify(view(state), null, 2));
    return;
  }
  const lock = join(run, '.lock');
  try { writeFileSync(lock, String(process.pid), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('Run is locked by another writer. If it crashed, confirm no writer is active before removing .lock.'); throw error; }
  try {
    const state = readJson(path);
    if (state.version !== 2) throw new Error('Unsupported state version.');
    if (state.result) throw new Error('Run is already finished. Start a new run referencing this one.');
    const input = readJson(options['--input']);
    if (command === 'add') {
      const remaining = budget(state);
      if (!remaining.attempts_remaining || remaining.time_exhausted) throw new Error('Run budget exhausted. Finish with budget_exhausted or another justified non-completed status.');
      validateChecks(input, state.task);
      state.attempts.push({ ...input, recorded_at: now(), workspace_snapshot: snapshot(state.task.workspace) });
    } else {
      if (!statuses.includes(input.status) || !nonempty(input.summary)) throw new Error(`Result requires summary and status: ${statuses.join(', ')}.`);
      if (input.status === 'completed') {
        const current = view(state);
        if (!current.workspace_available) throw new Error('Workspace is unavailable; restore it and reverify before completing.');
        if (current.unverified_required.length) throw new Error(`Required criteria have not passed: ${current.unverified_required.join(', ')}.`);
        if (current.evidence_current === false) throw new Error('Workspace changed after verification. Record a new verification attempt before completing.');
        if (current.evidence_current === null && input.workspace_reviewed !== true) throw new Error('No Git snapshot available. Review current workspace and supply workspace_reviewed: true.');
      } else if (!nonempty(input.next_action)) throw new Error('Non-completed result requires next_action (use "none" when cancelled).');
      state.result = { ...input, finished_at: now() };
    }
    writeJson(path, state);
    console.log(`${command}: ${run}`);
  } finally { unlinkSync(lock); }
}
try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
