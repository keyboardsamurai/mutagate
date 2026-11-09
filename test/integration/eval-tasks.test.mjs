import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {agentEnv} from '../eval/run.mjs';
import {root,scratch} from '../scratch.mjs';
const {glob}=createRequire(import.meta.url)('../../scripts/glob.cjs');
// Model-free eval task validation: reference tests in, every declared target must come out scored. Opt-in via MUTAGATE_FIXTURES=eval-<lang>.
const tasks=path.join(root,'test/eval/tasks');
const selected=(process.env.MUTAGATE_FIXTURES||'').split(',').filter(n=>n.startsWith('eval-'));
// Same copy filter and toolchain env as a live run (agentEnv already drops MUTAGATE_HARNESS and the other inherited harness vars).
const env={...agentEnv(),MUTAGATE_RUN_BUDGET_SEC:'600'};
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
for(const name of selected)test(name+' reference tests score every expected target',{timeout:3600000},t=>{
  const lang=name.slice(5),task=path.join(tasks,lang),sr=scratch(task,{session:'eval-task-'+lang,env}),{repo}=sr;
  t.after(sr.rm);
  const expected=JSON.parse(fs.readFileSync(path.join(task,'expected.json'),'utf8'));
  const sh=(argv,label)=>{const r=spawnSync(argv[0],argv.slice(1),{cwd:repo,env:sr.env,encoding:'utf8',timeout:1200000,maxBuffer:50000000});assert.equal(r.status,0,`${label} ${argv.join(' ')} failed: ${r.error||''}\n${r.stdout}\n${r.stderr}`.slice(-6000));return r;};
  for(const argv of expected.setup||[])sh(argv,'setup');
  const refs=walk(path.join(task,'reference')).map(f=>path.relative(path.join(task,'reference'),f).split(path.sep).join('/'));
  for(const rel of refs){fs.mkdirSync(path.dirname(path.join(repo,rel)),{recursive:true});fs.copyFileSync(path.join(task,'reference',rel),path.join(repo,rel));}
  const tests=refs.filter(rel=>expected.testFiles.some(g=>glob(g).test(rel)));
  assert.ok(tests.length,'no reference tests match testFiles');
  const mutagate=(...args)=>sr.cli(args,{timeout:1200000});
  for(const rel of tests){const r=mutagate('run',rel,'--sync','--json');assert.ok(r.stdout,`no result for ${rel}: ${r.stderr}`);const out=JSON.parse(r.stdout);assert.ok(!out.ambiguous,`${rel}: ${out.message}`);for(const x of [out].flat())t.diagnostic(`${rel} -> ${x.target}: ${x.status} score=${x.score} (${x.killed}/${x.killed+x.survived}) ${x.duration_ms}ms${x.error?' '+x.error:''}`);}
  const status=JSON.parse(mutagate('status','--json').stdout);
  for(const {target} of expected.targets){const s=status.find(x=>x.target===target);assert.ok(s,`${target} not registered; status: ${status.map(x=>x.target).join(', ')}`);assert.equal(typeof s.result?.score,'number',`${target} unscored: ${JSON.stringify(s)}`.slice(0,3000));assert.ok(!['unscored','error'].includes(s.result.status),`${target}: ${s.result.status} ${s.result.error||''}`);}
  if(lang==='csharp')assert.ok(walk(repo).every(f=>!path.relative(repo,f).split(path.sep).some(p=>['bin','obj'].includes(p))),'mutagate created repo bin/obj outputs');
  sh(expected.testCommand,'testCommand');
});
