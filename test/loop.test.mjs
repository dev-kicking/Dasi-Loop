import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const installer = join(root, 'bin', 'install.mjs');
const helper = join(root, 'skills', 'dasi-loop', 'scripts', 'record.mjs');
const run = (script, args, cwd) => spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' });
function fixture(t, git = true) {
  const temp = mkdtempSync(join(tmpdir(), 'dasi-test-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const workspace = join(temp, 'workspace');
  mkdirSync(workspace);
  if (git) execFileSync('git', ['init', '-q'], { cwd: workspace });
  const input = join(temp, 'input.json');
  const task = { goal: 'Fix invalid-input handling', workspace, criteria: [{ id: 'AC-1', description: 'Invalid input returns an error' }] };
  function invoke(command, value, dir) {
    const args = [command];
    if (value) { writeFileSync(input, JSON.stringify(value)); args.push('--input', input); }
    if (dir) args.push('--run', dir);
    if (command === 'start') args.push('--root', join(temp, 'runs'));
    return run(helper, args, temp);
  }
  function start(overrides = {}) {
    const result = invoke('start', { ...task, ...overrides });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  }
  return { temp, workspace, task, invoke, start };
}
const check = (status = 'passed') => ({ criterion: 'AC-1', status, method: 'command', command: 'npm test', exit_code: status === 'passed' ? 0 : 1, evidence: `invalid-input test ${status}` });
const attempt = (status = 'passed') => ({ summary: 'Validate input and run regression test', checks: [check(status)] });
const completed = { status: 'completed', summary: 'Invalid-input regression test passed.' };
function ok(result) { assert.equal(result.status, 0, result.stderr); }
function rejected(result, message) { assert.notEqual(result.status, 0); assert.match(result.stderr, message); }

test('project installation provides helper and refuses to overwrite existing skills', t => {
  const f = fixture(t, false);
  for (const [agent, directory] of [['codex', '.agents'], ['claude', '.claude']]) {
    const args = ['install', '--agent', agent, '--scope', 'project'];
    ok(run(installer, args, f.workspace));
    const skill = join(f.workspace, directory, 'skills', 'dasi-loop', 'SKILL.md');
    assert.ok(existsSync(skill));
    const installedHelper = join(f.workspace, directory, 'skills', 'dasi-loop', 'scripts', 'record.mjs');
    ok(run(installedHelper, ['--help'], f.workspace));
    const original = readFileSync(skill, 'utf8');
    rejected(run(installer, args, f.workspace), /Already exists/);
    assert.equal(readFileSync(skill, 'utf8'), original);
  }
});

test('requires evidence for every criterion and rejects a failed command claimed as passed', t => {
  const f = fixture(t);
  const dir = f.start();
  rejected(f.invoke('finish', completed, dir), /Required criteria/);
  rejected(f.invoke('add', { summary: 'Done', checks: [] }, dir), /every criterion/);
  rejected(f.invoke('add', { summary: 'Done', checks: [{ ...check(), exit_code: 1 }] }, dir), /exit_code 0/);
  ok(f.invoke('add', attempt('failed'), dir));
  rejected(f.invoke('finish', completed, dir), /Required criteria/);
  ok(f.invoke('add', attempt(), dir));
  ok(f.invoke('finish', completed, dir));
  rejected(f.invoke('add', attempt(), dir), /already finished/);
});

test('latest round supersedes old passes and unverified human checks prevent completion', t => {
  const f = fixture(t);
  const dir = f.start();
  ok(f.invoke('add', attempt(), dir));
  ok(f.invoke('add', { summary: 'Device unavailable', checks: [{ criterion: 'AC-1', status: 'unverified', evidence: 'No device connected' }] }, dir));
  rejected(f.invoke('finish', completed, dir), /Required criteria/);
  ok(f.invoke('finish', { status: 'needs_review', summary: 'Device check remains', next_action: 'Connect device and verify focus' }, dir));
});

test('resume detects changed untracked files and completion requires new evidence', t => {
  const f = fixture(t);
  const code = join(f.workspace, 'app.js');
  writeFileSync(code, 'export const version = 1;');
  const dir = f.start();
  ok(f.invoke('add', attempt(), dir));
  assert.equal(JSON.parse(f.invoke('resume', null, dir).stdout).evidence_current, true);
  writeFileSync(code, 'export const version = 2;');
  assert.equal(JSON.parse(f.invoke('resume', null, dir).stdout).evidence_current, false);
  rejected(f.invoke('finish', completed, dir), /Workspace changed/);
  ok(f.invoke('add', attempt(), dir));
  ok(f.invoke('finish', completed, dir));
});

test('records last allowed attempt but refuses an extra attempt', t => {
  const f = fixture(t);
  const dir = f.start({ limits: { attempts: 1 } });
  ok(f.invoke('add', attempt('failed'), dir));
  rejected(f.invoke('add', attempt(), dir), /budget exhausted/);
  ok(f.invoke('finish', { status: 'budget_exhausted', summary: 'Attempt limit reached', next_action: 'Review failure before a new run' }, dir));
});

test('deadline prevents another verification round and preserves existing state', t => {
  const f = fixture(t);
  const dir = f.start();
  const path = join(dir, 'state.json');
  const state = JSON.parse(readFileSync(path, 'utf8'));
  state.created_at = '2020-01-01T00:00:00Z';
  writeFileSync(path, JSON.stringify(state));
  rejected(f.invoke('add', attempt(), dir), /budget exhausted/);
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).attempts.length, 0);
  ok(f.invoke('finish', { status: 'budget_exhausted', summary: 'Time expired', next_action: 'Review and start a new run' }, dir));
});

