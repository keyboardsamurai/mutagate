// Live eval sweep: planner and aggregation are pure exports; the CLI executes the plan.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {command,hash,cacheRoot} from '../../scripts/mutagate.mjs';
import {packageSkill} from '../package.mjs';
import {harnesses,which,procs} from './harnesses.mjs';
import {writeChecks,writeSweep,scrubDir,evidenceRecord} from './checks.mjs';
export const ids={harness:['claude','codex','opencode','pi'],lang:['java','kotlin','python','typescript','go','csharp'],scenario:['natural','forced'],task:['small','greenfield']};
const known=(kind,v)=>{if(!ids[kind].includes(v))throw Error(`unknown ${kind} "${v}" (expected ${ids[kind].join('|')})`);return v;};
const count=(flag,v)=>{if(!/^[1-9]\d*$/.test(v))throw Error(`${flag} must be a positive integer, got "${v}"`);return +v;};

export function parseArgs(argv){
 const f={harness:[],lang:[],scenario:[],task:[],repeat:undefined,jobs:undefined,model:{},report:undefined}; // f.variant is set only by --variant
 for(let i=0;i<argv.length;i++){
  const m=/^--([^=]+)(?:=(.*))?$/s.exec(argv[i]);if(!m)throw Error(`unknown argument "${argv[i]}"`);
  const flag='--'+m[1];if(!['harness','lang','scenario','task','repeat','jobs','model','report','variant'].includes(m[1]))throw Error(`unknown flag "${flag}"`);
  const v=m[2]??argv[++i];if(!v||m[2]===undefined&&v.startsWith('--'))throw Error(`${flag} needs a value`);
  if(m[1]==='repeat'||m[1]==='jobs')f[m[1]]=count(flag,v);
  else if(m[1]==='report')f.report=v;
  else if(m[1]==='variant'){if(!/^[a-z][a-z0-9-]*$/.test(v))throw Error(`--variant must match /^[a-z][a-z0-9-]*$/, got "${v}"`);f.variant=v;}
  else if(m[1]==='model'){const [,h,id]=/^([^=]*)=(.+)$/s.exec(v)||[];if(!id)throw Error(`--model expects <harness>=<id>, got "${v}"`);f.model[known('harness',h)]=id;}
  else f[m[1]].push(...v.split(',').map(x=>known(m[1],x)));
 }
 if(f.task.length>1)throw Error('--task takes one value');
 // A prompt variant (tasks/<lang>/prompt.<variant>.md) replaces the natural prompt of the small task only; it never writes evidence records.
 if(f.variant){if(f.scenario.includes('forced')||f.task[0]==='greenfield')throw Error('--variant applies to the small task, natural scenario');if(!f.scenario.length)f.scenario=['natural'];}
 for(const k of ['harness','lang','scenario'])f[k]=f[k].length?[...new Set(f[k])]:[...ids[k]];
 return {...f,task:f.task[0]??'small'};
}

export function planSweep({flags,config,preflight}){
 const task=flags.task??'small',repeat=flags.repeat??config.repeat,skips=new Map(),plan=[];
 for(const harness of flags.harness??ids.harness)for(const lang of flags.lang??ids.lang){
  const key=`${harness}\0${lang}\0${task}`;if(!skips.has(key))skips.set(key,preflight(harness,lang,task,flags.variant)??null);
  for(const scenario of flags.scenario??ids.scenario){
   const cell=`${harness}-${lang}-${scenario}${task==='greenfield'?'-greenfield':''}${flags.variant?`-${flags.variant}`:''}`;
   for(let n=1;n<=repeat;n++)plan.push({name:`${cell}-${n}`,cell,harness,lang,scenario,task,n,model:flags.model?.[harness]??config.models[harness],skip:skips.get(key),...(flags.variant&&{variant:flags.variant})});
  }
 }
 return plan;
}

