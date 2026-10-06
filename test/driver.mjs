import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const harness=process.env.MUTAGATE_DRIVER_HARNESS||'claude';
if(!['claude','codex','opencode','pi'].includes(harness))throw Error('unknown harness');
const root=path.resolve(import.meta.dirname,'..'),repo=fs.mkdtempSync(path.join(os.tmpdir(),'mutagate-driver-')),cli=path.join(root,'scripts/mutagate-hook.cjs');
try {
 fs.cpSync(path.join(root,'test/fixtures/java-gradle'),repo,{recursive:true,filter:p=>!p.split(path.sep).some(x=>['build','.gradle'].includes(x))});
 const env={...process.env,MUTAGATE_HOOK_SESSION:'driver',MUTAGATE_HARNESS:harness},file='src/test/java/acme/UserServiceTest.java';
 const hook=(event,tool,mutate=false)=>spawnSync(process.execPath,[cli,'hook',event,...(mutate?['--mutate']:[])],{env,cwd:repo,encoding:'utf8',input:JSON.stringify({cwd:repo,session_id:'driver',hook_event_name:event,harness,tool_name:harness==='codex'?'apply_patch':'Write',tool_use_id:tool,tool_input:harness==='codex'?{command:'*** Update File: '+file}:{file_path:file}}),timeout:300000});
 assert.equal(hook('SessionStart').status,0);
 const weak=hook('PostToolUse','weak',true);assert.ok([0,2].includes(weak.status),weak.stderr);
 const block=hook('Stop');assert.equal(block.status,2,block.stderr);assert.match(block.stdout,/isEligible/);
 fs.copyFileSync(path.join(repo,'variants/UserServiceTest.strong.java'),path.join(repo,file));
 const strong=hook('PostToolUse','strong',true);assert.equal(strong.status,0,strong.stderr);
 assert.equal(hook('Stop').status,0);
 const check=spawnSync(process.execPath,[cli,'check'],{env,cwd:repo,encoding:'utf8'});assert.equal(check.status,0,check.stdout+check.stderr);
 console.log('PASS '+harness+' real scripted harness: write weak → block → write strong → allow → check');
}finally{fs.rmSync(repo,{recursive:true,force:true});}
