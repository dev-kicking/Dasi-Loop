#!/usr/bin/env node
import { lstatSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function isInside(parent, child) {
  const path = relative(parent, child);
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

function globalModuleRoot() {
  const npmExecPath = process.env.npm_execpath;
  const result = npmExecPath
    ? spawnSync(process.execPath, [npmExecPath, 'root', '--global'], { encoding: 'utf8' })
    : spawnSync('npm', ['root', '--global'], { encoding: 'utf8' });
  if (result.error || result.status !== 0) return null;
  const output = result.stdout.trim();
  if (!output) return null;
  try { return realpathSync(output); } catch { return null; }
}

const globalRoot = globalModuleRoot();
let realPackageRoot;
try { realPackageRoot = realpathSync(packageRoot); } catch { realPackageRoot = null; }
if (!globalRoot || !realPackageRoot || !isInside(globalRoot, realPackageRoot)) process.exit(0);

const home = homedir();
const skillRoot = join(packageRoot, 'bin', 'install.mjs');
let found = false;
for (const [agent, directory] of [
  ['codex', join(home, '.codex', 'skills', 'dasi-loop')],
  ['claude', join(home, '.claude', 'skills', 'dasi-loop')],
]) {
  let installed;
  try {
    const stat = lstatSync(directory);
    installed = stat.isDirectory() && !stat.isSymbolicLink();
  } catch { installed = false; }
  if (!installed) continue;
  found = true;
  const result = spawnSync(process.execPath, [skillRoot, 'update', '--agent', agent], { stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    console.error(`Could not sync the user-level ${agent} skill. Run: dasi-loop update --agent ${agent}`);
  }
}
if (found) console.log('Dasi Loop user-level skill sync finished.');