export function aggregate(results){
 const cells=new Map();
 for(const r of results){
  const cell=r.run.replace(/-\d+$/,'');
  const c=cells.get(cell)??cells.set(cell,{cell,harness:r.harness,lang:r.lang,scenario:r.scenario,task:r.task??'small',status:'skip',passed:0,total:0,wallMs:0}).get(cell);
  if(r.skipped)continue;
  c.total++;c.passed+=r.passed?1:0;c.wallMs+=r.wallMs??0;c.status=c.passed?'pass':'fail';
 }
 const list=[...cells.values()],by=s=>list.filter(c=>c.status===s),failed=by('fail'),n=by('pass').length+failed.length;
 const summary=`${by('pass').length} passed, ${failed.length} failed, ${by('skip').length} skipped`;
 if(!n)return {cells:list,exitCode:1,message:`no cell executed (${summary})`};
 return {cells:list,exitCode:failed.length?1:0,message:failed.length?`${summary}; failed: ${failed.map(c=>c.cell).join(', ')}`:summary};
}

// Run repos live outside this tree: Claude and Pi load CLAUDE.md/AGENTS.md from every ancestor dir, and tmp dirs do not survive a reboot. The run dir's repo/ links here.
export const evidenceCells=cells=>cells.filter(c=>c.status==='pass'&&c.task==='small'&&c.total>=2); // ADR-0011: both runs or no record
export const runRepo=(sweepId,run,home=os.homedir(),suffix=crypto.randomBytes(8).toString('hex'))=>path.join(home,'.cache/mutagate-eval',sweepId,`${run}-${suffix}`);
// One deadline from run start covers setup and the agent; collection after the agent gets a fixed grace. Never 0: command() treats 0 as its 300 s default.
export const GRACE_MS=300000;
export const stepTimeout=({start,timeoutMs,agentEnd},now=Date.now())=>Math.max(1,(agentEnd==null?start+timeoutMs:agentEnd+GRACE_MS)-now);
// Working tree vs baseline including new files. add -N records paths with an empty blob, so file content (and any secret in it) never reaches .git/objects.
export function diffSince(repo,baseline,timeout=GRACE_MS){
 spawnSync('git',['add','-N','-A'],{cwd:repo,timeout});
 return spawnSync('git',['diff',baseline],{cwd:repo,encoding:'utf8',maxBuffer:1<<30,timeout}).stdout??'';
}

// ---- CLI execution (docs/eval_suite.md "Run lifecycle") ----
const root=path.resolve(import.meta.dirname,'../..'),tasks=path.join(import.meta.dirname,'tasks'),home=os.homedir(),readJson=f=>JSON.parse(fs.readFileSync(f,'utf8'));
export const BUILD=new Set(['node_modules','.venv','target','build','.gradle','bin','obj','StrykerOutput','TestResults','dist','__pycache__','.pytest_cache','mutants','.mutmut-cache']);
const IGNORE=['','.claude/','.agents/','.pi/','.opencode/','.codex/',...BUILD,''].join('\n');

// process.env minus inherited harness/mutagate vars and secrets, plus the mutagate debug env and the toolchains.
// Stripping all CLAUDE* (not only CLAUDECODE/CLAUDE_CODE_*/CLAUDE_CONFIG_DIR) also drops CLAUDE_PROJECT_DIR and CLAUDE_PLUGIN_ROOT, which mutagate's harness detection reads.
export function agentEnv(){
 const java=[path.join(home,'.sdkman/candidates/java/21.0.2-open'),process.env.JAVA_HOME].find(p=>p&&fs.existsSync(p)),dotnet=path.join(home,'.dotnet');
 const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(CLAUDE|CODEX_|OPENCODE|PI_|MUTAGATE_)/.test(k)&&k!=='OPENROUTER_API_KEY'));
 return {...env,MUTAGATE_TRACE:'1',MUTAGATE_DEBUG:'1',MUTAGATE_RECORD:'1',MUTAGATE_NODE:process.execPath,...(java&&{JAVA_HOME:java}),...(!env.DOTNET_ROOT&&fs.existsSync(dotnet)&&{DOTNET_ROOT:dotnet}),
  PATH:[path.dirname(process.execPath),java&&path.join(java,'bin'),path.join(home,'go/bin'),dotnet,path.join(dotnet,'tools'),process.env.PATH].filter(Boolean).join(path.delimiter)};
}

