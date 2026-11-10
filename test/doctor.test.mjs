import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import * as m from '../scripts/mutagate.mjs';
const root=path.resolve(import.meta.dirname,'..'),doctor=createRequire(import.meta.url)('../scripts/doctor.cjs');
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(CLAUDE_|CODEX_|MUTAGATE_|COPILOT_)/.test(k)));
const cli=(entry,args,opts={})=>spawnSync(process.execPath,[path.join(root,'scripts',entry),...args],{encoding:'utf8',env,...opts});
const tmp=t=>{const d=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'mutagate-doctor-unit-')));t.after(()=>fs.rmSync(d,{recursive:true,force:true}));return d;};
for(const entry of ['mutagate.mjs','mutagate-hook.cjs'])for(const args of [['--version'],['version']])test(`${entry} ${args[0]} prints the version`,()=>{
 const r=cli(entry,args);assert.equal(r.status,0,r.stderr);assert.equal(r.stdout,`mutagate ${m.VERSION}\n`);});
test('install --agent auto without a harness names the real script path on stderr',t=>{
 const repo=tmp(t),r=cli('mutagate.mjs',['install','--agent','auto','--repo',repo]),script=path.join(root,'scripts','mutagate');
 assert.equal(r.status,2);assert.equal(r.stdout,'');
 assert.equal(r.stderr,[`no harness detected in ${repo}; run one of:`,...['claude','codex','opencode','pi','copilot'].map(a=>`${script} install --agent ${a} --repo ${repo}`)].join('\n')+'\n');});
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
 const pins=JSON.parse(fs.readFileSync(path.join(root,'references/versions.json'),'utf8'));assert.equal(pins.packages['@github/copilot'],'1.0.107','Copilot CLI pin (#35)');
 const outputs={claude:`${pins.packages['@anthropic-ai/claude-code']} (Claude Code)\n`,codex:'codex-cli 0.155.2\n',opencode:null,pi:'garbage',copilot:'GitHub Copilot CLI 1.0.108.\n'},asked=[];
 const checks=await doctor.harnessChecks(pins,async bin=>{asked.push(bin);return outputs[bin];});
 assert.deepEqual(asked.sort(),['claude','codex','copilot','opencode','pi']);
 assert.deepEqual(checks,[{name:'codex version',pass:true,warn:true,note:`0.155.2 differs from tested ${pins.packages['@openai/codex']}; see README harness matrix`},{name:'copilot version',pass:true,warn:true,note:'1.0.108 differs from tested 1.0.107; see README harness matrix'}]);
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
 for(const a of ['claude','codex','opencode','pi','copilot'])assert.equal(run(['install','--agent',a]).status,0);
 const edit=(f,a,b)=>{const s=fs.readFileSync(f,'utf8');assert.ok(s.includes(a),f);fs.writeFileSync(f,s.replace(a,b));},v=m.VERSION;
 const warns=(cwd=repo)=>checks(cwd).filter(x=>x.warn&&x.name.endsWith(' install')).map(x=>`${x.name}: ${x.note}`),fix=(from,a)=>`Hooks are from ${from}, skill is ${v}: rerun mutagate install --agent ${a}`;
 assert.deepEqual(warns(),[]);
 edit(path.join(repo,'.claude/settings.json'),` SessionStart --installed ${v}:project`,' SessionStart --installed 0.8.0:project');edit(path.join(home,'.claude/settings.json'),` --installed ${v}:user`,'');
 edit(path.join(repo,'.codex/hooks.json'),` --installed ${v}:project`,'');edit(path.join(repo,'.pi/extensions/mutagate.ts'),`installed: ${JSON.stringify(v+':project')}, `,'');edit(path.join(home,'.config/opencode/plugins/mutagate.js'),JSON.stringify(v+':user'),'"0.8.0:user"');edit(path.join(repo,'.github/hooks/mutagate.json'),` SessionStart --installed ${v}:project`,' SessionStart --installed 0.8.0:project');
 assert.deepEqual(warns(),[`claude project install: ${fix('mutagate 0.8.0','claude')}`,`claude user install: ${fix('an older mutagate','claude')} --scope user`,`codex project install: ${fix('an older mutagate','codex')}`,
  `opencode user install: ${fix('mutagate 0.8.0','opencode')} --scope user`,`pi project install: ${fix('an older mutagate','pi')}`,`copilot project install: ${fix('mutagate 0.8.0','copilot')}`]);
 {const r=tmp(t);fs.mkdirSync(path.join(r,'.pi'));assert.deepEqual(warns(r).map(x=>x.split(':')[0]),['claude user install','opencode user install'],'stale user installs of undetected harnesses');}
 for(const s of [`${v}:project`,`${v}:user`])assert.doesNotMatch(run(['hook','SessionStart','--installed',s]).stdout,/rerun/);assert.doesNotMatch(run(['hook','SessionStart'],{harness:'pi',installed:`${v}:user`}).stdout,/rerun/);
 const start=stamp=>run(['hook','SessionStart','--installed',stamp]).stdout,hint=' (add --scope user for a user install).';
 assert.ok(start('0.8.0:project').includes(`${fix('mutagate 0.8.0','<harness>')}.`));assert.ok(start('0.8.0:user').includes(`${fix('mutagate 0.8.0','<harness>')} --scope user.`));assert.ok(start('0.8.0').includes(fix('mutagate 0.8.0','<harness>')+hint),'no scope: hint');
 assert.ok(JSON.parse(run(['hook','SessionStart'],{harness:'pi'}).stdout).systemMessage.endsWith(fix('an older mutagate','pi')+hint));
 assert.ok(JSON.parse(run(['hook','SessionStart'],{harness:'pi',installed:'0.8.0:user'}).stdout).systemMessage.endsWith(`${fix('mutagate 0.8.0','pi')} --scope user.`));
 assert.ok(JSON.parse(run(['hook','SessionStart','--installed','0.8.0:user','--harness','copilot'],{sessionId:'s',timestamp:1}).stdout).additionalContext.includes(`${fix('mutagate 0.8.0','copilot')} --scope user.`),'Copilot: top-level additionalContext');});
