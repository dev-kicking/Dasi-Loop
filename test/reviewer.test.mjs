import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { invokeReviewer } from '../skills/dasi-loop/scripts/lib/reviewer.mjs';
import { planPrompt, planSchema } from '../skills/dasi-loop/scripts/lib/planning.mjs';

test('Codex runner passes each stage schema and reads the answer file in a fresh read-only invocation', () => {
  const root = mkdtempSync(join(tmpdir(), 'dasi-codex-protocol-'));
  const executable = join(root, 'codex');
  const originalSearchPath = process.env.PATH;
  try {
    writeFileSync(executable, `#!/usr/bin/env node
const fs=require('node:fs');const assert=require('node:assert/strict');const a=process.argv.slice(2);
assert.equal(a[0],'exec');assert.equal(a[a.indexOf('--sandbox')+1],'read-only');assert.ok(a.includes('--ephemeral'));assert.ok(a.includes('approval_policy="never"'));assert.ok(!a.includes('resume'));
const schema=JSON.parse(fs.readFileSync(a[a.indexOf('--output-schema')+1],'utf8'));
const prompt=fs.readFileSync(0,'utf8');const request=JSON.parse(prompt.slice(prompt.indexOf('{')));
const planning=request.protocol==='dasi-plan/v1';
assert.equal(Boolean(schema.properties.findings),planning);assert.equal(Boolean(schema.properties.scores),!planning);
if(!planning){assert.equal(schema.properties.checks.items.properties.status.type,'string');}
fs.writeFileSync(a[a.indexOf('--output-last-message')+1],JSON.stringify(planning?{request_id:request.request_id,summary:'Fixture plan review',findings:[]}:{request_id:request.request_id,summary:'Fixture implementation review',checks:[],scores:[],must_fix:[]}));
`);
    chmodSync(executable, 0o755);
    // Only this isolated test process changes its executable search path; no real agent is launched.
    process.env.PATH = `${root}:${originalSearchPath}`;
    const workspace = join(root,'workspace'); mkdirSync(workspace);
    const task = {workspace,reviewer:{kind:'codex'}};
    for (const planning of [true,false]) {
      const request = {request_id:'fixture-id',protocol:planning?'dasi-plan/v1':'dasi-review/v1'};
      const options = planning?{schema:planSchema,prompt:planPrompt(request)}:{};
      const result = invokeReviewer(task,request,root,3000,options);
      assert.equal(result.response.request_id,request.request_id);
      assert.equal(result.provenance.sandbox,'read-only');
      assert.equal(result.provenance.fresh_process,true);
    }
  } finally {
    if (originalSearchPath === undefined) delete process.env.PATH; else process.env.PATH=originalSearchPath;
    rmSync(root,{recursive:true,force:true});
  }
});
