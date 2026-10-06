import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {cacheRoot,hash} from '../../scripts/mutagate.mjs';
import {agentEnv,BUILD} from '../eval/run.mjs';
const {glob}=createRequire(import.meta.url)('../../scripts/glob.cjs');
// Model-free eval task validation: reference tests in, every declared target must come out scored. Opt-in via MUTAGATE_FIXTURES=eval-<lang>.
const root=path.resolve(import.meta.dirname,'../..'),tasks=path.join(root,'test/eval/tasks');
const selected=(process.env.MUTAGATE_FIXTURES||'').split(',').filter(n=>n.startsWith('eval-'));
// Same copy filter and toolchain env as a live run (agentEnv already drops MUTAGATE_HARNESS and the other inherited harness vars).
const skip=new Set([...BUILD,'expected.json','prompt.natural.md','reference']);
const env={...agentEnv(),MUTAGATE_RUN_BUDGET_SEC:'600'};
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
for(const name of selected)test(name+' reference tests score every expected target',{timeout:3600000},t=>{
  const lang=name.slice(5),task=path.join(tasks,lang),repo=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'mutagate-eval-task-')));
  // The engine keys its data dir on the realpath of --repo (macOS tmpdir is a /private symlink).
  t.after(()=>{fs.rmSync(repo,{recursive:true,force:true});fs.rmSync(path.join(cacheRoot(env),'repos',hash(repo)),{recursive:true,force:true});});
  const expected=JSON.parse(fs.readFileSync(path.join(task,'expected.json'),'utf8'));
  fs.cpSync(task,repo,{recursive:true,filter:p=>!path.relative(task,p).split(path.sep).some(s=>skip.has(s))});
  const sh=(argv,label)=>{const r=spawnSync(argv[0],argv.slice(1),{cwd:repo,env:{...env,MUTAGATE_SESSION:'eval-task-'+lang},encoding:'utf8',timeout:1200000,maxBuffer:50000000});assert.equal(r.status,0,`${label} ${argv.join(' ')} failed: ${r.error||''}\n${r.stdout}\n${r.stderr}`.slice(-6000));return r;};
  for(const argv of expected.setup||[])sh(argv,'setup');
  const refs=walk(path.join(task,'reference')).map(f=>path.relative(path.join(task,'reference'),f).split(path.sep).join('/'));
  for(const rel of refs){fs.mkdirSync(path.dirname(path.join(repo,rel)),{recursive:true});fs.copyFileSync(path.join(task,'reference',rel),path.join(repo,rel));}
  const tests=refs.filter(rel=>expected.testFiles.some(g=>glob(g).test(rel)));
  assert.ok(tests.length,'no reference tests match testFiles');
  const cli=path.join(root,'scripts',process.env.MUTAGATE_TEST_ENTRY||'mutagate.mjs'),mutagate=(...args)=>spawnSync(process.execPath,[cli,...args,'--repo',repo],{env:{...env,MUTAGATE_SESSION:'eval-task-'+lang},encoding:'utf8',timeout:1200000,maxBuffer:50000000});
  for(const rel of tests){const r=mutagate('run',rel,'--sync','--json');assert.ok(r.stdout,`no result for ${rel}: ${r.stderr}`);const out=JSON.parse(r.stdout);assert.ok(!out.ambiguous,`${rel}: ${out.message}`);for(const x of [out].flat())t.diagnostic(`${rel} -> ${x.target}: ${x.status} score=${x.score} (${x.killed}/${x.killed+x.survived}) ${x.duration_ms}ms${x.error?' '+x.error:''}`);}
  const status=JSON.parse(mutagate('status','--json').stdout);
  for(const {target} of expected.targets){const s=status.find(x=>x.target===target);assert.ok(s,`${target} not registered; status: ${status.map(x=>x.target).join(', ')}`);assert.equal(typeof s.result?.score,'number',`${target} unscored: ${JSON.stringify(s)}`.slice(0,3000));assert.ok(!['unscored','error'].includes(s.result.status),`${target}: ${s.result.status} ${s.result.error||''}`);}
  if(lang==='csharp')assert.ok(walk(repo).every(f=>!path.relative(repo,f).split(path.sep).some(p=>['bin','obj'].includes(p))),'mutagate created repo bin/obj outputs');
  sh(expected.testCommand,'testCommand');
});