test('doctor checks the Copilot hook files, a Claude project install that stays inert under Copilot, the cache root and the skill copy that Copilot loads (#35 D5, D23, D25, D26, AC 37)',{skip:process.platform==='win32'},t=>{
 const repo=tmp(t),home=tmp(t),data=tmp(t),ro=tmp(t),run=(args,cache=data)=>cli('mutagate.mjs',[...args,'--repo',repo],{env:{...env,HOME:home,PATH:path.dirname(process.execPath),CLAUDE_PLUGIN_DATA:cache}});
 const checks=cache=>JSON.parse(run(['doctor','--json'],cache).stdout).checks.filter(x=>/^(copilot (hook files|skill copy|setup)|cache root writable)$/.test(x.name)).map(x=>[x.name,x.warn?'WARN':x.pass?'PASS':'FAIL',x.note??x.hint]);
 const proj=path.join(repo,'.github/hooks/mutagate.json'),user=path.join(home,'.copilot/hooks/mutagate.json'),old=path.join(repo,'.github/hooks/old.json'),put=(f,s)=>{fs.mkdirSync(path.dirname(path.join(repo,f)),{recursive:true});fs.writeFileSync(path.join(repo,f),s);};
 const ok=['cache root writable','PASS',undefined],setup=['copilot setup','PASS','Copilot loads repo hooks only in a trusted folder (copilot -p: --trust-folder), not under a managed-hooks-only policy.'];
 assert.deepEqual(checks(),[],'no Copilot install or signal: no Copilot checks');assert.equal(run(['install','--agent','claude']).status,0);assert.deepEqual(checks(),[]);
 fs.mkdirSync(path.join(repo,'.github/hooks'),{recursive:true});
 assert.deepEqual(checks(),[['copilot hook files','WARN','none; mutagate keeps its hooks in .claude/settings.json inert under Copilot: run mutagate install --agent copilot'],ok,setup],'a Copilot signal and a Claude project install');
 assert.equal(run(['install','--agent','copilot']).status,0);assert.deepEqual(checks(),[['copilot hook files','PASS',proj],ok,setup]);
 fs.mkdirSync(path.dirname(user),{recursive:true});fs.copyFileSync(proj,user);fs.copyFileSync(proj,old);put('.github/hooks/other.json',JSON.stringify({version:1,hooks:{agentStop:[{type:'command',bash:'echo other'}]}}));
 assert.deepEqual(checks()[0],['copilot hook files','WARN',`Copilot runs each of ${proj}, ${old}, ${user}: keep one (mutagate uninstall --agent copilot [--scope user] removes a scope)`]);fs.rmSync(user);fs.rmSync(old);
 put('.agents/skills/mutagate/scripts/mutagate.mjs',"export const VERSION = '0.8.0';\n");
 assert.deepEqual(checks(),[['copilot hook files','PASS',proj],['copilot skill copy','WARN',`Copilot loads ${path.join(repo,'.agents/skills/mutagate')} (mutagate 0.8.0), its hooks run ${root} (mutagate ${m.VERSION}): keep one copy`],ok,setup]);
 put('.github/skills/mutagate/scripts/mutagate.mjs',`export const VERSION = '${m.VERSION}';\n`);assert.deepEqual(checks().map(x=>x[0]),['copilot hook files','cache root writable','copilot setup'],'.github/skills comes first');
 fs.chmodSync(ro,0o555);try{assert.deepEqual(checks(ro)[1],['cache root writable','FAIL',`mutagate inactive: cannot write ${path.join(ro,'repos',m.hash(repo),'state')}`]);}finally{fs.chmodSync(ro,0o755);}});
