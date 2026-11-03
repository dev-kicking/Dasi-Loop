import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { compareVersions, updateNotice } from '../skills/dasi-loop/scripts/lib/update-notice.mjs';
const helper = fileURLToPath(new URL('../skills/dasi-loop/scripts/record.mjs', import.meta.url));
function fixture(t, metadata = { version: '0.4.0', agent: 'codex', scope: 'user' }) {
  const root = mkdtempSync(join(tmpdir(), 'dasi-update-notice-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const skillRoot = join(root, '.codex', 'skills', 'dasi-loop'); mkdirSync(skillRoot, { recursive: true });
  if (metadata !== null) writeFileSync(join(skillRoot, '.dasi-loop-install.json'), JSON.stringify(metadata));
  return { root, skillRoot, home: root, fetchImpl: async () => ({ ok: true, json: async () => ({ latest: '0.5.0' }) }) };
}
test('SemVer precedence includes numeric prereleases, release promotion and ignored build metadata', () => {
  const versions = ['0.4.9', '0.4.10', '0.5.0-alpha', '0.5.0-alpha.2', '0.5.0-alpha.10', '0.5.0-beta', '0.5.0-rc.1', '0.5.0', '1.0.0'];
  for (let i = 1; i < versions.length; i++) {
    assert.equal(compareVersions(versions[i], versions[i-1]), 1);
    assert.equal(compareVersions(versions[i-1], versions[i]), -1);
  }
  assert.equal(compareVersions('1.0.0+one', '1.0.0+two'), 0);
  for (const value of ['v1.0.0', '1.0', '01.0.0', '1.0.0-01', 'garbage']) assert.equal(compareVersions(value, '1.0.0'), null);
});
test('newer versions give user commands with script-approval and manual fallback', async t => {
  const f = fixture(t); let called = false;
  const notice = await updateNotice({ ...f, fetchImpl: async (url, options) => {
    assert.equal(url, 'https://registry.npmjs.org/-/package/dasi-loop/dist-tags');
    assert.equal(options.redirect, 'error'); called = true;
    return f.fetchImpl();
  } });
  assert.ok(called); assert.match(notice, /0.4.0 -> 0.5.0/);
  assert.match(notice, /--registry=https:\/\/registry.npmjs.org\/ --tag=latest/);
  assert.match(notice, /allow-scripts=dasi-loop/); assert.match(notice, /--agent codex --scope user/);
});
test('project and legacy version-only installs get commands only for validated targets', async t => {
  const f = fixture(t, { version: '0.4.0' });
  assert.match(await updateNotice(f), /--agent codex --scope user/);
  const workspace = join(f.root, 'project'); const skillRoot = join(workspace, '.claude', 'skills', 'dasi-loop');
  mkdirSync(skillRoot, { recursive: true }); writeFileSync(join(skillRoot, '.dasi-loop-install.json'), '{"version":"0.4.0"}');
  assert.match(await updateNotice({ ...f, workspace, skillRoot }), /Then, from the project root: dasi-loop update --agent claude --scope project/);
  const unknown = await updateNotice({ ...f, home: join(f.root, 'elsewhere') });
  assert.match(unknown, /installation target unknown/); assert.doesNotMatch(unknown, /--agent codex/);
});
test('missing metadata labels installed version unknown rather than asserting an upgrade', async t => {
  const f = fixture(t, null); const notice = await updateNotice(f);
  assert.match(notice, /installed version unknown/); assert.match(notice, /an upgrade cannot be confirmed/);
  assert.doesNotMatch(notice, /update available/);
});
test('current, future, invalid, HTTP-error and offline cases produce no notice', async t => {
  for (const version of ['0.5.0', '0.6.0', 'invalid']) {
    const f = fixture(t, { version }); assert.equal(await updateNotice(f), null);
  }
  const f = fixture(t);
  for (const fetchImpl of [async () => { throw Error('offline'); }, async () => ({ ok: false }), async () => ({ ok: true, json: async () => ({ latest: 'bad' }) }), async () => ({ ok: true, json: async () => { throw Error('bad JSON'); } })]) {
    assert.equal(await updateNotice({ ...f, fetchImpl }), null);
  }
});
test('deadline bounds both a stalled fetch and a stalled body even if the provider ignores abort', async t => {
  const f = fixture(t);
  for (const fetchImpl of [() => new Promise(() => {}), async () => ({ ok: true, json: () => new Promise(() => {}) })]) {
    const start = Date.now(); assert.equal(await updateNotice({ ...f, fetchImpl, timeoutMs: 20 }), null);
    assert.ok(Date.now() - start < 1000);
  }
});
test('CLI checks only after accepted finalization, after saving state and releasing lock', t => {
  const f = fixture(t); const workspace = join(f.root, 'workspace'); mkdirSync(workspace);
  const task = { kind:'fix', impact_review:'Fixture bounded change', goal:'Fixture', workspace,
    criteria:[{id:'AC-1',description:'Fixture behavior'}], rubric:{target:80,dimensions:[{id:'behavior',description:'Fixture',criteria:['AC-1'],weight:100,anchors:{0:'Missing',1:'Broken',2:'Partial',3:'Almost',4:'Verified'}}]},
    reviewer:{kind:'command',argv:[process.execPath, join(f.root,'reviewer.mjs')]}};
  writeFileSync(task.reviewer.argv[1], `import{readFileSync}from'node:fs';const r=JSON.parse(readFileSync(0,'utf8'));console.log(JSON.stringify({request_id:r.request_id,summary:'Fixture',checks:[{criterion:'AC-1',status:'passed',method:'inspection',evidence:'Fixture inspection'}],scores:[{dimension:'behavior',rating:4,evidence:'Fixture verified',improvement:''}],must_fix:[]}));`);
  const preload = join(f.root, 'fetch.cjs'); const marker = join(f.root, 'fetch-called');
  writeFileSync(preload, `const fs=require('node:fs'),path=require('node:path');globalThis.fetch=async()=>{const run=process.env.DASI_TEST_RUN;if(fs.existsSync(path.join(run,'.lock')))throw Error('lock held');if(!JSON.parse(fs.readFileSync(path.join(run,'state.json'))).result)throw Error('not saved');fs.writeFileSync(${JSON.stringify(marker)},'called');return{ok:true,json:async()=>({latest:'99.0.0'})}};`);
  const input = join(f.root,'input.json');
  const call = (cmd, data, run) => {
    if (data) writeFileSync(input, JSON.stringify(data));
    const args = ['--require',preload,helper,cmd]; if (data) args.push('--input',input);
    if (run) args.push('--run',run); if (cmd === 'start') args.push('--root',join(f.root,'runs'));
    return spawnSync(process.execPath,args,{encoding:'utf8',env:{...process.env,DASI_TEST_RUN:run ?? ''}});
  };
  const ok = r => { assert.equal(r.status,0,r.stderr); return r; };
  for (const status of ['completed','needs_review','blocked','budget_exhausted','cancelled']) {
    if (existsSync(marker)) rmSync(marker);
    const run = ok(call('start', task)).stdout.trim();
    ok(call('status',null,run)); ok(call('resume',null,run));
    assert.notEqual(call('finish',{status:'completed',summary:'Not assessed'},run).status,0);
    assert.equal(existsSync(marker),false);
    if (status === 'completed') {
      ok(call('add',{summary:'Fixture',checks:[{criterion:'AC-1',status:'passed',method:'inspection',evidence:'Fixture'}]},run));
      ok(call('evaluate',null,run)); assert.equal(existsSync(marker),false);
    }
    const result=ok(call('finish',{status,summary:'Fixture finish',next_action:'Fixture next',workspace_reviewed:true},run));
    assert.match(result.stdout,/Public npm latest: 99.0.0/); assert.equal(readFileSync(marker,'utf8'),'called');
    assert.equal(JSON.parse(readFileSync(join(run,'state.json'))).result.status,status);
    rmSync(marker); assert.notEqual(call('finish',{status,summary:'Again'},run).status,0); assert.equal(existsSync(marker),false);
  }
});
