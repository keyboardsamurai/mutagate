// Scratch repos for test tooling: the live eval copy filter, the weak/strong variant swap, a temp cache root (jars/ and tools/ shared), a scrubbed session env and one CLI call.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {cacheRoot} from '../scripts/mutagate.mjs';
export const root=path.resolve(import.meta.dirname,'..');
export const BUILD=new Set(['node_modules','.venv','target','build','.gradle','bin','obj','StrykerOutput','TestResults','dist','__pycache__','.pytest_cache','mutants','.mutmut-cache']);
// The copy a live eval run makes: no answer key at the top (expected.json, reference/, prompt.*.md) and no build output at any depth.
export const copyRepo=(src,repo)=>fs.cpSync(src,repo,{recursive:true,filter:p=>{const rel=path.relative(src,p);return !['expected.json','reference'].includes(rel)&&!/^prompt\.[a-z0-9-]+\.md$/.test(rel)&&!rel.split(path.sep).some(s=>BUILD.has(s));}});
// process.env minus inherited harness, mutagate and token vars. context() takes CODEX_THREAD_ID and CLAUDE_CODE_SESSION_ID before MUTAGATE_SESSION, and CLAUDE_PLUGIN_DATA moves the cache root; callers set back what they need.
export const scrubEnv=(env=process.env)=>Object.fromEntries(Object.entries(env).filter(([k])=>!/^(CLAUDE|CODEX_|OPENCODE|PI_|MUTAGATE_|COPILOT_)|^(GH_TOKEN|GITHUB_TOKEN|GITHUB_COPILOT_API_TOKEN|OPENROUTER_API_KEY)$/.test(k)));
// A recorded hook payload (test/payloads/) with its /repo placeholder replaced by repo.
export const recordedPayload=(file,repo)=>JSON.parse(fs.readFileSync(file,'utf8'),(k,v)=>typeof v==='string'?v.replaceAll('/repo',repo):v);
// A copy of a fixture or eval task at a real temp path (macOS tmpdir is a /private symlink), with its own cache root and CLI session; s.env is read at each cli call.
export function scratch(src,{session='scratch',env={}}={}){
 const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'mutagate-scratch-'))),repo=path.join(dir,'repo'),cache=path.join(dir,'cache');
 const s={dir,repo,env:{...scrubEnv(),CLAUDE_PLUGIN_DATA:cache,MUTAGATE_SESSION:session,...env}};
 // Session state (repos/, trace, recorded/) stays in the temp cache root. jars/ (SHA-256 pinned) and tools/ (version-keyed, locked) link to the real cache root, so no scratch repo downloads them again; s.rm removes the links, not their targets.
 fs.mkdirSync(cache);
 for(const n of ['jars','tools']){const target=path.join(cacheRoot(scrubEnv()),n);fs.mkdirSync(target,{recursive:true});fs.symlinkSync(target,path.join(cache,n),'junction');}
 copyRepo(src,repo);
 // variants/<stem>.<weak|strong><ext> in the nearest dir above the test replaces the test.
 s.swap=(test,kind)=>{const ext=path.extname(test),stem=path.basename(test,ext);let d=path.dirname(test);while(d!=='.'&&!fs.existsSync(path.join(repo,d,'variants')))d=path.dirname(d);fs.copyFileSync(path.join(repo,d,'variants',`${stem}.${kind}${ext}`),path.join(repo,test));};
 s.cli=(args,{entry=process.env.MUTAGATE_TEST_ENTRY||'mutagate.mjs',...o}={})=>spawnSync(process.execPath,[path.join(root,'scripts',entry),...args],{cwd:repo,env:s.env,encoding:'utf8',timeout:600000,maxBuffer:50_000_000,...o});
 s.rm=()=>fs.rmSync(dir,{recursive:true,force:true,maxRetries:5});
 return s;
}
