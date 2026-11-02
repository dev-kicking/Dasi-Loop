import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const helper = fileURLToPath(new URL('../skills/dasi-loop/scripts/record.mjs', import.meta.url));
const ok = result => { assert.equal(result.status, 0, result.stderr); return result; };
const reject = (result, pattern) => { assert.notEqual(result.status, 0); assert.match(result.stderr, pattern); };
function fixture(t, overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'dasi-planning-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const workspace = join(root, 'workspace');
  mkdirSync(workspace);
  execFileSync('git', ['init', '-q'], { cwd: workspace });
  writeFileSync(join(workspace, 'app.txt'), 'initial work');
  const config = join(root, 'config.json');
  writeFileSync(config, '{}');
  const reviewer = join(root, 'reviewer.mjs');
  writeFileSync(reviewer, `import {readFileSync,writeFileSync} from 'node:fs';
const r=JSON.parse(readFileSync(0,'utf8')); const c=JSON.parse(readFileSync(process.argv[2],'utf8'));
if ('attempts' in r || 'agreement' in r || 'history' in r) throw Error('Prior claims leaked');
if (c.exit) process.exit(1);
if(c.mutate) writeFileSync('mutation.txt','unexpected');
if(r.protocol==='dasi-plan/v1') {
 if(!r.request || !r.proposal || !r.response_schema.properties.findings || r.response_schema.properties.scores) throw Error('Wrong planning protocol');
 console.log(JSON.stringify({request_id:c.wrong_id?'wrong':r.request_id,summary:'Independent planning assessment',findings:c.findings??[],...(c.scores?{scores:[]}: {})}));
} else {
 if(!r.proposal || !Array.isArray(r.decisions)) throw Error('Agreed proposal or decisions missing from implementation evaluation');
 console.log(JSON.stringify({request_id:r.request_id,summary:'Independent implementation assessment',checks:[{criterion:'AC-1',status:'passed',method:'inspection',evidence:'Fixture behavior inspected'}],scores:[{dimension:'behavior',rating:c.rating??4,evidence:'Fixture result inspected',improvement:c.rating?'Resolve remaining fixture gaps':''}],must_fix:[]}));
}`);
  const task = {
    kind: 'feature', request: 'Add an export action', goal: 'Users can export their data',
    proposal: 'Existing users export their data; handle empty results and permission failures, preserve existing data; verify export and recovery.', workspace,
    criteria: [{ id: 'AC-1', description: 'Export works and handles empty data' }],
    rubric: { target: 85, dimensions: [{ id: 'behavior', description: 'Export behavior', weight: 100, criteria: ['AC-1'], anchors: {0:'Absent',1:'Broken',2:'Partial',3:'Mostly working',4:'All cases verified'} }] },
    reviewer: { kind: 'command', argv: [process.execPath, reviewer, config], timeout_seconds: 5 },
    ...overrides,
  };
  function call(command, input, run) {
    const args = [helper, command];
    if (input) { const p = join(root, 'input.json'); writeFileSync(p, JSON.stringify(input)); args.push('--input', p); }
    if (run) args.push('--run', run);
    if (command === 'start') args.push('--root', join(root, 'runs'));
    return spawnSync(process.execPath, args, { encoding: 'utf8', cwd: root });
  }
  const start = () => ok(call('start', task)).stdout.trim();
  const state = run => JSON.parse(readFileSync(join(run, 'state.json'), 'utf8'));
  const agreement = run => ({ contract_hash: state(run).contract_hash, summary: 'Agreed export scope', user_confirmation: 'Fixture user explicitly approved this export proposal', resolutions: [] });
  return { root, workspace, task, call, start, state, agreement, configure: value => writeFileSync(config, JSON.stringify(value)) };
}
const observation = { summary: 'Export implemented', checks: [{criterion:'AC-1',status:'passed',method:'inspection',evidence:'Fixture inspection'}] };

test('full planning blocks implementation and completion before independent review and user agreement', t => {
  const f = fixture(t); const run = f.start();
  assert.equal(JSON.parse(ok(f.call('status', null, run)).stdout).stage, 'planning');
  reject(f.call('add', observation, run), /Planning is not agreed/);
  reject(f.call('evaluate', null, run), /Planning is not agreed/);
  reject(f.call('finish', {status:'completed',summary:'Done'}, run), /Planning is not agreed/);
  reject(f.call('agree-plan', f.agreement(run), run), /independent planning review/);
  const review = JSON.parse(ok(f.call('review-plan', null, run)).stdout);
  assert.equal(review.provenance.fresh_process, true);
  assert.equal(review.score, undefined);
  assert.equal(f.state(run).attempts.length, 0);
  reject(f.call('agree-plan', {...f.agreement(run),user_confirmation:''}, run), /actual user_confirmation/);
  reject(f.call('agree-plan', {...f.agreement(run),contract_hash:'stale'}, run), /contract_hash/);
  ok(f.call('agree-plan', f.agreement(run), run));
  assert.equal(f.state(run).planning.agreement.contract_hash, f.state(run).contract_hash);
  ok(f.call('add', observation, run));
  f.configure({rating:3});
  assert.equal(JSON.parse(ok(f.call('evaluate', null, run)).stdout).score.total, 75);
  reject(f.call('finish', {status:'completed',summary:'Done'}, run), /below target/);
  writeFileSync(join(f.workspace,'app.txt'), 'corrected export');
  ok(f.call('add', observation, run));
  f.configure({});
  assert.equal(JSON.parse(ok(f.call('evaluate', null, run)).stdout).score.total, 100);
  ok(f.call('finish', {status:'completed',summary:'Verified export'}, run));
});

