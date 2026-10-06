import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {context,hookConfig} from '../scripts/mutagate.mjs';
const repo=fs.mkdtempSync(path.join(os.tmpdir(),'mutagate-perf-')),root=path.resolve(import.meta.dirname,'..');
try {
 // The installed project command: sh wrapper plus git rev-parse, as Claude and Codex run it.
 const installed=hookConfig('claude',context({repo:root})).hooks.PostToolUse[0].hooks[0].command,count=Number(process.env.MUTAGATE_PERF_COUNT||100),env={...process.env,CLAUDE_PLUGIN_DATA:path.join(repo,'.cache'),MUTAGATE_NODE:process.execPath};
 assert.equal(installed,'f="$(git rev-parse --show-toplevel)/scripts/hook" && [ -f "$f" ] && sh "$f" PostToolUse # mutagate');
 const p95=(exe,args)=>{const samples=[];for(let n=0;n<count+5;n++){const start=performance.now();const r=spawnSync(exe,args,{cwd:root,input:JSON.stringify({cwd:repo,session_id:'perf',harness:'claude',tool_name:'Edit',tool_input:{file_path:'production.java'},tool_use_id:String(n)}),env,encoding:'utf8'});if(r.status!==0)throw Error(r.stderr);if(n>=5)samples.push(performance.now()-start);}samples.sort((a,b)=>a-b);return samples[Math.ceil(samples.length*.95)-1];};
 const runtime=p95(process.execPath,[path.join(root,'scripts/mutagate-hook.cjs'),'hook','PostToolUse']),p95_ms=p95('sh',['-c',installed]);
 console.log(JSON.stringify({entrypoint:installed+' (installed hook command)',samples:count,p95_ms,runtime_entrypoint:'scripts/mutagate-hook.cjs',runtime_p95_ms:runtime,budget_ms:80,tolerance_ms:80}));if(p95_ms>80)process.exitCode=1;
}finally{fs.rmSync(repo,{recursive:true,force:true});}