async function execute(run,{sweepDir,config,base,pre,secrets,started}){
 const {harness,lang,scenario,task,n,model,variant}=run,dir=path.join(sweepDir,run.name),write=(f,s)=>fs.writeFileSync(path.join(dir,f),s??'');
 fs.mkdirSync(dir,{recursive:true});
 if(run.skip){const result={run:run.name,harness,lang,scenario,task,n,passed:false,skipped:run.skip,ended:null,wallMs:null,checks:[]};write('result.json',JSON.stringify(result,null,2));return result;}
 const h=harnesses[harness],taskDir=path.join(tasks,lang),expected=readJson(path.join(taskDir,'expected.json')),node=process.execPath,budget={start:Date.now(),timeoutMs:config.timeoutMs};
 const meta={harness,harnessVersion:pre.get(harness).version,model,lang,scenario,task,variant:variant??null,n,startedAt:null,endedAt:null,wallMs:null,exitCode:null,ended:null,session:null};
 const repoDir=runRepo(path.basename(sweepDir),run.name);fs.mkdirSync(path.dirname(repoDir),{recursive:true,mode:0o311});fs.mkdirSync(repoDir,{mode:0o700});
 const repo=fs.realpathSync(repoDir);fs.symlinkSync(repo,path.join(dir,'repo'));started.push({dir,repo});
 const cli=path.join(repo,h.skillDir,'scripts/mutagate.mjs'),sh=(exe,args,o={})=>command(exe,args,{cwd:repo,env:base,timeout:stepTimeout(budget),...o});
 try{
  if(task==='small')fs.cpSync(taskDir,repo,{recursive:true,filter:src=>{const rel=path.relative(taskDir,src);return !['expected.json','reference'].includes(rel)&&!/^prompt\.[a-z0-9-]+\.md$/.test(rel)&&!rel.split(path.sep).some(s=>BUILD.has(s));}});
  const stage=path.join(dir,'stage');packageSkill(stage);
  await sh('npx',['--yes','skills@1.5.26','add',stage,'--skill','mutagate','--agent',h.agent,'--yes','--copy'],{env:{...base,DISABLE_TELEMETRY:'1',DO_NOT_TRACK:'1'}});
  await sh('git',['init','-q']);await sh(node,[cli,'install','--agent',harness,'--repo',repo]); // in Git first: install writes the portable form users get
  if(task==='small')for(const [exe,...args] of expected.setup||[])await sh(exe,args);
  fs.appendFileSync(path.join(repo,'.gitignore'),IGNORE);
  for(const args of [['add','-A'],['-c','user.name=mutagate','-c','user.email=mutagate@example.invalid','commit','-qm','eval baseline']])await sh('git',args);
  const baseline=(await sh('git',['rev-parse','HEAD'])).output.trim();
  // Greenfield: the language plan, plus the shared build-order addendum when forced.
  const read=f=>fs.readFileSync(f,'utf8'),green=f=>path.join(tasks,'greenfield',f);
  const prompt=task==='greenfield'?read(green(lang+'.md'))+(scenario==='forced'?read(green('forced.md')):''):read(scenario==='forced'?path.join(tasks,'prompt.forced.md'):path.join(taskDir,`prompt.${variant??'natural'}.md`));
  const env={...base,PWD:repo,...h.env({runDir:dir,repo})},start=Date.now();meta.startedAt=new Date(start).toISOString();
  console.log(`start ${run.name}`);
  const r=await h.launch({exe:pre.get(harness).exe,repo,runDir:dir,prompt,model,env,timeoutMs:stepTimeout(budget),config});budget.agentEnd=Date.now();
  Object.assign(meta,{endedAt:new Date().toISOString(),wallMs:Date.now()-start,exitCode:r.exitCode,ended:r.ended});write('final.txt',r.final);
  const cache=cacheRoot(env),data=path.join(cache,'repos',hash(repo)),trace=path.join(data,'trace.jsonl');
  const events=(fs.existsSync(trace)?fs.readFileSync(trace,'utf8'):'').split('\n').flatMap(l=>{try{return [JSON.parse(l)];}catch{return [];}}),starts=events.filter(e=>e.event==='SessionStart');
  meta.session=(starts.find(e=>e.harness===harness)??starts[0])?.session??null;
  const cliEnv={...env,MUTAGATE_HARNESS:harness,...(meta.session&&{MUTAGATE_SESSION:meta.session})};
  const check=await sh(node,[cli,'check','--json','--repo',repo],{env:cliEnv,allowFailure:true});write('check.json',check.output);write('check.exit',String(check.code??check.signal));
  write('status.json',(await sh(node,[cli,'status','--json','--repo',repo],{env:cliEnv,allowFailure:true})).output);
  write('diff.patch',diffSince(repo,baseline,stepTimeout(budget)));
  const t=await sh(expected.testCommand[0],expected.testCommand.slice(1),{allowFailure:true}).catch(e=>({output:'',error:e.message,code:127}));
  write('test-command.log',t.output+t.error);write('test-command.exit',String(t.code??t.signal));
  if(fs.existsSync(trace))fs.copyFileSync(trace,path.join(dir,'trace.jsonl'));
  if(fs.existsSync(path.join(data,'logs')))fs.cpSync(path.join(data,'logs'),path.join(dir,'runner-logs'),{recursive:true});
  // MUTAGATE_RECORD writes to the shared cacheRoot()/recorded/<harness>/; keep this run's payloads by time and repo path.
  const rec=path.join(cache,'recorded'),needle=JSON.stringify(repo).slice(1,-1);
  for(const f of fs.existsSync(rec)?fs.readdirSync(rec,{recursive:true}).map(String):[]){const p=path.join(rec,f),s=fs.statSync(p);if(s.isFile()&&s.mtimeMs>=start&&fs.readFileSync(p,'utf8').includes(needle))fs.cpSync(p,path.join(dir,'recorded',f));}
 }catch(e){meta.error=String(e.stack||e);write('error.log',meta.error);console.error(`${run.name}: ${e.message}`);}
 const stage=path.join(dir,'stage'),modified=[];
 if(fs.existsSync(stage))for(const f of fs.readdirSync(stage,{recursive:true}).map(String).sort()){
  if(!/^(?:SKILL\.md$|README\.md$|scripts\/|references\/)/.test(f)||/^scripts\/(?:adapters\/|\.node-path$)/.test(f)||!fs.statSync(path.join(stage,f)).isFile())continue;
  const digest=p=>{try{return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');}catch{return null;}};
  if(digest(path.join(stage,f))!==digest(path.join(repo,h.skillDir,f)))modified.push(f);
 }
 write('skill-diff.txt',modified.length?modified.join('\n')+'\n':'');
 write('meta.json',JSON.stringify(meta,null,2));
 scrubDir(dir,secrets);scrubDir(repo,secrets);
 // Greenfield starts empty: the small task's targets and production globs do not apply (targets-scored is vacuous); testFiles and testCommand still do.
 const {result}=writeChecks(dir,task==='greenfield'?{...expected,targets:[],prodFiles:[],expectedProdEdits:[]}:expected);
 console.log(`${result.passed?'PASS':'FAIL'} ${run.name} (${((meta.wallMs||0)/60000).toFixed(1)}m)`);
 return result;
}

async function main(){
 const flags=parseArgs(process.argv.slice(2));
 // --report <sweepDir>: re-render report.md and anomalies.json from the run dirs' existing result.json/anomalies.json (e.g. a killed sweep), no runs and no re-check.
 if(flags.report){const dir=path.resolve(flags.report);writeSweep(dir);console.log(`report: ${path.join(dir,'report.md')}`);return;}
 if(fs.existsSync(path.join(root,'.env')))process.loadEnvFile(path.join(root,'.env'));
 if(+process.versions.node.split('.')[0]<22)throw Error(`run the eval under Node 22+ (this is ${process.version}); it becomes MUTAGATE_NODE`);
 const config=readJson(path.join(import.meta.dirname,'config.json')),base=agentEnv(),pre=new Map();
 const secrets=[process.env.CLAUDE_CODE_OAUTH_TOKEN,process.env.OPENROUTER_API_KEY].filter(Boolean);
 const stamp=new Date().toISOString().replace(/\D/g,''),sweepId=`${stamp.slice(0,8)}-${stamp.slice(8,14)}-${crypto.randomBytes(2).toString('hex')}`,sweepDir=path.join(root,'test/.cache/eval',sweepId);
 const preflight=(h,lang,task,variant)=>{
  const t=path.join(tasks,lang);
  if(!['expected.json','prompt.natural.md'].every(f=>fs.existsSync(path.join(t,f))))return `task ${lang} missing`;
  if(task==='greenfield'&&!fs.existsSync(path.join(tasks,'greenfield',lang+'.md')))return `greenfield prompt for ${lang} missing`;
  if(variant&&!fs.existsSync(path.join(t,`prompt.${variant}.md`)))return `variant prompt tasks/${lang}/prompt.${variant}.md missing`;
  if(!pre.has(h))try{pre.set(h,harnesses[h].preflight({env:base}));}catch(e){pre.set(h,{reason:`preflight failed: ${e.message}`});}
  if(pre.get(h).reason)return pre.get(h).reason;
  const missing=(readJson(path.join(t,'expected.json')).toolchain||[]).filter(b=>!which(b,base.PATH));
  return missing.length?`toolchain missing: ${missing.join(', ')}`:null;
 };
 const plan=planSweep({flags,config,preflight});
 console.log(`sweep ${sweepId}: ${plan.length} runs, ${plan.filter(r=>!r.skip).length} to execute`);
 // Runs killed mid-way never reach execute()'s scrub: scrub every run dir and repo started so far before exiting.
 const results=[],queue=[...plan],started=[];
 process.on('SIGINT',()=>{for(const pid of procs)try{process.kill(-pid,'SIGKILL');}catch{}for(const {dir,repo} of started){for(const f of ['opencode.db','opencode.db-wal','opencode.db-shm'])fs.rmSync(path.join(dir,'opencode/data/opencode',f),{force:true});for(const d of [dir,repo])try{scrubDir(d,secrets);}catch{}}process.exit(130);});
 await Promise.all(Array.from({length:flags.jobs??config.jobs},async()=>{for(let run;(run=queue.shift());)results.push(await execute(run,{sweepDir,config,base,pre,secrets,started}));}));
 results.sort((a,b)=>plan.findIndex(r=>r.name===a.run)-plan.findIndex(r=>r.name===b.run));
 writeSweep(sweepDir);
 const agg=aggregate(results);
 if(flags.variant)console.log('--variant: no evidence records written');
 else if((flags.repeat??config.repeat)<2)console.log('--repeat below 2: no evidence records written (ADR-0011)');
 for(const c of flags.variant?[]:evidenceCells(agg.cells)){
  const file=path.join(root,'test/evidence/live',c.cell+'.json');fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file,JSON.stringify(evidenceRecord(c.cell,plan.filter(r=>r.cell===c.cell).map(r=>path.join(sweepDir,r.name)),secrets),null,2)+'\n');
 }
 console.log(`\nreport: ${path.join(sweepDir,'report.md')}`);
 for(const c of agg.cells)console.log(`${c.status.toUpperCase().padEnd(4)}  ${c.cell.padEnd(36)} ${c.passed}/${c.total}  ${(c.wallMs/60000).toFixed(1)}m${c.status==='skip'?`  ${results.find(r=>r.run.startsWith(c.cell+'-')&&r.skipped)?.skipped}`:''}`);
 console.log(agg.message);
 process.exitCode=agg.exitCode;
}
if(process.argv[1]===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1;});
