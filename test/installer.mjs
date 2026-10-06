import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {command} from '../scripts/mutagate.mjs';
import {packageSkill} from './package.mjs';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mutagate-installer-')),stage=path.join(dir,'package'),project=path.join(dir,'project'),linked=path.join(dir,'linked project'),moved=path.join(dir,'moved here','linked project 2');
const env={...process.env,DISABLE_TELEMETRY:'1',DO_NOT_TRACK:'1'},hookEnv={...env,CLAUDE_PLUGIN_DATA:path.join(dir,'cache'),XDG_CACHE_HOME:path.join(dir,'xdg'),GIT_CEILING_DIRECTORIES:path.dirname(dir)};
for(const k of ['MUTAGATE_NODE','MUTAGATE_HARNESS','MUTAGATE_HOOK_SESSION','MUTAGATE_SESSION','CLAUDE_PROJECT_DIR','CLAUDE_CODE_SESSION_ID','CODEX_HOME','CODEX_THREAD_ID'])delete hookEnv[k]; // hooks must find Node through .node-path
const add=(cwd,...flags)=>command('npx',['--yes','skills@1.5.26','add',stage,'--skill','mutagate','--agent','claude-code','codex','opencode','pi','--yes',...flags],{cwd,timeout:120000,env});
const cli=(repo,...args)=>{const r=spawnSync(process.execPath,[path.join(repo,'.claude/skills/mutagate/scripts/mutagate.mjs'),...args,'--repo',repo],{cwd:repo,env:hookEnv,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout;};
const configs=repo=>['.claude/settings.json','.codex/hooks.json'].filter(f=>fs.existsSync(path.join(repo,f))).map(f=>fs.readFileSync(path.join(repo,f),'utf8'));
const commands=repo=>[...new Map(configs(repo).flatMap(t=>Object.entries(JSON.parse(t).hooks).flatMap(([event,groups])=>groups.flatMap(g=>g.hooks.map(h=>[h.command,event]))))).entries()];
// Run each distinct hook command as the harnesses do: sh -c in the session cwd, event payload on stdin.
const adapters=repo=>{for(const f of ['.opencode/plugins/mutagate.js','.pi/extensions/mutagate.ts']){const p=path.join(repo,f),rel=JSON.parse(fs.readFileSync(p,'utf8').match(/import\.meta\.url\)\), ("[^"]+")\)/)[1]);assert.ok(!path.isAbsolute(rel)&&fs.existsSync(path.resolve(path.dirname(p),rel)),`${f}: ${rel}`);}};
function fire(repo,cwd,only){let n=0;for(const [cmd,event] of commands(repo).filter(([,e])=>!only||only.includes(e))){n++;
 const r=spawnSync('sh',['-c',cmd],{cwd,env:hookEnv,encoding:'utf8',timeout:60000,input:JSON.stringify({cwd,session_id:'installer',hook_event_name:event,tool_name:'Write',tool_input:{file_path:path.join(cwd,'notes.md'),content:''},tool_use_id:'installer',stop_hook_active:false})});
 assert.equal(r.status,0,`${cmd} in ${cwd}: ${r.stderr}`);assert.equal(r.stderr,'',`${cmd} in ${cwd}`);if(event==='SessionStart')assert.match(r.stdout,/^mutagate \S+ active\./m,cmd);}return n;}
// MUTAGATE_INSTALL_SOURCE (a git ref such as keyboardsamurai/mutagate#skill-v0.9.0, or a local path): install it as users do and compare every skill dir with the current packageSkill tree.
const source=process.env.MUTAGATE_INSTALL_SOURCE,files=d=>fs.readdirSync(d,{recursive:true}).map(String).filter(f=>fs.statSync(path.join(d,f)).isFile()).sort();
if(source)try{
 const bytes=packageSkill(stage);fs.mkdirSync(project);fs.writeFileSync(path.join(project,'package.json'),'{"name":"install-test","private":true}');
 await command('npx',['--yes','skills@1.5.26','add',source,'--skill','mutagate','-a','claude-code','codex','opencode','pi','--copy','-y'],{cwd:project,timeout:180000,env});
 const dirs=files(project).filter(f=>f.endsWith(path.join('skills','mutagate','SKILL.md'))&&!f.includes('node_modules')).map(path.dirname),want=files(stage);
 assert.deepEqual(dirs,['.agents/skills/mutagate','.claude/skills/mutagate','.pi/skills/mutagate'].map(d=>d.split('/').join(path.sep)));
 for(const d of dirs){const at=path.join(project,d);assert.ok(!fs.lstatSync(at).isSymbolicLink(),d);assert.deepEqual(files(at),want,d);for(const f of want)assert.ok(fs.readFileSync(path.join(at,f)).equals(fs.readFileSync(path.join(stage,f))),`${d}/${f} differs`);
  const size=want.reduce((n,f)=>n+fs.statSync(path.join(at,f)).size,0);assert.ok(size<300000,`${d}: ${size} bytes`);}
 console.log(JSON.stringify({passed:true,source,dirs,bytes}));
}finally{fs.rmSync(dir,{recursive:true,force:true});}
else try {
 const bytes=packageSkill(stage);for(const p of [project,linked]){fs.mkdirSync(p);fs.writeFileSync(path.join(p,'package.json'),'{"name":"install-test","private":true}');}
 assert.equal(spawnSync('git',['init','-q'],{cwd:linked}).status,0);
 await add(project,'--copy');await add(linked);
 for(const location of ['.claude/skills/mutagate','.agents/skills/mutagate','.pi/skills/mutagate'])for(const repo of [project,linked]){const installed=path.join(repo,location);assert.ok(fs.existsSync(path.join(installed,'SKILL.md')));assert.ok(!fs.existsSync(path.join(installed,'test')));assert.equal(fs.readFileSync(path.join(installed,'scripts/mutagate.mjs'),'utf8'),fs.readFileSync(path.join(stage,'scripts/mutagate.mjs'),'utf8'));assert.ok(fs.existsSync(path.join(installed,'scripts/.gitignore')));assert.ok(!fs.existsSync(path.join(installed,'scripts/.node-path')));}
 assert.ok(fs.lstatSync(path.join(linked,'.claude/skills/mutagate')).isSymbolicLink()&&!fs.lstatSync(path.join(project,'.claude/skills/mutagate')).isSymbolicLink());
 // Symlink mode in a Git repo: repo-relative commands that run from the root, a subdirectory and a moved clone.
 for(const agent of ['claude','codex','opencode','pi'])assert.doesNotMatch(cli(linked,'install','--agent',agent),/machine-local/);
 for(const text of configs(linked))for(const s of [dir,fs.realpathSync(dir),process.execPath])assert.ok(!text.includes(s),s);
 for(const [cmd] of commands(linked))assert.ok(cmd.startsWith('f="$(git rev-parse --show-toplevel)/.agents/skills/mutagate/scripts/hook" && [ -f "$f" ] && sh "$f" '),cmd);
 adapters(linked);fs.mkdirSync(path.join(linked,'src','deep dir'),{recursive:true});let fired=0;
 for(const repo of [linked,moved]){if(repo===moved){fs.mkdirSync(path.dirname(moved));fs.renameSync(linked,moved);}for(const cwd of [repo,path.join(repo,'src','deep dir')])fired+=fire(repo,cwd);}
 adapters(moved);
 // Not a Git repo: absolute commands and the machine-local warning.
 assert.match(cli(project,'install','--agent','claude'),/machine-local/);
 for(const [cmd] of commands(project))assert.ok(cmd.startsWith(`'${process.execPath}' '${fs.realpathSync(path.join(project,'.claude/skills/mutagate/scripts'))}/mutagate-hook.cjs' hook `),cmd);
 fired+=fire(project,project,['SessionStart','Stop']);
 console.log(JSON.stringify({passed:true,agents:['claude-code','codex','opencode','pi'],bytes,hook_runs:fired}));
}finally{fs.rmSync(dir,{recursive:true,force:true});}
