#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const usage = 'Usage: record.mjs start --input FILE [--root DIR] | add|finish --run DIR --input FILE | status --run DIR';
const statuses = ['completed', 'needs_review', 'blocked', 'budget_exhausted', 'cancelled'];
const now = () => new Date().toISOString();
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
function readJson(path) { return JSON.parse(readFileSync(path, 'utf8')); }
function writeJson(path, value) { writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 }); }
try {
  const args = process.argv.slice(2);
  if (!args.length || args.includes('--help')) { console.log(usage); process.exit(0); }
  const command = args.shift();
  const allowed = { start: ['--input', '--root'], add: ['--run', '--input'], finish: ['--run', '--input'], status: ['--run'] };
  if (!allowed[command]) throw new Error(usage);
  const options = {};
  while (args.length) {
    const key = args.shift();
    if (!allowed[command].includes(key) || !args.length || options[key]) throw new Error(usage);
    options[key] = args.shift();
  }
  if (command === 'start') {
    if (!options['--input']) throw new Error(usage);
    const task = readJson(options['--input']);
    if (!nonempty(task.goal) || !nonempty(task.workspace) || !Array.isArray(task.criteria) || !task.criteria.length || !task.criteria.every(nonempty)) throw new Error('Task requires goal, workspace, and a nonempty array of criteria.');
    const root = resolve(options['--root'] ?? join(homedir(), '.loop-engineering', 'runs'));
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const run = join(root, randomUUID());
    mkdirSync(run, { mode: 0o700 });
    writeJson(join(run, 'task.json'), { ...task, created_at: now() });
    console.log(run);
  } else {
    if (!options['--run'] || (command !== 'status' && !options['--input'])) throw new Error(usage);
    const run = resolve(options['--run']);
    const task = readJson(join(run, 'task.json'));
    const resultPath = join(run, 'result.json');
    const eventsPath = join(run, 'attempts.jsonl');
    if (command === 'status') {
      const attempts = existsSync(eventsPath) ? readFileSync(eventsPath, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
      console.log(JSON.stringify({ task, attempts, result: existsSync(resultPath) ? readJson(resultPath) : null }, null, 2));
    } else {
      if (existsSync(resultPath)) throw new Error('Run is already finished.');
      const input = readJson(options['--input']);
      if (command === 'add') {
        if (!nonempty(input.summary) || !nonempty(input.verification)) throw new Error('Attempt requires summary and verification.');
        appendFileSync(eventsPath, `${JSON.stringify({ ...input, recorded_at: now() })}\n`, { mode: 0o600 });
      } else {
        if (!statuses.includes(input.status) || !nonempty(input.summary)) throw new Error(`Result requires summary and status: ${statuses.join(', ')}.`);
        writeJson(resultPath, { ...input, finished_at: now() });
      }
      console.log(`${command}: ${run}`);
    }
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
