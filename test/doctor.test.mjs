import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import * as m from '../scripts/mutagate.mjs';
const root=path.resolve(import.meta.dirname,'..'),doctor=createRequire(import.meta.url)('../scripts/doctor.cjs');
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(CLAUDE_|CODEX_|MUTAGATE_)/.test(k)));
const cli=(entry,args,opts={})=>spawnSync(process.execPath,[path.join(root,'scripts',entry),...args],{encoding:'utf8',env,...opts});
const tmp=t=>{const d=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'mutagate-doctor-unit-')));t.after(()=>fs.rmSync(d,{recursive:true,force:true}));return d;};
for(const entry of ['mutagate.mjs','mutagate-hook.cjs'])for(const args of [['--version'],['version']])test(`${entry} ${args[0]} prints the version`,()=>{
 const r=cli(entry,args);assert.equal(r.status,0,r.stderr);assert.equal(r.stdout,`mutagate ${m.VERSION}\n`);});
test('install --agent auto without a harness names the real script path on stderr',t=>{
 const repo=tmp(t),r=cli('mutagate.mjs',['install','--agent','auto','--repo',repo]),script=path.join(root,'scripts','mutagate');
 assert.equal(r.status,2);assert.equal(r.stdout,'');
 assert.equal(r.stderr,[`no harness detected in ${repo}; run one of:`,...['claude','codex','opencode','pi'].map(a=>`${script} install --agent ${a} --repo ${repo}`)].join('\n')+'\n');});
test('install ends with the next steps',t=>{
 const repo=tmp(t),script=path.join(root,'scripts','mutagate');
 let r=cli('mutagate.mjs',['install','--agent','claude','--repo',repo]);assert.equal(r.status,0,r.stderr);
 assert.equal(r.stdout.trim().split('\n').at(-1),`Next: run ${script} doctor --repo ${repo}, then restart your agent so it loads the hooks.`);
 r=cli('mutagate.mjs',['install','--agent','codex','--repo',repo]);assert.equal(r.status,0,r.stderr);
 assert.match(r.stdout.trim().split('\n').at(-1),/^Next: run .* doctor --repo .*, then restart your agent so it loads the hooks\. In Codex, open \/hooks and trust mutagate\.$/);
 r=cli('mutagate.mjs',['uninstall','--agent','claude','--repo',repo]);assert.equal(r.status,0,r.stderr);assert.doesNotMatch(r.stdout,/Next:/);});
test('doctor text: version first, versions JSON hidden, restart hint on full pass',()=>{
 const pass={version:'0.9.0',checks:[{name:'Node 22+',pass:true},{name:'claude version',pass:true,warn:true,note:'2.1.300 differs from tested 2.1.289'}],versions:{schema:1}};
 assert.equal(doctor.render(pass),'mutagate 0.9.0\nPASS Node 22+\nWARN claude version: 2.1.300 differs from tested 2.1.289\nAll checks passed. Restart your agent so it loads the hooks.');
 const fail={...pass,checks:[{name:'runner detected',pass:false,hint:'Run doctor inside a supported project.'},{name:'.NET run budget',pass:true,note:'set runBudgetSec'}]};
 assert.equal(doctor.render(fail),'mutagate 0.9.0\nFAIL runner detected: Run doctor inside a supported project.\nPASS .NET run budget: set runBudgetSec');
 assert.doesNotMatch(doctor.render(pass),/Tested versions|schema/);});
test('doctor warns, never fails, when an installed harness differs from its pin',async()=>{
 const pins={packages:{'@anthropic-ai/claude-code':'2.1.289','@openai/codex':'0.154.0','opencode-ai':'1.18.30','@mariozechner/pi-coding-agent':'0.73.1'}};
 const outputs={claude:'2.1.289 (Claude Code)\n',codex:'codex-cli 0.155.2\n',opencode:null,pi:'garbage'},asked=[];
 const checks=await doctor.harnessChecks(pins,async bin=>{asked.push(bin);return outputs[bin];});
 assert.deepEqual(asked.sort(),['claude','codex','opencode','pi']);
 assert.deepEqual(checks,[{name:'codex version',pass:true,warn:true,note:'0.155.2 differs from tested 0.154.0; see README harness matrix'}]);
 assert.deepEqual(await doctor.harnessChecks({},async()=>'1.0.0'),[]);
 const slow=Date.now();assert.equal(await doctor.version(process.execPath,['-e','setTimeout(()=>{},10000)'],200),null);assert.ok(Date.now()-slow<3000);
 assert.equal(await doctor.version('mutagate-no-such-binary'),null);
 assert.match(await doctor.version(process.execPath),/^v\d+/);});
test('doctor --json keeps its shape plus version; progress goes to stderr',t=>{
 const repo=tmp(t),r=cli('mutagate.mjs',['doctor','--json','--repo',repo],{env:{...env,PATH:path.dirname(process.execPath),CLAUDE_PLUGIN_DATA:path.join(repo,'.data')}});
 const d=JSON.parse(r.stdout);assert.equal(r.status,3);assert.deepEqual(Object.keys(d).sort(),['checks','versions','version'].sort());assert.equal(d.version,m.VERSION);assert.equal(d.versions.schema,1);
 assert.match(r.stderr,/^checking runner detected…$/m);
 const text=cli('mutagate.mjs',['doctor','--repo',repo],{env:{...env,PATH:path.dirname(process.execPath),CLAUDE_PLUGIN_DATA:path.join(repo,'.data')}});
 assert.equal(text.stdout.split('\n')[0],`mutagate ${m.VERSION}`);assert.doesNotMatch(text.stdout,/Tested versions/);assert.match(text.stdout,/^FAIL runner detected/m);});
