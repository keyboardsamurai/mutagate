import path from 'node:path';
import assert from 'node:assert/strict';
import {root,scratch} from './scratch.mjs';
const harness=process.env.MUTAGATE_DRIVER_HARNESS||'claude';
if(!['claude','codex','opencode','pi'].includes(harness))throw Error('unknown harness');
const s=scratch(path.join(root,'test/fixtures/java-gradle'),{session:'driver',env:{MUTAGATE_HOOK_SESSION:'driver',MUTAGATE_HARNESS:harness}}),{repo}=s,entry='mutagate-hook.cjs';
try {
 const file='src/test/java/acme/UserServiceTest.java';
 const hook=(event,tool,mutate=false)=>s.cli(['hook',event,...(mutate?['--mutate']:[])],{entry,timeout:300000,input:JSON.stringify({cwd:repo,session_id:'driver',hook_event_name:event,harness,tool_name:harness==='codex'?'apply_patch':'Write',tool_use_id:tool,tool_input:harness==='codex'?{command:'*** Update File: '+file}:{file_path:file}})});
 assert.equal(hook('SessionStart').status,0);
 const weak=hook('PostToolUse','weak',true);assert.ok([0,2].includes(weak.status),weak.stderr);
 const block=hook('Stop');assert.equal(block.status,2,block.stderr);assert.match(block.stdout,/isEligible/);
 s.swap(file,'strong');
 const strong=hook('PostToolUse','strong',true);assert.equal(strong.status,0,strong.stderr);
 assert.equal(hook('Stop').status,0);
 const check=s.cli(['check'],{entry});assert.equal(check.status,0,check.stdout+check.stderr);
 console.log('PASS '+harness+' real scripted harness: write weak → block → write strong → allow → check');
}finally{s.rm();}