test('doctor reads the skill dir that each Copilot hook command form of install runs: portable, absolute, Windows (#35 D26)',t=>{
 const dir=tmp(t),file=path.join(dir,'mutagate.json'),platform=process.platform,skill=c=>{fs.writeFileSync(file,JSON.stringify(m.hookConfig('copilot',c)));return doctor.hookSkill(file,dir);};
 if(platform!=='win32'){assert.equal(skill({repo:root}),dir,'portable: under the Git top of the call');assert.match(fs.readFileSync(file,'utf8'),/show-toplevel/);}
 assert.equal(skill(undefined),root,'absolute');
 t.after(()=>Object.defineProperty(process,'platform',{value:platform}));Object.defineProperty(process,'platform',{value:'win32'});
 try{assert.equal(skill(undefined),root,'Windows');}finally{Object.defineProperty(process,'platform',{value:platform});}});
test('doctor counts a user install when the repo .claude/ holds only skills/: Copilot, and Claude beside a Copilot signal (#35 D25)',t=>{
 for(const [agent,signal] of [['copilot'],['claude','.github/hooks/other.json']]){const repo=tmp(t),home=tmp(t),run=args=>cli('mutagate.mjs',[...args,'--repo',repo],{env:{...env,HOME:home,PATH:path.dirname(process.execPath),CLAUDE_PLUGIN_DATA:path.join(repo,'.data')}});
  const adapter=()=>JSON.parse(run(['doctor','--json']).stdout).checks.find(x=>x.name==='adapter installed').pass;
  fs.mkdirSync(path.join(repo,'.claude/skills/x'),{recursive:true});if(signal){fs.mkdirSync(path.dirname(path.join(repo,signal)),{recursive:true});fs.writeFileSync(path.join(repo,signal),JSON.stringify({version:1,hooks:{}}));}assert.equal(adapter(),false,agent);
  assert.equal(run(['install','--agent',agent,'--scope','user']).status,0);assert.equal(adapter(),true,agent);}});
