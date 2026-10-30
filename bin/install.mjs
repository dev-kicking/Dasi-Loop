#!/usr/bin/env node
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const version = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')).version;
const usage = 'Usage: dasi-loop install|update --agent codex|claude [--scope user|project]\n       dasi-loop --version';
try {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.length === 0) { console.log(usage); process.exit(0); }
  if (args.length === 1 && args[0] === '--version') { console.log(version); process.exit(0); }
  const command = args.shift();
  if (!['install', 'update'].includes(command)) throw new Error(usage);
  const options = {};
  while (args.length) {
    const key = args.shift();
    if (!['--agent', '--scope'].includes(key) || !args.length || options[key]) throw new Error(usage);
    options[key] = args.shift();
  }
  const agent = options['--agent'];
  const scope = options['--scope'] ?? 'user';
  if (!['codex', 'claude'].includes(agent) || !['user', 'project'].includes(scope)) throw new Error(usage);
  const base = scope === 'project' ? process.cwd() : homedir();
  const folder = agent === 'codex' ? (scope === 'project' ? '.agents' : '.codex') : '.claude';
  const destination = resolve(base, folder, 'skills', 'dasi-loop');
  mkdirSync(dirname(destination), { recursive: true });
  const lock = `${destination}.lock`;
  try { writeFileSync(lock, String(process.pid), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('Another install or update holds the lock. If it crashed, confirm it stopped before removing ' + lock); throw error; }
  let staging;
  try {
    const installed = lstatSync(destination, { throwIfNoEntry: false });
    if (command === 'install' && installed) throw new Error(`Already exists: ${destination}. Use dasi-loop update with the same --agent and --scope.`);
    if (command === 'update' && !installed) throw new Error(`No installed skill at ${destination}. Use dasi-loop install first.`);
    if (installed && (!installed.isDirectory() || installed.isSymbolicLink())) throw new Error('Update requires a real skill directory; move the existing file or symlink yourself.');
    const source = join(packageRoot, 'skills', 'dasi-loop');
    if (!existsSync(join(source, 'SKILL.md'))) throw new Error('Package is missing skills/dasi-loop/SKILL.md. Reinstall the npm package.');
    staging = mkdtempSync(join(base, folder, '.dasi-loop-update-'));
    const candidate = join(staging, 'dasi-loop');
    cpSync(source, candidate, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
    writeFileSync(join(candidate, '.dasi-loop-install.json'), JSON.stringify({ version, installed_at: new Date().toISOString() }) + '\n');
    let backup;
    if (command === 'update') {
      const backupRoot = join(base, folder, 'dasi-loop-backups');
      mkdirSync(backupRoot, { recursive: true, mode: 0o700 });
      const backupDirectory = mkdtempSync(join(backupRoot, `${new Date().toISOString().replace(/[:.]/g, '-')}-`));
      backup = join(backupDirectory, 'dasi-loop');
      renameSync(destination, backup);
    }
    try { renameSync(candidate, destination); }
    catch (error) {
      if (backup) {
        try { renameSync(backup, destination); }
        catch { throw new Error(`Update failed and automatic restore failed. Restore your skill from ${backup}. Original error: ${error.message}`); }
      }
      throw error;
    }
    console.log(`${command === 'update' ? 'Updated' : 'Installed'} dasi-loop ${version} to ${destination}`);
    if (backup) console.log(`Previous skill (including local edits) backed up to ${backup}`);
  } finally {
    try { if (staging) rmSync(staging, { recursive: true, force: true }); }
    finally { unlinkSync(lock); }
  }
  console.log('Start a new agent session if the skill is not yet available.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
