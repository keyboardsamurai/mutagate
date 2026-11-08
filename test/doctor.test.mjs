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
test('SessionStart and doctor name the install command to rerun when an install stamp is missing or differs',t=>{
 const repo=tmp(t),home=tmp(t),run=(args,p={},cwd=repo)=>cli('mutagate.mjs',[...args,'--repo',cwd],{env:{...env,HOME:home,XDG_CONFIG_HOME:path.join(home,'.config'),PATH:path.dirname(process.execPath),CLAUDE_PLUGIN_DATA:path.join(repo,'.data')},input:JSON.stringify({cwd,session_id:'s',...p})});
 const checks=cwd=>JSON.parse(run(['doctor','--json'],{},cwd).stdout).checks,adapter=cwd=>checks(cwd).find(x=>x.name==='adapter installed').pass,other=tmp(t);
 assert.equal(adapter(other),false);for(const a of ['claude','opencode'])assert.equal(run(['install','--agent',a,'--scope','user']).status,0);assert.equal(adapter(other),true,'a user install counts');
 for(const [d,pass] of [['.claude',true],['.pi',false]]){const r=tmp(t);fs.mkdirSync(path.join(r,d));assert.equal(adapter(r),pass,`only a detected harness counts when one is detected: ${d}`);}
 for(const a of ['claude','codex','opencode','pi'])assert.equal(run(['install','--agent',a]).status,0);
 const edit=(f,a,b)=>{const s=fs.readFileSync(f,'utf8');assert.ok(s.includes(a),f);fs.writeFileSync(f,s.replace(a,b));},v=m.VERSION;
 const warns=(cwd=repo)=>checks(cwd).filter(x=>x.warn&&x.name.endsWith(' install')).map(x=>`${x.name}: ${x.note}`),fix=(from,a)=>`Hooks are from ${from}, skill is ${v}: rerun mutagate install --agent ${a}`;
 assert.deepEqual(warns(),[]);
 edit(path.join(repo,'.claude/settings.json'),` SessionStart --installed ${v}:project`,' SessionStart --installed 0.8.0:project');edit(path.join(home,'.claude/settings.json'),` --installed ${v}:user`,'');
 edit(path.join(repo,'.codex/hooks.json'),` --installed ${v}:project`,'');edit(path.join(repo,'.pi/extensions/mutagate.ts'),`installed: ${JSON.stringify(v+':project')}, `,'');edit(path.join(home,'.config/opencode/plugins/mutagate.js'),JSON.stringify(v+':user'),'"0.8.0:user"');
 assert.deepEqual(warns(),[`claude project install: ${fix('mutagate 0.8.0','claude')}`,`claude user install: ${fix('an older mutagate','claude')} --scope user`,`codex project install: ${fix('an older mutagate','codex')}`,
  `opencode user install: ${fix('mutagate 0.8.0','opencode')} --scope user`,`pi project install: ${fix('an older mutagate','pi')}`]);
 {const r=tmp(t);fs.mkdirSync(path.join(r,'.pi'));assert.deepEqual(warns(r).map(x=>x.split(':')[0]),['claude user install','opencode user install'],'stale user installs of undetected harnesses');}
 for(const s of [`${v}:project`,`${v}:user`])assert.doesNotMatch(run(['hook','SessionStart','--installed',s]).stdout,/rerun/);assert.doesNotMatch(run(['hook','SessionStart'],{harness:'pi',installed:`${v}:user`}).stdout,/rerun/);
 const start=stamp=>run(['hook','SessionStart','--installed',stamp]).stdout,hint=' (add --scope user for a user install).';
 assert.ok(start('0.8.0:project').includes(`${fix('mutagate 0.8.0','<harness>')}.`));assert.ok(start('0.8.0:user').includes(`${fix('mutagate 0.8.0','<harness>')} --scope user.`));assert.ok(start('0.8.0').includes(fix('mutagate 0.8.0','<harness>')+hint),'no scope: hint');
 assert.ok(JSON.parse(run(['hook','SessionStart'],{harness:'pi'}).stdout).systemMessage.endsWith(fix('an older mutagate','pi')+hint));
 assert.ok(JSON.parse(run(['hook','SessionStart'],{harness:'pi',installed:'0.8.0:user'}).stdout).systemMessage.endsWith(`${fix('mutagate 0.8.0','pi')} --scope user.`));});
