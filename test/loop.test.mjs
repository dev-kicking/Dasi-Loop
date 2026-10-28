import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreTrend } from '../skills/dasi-loop/scripts/lib/scoring.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const installer = join(root, 'bin', 'install.mjs');
const helper = join(root, 'skills', 'dasi-loop', 'scripts', 'record.mjs');
const run = (script, args, cwd) => spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' });
const anchors = { 0: 'No usable evidence', 1: 'Only partial inspection', 2: 'Runtime checks expose major gaps', 3: 'Most behavior works with minor gaps', 4: 'All linked behavior independently verified' };
const check = (status = 'passed') => ({ criterion: 'AC-1', status, method: 'command', command: 'node test.cjs', exit_code: status === 'passed' ? 0 : 1, evidence: `invalid-input test ${status}` });
const attempt = (status = 'passed') => ({ summary: 'Validate input and run regression test', checks: [check(status)] });
const completed = { status: 'completed', summary: 'Independent invalid-input checks passed.' };
function ok(result) { assert.equal(result.status, 0, result.stderr); return result; }
function rejected(result, message) { assert.notEqual(result.status, 0); assert.match(result.stderr, message); }
function fixture(t, git = true) {
  const temp = mkdtempSync(join(tmpdir(), 'dasi-v3-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const workspace = join(temp, 'workspace');
  mkdirSync(workspace);
  if (git) execFileSync('git', ['init', '-q'], { cwd: workspace });
  const input = join(temp, 'input.json');
  const assessment = join(temp, 'assessment.json');
  writeFileSync(assessment, '{}');
  const reviewer = join(temp, 'reviewer.mjs');
  writeFileSync(reviewer, `import { readFileSync, writeFileSync } from 'node:fs';
const request = JSON.parse(readFileSync(0, 'utf8'));
const config = JSON.parse(readFileSync(process.argv[2], 'utf8'));
if ('attempts' in request || 'history' in request || 'checks' in request || 'scores' in request) throw new Error('Implementer claims leaked into reviewer input');
if (config.exit) process.exit(config.exit);
if (config.delay) await new Promise(resolve => setTimeout(resolve, config.delay));
if (config.mutate) writeFileSync('reviewer-change.txt', 'unexpected mutation');
if (config.invalidJson) { process.stdout.write('invalid'); process.exit(0); }
const checks = config.checks ?? request.criteria.map(item => ({ criterion: item.id, status: 'passed', method: 'inspection', evidence: 'Independent inspection confirms behavior' }));
const scores = config.scores ?? request.rubric.dimensions.map(item => ({ dimension: item.id, rating: 4, evidence: 'Independent behavior check', improvement: '' }));
process.stdout.write(JSON.stringify({ request_id: config.wrong_id ? 'wrong' : request.request_id, summary: 'Independent assessment', checks, scores, must_fix: config.must_fix ?? [], total: 999 }));
`);
  const task = {
    goal: 'Fix invalid-input handling', workspace,
    criteria: [{ id: 'AC-1', description: 'Invalid input returns an error' }],
    reviewer: { kind: 'command', argv: [process.execPath, reviewer, assessment] },
    rubric: {
      target: 85,
      dimensions: [
        { id: 'correctness', description: 'Invalid-input behavior', weight: 60, anchors, criteria: ['AC-1'] },
        { id: 'regression', description: 'Regression evidence', weight: 40, anchors, criteria: ['AC-1'] },
      ],
    },
  };
  function invoke(command, value, dir) {
    const args = [command];
    if (value) { writeFileSync(input, JSON.stringify(value)); args.push('--input', input); }
    if (dir) args.push('--run', dir);
    if (command === 'start') args.push('--root', join(temp, 'runs'));
    return run(helper, args, temp);
  }
  function start(overrides = {}) { return ok(invoke('start', { ...task, ...overrides })).stdout.trim(); }
  const configure = config => writeFileSync(assessment, JSON.stringify(config));
  const state = dir => JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'));
  let revision = 0;
  const correct = () => writeFileSync(join(workspace, 'candidate-revision.json'), JSON.stringify({ revision: ++revision }));
  return { temp, workspace, task, invoke, start, configure, state, correct };
}
const ratings = (a, b) => [
  { dimension: 'correctness', rating: a, evidence: 'Observed invalid-input behavior', improvement: a < 4 ? 'Fix remaining invalid-input cases' : '' },
  { dimension: 'regression', rating: b, evidence: 'Observed regression results', improvement: b < 4 ? 'Cover remaining regression cases' : '' },
];

test('installation includes scoring and independent-review runtime without overwriting existing skills', t => {
  const f = fixture(t, false);
  for (const [agent, directory] of [['codex', '.agents'], ['claude', '.claude']]) {
    const args = ['install', '--agent', agent, '--scope', 'project'];
    ok(run(installer, args, f.workspace));
    const installed = join(f.workspace, directory, 'skills', 'dasi-loop');
    ok(run(join(installed, 'scripts', 'record.mjs'), ['--help'], f.workspace));
    assert.ok(existsSync(join(installed, 'scripts', 'lib', 'reviewer.mjs')));
    const original = readFileSync(join(installed, 'SKILL.md'), 'utf8');
    rejected(run(installer, args, f.workspace), /Already exists/);
    assert.equal(readFileSync(join(installed, 'SKILL.md'), 'utf8'), original);
  }
});

test('implementer self-checks and submitted scores cannot complete the task', t => {
  const f = fixture(t);
  const dir = f.start();
  rejected(f.invoke('finish', completed, dir), /Independent evaluation/);
  rejected(f.invoke('add', { ...attempt(), scores: ratings(4, 4) }, dir), /Implementer cannot/);
  rejected(f.invoke('add', { ...attempt(), review: { total: 100 } }, dir), /Implementer cannot/);
  ok(f.invoke('add', attempt(), dir));
  rejected(f.invoke('finish', completed, dir), /Independent evaluation/);
  ok(f.invoke('evaluate', null, dir));
  assert.equal(f.state(dir).attempts[0].review.provenance.fresh_process, true);
  ok(f.invoke('finish', completed, dir));
  rejected(f.invoke('add', attempt(), dir), /already finished/);
});

test('weighted score is computed by harness and must reach target', t => {
  const f = fixture(t);
  const dir = f.start();
  ok(f.invoke('add', attempt(), dir));
  f.configure({ scores: ratings(3, 3) });
  const evaluation = JSON.parse(ok(f.invoke('evaluate', null, dir)).stdout);
  assert.equal(evaluation.score.total, 75); // Ignore evaluator's forged total:999.
  rejected(f.invoke('finish', completed, dir), /below target/);
  f.correct();
  ok(f.invoke('add', attempt(), dir));
  f.configure({ scores: ratings(4, 3) });
  ok(f.invoke('evaluate', null, dir));
  const status = JSON.parse(ok(f.invoke('status', null, dir)).stdout);
  assert.equal(status.scoring.history[1].total, 90);
  assert.equal(status.scoring.history[1].delta, 15);
  assert.equal(status.scoring.history[1].dimensions[0].delta, 15);
  assert.equal(status.scoring.best_attempt, 2);
  ok(f.invoke('finish', completed, dir));
});

test('high score cannot hide a failed required check or critical blocker', t => {
  const f = fixture(t);
  const dir = f.start();
  ok(f.invoke('add', attempt(), dir));
  f.configure({ checks: [check('failed')], scores: ratings(4, 4) });
  rejected(f.invoke('evaluate', null, dir), /cannot receive rating 4/);
  assert.equal(f.state(dir).attempts[0].review, null);
  f.configure({ checks: [check('failed')], scores: ratings(3, 3) });
  ok(f.invoke('evaluate', null, dir));
  rejected(f.invoke('finish', completed, dir), /Required criteria/);
  f.correct();
  ok(f.invoke('add', attempt(), dir));
  f.configure({ must_fix: ['Required regression coverage missing'] });
  ok(f.invoke('evaluate', null, dir));
  rejected(f.invoke('finish', completed, dir), /must_fix/);
});

test('a recorded assessment cannot be re-rolled for a better score', t => {
  const f = fixture(t);
  const dir = f.start();
  ok(f.invoke('add', attempt(), dir));
  f.configure({ scores: ratings(2, 2) });
  ok(f.invoke('evaluate', null, dir));
  f.configure({ scores: ratings(4, 4) });
  rejected(f.invoke('evaluate', null, dir), /already has an evaluation/);
  rejected(f.invoke('add', attempt(), dir), /unchanged Git candidate/);
  assert.equal(f.state(dir).attempts[0].review.score.total, 50);
});

test('score history tracks regressions, best round and plateau and stops further rounds', t => {
  const f = fixture(t);
  const dir = f.start({ limits: { attempts: 5 } });
  for (const [a, b] of [[3, 3], [3, 2], [3, 3]]) {
    f.correct();
    ok(f.invoke('add', attempt(), dir));
    f.configure({ scores: ratings(a, b) });
    ok(f.invoke('evaluate', null, dir));
  }
  const status = JSON.parse(ok(f.invoke('resume', null, dir)).stdout);
  assert.deepEqual(status.scoring.history.map(item => item.total), [75, 65, 75]);
  assert.equal(status.scoring.history[1].delta, -10);
  assert.equal(status.scoring.best_attempt, 1);
  assert.equal(status.scoring.plateau, true);
  rejected(f.invoke('add', attempt(), dir), /plateau/);
  ok(f.invoke('finish', { status: 'needs_review', summary: 'Score plateau', next_action: 'Review failure strategy' }, dir));
});

test('cumulative small improvements do not cause a false plateau', () => {
  const state = { task: { rubric: { plateau_rounds: 2, min_delta: 1 } }, attempts: [80, 80.6, 81.2].map((total, i) => ({ number: i + 1, review: { score: { total, dimensions: [] } } })) };
  assert.equal(scoreTrend(state).plateau, false);
});

test('stale work before or after evaluation requires a new round and review', t => {
  const f = fixture(t);
  const code = join(f.workspace, 'app.js');
  writeFileSync(code, 'v1');
  const dir = f.start();
  ok(f.invoke('add', attempt(), dir));
  writeFileSync(code, 'v2');
  rejected(f.invoke('evaluate', null, dir), /changed since the attempt/);
  ok(f.invoke('add', attempt(), dir));
  ok(f.invoke('evaluate', null, dir));
  writeFileSync(code, 'v3');
  assert.equal(JSON.parse(ok(f.invoke('resume', null, dir)).stdout).evidence_current, false);
  rejected(f.invoke('finish', completed, dir), /Workspace changed/);
  ok(f.invoke('add', attempt(), dir));
  ok(f.invoke('evaluate', null, dir));
  ok(f.invoke('finish', completed, dir));
});

test('evaluator workspace mutations are detected and never approved', t => {
  const f = fixture(t);
  const dir = f.start();
  ok(f.invoke('add', attempt(), dir));
  f.configure({ mutate: true });
  rejected(f.invoke('evaluate', null, dir), /changed during evaluation/);
  assert.equal(f.state(dir).attempts[0].review, null);
});

test('reviewer crashes, invalid JSON and mismatched request IDs leave no passing assessment', t => {
  const f = fixture(t);
  const dir = f.start();
  ok(f.invoke('add', attempt(), dir));
  for (const [config, message] of [[{ exit: 1 }, /exited unsuccessfully/], [{ invalidJson: true }, /one JSON/], [{ wrong_id: true }, /request_id/]]) {
    f.configure(config);
    rejected(f.invoke('evaluate', null, dir), message);
    assert.equal(f.state(dir).attempts[0].review, null);
    assert.ok(f.state(dir).attempts[0].evaluation_error);
    rejected(f.invoke('finish', completed, dir), /Independent evaluation/);
  }
});

test('reviewer timeout is bounded and cannot yield a score', t => {
  const f = fixture(t);
  const dir = f.start({ reviewer: { ...f.task.reviewer, timeout_seconds: 0.1 } });
  ok(f.invoke('add', attempt(), dir));
  f.configure({ delay: 2000 });
  rejected(f.invoke('evaluate', null, dir), /timed out/);
  assert.equal(f.state(dir).attempts[0].review, null);
});

test('fixed rubric rejects missing anchors, bad weights, unknown IDs and contract changes', t => {
  const f = fixture(t);
  const dims = structuredClone(f.task.rubric.dimensions);
  delete dims[0].anchors[2];
  rejected(f.invoke('start', { ...f.task, rubric: { dimensions: dims } }), /anchors/);
  const bad = structuredClone(f.task.rubric);
  bad.dimensions[0].weight = 50;
  rejected(f.invoke('start', { ...f.task, rubric: bad }), /sum to 100/);
  const unknown = structuredClone(f.task.rubric);
  unknown.dimensions[0].criteria = ['other'];
  rejected(f.invoke('start', { ...f.task, rubric: unknown }), /known criterion/);
  const dir = f.start();
  const state = f.state(dir);
  state.task.rubric.target = 1;
  writeFileSync(join(dir, 'state.json'), JSON.stringify(state));
  rejected(f.invoke('status', null, dir), /contract changed/);
});

test('incomplete or invalid evaluator scoring is rejected', t => {
  const f = fixture(t);
  const dir = f.start();
  ok(f.invoke('add', attempt(), dir));
  const invalid = [[], [ratings(4, 4)[0], ratings(4, 4)[0]], [{ ...ratings(4, 4)[0], rating: 5 }, ratings(4, 4)[1]], [{ ...ratings(3, 3)[0], improvement: '' }, ratings(3, 3)[1]]];
  for (const scores of invalid) {
    f.configure({ scores });
    rejected(f.invoke('evaluate', null, dir), /score every|Scores require/);
  }
});

test('attempt/time budgets, locks, invalid checks and legacy records remain protected', t => {
  const f = fixture(t);
  const dir = f.start({ limits: { attempts: 1 } });
  rejected(f.invoke('add', { summary: 'Done', checks: [] }, dir), /every criterion/);
  rejected(f.invoke('add', { summary: 'Done', checks: [{ ...check(), exit_code: 1 }] }, dir), /exit_code 0/);
  ok(f.invoke('add', attempt(), dir));
  rejected(f.invoke('add', attempt(), dir), /budget exhausted/);
  writeFileSync(join(dir, '.lock'), 'other-writer');
  rejected(f.invoke('evaluate', null, dir), /locked/);
  assert.equal(readFileSync(join(dir, '.lock'), 'utf8'), 'other-writer');
  rmSync(join(dir, '.lock'));
  const state = f.state(dir);
  state.created_at = '2020-01-01T00:00:00Z';
  writeFileSync(join(dir, 'state.json'), JSON.stringify(state));
  rejected(f.invoke('evaluate', null, dir), /budget exhausted/);
  ok(f.invoke('finish', { status: 'budget_exhausted', summary: 'Time expired', next_action: 'Review before restarting' }, dir));
  const legacy = f.start();
  const old = f.state(legacy); old.version = 2;
  writeFileSync(join(legacy, 'state.json'), JSON.stringify(old));
  ok(f.invoke('status', null, legacy));
  rejected(f.invoke('add', attempt(), legacy), /read-only/);
});

test('non-Git completion requires review; unavailable workspaces and missing next actions are rejected', t => {
  const f = fixture(t, false);
  const dir = f.start();
  ok(f.invoke('add', attempt(), dir));
  ok(f.invoke('evaluate', null, dir));
  rejected(f.invoke('finish', completed, dir), /workspace_reviewed/);
  ok(f.invoke('finish', { ...completed, workspace_reviewed: true }, dir));
  const missing = f.start();
  rmSync(f.workspace, { recursive: true });
  assert.equal(JSON.parse(ok(f.invoke('status', null, missing)).stdout).workspace_available, false);
  rejected(f.invoke('finish', completed, missing), /Workspace is unavailable/);
  rejected(f.invoke('finish', { status: 'blocked', summary: 'No workspace' }, missing), /next_action/);
});

test('independent process reruns real tests and catches implementer false positives before a fix', t => {
  const f = fixture(t);
  const reviewer = join(f.temp, 'real-reviewer.mjs');
  writeFileSync(reviewer, `import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const request = JSON.parse(readFileSync(0, 'utf8'));
const result = spawnSync(process.execPath, ['regression.cjs'], { cwd: request.workspace, encoding: 'utf8' });
const passed = result.status === 0;
process.stdout.write(JSON.stringify({ request_id: request.request_id, summary: 'Reran independent regression tests', checks: [{ criterion: 'AC-1', status: passed ? 'passed' : 'failed', method: 'command', command: 'node regression.cjs', exit_code: result.status, evidence: passed ? 'Regression passed' : 'Empty username assertion failed' }], scores: request.rubric.dimensions.map(item => ({ dimension: item.id, rating: passed ? 4 : 1, evidence: passed ? 'Actual regression passed' : 'Actual regression failed', improvement: passed ? '' : 'Reject empty usernames' })), must_fix: passed ? [] : ['Reject empty usernames'] }));
`);
  writeFileSync(join(f.workspace, 'validate.cjs'), 'module.exports = name => true;\n');
  writeFileSync(join(f.workspace, 'regression.cjs'), "const assert = require('node:assert/strict'); const valid = require('./validate.cjs'); assert.equal(valid(''), false); assert.equal(valid('user'), true);\n");
  const dir = f.start({ reviewer: { kind: 'command', argv: [process.execPath, reviewer] } });
  ok(f.invoke('add', attempt(), dir)); // Deliberately false implementer claim.
  ok(f.invoke('evaluate', null, dir));
  assert.equal(f.state(dir).attempts[0].review.score.total, 25);
  rejected(f.invoke('finish', completed, dir), /Required criteria/);
  writeFileSync(join(f.workspace, 'validate.cjs'), 'module.exports = name => name.trim().length > 0;\n');
  ok(f.invoke('add', attempt(), dir));
  ok(f.invoke('evaluate', null, dir));
  assert.equal(f.state(dir).attempts[1].review.score.total, 100);
  assert.equal(JSON.parse(ok(f.invoke('status', null, dir)).stdout).scoring.history[1].delta, 75);
  ok(f.invoke('finish', completed, dir));
});
