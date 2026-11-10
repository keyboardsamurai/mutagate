import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {context,hookConfig,register,runTarget,hash,updateState} from '../scripts/mutagate.mjs';
const repo=fs.mkdtempSync(path.join(os.tmpdir(),'mutagate-perf-')),big=fs.mkdtempSync(path.join(os.tmpdir(),'mutagate-perf-big-')),root=path.resolve(import.meta.dirname,'..');
try {
 // The installed project command: sh wrapper plus git rev-parse, as Claude and Codex run it.
 const hooks=hookConfig('claude',context({repo:root})).hooks,installed=hooks.PostToolUse[0].hooks[0].command,count=Number(process.env.MUTAGATE_PERF_COUNT||100),env={...process.env,CLAUDE_PLUGIN_DATA:path.join(repo,'.cache'),MUTAGATE_NODE:process.execPath};
 assert.equal(installed,'f="$(git rev-parse --show-toplevel)/scripts/hook" && [ -f "$f" ] && sh "$f" PostToolUse || true # mutagate');
 const p95=(exe,args,payload=n=>({cwd:repo,session_id:'perf',harness:'claude',tool_name:'Edit',tool_input:{file_path:'production.java'},tool_use_id:String(n)}),total=count)=>{const samples=[];for(let n=0;n<total+5;n++){const start=performance.now();const r=spawnSync(exe,args,{cwd:root,input:JSON.stringify(payload(n)),env,encoding:'utf8'});if(r.status!==0)throw Error(r.stderr);if(n>=5)samples.push(performance.now()-start);}samples.sort((a,b)=>a-b);return samples[Math.ceil(samples.length*.95)-1];};
 const runtime=p95(process.execPath,[path.join(root,'scripts/mutagate-hook.cjs'),'hook','PostToolUse']),p95_ms=p95('sh',['-c',installed]);
 // A 15k-file Git repo (5k Java sources, 10k resources): edits must not scale with it, SessionStart and test edits list it once.
 const put=(f,s)=>{fs.mkdirSync(path.dirname(path.join(big,f)),{recursive:true});fs.writeFileSync(path.join(big,f),s);};put('pom.xml','<project/>');put('src/test/java/acme/p0/C0Test.java','package acme.p0;\npublic class C0Test {}\n');
 for(let n=0;n<5000;n++)put(`src/main/java/acme/p${n%50}/C${n}.java`,`package acme.p${n%50};\npublic class C${n} { int value() { return ${n}; } }\n`);
 for(let n=0;n<10000;n++)put(`src/main/resources/r${n%100}/f${n}.txt`,'x\n');
 for(const args of [['init','-q'],['add','-A']])if(spawnSync('git',args,{cwd:big}).status!==0)throw Error('git '+args.join(' ')+' failed');
 const large=Math.min(count,100),event=(name,input)=>p95('sh',['-c',hooks[name][0].hooks[0].command],n=>({cwd:big,session_id:'perf-big',harness:'claude',...input(n)}),large);
 const large_tree={files:15002,samples:large,SessionStart:event('SessionStart',()=>({source:'startup'})),PreToolUse:event('PreToolUse',()=>({tool_name:'Edit',tool_input:{file_path:'src/main/java/acme/p1/C1.java'}})),
  test_PostToolUse:event('PostToolUse',n=>({tool_name:'Edit',tool_input:{file_path:'src/test/java/acme/p0/C0Test.java'},tool_use_id:'test-'+n})),PostToolUse:event('PostToolUse',n=>({tool_name:'Edit',tool_input:{file_path:'src/main/java/acme/p1/C1.java'},tool_use_id:'edit-'+n})),
  // Copilot CLI runs the Claude project hooks; its test edit is inert (ADR-0015).
  inherited_PostToolUse:event('PostToolUse',n=>({harness:undefined,timestamp:new Date().toISOString(),tool_name:'Write',tool_input:{path:'src/test/java/acme/p0/C0Test.java'},tool_result:{result_type:'success'},tool_use_id:'copilot-'+n})),budget_ms:80,listing_budget_ms:300};
 // Before the Copilot seed below, which registers the same class.
 const registered=fs.readdirSync(path.join(repo,'.cache/repos')).some(d=>{const dir=path.join(repo,'.cache/repos',d,'state');return fs.existsSync(dir)&&fs.readdirSync(dir).some(f=>fs.readFileSync(path.join(dir,f),'utf8').includes('"target": "acme.p0.C0"'));});assert.ok(registered,'the test edit registers acme.p0.C0');
 // Native Copilot postToolUse (ADR-0019): a test edit, which registers and spawns the detached handler; a path-less bash call with an empty outbox;
 // and a drain of one fresh report queued before each call.
 // A drain checks the result fingerprint, which hashes the target's module: the small repo carries its budget; in the 15k-file module it is reported only.
 process.env.CLAUDE_PLUGIN_DATA=env.CLAUDE_PLUGIN_DATA;
 const seed=async(dir,cls)=>{const c=context({harness:'copilot'},{cwd:dir,sessionId:'perf-copilot'}),key=hash(cls),name=cls.split('.').at(-1);await register(c,`src/test/java/${cls.replaceAll('.','/')}Test.java`);
  const r=await runTarget(c,key,async()=>({raw:[{file:name+'.java',class:cls,line:2,method:'value',mutator:'PRIMITIVE_RETURNS',description:'replaced int return with 0',status:'SURVIVED'}]}));return {c,key,run:r.started_at};};
 const copilot=(c,payload,total)=>p95(process.execPath,[path.join(root,'scripts/mutagate-hook.cjs'),'hook','PostToolUse','--harness','copilot'],n=>({sessionId:'perf-copilot',timestamp:Date.now(),cwd:c.repo,toolCallId:'call-'+n,...payload(n)}),total);
 const bash=({c,key,run},queue,total)=>copilot(c,n=>{if(queue){const s=JSON.parse(fs.readFileSync(c.stateFile,'utf8'));s.outbox=[{key,run,text:'mutagate: report '+n}];fs.writeFileSync(c.stateFile,JSON.stringify(s));}return {toolName:'bash',toolArgs:{command:'echo '+n}};},total);
 for(const [f,s] of [['pom.xml','<project/>'],['src/main/java/acme/C.java','package acme;\npublic class C { int value() { return 1; } }\n'],['src/test/java/acme/CTest.java','package acme;\npublic class CTest {}\n']]){fs.mkdirSync(path.dirname(path.join(repo,f)),{recursive:true});fs.writeFileSync(path.join(repo,f),s);}
 const small=await seed(repo,'acme.C'),large_target=await seed(big,'acme.p0.C0'),copilot_drain_p95_ms=bash(small,true,count),
  copilot_test_edit_p95_ms=copilot(small.c,n=>({toolName:'edit',toolArgs:{path:path.join(small.c.repo,'src/test/java/acme/CTest.java'),old_str:'{}',new_str:'{ }'.repeat(n+1)}}),count);
 // Each edit spawned a handler that waits up to 6 s for quiet and yields to a newer event: a last event ends them with no mutation run.
 await updateState(small.c,s=>{s.events.push('perf-end');});const handlersDone=Date.now()+7000;Object.assign(large_tree,{copilot_PostToolUse:bash(large_target,false,large),copilot_drain_unbudgeted:bash(large_target,true,large)});
 await new Promise(r=>setTimeout(r,Math.max(0,handlersDone-Date.now()))); // the handlers exit before the repo is removed
 console.log(JSON.stringify({entrypoint:installed+' (installed hook command)',samples:count,p95_ms,runtime_entrypoint:'scripts/mutagate-hook.cjs',runtime_p95_ms:runtime,copilot_test_edit_p95_ms,copilot_drain_p95_ms,budget_ms:80,tolerance_ms:80,large_tree}));
 if(p95_ms>80||copilot_test_edit_p95_ms>80||copilot_drain_p95_ms>80||[large_tree.PreToolUse,large_tree.PostToolUse,large_tree.inherited_PostToolUse,large_tree.copilot_PostToolUse].some(v=>v>large_tree.budget_ms)||[large_tree.SessionStart,large_tree.test_PostToolUse].some(v=>v>large_tree.listing_budget_ms))process.exitCode=1;
}finally{for(const dir of [repo,big])fs.rmSync(dir,{recursive:true,force:true});}
