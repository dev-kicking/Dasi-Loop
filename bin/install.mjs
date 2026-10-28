#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const usage = 'Usage: loop-engineering-skill install --agent codex|claude [--scope user|project]';
try {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.length === 0) { console.log(usage); process.exit(0); }
  if (args.shift() !== 'install') throw new Error(usage);
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
  const destination = resolve(base, folder, 'skills', 'loop-engineering');
  if (existsSync(destination)) throw new Error(`Already exists: ${destination}. Remove or move it yourself before reinstalling.`);
  mkdirSync(dirname(destination), { recursive: true });
  const source = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'loop-engineering');
  cpSync(source, destination, { recursive: true, errorOnExist: true, force: false });
  console.log(`Installed loop-engineering to ${destination}`);
  console.log('Start a new agent session if the skill is not yet available.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
