import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import * as m from '../scripts/mutagate.mjs';
const root=path.resolve(import.meta.dirname,'..');
for(const executable of ['mutagate.mjs','mutagate-hook.cjs'])for(const harness of ['claude','codex','opencode','pi'])test(executable+' '+harness+' golden hook corpus',async t=>{
 const repo=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mutagate-protocol-')));t.after(()=>fs.rmSync(repo,{recursive:true,force:true}));
 const cache=path.join(repo,'.cache');
 const invoke=(event,p,input)=>spawnSync(process.execPath,[path.join(root,'scripts',executable),'hook',event],{input:input??JSON.stringify({cwd:repo,session_id:'sess_fixture',harness,...p}),env:{...process.env,CLAUDE_PLUGIN_DATA:cache,MUTAGATE_HARNESS:harness,MUTAGATE_TRACE:'1'},encoding:'utf8'});
 const corpus=path.join(root,'test/payloads',harness);
 for(const file of fs.readdirSync(corpus).filter(f=>f.endsWith('.json')&&!f.endsWith('.expected.json')&&f!=='schema-keys.json')){
  const payload=JSON.parse(fs.readFileSync(path.join(corpus,file))),expected=JSON.parse(fs.readFileSync(path.join(corpus,file.replace('.json','.expected.json'))));
  const actual=invoke(payload.hook_event_name,{...payload,cwd:repo});assert.equal(actual.status,expected.exit_code,file);assert.equal(actual.stdout,expected.stdout,file);assert.ok(actual.stderr.includes(expected.stderr_contains));
 }
 const start=invoke('SessionStart',{});assert.equal(start.status,0);assert.match(start.stdout,/mutagate/);
 const deny=invoke('PreToolUse',{tool_name:harness==='codex'?'apply_patch':'Write',tool_input:harness==='codex'?{command:'*** Update File: .mutagate/waivers.json'}:{file_path:'.mutagate/waivers.json'}});assert.equal(JSON.parse(deny.stdout).hookSpecificOutput.permissionDecision,harness==='claude'?'ask':'deny');
 for(const event of ['Stop','SubagentStop','TaskCompleted','Unknown']){const r=invoke(event,{});assert.equal(r.status,0);assert.equal(r.stdout,'');}
 assert.equal(invoke('Stop',{},'{').status,0);
 const trace=fs.readFileSync(path.join(cache,'repos',m.hash(repo),'trace.jsonl'),'utf8').trim().split('\n').map(JSON.parse);assert.ok(trace.every(r=>r.harness===harness));
});
test('size limits and Kotlin labeled-corpus precision',()=>{
 assert.ok(fs.readFileSync(path.join(root,'scripts/mutagate.mjs'),'utf8').split('\n').length<1400);
 const base=path.join(root,'test/fixtures/kotlin-gradle');
 const rules=JSON.parse(fs.readFileSync(path.join(root,'references/kotlin-junk.yaml'))),data=JSON.parse(fs.readFileSync(path.join(base,'labeled-mutants.json'))),corpus=data.mutants;
 const classify=x=>m.junkRule(x,rules,fs.readFileSync(path.join(base,'src/main/kotlin/acme',x.file),'utf8'));
 const flagged=corpus.filter(classify),real=corpus.filter(x=>x.label==='real');
 assert.ok(corpus.length>=100);assert.ok(flagged.length>=30);assert.ok(real.length>=25);
 for(const pattern of ['data-class','default-argument','when-mapping','coroutine','inline','lateinit','source-logic'])assert.ok(corpus.some(x=>x.pattern===pattern),pattern);
 assert.ok(flagged.filter(x=>x.label==='junk').length/flagged.length>=.95);
 assert.ok(real.filter(classify).length/real.length<=.02);
 const raw=m.parsePitXML(fs.readFileSync(path.join(root,'test/corpus/kotlin-unfiltered.xml'),'utf8'));
 assert.deepEqual(corpus.map(({label,pattern,rationale,...x})=>x),raw);
 for(const method of ['equals','hashCode','toString'])assert.ok(real.some(x=>x.class==='acme.OverrideProfile'&&x.method===method&&!classify(x)));

});
test('shipped version metadata matches CI pins',()=>{const versions=JSON.parse(fs.readFileSync(path.join(root,'references/versions.json')));for(const name of ['gomutants','gremlins'])assert.equal(m.TOOLS[name].split('@v')[1],versions[name]);assert.equal(m.TOOLS['dotnet-stryker'],versions['dotnet-stryker']);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'references/versions.json'))),JSON.parse(fs.readFileSync(path.join(root,'test/harness-versions.json'))));});
test('package.json version is the engine VERSION',()=>{assert.equal(JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version,m.VERSION);});
