import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function setup(t,name,rel=false,prepare=()=>{}) {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mutagate-adapter-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const calls=path.join(dir,'calls.jsonl'),cli=path.join(dir,'cli.mjs');
 fs.writeFileSync(cli,`import fs from 'node:fs';const p=JSON.parse(fs.readFileSync(0,'utf8'));fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify(p)+'\\n');const event=p.hook_event_name;console.log(JSON.stringify(event==='PreToolUse'?{hookSpecificOutput:{permissionDecision:'deny',permissionDecisionReason:'human approval'}}:event==='Stop'?{decision:'block',reason:'score below'}:event==='SessionStart'?{systemMessage:'active'}:{hookSpecificOutput:{additionalContext:'surviving mutant'}}));`);
 const source=fs.readFileSync(path.resolve(import.meta.dirname,'../../scripts/adapters',name==='pi'?'pi.ts':'opencode.js'),'utf8');assert.ok(source.split('\n').length<60);assert.ok([...source.matchAll(/from ['"]([^'"]+)/g)].every(m=>m[1].startsWith('node:')));
 const adapter=path.join(dir,rel?'plugins/adapter.mjs':'adapter.mjs');fs.mkdirSync(path.dirname(adapter),{recursive:true});fs.writeFileSync(adapter,source.replace('"__MUTAGATE_CLI__"',JSON.stringify(rel?'../cli.mjs':cli)));
 prepare(dir);return {dir,calls,mod:await import(pathToFileURL(adapter).href)};
}
test('OpenCode maps arguments, blocks waivers, appends context and reprompts',async t=>{
 const {dir,calls,mod}=await setup(t,'opencode'),prompts=[];
 const hooks=await mod.Mutagate({directory:dir,client:{session:{prompt:async p=>prompts.push(p)}}});
 const readOutput={output:'read'};await hooks['tool.execute.after']({tool:'read',sessionID:'s',args:{filePath:'foo.test.ts'}},readOutput);
 await assert.doesNotReject(hooks['tool.execute.before']({tool:'read',sessionID:'s'},{args:{filePath:'foo.test.ts'}}));
 assert.equal(readOutput.output,'read');assert.equal(fs.existsSync(calls),false);
 await assert.rejects(hooks['tool.execute.before']({tool:'write',sessionID:'s'},{args:{filePath:'.mutagate/waivers.json'}}),/human approval/);
 const output={output:'written'};await hooks['tool.execute.after']({tool:'write',sessionID:'s',args:{filePath:'foo.test.ts'}},output);assert.match(output.output,/surviving mutant/);
 await hooks.event({event:{type:'session.idle',properties:{sessionID:'s'}}});await sleep(150);
 assert.ok(prompts.some(p=>p.body.noReply===false&&p.body.parts[0].text==='score below'));assert.ok(prompts.some(p=>p.body.noReply===true));
 assert.equal(JSON.parse(fs.readFileSync(calls,'utf8').split('\n')[0]).tool_input.filePath,'.mutagate/waivers.json');
});
test('Pi maps session and tool inputs, blocks waivers and injects reports',async t=>{
 const {dir,calls,mod}=await setup(t,'pi'),handlers={},messages=[],prompts=[];
 mod.default({on:(e,f)=>handlers[e]=f,sendMessage:(...p)=>messages.push(p),sendUserMessage:p=>prompts.push(p)});
 const ctx={cwd:dir,sessionManager:{getSessionId:()=> 'pi-session'}};
 await handlers.tool_result({toolName:'read',input:{path:'foo.test.ts'}},ctx);
 assert.equal(await handlers.tool_call({toolName:'read',input:{path:'foo.test.ts'}},ctx),undefined);assert.equal(fs.existsSync(calls),false);assert.deepEqual(messages,[]);
 const result=await handlers.tool_call({toolName:'write',input:{path:'.mutagate/waivers.json'}},ctx);assert.equal(result.block,true);
 await handlers.session_start({},ctx);await handlers.tool_result({toolName:'write',input:{path:'foo.test.ts'}},ctx);await handlers.agent_end({},ctx);await sleep(150);
 assert.ok(messages.some(([m])=>m.content==='active'&&m.display===false));assert.ok(messages.some(([m,o])=>m.content==='surviving mutant'&&o.deliverAs==='steer'));assert.deepEqual(prompts,['score below']);
 assert.equal(JSON.parse(fs.readFileSync(calls,'utf8').split('\n')[0]).session_id,'pi-session');
});
test('OpenCode joins bash commands to the hook session through shell.env, skipping shells without a session',async t=>{
 const {dir,mod}=await setup(t,'opencode'),hooks=await mod.Mutagate({directory:dir,client:{session:{}}});
 const out={env:{KEEP:'1'}};await hooks['shell.env']({cwd:dir,sessionID:'ses_1',callID:'c'},out);assert.deepEqual(out.env,{KEEP:'1',MUTAGATE_HOOK_SESSION:'ses_1',MUTAGATE_HARNESS:'opencode'});
 const pty={env:{}};await hooks['shell.env']({cwd:dir},pty);assert.deepEqual(pty.env,{});
});
test('Pi exports the session id to its in-process bash tool at session start',async t=>{
 const {dir,mod}=await setup(t,'pi'),handlers={},old=process.env.MUTAGATE_HOOK_SESSION,oldHarness=process.env.MUTAGATE_HARNESS;t.after(()=>{if(oldHarness===undefined)delete process.env.MUTAGATE_HARNESS;else process.env.MUTAGATE_HARNESS=oldHarness;if(old===undefined)delete process.env.MUTAGATE_HOOK_SESSION;else process.env.MUTAGATE_HOOK_SESSION=old;});
 mod.default({on:(e,f)=>handlers[e]=f,sendMessage:()=>{},sendUserMessage:()=>{}});
 await handlers.session_start({},{cwd:dir,sessionManager:{getSessionId:()=>'pi-session-2'}});assert.equal(process.env.MUTAGATE_HOOK_SESSION,'pi-session-2');assert.equal(process.env.MUTAGATE_HARNESS,'pi');
});
test('OpenCode reprompts with the session model from the last assistant message and fails open',async t=>{
 const {dir,mod}=await setup(t,'opencode'),prompts=[],info=(role,extra)=>({info:{id:'m',sessionID:'s',role,...extra},parts:[]});
 const run=async messages=>{prompts.length=0;const hooks=await mod.Mutagate({directory:dir,client:{session:{messages,prompt:async p=>prompts.push(p)}}});await hooks.event({event:{type:'session.idle',properties:{sessionID:'s'}}});return prompts[0].body;};
 const seen=[];const body=await run(async q=>{seen.push(q);return {data:[info('assistant',{providerID:'anthropic',modelID:'old'}),info('assistant',{providerID:'openrouter',modelID:'deepseek/deepseek-v4.1-flash'}),info('user',{model:{providerID:'x',modelID:'y'}})]};});
 assert.deepEqual(body.model,{providerID:'openrouter',modelID:'deepseek/deepseek-v4.1-flash'});assert.equal(seen[0].path.id,'s');assert.equal(body.parts[0].text,'score below');
 assert.equal('model' in await run(async()=>({data:[info('user',{model:{providerID:'x',modelID:'y'}})]})),false);
 assert.equal('model' in await run(async()=>{throw new Error('down');}),false);
 assert.equal('model' in await run(async()=>({error:{name:'NotFoundError'}})),false);
});
test('adapters resolve a relative runtime path and pick Node from MUTAGATE_NODE, then .node-path, then PATH',{skip:process.platform==='win32'},async t=>{
 const old=process.env.MUTAGATE_NODE,oldSession=process.env.MUTAGATE_HOOK_SESSION,oldHarness=process.env.MUTAGATE_HARNESS;t.after(()=>{for(const [k,v] of [['MUTAGATE_NODE',old],['MUTAGATE_HOOK_SESSION',oldSession],['MUTAGATE_HARNESS',oldHarness]])if(v===undefined)delete process.env[k];else process.env[k]=v;});
 const fake=(dir,name)=>{const f=path.join(dir,name);fs.writeFileSync(f,`#!/bin/sh\ncat >/dev/null\necho '{"systemMessage":"${name}"}'\n`,{mode:0o755});return f;};
 const started=async(name,prepare)=>{delete process.env.MUTAGATE_NODE;const {dir,mod}=await setup(t,name,true,prepare),seen=[];
  if(name==='pi'){const handlers={};mod.default({on:(e,f)=>handlers[e]=f,sendMessage:m=>seen.push(m.content),sendUserMessage:()=>{}});await handlers.session_start({},{cwd:dir,sessionManager:{getSessionId:()=>'s'}});}
  else await (await mod.Mutagate({directory:dir,client:{session:{prompt:async p=>seen.push(p.body.parts[0].text)}}})).event({event:{type:'session.created',properties:{sessionID:'s'}}});
  return seen[0];};
 const recorded=dir=>fs.writeFileSync(path.join(dir,'.node-path'),fake(dir,'recorded')+'\n'); // next to the runtime (cli.mjs), as install writes it
 for(const name of ['opencode','pi']){
  assert.equal(await started(name,()=>{}),'active',name); // PATH node runs ../cli.mjs resolved against the adapter file
  assert.equal(await started(name,recorded),'recorded',name);
  assert.equal(await started(name,dir=>{recorded(dir);process.env.MUTAGATE_NODE=fake(dir,'env');}),'env',name);
  assert.equal(await started(name,dir=>{recorded(dir);process.env.MUTAGATE_NODE=path.join(dir,'missing');}),'recorded',name);
  assert.equal(await started(name,dir=>{process.env.MUTAGATE_NODE=path.join(dir,'missing');}),'active',name);
  assert.equal(await started(name,dir=>{recorded(dir);process.env.MUTAGATE_NODE=path.join(dir,'cli.mjs');}),'recorded',name); // exists, not executable
  assert.equal(await started(name,dir=>fs.writeFileSync(path.join(dir,'.node-path'),path.join(dir,'cli.mjs'))),'active',name);
 }
});
