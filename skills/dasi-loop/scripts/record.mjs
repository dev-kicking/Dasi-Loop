#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { budget, digest, loadState, nonempty, normalizeTask, now, readJson, snapshot, validateChecks, writeJson } from './lib/state.mjs';
import { scoreReview, scoreTrend } from './lib/scoring.mjs';
import { invokeReviewer } from './lib/reviewer.mjs';
import { agreePlan, implementationReady, reviewPlan, revisePlan } from './lib/planning.mjs';

const usage = 'Usage: record.mjs start --input FILE [--root DIR] | revise-plan|agree-plan|add|finish --run DIR --input FILE | review-plan|evaluate|status|resume --run DIR';
const statuses = ['completed', 'needs_review', 'blocked', 'budget_exhausted', 'cancelled'];
function view(state) {
  const workspaceAvailable = existsSync(state.task.workspace) && lstatSync(state.task.workspace).isDirectory();
  const current = workspaceAvailable ? snapshot(state.task.workspace) : null;
  const last = state.attempts.at(-1);
  const checks = state.version === 3 ? last?.review?.checks : last?.checks;
  const reference = state.version === 3 ? last?.review?.workspace_snapshot : last?.workspace_snapshot;
  return {
    ...state,
    stage: state.result ? 'finished' : state.planning && !state.planning.agreement ? 'planning' : state.task.kind === 'plan' ? 'plan_agreed' : 'implementation',
    legacy_read_only: state.version === 2,
    budget: budget(state),
    workspace_available: workspaceAvailable,
    evidence_current: state.version === 3 && reference && current ? reference.digest === current.digest : null,
    current_snapshot: current,
    unverified_required: state.task.criteria.filter(item => item.required && !checks?.some(check => check.criterion === item.id && check.status === 'passed')).map(item => item.id),
    scoring: state.version === 3 ? scoreTrend(state) : null,
    independent_review_pending: state.version === 3 && !last?.review,
  };
}
function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes('--help')) { console.log(usage); return; }
  const command = args.shift();
  const allowed = { start: ['--input', '--root'], 'revise-plan': ['--run', '--input'], 'agree-plan': ['--run', '--input'], 'review-plan': ['--run'], add: ['--run', '--input'], finish: ['--run', '--input'], evaluate: ['--run'], status: ['--run'], resume: ['--run'] };
  if (!allowed[command]) throw new Error(usage);
  const options = {};
  while (args.length) {
    const key = args.shift();
    if (!allowed[command].includes(key) || !args.length || options[key]) throw new Error(usage);
    options[key] = args.shift();
  }
  if (command === 'start') {
    if (!options['--input']) throw new Error(usage);
    const task = normalizeTask(readJson(options['--input']));
    const root = resolve(options['--root'] ?? join(homedir(), '.dasi-loop', 'runs'));
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const relativeRoot = relative(task.workspace, realpathSync(root));
    const rootInsideWorkspace = !relativeRoot || (relativeRoot !== '..' && !relativeRoot.startsWith(`..${sep}`) && !isAbsolute(relativeRoot));
    if (rootInsideWorkspace) throw new Error('Run storage must be outside the workspace so records cannot invalidate their own evidence.');
    const id = randomUUID();
    const run = join(root, id);
    const state = { version: 3, id, created_at: now(), task, contract_hash: digest(task), initial_snapshot: snapshot(task.workspace), attempts: [], result: null };
    if (!['fix', 'simple'].includes(task.kind)) state.planning = { revision: 1, drafts: [{ revision: 1, contract_hash: state.contract_hash, task }], review_attempts: 0, reviews: [], agreement: null };
    mkdirSync(run, { mode: 0o700 });
    writeJson(join(run, 'state.json'), state);
    console.log(run);
    return;
  }
  if (!options['--run'] || (['revise-plan', 'agree-plan', 'add', 'finish'].includes(command) && !options['--input'])) throw new Error(usage);
  const run = resolve(options['--run']);
  const path = join(run, 'state.json');
  if (!existsSync(path)) throw new Error('No state.json. Inspect legacy v0.1 records and start a new run referencing them.');
  if (['status', 'resume'].includes(command)) {
    console.log(JSON.stringify(view(loadState(path)), null, 2));
    return;
  }
  const lock = join(run, '.lock');
  try { writeFileSync(lock, String(process.pid), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('Run is locked by another writer. If it crashed, confirm no writer is active before removing .lock.'); throw error; }
  try {
    const state = loadState(path);
    if (state.version !== 3) throw new Error('Version-2 runs are read-only. Start a v3 run with a fixed rubric and independent reviewer, referencing this run.');
    if (state.result) throw new Error('Run is already finished. Start a new run referencing this one.');
    if (command === 'review-plan') { console.log(JSON.stringify(reviewPlan(state, run, path), null, 2)); return; }
    if (command === 'revise-plan' || command === 'agree-plan') {
      const input = readJson(options['--input']);
      if (command === 'revise-plan') revisePlan(state, input); else agreePlan(state, input);
      writeJson(path, state);
      console.log(`${command}: ${run}`);
      return;
    }
    if (['add', 'evaluate'].includes(command)) {
      implementationReady(state);
      if (state.task.kind === 'plan') throw new Error('Planning-only runs do not implement or score code. Finish the agreed plan, or start an authorized implementation run.');
    }
    if (command === 'evaluate') {
      evaluate(state, run, path);
      return;
    }
    const input = readJson(options['--input']);
    if (command === 'add') {
      const remaining = budget(state);
      if (!remaining.attempts_remaining || remaining.time_exhausted) throw new Error('Run budget exhausted. Finish with budget_exhausted or another justified non-completed status.');
      if (scoreTrend(state).plateau) throw new Error('Score plateau reached. Stop for review and record a next action instead of continuing unchanged.');
      if (input.review !== undefined || input.scores !== undefined || input.rubric !== undefined) throw new Error('Implementer cannot submit a review, scores, or a changed rubric. Use evaluate to launch the fixed reviewer.');
      validateChecks(input, state.task);
      const candidate = snapshot(state.task.workspace);
      if (candidate && state.attempts.some(attempt => attempt.review?.workspace_snapshot?.digest === candidate.digest)) throw new Error('This unchanged Git candidate already has an assessment. Correct the work before a new round; external verification-context changes need a new authorized run.');
      state.attempts.push({ number: state.attempts.length + 1, summary: input.summary, checks: input.checks, diagnosis: input.diagnosis ?? null, next_action: input.next_action ?? null, recorded_at: now(), workspace_snapshot: candidate, review: null });
    } else {
      if (!input || !statuses.includes(input.status) || !nonempty(input.summary)) throw new Error(`Result requires summary and status: ${statuses.join(', ')}.`);
      if (input.status === 'completed') {
        implementationReady(state);
        if (state.task.kind === 'plan') {
          if (!existsSync(state.task.workspace) || !lstatSync(state.task.workspace).isDirectory()) throw new Error('Workspace is unavailable; restore the reviewed planning context before completing.');
          const current = snapshot(state.task.workspace);
          if ((state.initial_snapshot?.digest ?? null) !== (current?.digest ?? null)) throw new Error('Workspace changed after plan agreement. Review the changed context before completing a new planning run.');
          if (!current && input.workspace_reviewed !== true) throw new Error('No Git snapshot available. Review current workspace and supply workspace_reviewed: true.');
        }
        if (state.task.kind !== 'plan') {
          const current = view(state);
          const review = state.attempts.at(-1)?.review;
          if (!current.workspace_available) throw new Error('Workspace is unavailable; restore it and reverify before completing.');
          if (state.initial_snapshot && !current.current_snapshot) throw new Error('Git snapshot became unavailable. Restore Git verification or start a new authorized run; workspace_reviewed cannot replace prior Git evidence.');
          if (!review) throw new Error('Independent evaluation is required before completion. Run evaluate; implementer checks cannot approve the task.');
          if (current.unverified_required.length) throw new Error(`Required criteria have not passed independent review: ${current.unverified_required.join(', ')}.`);
          if (review.must_fix.length) throw new Error('Independent reviewer reported must_fix blockers.');
          if (review.score.total < state.task.rubric.target) throw new Error(`Score ${review.score.total} is below target ${state.task.rubric.target}.`);
          if (current.evidence_current === false) throw new Error('Workspace changed after independent verification. Record a new attempt and evaluation before completing.');
          if (current.evidence_current === null && input.workspace_reviewed !== true) throw new Error('No Git snapshot available. Review current workspace and supply workspace_reviewed: true.');
        }
      } else if (!nonempty(input.next_action)) throw new Error('Non-completed result requires next_action (use "none" when cancelled).');
      state.result = { status: input.status, summary: input.summary, next_action: input.next_action ?? null, workspace_reviewed: input.workspace_reviewed === true, finished_at: now() };
    }
    writeJson(path, state);
    console.log(`${command}: ${run}`);
  } finally { unlinkSync(lock); }
}
function evaluate(state, run, path) {
  const attempt = state.attempts.at(-1);
  if (!attempt) throw new Error('Record an implementation attempt before evaluating.');
  if (attempt.review) throw new Error('This attempt already has an evaluation. Do not re-roll scores; record a new attempt after a meaningful correction.');
  const remaining = budget(state);
  if (remaining.time_exhausted) throw new Error('Run budget exhausted before evaluation.');
  const before = snapshot(state.task.workspace);
  if (attempt.workspace_snapshot && before?.digest !== attempt.workspace_snapshot.digest) throw new Error('Workspace changed since the attempt. Record a new attempt before evaluation.');
  const request = {
    protocol: 'dasi-review/v1', request_id: randomUUID(), contract_hash: state.contract_hash,
    workspace: state.task.workspace, goal: state.task.goal, scope: state.task.scope ?? [],
    criteria: state.task.criteria, rubric: state.task.rubric, initial_snapshot: state.initial_snapshot,
    ...(state.planning?.agreement ? { proposal: state.task.proposal, decisions: state.planning.agreement.resolutions } : {}),
  };
  try {
    const timeout = Math.max(1, Math.floor(Math.min(remaining.milliseconds_remaining, state.task.reviewer.timeout_seconds * 1000)));
    const { response, provenance } = invokeReviewer(state.task, request, run, timeout);
    if (response.request_id !== request.request_id) throw new Error('Assessment request_id does not match this evaluation.');
    validateChecks(response, state.task);
    if (!Array.isArray(response.must_fix) || !response.must_fix.every(nonempty)) throw new Error('Reviewer requires must_fix as an array of nonempty strings.');
    const score = scoreReview(response, state.task);
    const after = snapshot(state.task.workspace);
    if (before && after?.digest !== before.digest) throw new Error('Workspace changed during evaluation; no assessment accepted.');
    if (budget(state).time_exhausted) throw new Error('Run budget exhausted during evaluation; no assessment accepted.');
    // Only output captured from the launched evaluator can populate this field.
    attempt.review = {
      request_id: request.request_id, contract_hash: state.contract_hash, provenance,
      summary: response.summary, checks: response.checks, must_fix: response.must_fix, score,
      evaluated_at: now(), workspace_snapshot: after,
    };
    attempt.evaluation_error = null;
    writeJson(path, state);
    console.log(JSON.stringify({ attempt: attempt.number, score, trend: scoreTrend(state), must_fix: response.must_fix }, null, 2));
  } catch (error) {
    attempt.evaluation_error = { message: error.message, occurred_at: now() };
    writeJson(path, state);
    throw error;
  }
}
try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