test('non-Git workspace requires explicit current-workspace review', t => {
  const f = fixture(t, false);
  const dir = f.start();
  ok(f.invoke('add', attempt(), dir));
  rejected(f.invoke('finish', completed, dir), /workspace_reviewed/);
  ok(f.invoke('finish', { ...completed, workspace_reviewed: true }, dir));
});

test('optional failed criteria are reported but do not block required criteria', t => {
  const f = fixture(t);
  const dir = f.start({ criteria: [...f.task.criteria, { id: 'AC-2', description: 'Optional polish', required: false }] });
  ok(f.invoke('add', { summary: 'Core passes', checks: [check(), { criterion: 'AC-2', status: 'unverified', evidence: 'Deferred polish' }] }, dir));
  ok(f.invoke('finish', completed, dir));
});

test('invalid tasks and ambiguous checks do not enter the record', t => {
  const f = fixture(t);
  rejected(f.invoke('start', { ...f.task, criteria: [] }), /requires/);
  rejected(f.invoke('start', { ...f.task, limits: { attempts: 0 } }), /Limits/);
  rejected(f.invoke('start', { ...f.task, criteria: [f.task.criteria[0], f.task.criteria[0]] }), /unique/);
  const dir = f.start();
  rejected(f.invoke('add', { summary: 'Done', checks: [{ ...check(), criterion: 'unknown' }] }, dir), /known criterion/);
  rejected(f.invoke('add', { summary: 'Done', checks: [{ ...check(), method: 'human' }] }, dir), /confirmed_by/);
  rejected(f.invoke('finish', { status: 'blocked', summary: 'No credentials' }, dir), /next_action/);
});

test('another writer lock prevents changes without discarding the lock', t => {
  const f = fixture(t);
  const dir = f.start();
  writeFileSync(join(dir, '.lock'), 'other-process');
  rejected(f.invoke('add', attempt(), dir), /locked/);
  assert.equal(readFileSync(join(dir, '.lock'), 'utf8'), 'other-process');
  assert.equal(JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')).attempts.length, 0);
});

test('real failing regression, correction, and fresh passing evidence complete a run', t => {
  const f = fixture(t);
  const code = join(f.workspace, 'validate.cjs');
  writeFileSync(code, 'module.exports = name => true;\n');
  writeFileSync(join(f.workspace, 'validate.test.cjs'), "const assert = require('node:assert/strict');\nassert.equal(require('./validate.cjs')(''), false);\n");
  const dir = f.start();
  const verify = () => spawnSync(process.execPath, ['validate.test.cjs'], { cwd: f.workspace, encoding: 'utf8' });
  const fail = verify();
  assert.notEqual(fail.status, 0);
  ok(f.invoke('add', { summary: 'Reproduced missing validation', checks: [{ ...check('failed'), command: 'node validate.test.cjs', exit_code: fail.status, evidence: 'Assertion failed: empty username returned true' }] }, dir));
  rejected(f.invoke('finish', completed, dir), /Required criteria/);
  writeFileSync(code, 'module.exports = name => name.trim().length > 0;\n');
  const pass = verify();
  assert.equal(pass.status, 0);
  ok(f.invoke('add', { summary: 'Reject blank usernames', checks: [{ ...check(), command: 'node validate.test.cjs', exit_code: pass.status, evidence: 'Empty username now returns false' }] }, dir));
  ok(f.invoke('finish', completed, dir));
});

test('tracked content changes and deletions invalidate earlier evidence', t => {
  const f = fixture(t);
  const code = join(f.workspace, 'app.js');
  writeFileSync(code, 'version one');
  execFileSync('git', ['add', 'app.js'], { cwd: f.workspace });
  const dir = f.start();
  ok(f.invoke('add', attempt(), dir));
  writeFileSync(code, 'version two');
  rejected(f.invoke('finish', completed, dir), /Workspace changed/);
  ok(f.invoke('add', attempt(), dir));
  rmSync(code);
  rejected(f.invoke('finish', completed, dir), /Workspace changed/);
});

test('journal storage inside workspace is rejected before creating a run', t => {
  const f = fixture(t);
  const input = join(f.temp, 'nested.json');
  writeFileSync(input, JSON.stringify(f.task));
  rejected(run(helper, ['start', '--input', input, '--root', join(f.workspace, 'runs')], f.temp), /outside the workspace/);
});

test('missing workspace can be reported but cannot be completed', t => {
  const f = fixture(t, false);
  const dir = f.start();
  ok(f.invoke('add', attempt(), dir));
  rmSync(f.workspace, { recursive: true });
  const status = f.invoke('resume', null, dir);
  ok(status);
  assert.equal(JSON.parse(status.stdout).workspace_available, false);
  rejected(f.invoke('finish', { ...completed, workspace_reviewed: true }, dir), /Workspace is unavailable/);
  ok(f.invoke('finish', { status: 'blocked', summary: 'Workspace missing', next_action: 'Restore workspace' }, dir));
});
