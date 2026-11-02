import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function fixture(t, agent = 'codex') {
  const root = mkdtempSync(join(tmpdir(), 'dasi-install-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const pkg = join(root, 'package');
  cpSync(new URL('../bin', import.meta.url), join(pkg, 'bin'), { recursive: true });
  mkdirSync(join(pkg, 'skills', 'dasi-loop'), { recursive: true });
  writeFileSync(join(pkg, 'skills', 'dasi-loop', 'SKILL.md'), 'new skill');
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ type: 'module', version: '0.3.1' }));
  const project = join(root, 'project');
  mkdirSync(project);
  const folder = join(project, agent === 'codex' ? '.agents' : '.claude');
  const installed = join(folder, 'skills', 'dasi-loop');
  function run(command, preload) {
    const args = preload ? ['--require', preload] : [];
    args.push(join(pkg, 'bin', 'install.mjs'), command);
    if (command !== '--version') args.push('--agent', agent, '--scope', 'project');
    return spawnSync(process.execPath, args, { cwd: project, encoding: 'utf8' });
  }
  function legacy() {
    mkdirSync(installed, { recursive: true });
    writeFileSync(join(installed, 'SKILL.md'), 'locally edited old skill');
    writeFileSync(join(installed, 'custom.txt'), 'keep my customization');
  }
  return { root, pkg, folder, installed, run, legacy };
}
function ok(result) { assert.equal(result.status, 0, result.stderr); return result; }
function backup(f) {
  const root = join(f.folder, 'dasi-loop-backups');
  const entries = readdirSync(root);
  assert.equal(entries.length, 1);
  return join(root, entries[0], 'dasi-loop');
}

for (const agent of ['codex', 'claude']) {
  test(`${agent} update backs up a legacy installation and local edits outside skill discovery`, t => {
    const f = fixture(t, agent);
    f.legacy();
    const result = ok(f.run('update'));
    assert.equal(readFileSync(join(f.installed, 'SKILL.md'), 'utf8'), 'new skill');
    assert.equal(existsSync(join(f.installed, 'custom.txt')), false);
    const saved = backup(f);
    assert.equal(readFileSync(join(saved, 'SKILL.md'), 'utf8'), 'locally edited old skill');
    assert.equal(readFileSync(join(saved, 'custom.txt'), 'utf8'), 'keep my customization');
    assert.ok(result.stdout.includes(saved));
    assert.equal(JSON.parse(readFileSync(join(f.installed, '.dasi-loop-install.json'), 'utf8')).version, '0.3.1');
    assert.deepEqual(readdirSync(join(f.folder, 'skills')), ['dasi-loop']);
  });
}

test('install records the package version, refuses replacement and update requires installation', t => {
  const f = fixture(t);
  assert.equal(ok(f.run('--version')).stdout.trim(), '0.3.1');
  assert.match(f.run('update').stderr, /install first/);
  ok(f.run('install'));
  assert.equal(JSON.parse(readFileSync(join(f.installed, '.dasi-loop-install.json'), 'utf8')).version, '0.3.1');
  assert.match(f.run('install').stderr, /Already exists/);
  ok(f.run('update'));
  assert.equal(readFileSync(join(backup(f), 'SKILL.md'), 'utf8'), 'new skill');
});

test('a replacement failure restores the original skill and releases the lock', t => {
  const f = fixture(t);
  f.legacy();
  const preload = join(f.root, 'fail-rename.cjs');
  writeFileSync(preload, `const fs = require('node:fs');
const rename = fs.renameSync;
fs.renameSync = (from, to) => {
  if (from.includes('.dasi-loop-update-')) throw new Error('Simulated replacement failure');
  return rename(from, to);
};
require('node:module').syncBuiltinESMExports();
`);
  assert.match(f.run('update', preload).stderr, /Simulated replacement failure/);
  assert.equal(readFileSync(join(f.installed, 'SKILL.md'), 'utf8'), 'locally edited old skill');
  assert.equal(readFileSync(join(f.installed, 'custom.txt'), 'utf8'), 'keep my customization');
  assert.equal(existsSync(`${f.installed}.lock`), false);
  assert.equal(readdirSync(f.folder).some(name => name.startsWith('.dasi-loop-update-')), false);
  ok(f.run('update'));
});

test('updates reject symlinks and competing writers without altering the skill', t => {
  const f = fixture(t);
  f.legacy();
  writeFileSync(`${f.installed}.lock`, 'other process');
  assert.match(f.run('update').stderr, /holds the lock/);
  assert.equal(readFileSync(`${f.installed}.lock`, 'utf8'), 'other process');
  assert.equal(readFileSync(join(f.installed, 'SKILL.md'), 'utf8'), 'locally edited old skill');
  rmSync(`${f.installed}.lock`);
  const linked = fixture(t, 'claude');
  mkdirSync(join(linked.folder, 'skills'), { recursive: true });
  symlinkSync(f.installed, linked.installed, 'dir');
  assert.match(linked.run('update').stderr, /symlink/);
  assert.equal(readFileSync(join(f.installed, 'SKILL.md'), 'utf8'), 'locally edited old skill');
});
