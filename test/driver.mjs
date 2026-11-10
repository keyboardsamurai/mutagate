import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {root,scratch} from './scratch.mjs';
const harness=process.env.MUTAGATE_DRIVER_HARNESS||'claude';
if(!['claude','codex','opencode','pi','copilot'].includes(harness))throw Error('unknown harness');
const s=scratch(path.join(root,'test/fixtures/java-gradle'),{session:'driver',env:{MUTAGATE_HOOK_SESSION:'driver',MUTAGATE_HARNESS:harness}}),{repo}=s,entry='mutagate-hook.cjs';
try {
 const file='src/test/java/acme/UserServiceTest.java';
 const hook=(event,tool,mutate=false)=>s.cli(['hook',event,...(mutate?['--mutate']:[])],{entry,timeout:300000,input:JSON.stringify({cwd:repo,session_id:'driver',hook_event_name:event,harness,tool_name:harness==='codex'?'apply_patch':'Write',tool_use_id:tool,tool_input:harness==='codex'?{command:'*** Update File: '+file}:{file_path:file}})});
 if(harness==='copilot'){
 // Copilot (#35 AC 42): camelCase payloads through the installed bash commands, minus their `|| true`, so the exit code is the hook's: always 0, no stderr.
 // The native postToolUse spawns the background run (no --mutate); a block is one JSON object beside progress lines.
 s.env.COPILOT_HOME=path.join(s.dir,'copilot-home'); // install refuses the project scope beside a real ~/.copilot user install (#35 D5)
 assert.equal(s.cli(['install','--agent','copilot']).status,0);
 const bash=Object.fromEntries(Object.entries(JSON.parse(fs.readFileSync(path.join(repo,'.github/hooks/mutagate.json'),'utf8')).hooks).map(([e,[h]])=>[e,h.bash.replace(' || true # mutagate','')]));
 const native=(event,p)=>{const r=spawnSync('bash',['-c',bash[event]],{cwd:repo,env:s.env,encoding:'utf8',timeout:600000,input:JSON.stringify({sessionId:'driver',timestamp:Date.now(),cwd:repo,...p})}); // 600 s: the agentStop timeout T
  assert.equal(r.status,0,event);assert.equal(r.stderr,'',event);return r.stdout.split('\n').filter(Boolean).map(l=>JSON.parse(l)).filter(o=>o.type!=='progress');};
 const post=id=>native('postToolUse',{toolCallId:id,toolName:'create',toolArgs:{path:path.join(repo,file),file_text:fs.readFileSync(path.join(repo,file),'utf8')},toolResult:{resultType:'success'}}),status=()=>JSON.parse(s.cli(['status','--json'],{entry}).stdout);
 const write=async id=>{post(id);for(const end=Date.now()+300000;Date.now()<end;await new Promise(r=>setTimeout(r,1000))){const t=status();if(t.length&&t.every(x=>!x.stale&&!x.in_flight))return;}throw Error('no background run after the '+id+' write');};
 assert.match(native('sessionStart',{source:'new'})[0].additionalContext,/^mutagate \S+ active\./);
 // Overlap (#35 AC 18): agentStop while the real background PIT run holds the target lock; the gate waits for it (gateWaitSec up to G = 120 s) and blocks on its survivors.
 s.env.MUTAGATE_GATE_WAIT_SEC='120';const start=Date.now();post('weak');
 for(const end=Date.now()+120000;;await new Promise(r=>setTimeout(r,250))){const t=status();if(t.some(x=>x.in_flight))break;if(Date.now()>end||t.length&&t.every(x=>!x.stale))throw Error('no background run in flight after the weak write');}
 const block=native('agentStop',{stopReason:'end_turn',stop_hook_active:false});assert.equal(block.length,1,JSON.stringify(block));assert.equal(block[0].decision,'block');assert.match(block[0].reason,/isEligible/);
 console.log(`copilot overlap: agentStop blocked ${Math.round((Date.now()-start)/1000)} s after the weak write`);
 s.swap(file,'strong');await write('strong');
 assert.deepEqual(native('agentStop',{stopReason:'end_turn',stop_hook_active:true}),[]);
 }else{
 assert.equal(hook('SessionStart').status,0);
 const weak=hook('PostToolUse','weak',true);assert.ok([0,2].includes(weak.status),weak.stderr);
 const block=hook('Stop');assert.equal(block.status,2,block.stderr);assert.match(block.stdout,/isEligible/);
 s.swap(file,'strong');
 const strong=hook('PostToolUse','strong',true);assert.equal(strong.status,0,strong.stderr);
 assert.equal(hook('Stop').status,0);
 }
 const check=s.cli(['check'],{entry});assert.equal(check.status,0,check.stdout+check.stderr);
 console.log('PASS '+harness+' real scripted harness: write weak → block → write strong → allow → check');
}finally{s.rm();}
