import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const installer = join(root, 'bin', 'install.mjs');
const helper = join(root, 'skills', 'dasi-loop', 'scripts', 'record.mjs');
const run = (script, args, cwd) => spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' });

test('project installations are usable and do not overwrite existing skills', () => {
  const temp = mkdtempSync(join(tmpdir(), 'loop-install-'));
  try {
    for (const [agent, directory] of [['codex', '.agents'], ['claude', '.claude']]) {
      const args = ['install', '--agent', agent, '--scope', 'project'];
      assert.equal(run(installer, args, temp).status, 0);
      const skill = join(temp, directory, 'skills', 'dasi-loop', 'SKILL.md');
      assert.ok(existsSync(skill));
      assert.ok(existsSync(join(temp, directory, 'skills', 'dasi-loop', 'scripts', 'record.mjs')));
      const original = readFileSync(skill, 'utf8');
      assert.notEqual(run(installer, args, temp).status, 0);
      assert.equal(readFileSync(skill, 'utf8'), original);
    }
    assert.notEqual(run(installer, ['install', '--agent', 'unknown'], temp).status, 0);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('records a task, attempts, and final status and rejects changes after finish', () => {
  const temp = mkdtempSync(join(tmpdir(), 'loop-record-'));
  try {
    const input = join(temp, 'input.json');
    const put = obj => writeFileSync(input, JSON.stringify(obj));
    put({ goal: 'Fix bug', workspace: temp, criteria: ['test passes'] });
    const start = run(helper, ['start', '--input', input, '--root', join(temp, 'runs')], temp);
    assert.equal(start.status, 0, start.stderr);
    const dir = start.stdout.trim();
    put({ summary: 'first attempt', verification: 'test: exit 1' });
    assert.equal(run(helper, ['add', '--run', dir, '--input', input], temp).status, 0);
    put({ status: 'completed', summary: 'test: exit 0' });
    assert.equal(run(helper, ['finish', '--run', dir, '--input', input], temp).status, 0);
    const state = JSON.parse(execFileSync(process.execPath, [helper, 'status', '--run', dir], { encoding: 'utf8' }));
    assert.equal(state.task.goal, 'Fix bug');
    assert.equal(state.attempts[0].verification, 'test: exit 1');
    assert.equal(state.result.status, 'completed');
    assert.notEqual(run(helper, ['finish', '--run', dir, '--input', input], temp).status, 0);
    put({ summary: 'extra', verification: 'extra' });
    assert.notEqual(run(helper, ['add', '--run', dir, '--input', input], temp).status, 0);
    put({ goal: 'Missing criteria', workspace: temp, criteria: [] });
    assert.notEqual(run(helper, ['start', '--input', input, '--root', temp], temp).status, 0);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
