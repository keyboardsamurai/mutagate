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
 const invoke=(event,p,input)=>spawnSync(process.execPath,[path.join(root,'scripts',executable),'hook',event,...(event==='SessionStart'?['--installed',m.VERSION]:[])],{input:input??JSON.stringify({cwd:repo,session_id:'sess_fixture',harness,...p}),env:{...process.env,CLAUDE_PLUGIN_DATA:cache,MUTAGATE_HARNESS:harness,MUTAGATE_TRACE:'1'},encoding:'utf8'});
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
for(const executable of ['mutagate.mjs','mutagate-hook.cjs'])test(executable+' Copilot CLI payloads of the Claude project hooks are inert; one notice without a native Copilot file',t=>{
 const repo=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'mutagate-copilot-')));t.after(()=>fs.rmSync(repo,{recursive:true,force:true}));
 const cache=path.join(repo,'.cache'),home=path.join(repo,'.home'),data=path.join(cache,'repos',m.hash(repo)),corpus=path.join(root,'test/payloads/copilot/cli'),put=(f,s='')=>{fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,s);};
 put(path.join(repo,'src/calc.js'),'export const add = (a, b) => a + b;\n');put(path.join(repo,'test/calc.test.js'),"import test from 'node:test';\n");
 const base=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(CLAUDE|COPILOT|CODEX|MUTAGATE)_/.test(k)));
 const invoke=(file,extra=[],env={},edit=p=>p)=>{const p=edit(JSON.parse(fs.readFileSync(path.join(corpus,file),'utf8'),(k,v)=>typeof v==='string'?v.replaceAll('/repo',repo):v));return spawnSync(process.execPath,[path.join(root,'scripts',executable),'hook',p.hook_event_name,...extra],{input:JSON.stringify(p),env:{...base,HOME:home,USERPROFILE:home,CLAUDE_PLUGIN_DATA:cache,MUTAGATE_TRACE:'1',MUTAGATE_RECORD:'1',...env},encoding:'utf8'});};
 const notice=JSON.stringify({additionalContext:'mutagate inactive under Copilot: this repo has only the Claude Code install. Copilot support: `install --agent copilot`, mutagate 0.9.2 (#35).'})+'\n';let calls=0;
 for(const env of [{},{CLAUDE_PROJECT_DIR:repo,CLAUDE_PLUGIN_ROOT:root}])for(const file of fs.readdirSync(corpus).filter(f=>f.endsWith('.json')&&f!=='schema-keys.json').sort())for(const extra of file.startsWith('PostToolUse')?[[],['--mutate']]:file.startsWith('SessionStart')?[['--installed',m.VERSION]]:[[]]){
  const r=invoke(file,extra,env);calls++;assert.equal(r.status,0,file);assert.equal(r.stdout,file.startsWith('SessionStart')?notice:'',file);assert.deepEqual(fs.readdirSync(data),['trace.jsonl'],file+': no state, lock, result or worker');
 }
 const rows=fs.readFileSync(path.join(data,'trace.jsonl'),'utf8').trim().split('\n').map(JSON.parse);assert.equal(rows.length,calls);assert.ok(rows.every(r=>r.decision==='inherited'&&r.harness==='copilot'),'CLAUDE_* env never makes them claude');
 for(const [dir,env] of [[path.join(repo,'.github'),{}],[path.join(home,'.copilot'),{}],[path.join(repo,'.copilot-home'),{COPILOT_HOME:path.join(repo,'.copilot-home')}]]){put(path.join(dir,'hooks/mutagate.json'),'{}');const r=invoke('SessionStart-new.json',[],env);assert.equal(r.status,0);assert.equal(r.stdout,'',dir);fs.rmSync(dir,{recursive:true});}
 assert.deepEqual(fs.readdirSync(path.join(cache,'repos')),[m.hash(repo)]);assert.deepEqual(fs.readdirSync(data),['trace.jsonl']);assert.ok(!fs.existsSync(path.join(cache,'recorded')),'MUTAGATE_RECORD=1 records no inherited payload');
 // A target with pending results (gateBudgetSec 0) blocks a Claude Stop; inherited Stop and SubagentStop leave its state, `blocks` included, unchanged.
 put(path.join(repo,'.mutagate/config.json'),'{"gateBudgetSec":0}');const key=m.hash('src/calc.js'),seed=JSON.stringify({schema:1,targets:{[key]:{target:'src/calc.js',file:'src/calc.js',tests:['test/calc.test.js'],testNames:[],blocks:0}},choices:{},warnings:[],events:[],notified:[]});
 const seeded=['Stop-main.json','Stop-subagent.json','SubagentStop-subagent.json'].map(file=>{const p=JSON.parse(fs.readFileSync(path.join(corpus,file),'utf8'));const f=path.join(data,'state',m.hash(p.agent_id||p.session_id)+'.json');put(f,seed);return [file,f];});
 for(const [file,f] of seeded)for(const env of [{},{CLAUDE_PROJECT_DIR:repo}]){const r=invoke(file,[],env);assert.equal(r.status,0,file);assert.equal(r.stdout,'',file);assert.equal(fs.readFileSync(f,'utf8'),seed,file+': state and blocks unchanged');}
 const claude=invoke('Stop-main.json',[],{CLAUDE_PROJECT_DIR:repo},({timestamp,...p})=>p);assert.equal(claude.status,2,'the seeded target blocks a Claude Stop');assert.equal(JSON.parse(fs.readFileSync(seeded[0][1],'utf8')).targets[key].blocks,1);
});
test('VS Code Claude session target payloads stay claude, not inherited',t=>{const repo=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'mutagate-vscode-claude-'))),old=process.env.CLAUDE_PROJECT_DIR,dir=path.join(root,'test/payloads/copilot/vscode-claude');t.after(()=>{fs.rmSync(repo,{recursive:true,force:true});if(old===undefined)delete process.env.CLAUDE_PROJECT_DIR;else process.env.CLAUDE_PROJECT_DIR=old;});process.env.CLAUDE_PROJECT_DIR=repo;const files=fs.readdirSync(dir).filter(f=>f.endsWith('.json'));assert.equal(files.length,6);for(const f of files){const c=m.context({repo},JSON.parse(fs.readFileSync(path.join(dir,f),'utf8')));assert.deepEqual([c.inherited,c.harness],[false,'claude'],f);}});
test('every result-affecting helper is hashed into fingerprint',()=>{
 const list=JSON.parse(fs.readFileSync(path.join(root,'scripts/mutagate.mjs'),'utf8').match(/const implementation = (\[[^\]]*\])/)[1].replaceAll("'",'"'));
 for(const f of fs.readdirSync(path.join(root,'scripts')).filter(f=>f.endsWith('.cjs')&&!['install.cjs','doctor.cjs','prune.cjs','mutagate-hook.cjs'].includes(f)))assert.ok(list.includes(f),f);
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
test('shipped version metadata matches CI pins',()=>{const versions=JSON.parse(fs.readFileSync(path.join(root,'references/versions.json')));for(const name of ['gomutants','gremlins'])assert.equal(m.runners().TOOLS[name].split('@v')[1],versions[name]);assert.equal(m.runners().TOOLS['dotnet-stryker'],versions['dotnet-stryker']);const jars=JSON.parse(fs.readFileSync(path.join(root,'references/jars.json')));for(const name of ['pitest','pitest-command-line','pitest-entry'])assert.equal(jars.find(x=>x.artifact===name).version,versions.pitest,name);for(const name of ['pitest-junit5-plugin','pitest-history-plugin'])assert.equal(jars.find(x=>x.artifact===name).version,versions[name],name);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'references/versions.json'))),JSON.parse(fs.readFileSync(path.join(root,'test/harness-versions.json'))));});
test('package.json version is the engine VERSION',()=>{assert.equal(JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version,m.VERSION);});