test('required planning defects require a changed draft and a new independent review', t => {
  const f = fixture(t); const run = f.start();
  f.configure({findings:[{id:'P-1',category:'required_defect',description:'Recovery flow is missing',recommendation:'Specify recovery'}]});
  ok(f.call('review-plan', null, run));
  reject(f.call('agree-plan', f.agreement(run), run), /Required planning defects/);
  reject(f.call('review-plan', null, run), /already has a review/);
  reject(f.call('revise-plan', f.task, run), /unchanged/);
  const changed = {...f.task, proposal:f.task.proposal+' Retry recovery after permissions are restored.'};
  ok(f.call('revise-plan', changed, run));
  assert.equal(f.state(run).planning.drafts.length, 2);
  reject(f.call('agree-plan', f.agreement(run), run), /independent planning review/);
  f.configure({}); ok(f.call('review-plan', null, run));
  ok(f.call('agree-plan', f.agreement(run), run));
  reject(f.call('revise-plan', {...changed,proposal:'new scope'}, run), /agreed contract/);
});

test('all user decisions need resolutions; optional suggestions do not expand the contract', t => {
  const f = fixture(t); const run = f.start();
  f.configure({findings:[
    {id:'D-1',category:'user_decision',description:'Choose file format',recommendation:'Use CSV'},
    {id:'O-1',category:'optional_improvement',description:'Scheduled exports',recommendation:'Consider later'},
  ]});
  ok(f.call('review-plan', null, run));
  reject(f.call('agree-plan', f.agreement(run), run), /Resolve every user_decision/);
  ok(f.call('agree-plan', {...f.agreement(run),resolutions:[{id:'D-1',decision:'User chose CSV within the proposal'}]}, run));
  assert.equal(f.state(run).task.proposal, f.task.proposal);
});

test('review failures consume the planning budget and cannot inject scores or approval', t => {
  const f = fixture(t, {limits:{plan_reviews:2}}); const run = f.start();
  f.configure({scores:true}); reject(f.call('review-plan', null, run), /without implementation scores/);
  f.configure({wrong_id:true}); reject(f.call('review-plan', null, run), /matching request_id/);
  assert.equal(f.state(run).planning.reviews.length, 0);
  reject(f.call('review-plan', null, run), /budget exhausted/);
  reject(f.call('revise-plan', {...f.task,limits:{plan_reviews:3},proposal:'changed'}, run), /review budget/);
  ok(f.call('finish', {status:'needs_review',summary:'Planning budget ended',next_action:'Discuss unresolved issues before an authorized new run'}, run));
});

test('workspace changes invalidate planning evidence and reviewer writes are rejected', t => {
  const f = fixture(t); const run = f.start();
  f.configure({mutate:true}); reject(f.call('review-plan', null, run), /changed during planning review/);
  f.configure({}); ok(f.call('review-plan', null, run));
  writeFileSync(join(f.workspace,'app.txt'),'new project requirements');
  reject(f.call('agree-plan', f.agreement(run), run), /workspace require independent/);
  ok(f.call('review-plan', null, run));
  ok(f.call('agree-plan', f.agreement(run), run));
});

test('planning-only requests finish agreed deliverables without code or implementation scores', t => {
  const f = fixture(t,{kind:'plan'}); const run = f.start();
  ok(f.call('review-plan', null, run)); ok(f.call('agree-plan', f.agreement(run), run));
  reject(f.call('add', observation, run), /Planning-only/);
  reject(f.call('evaluate', null, run), /Planning-only/);
  ok(f.call('finish', {status:'completed',summary:'Delivered agreed plan'}, run));
  assert.equal(f.state(run).attempts.length, 0);
});

test('planning-only completion rejects context changes after agreement', t => {
  const f = fixture(t,{kind:'plan'}); const run = f.start();
  ok(f.call('review-plan',null,run)); ok(f.call('agree-plan',f.agreement(run),run));
  writeFileSync(join(f.workspace,'app.txt'),'changed context');
  reject(f.call('finish',{status:'completed',summary:'Stale plan'},run),/changed after plan agreement/);
});

test('lightweight fixes require impact review and planning waits do not spend implementation time', t => {
  const f = fixture(t,{kind:'fix'});
  reject(f.call('start', f.task), /impact_review/);
  const run = ok(f.call('start', {...f.task,impact_review:'Restore intended export behavior; check data integrity regressions'})).stdout.trim();
  ok(f.call('add', observation, run));
  const g = fixture(t); const draft = g.start();
  const saved = g.state(draft); saved.created_at='2020-01-01T00:00:00Z';
  writeFileSync(join(draft,'state.json'), JSON.stringify(saved));
  assert.equal(JSON.parse(ok(g.call('status',null,draft)).stdout).budget.time_exhausted,false);
  ok(g.call('review-plan',null,draft)); ok(g.call('agree-plan',g.agreement(draft),draft));
  assert.equal(JSON.parse(ok(g.call('status',null,draft)).stdout).budget.time_exhausted,false);
});
