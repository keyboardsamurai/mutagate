import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'../..'),fixtures=path.join(root,'test/fixtures');
const selected=(process.env.MUTAGATE_FIXTURES||'java-maven,java-gradle,java-gradle-multimodule,kotlin-gradle,kotlin-java-mixed,python-pip,python-uv,python-uv-src,ts-jest,ts-vitest,go-module,dotnet-xunit').split(',').filter(n=>!n.startsWith('eval-'));
for(const name of selected)test(name+' weak and strong actual mutation runs',{timeout:1200000},t=>{
  const original=path.join(fixtures,name),repo=fs.mkdtempSync(path.join(os.tmpdir(),'mutagate-integration-'));
  t.after(()=>fs.rmSync(repo,{recursive:true,force:true}));
  fs.cpSync(original,repo,{recursive:true,filter:p=>!p.split(path.sep).some(s=>['node_modules','build','target','.gradle','.venv','bin','obj','StrykerOutput','TestResults'].includes(s))});
  if(fs.existsSync(path.join(original,'node_modules')))fs.cpSync(path.join(original,'node_modules'),path.join(repo,'node_modules'),{recursive:true});
  if(fs.existsSync(path.join(original,'.venv')))fs.symlinkSync(path.join(original,'.venv'),path.join(repo,'.venv'),'junction');
  const expected=JSON.parse(fs.readFileSync(path.join(repo,'expected.json'))), ext=path.extname(expected.test),stem=path.basename(expected.test,ext),prefix=name==='java-gradle-multimodule'?'service/':'';
  const env={...process.env,MUTAGATE_RUN_BUDGET_SEC:'540',MUTAGATE_SESSION:'integration-'+name};
  if(name.startsWith('python')){const py=path.join(root,'test/.cache',name==='python-pip'?'py2':'py3');if(fs.existsSync(py))env.VIRTUAL_ENV=py;}
  if(name==='python-uv-src'){delete env.VIRTUAL_ENV;env.UV_PROJECT_ENVIRONMENT=path.join(repo,'.venv');const setup=spawnSync('uv',['sync','--project',repo,'--locked'],{env,encoding:'utf8',timeout:120000});assert.equal(setup.status,0,setup.stderr);}
  const buildFile=expected.manifest||(fs.existsSync(path.join(repo,'pom.xml'))?'pom.xml':fs.existsSync(path.join(repo,'build.gradle'))?'build.gradle':fs.existsSync(path.join(repo,'package.json'))?'package.json':'pyproject.toml'),before=fs.readFileSync(path.join(repo,buildFile),'utf8');
  const snapshot=()=>{const out={};function visit(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(['bin','obj'].includes(e.name)&&name==='dotnet-xunit')continue;const p=path.join(dir,e.name),rel=path.relative(repo,p);if(e.isDirectory())visit(p);else if(rel!==expected.test)out[rel]=fs.readFileSync(p,'base64');}}visit(repo);return out;};
  const cleanBefore=expected.file?snapshot():null;
  for(const variant of ['weak','strong']){fs.copyFileSync(path.join(repo,prefix,'variants',`${stem}.${variant}${ext}`),path.join(repo,expected.test));const result=spawnSync(process.execPath,[path.join(root,'scripts',process.env.MUTAGATE_TEST_ENTRY||'mutagate.mjs'),'run',expected.test,'--repo',repo,'--sync','--json'],{env,encoding:'utf8',timeout:600000,maxBuffer:10000000});assert.ok(result.stdout,'no result: '+result.stderr);const output=JSON.parse(result.stdout),r=Array.isArray(output)?output[0]:output;if(expected.file)assert.ok(r.raw?.length&&r.raw.every(m=>m.file===expected.file),JSON.stringify(r));assert.equal(r.status,variant==='weak'?'below':'pass',JSON.stringify(r));assert.ok(r.score>=expected[variant][0]&&r.score<=expected[variant][1]);if(variant==='weak')for(const method of expected.must_report)assert.ok(r.survivors.some(m=>m.method===method));assert.equal(fs.readFileSync(path.join(repo,buildFile),'utf8'),before);if(cleanBefore)assert.deepEqual(snapshot(),cleanBefore,'runner changed project files outside bin/obj');if(name==='dotnet-xunit')for(const project of ['Acme','Acme.Tests'])for(const output of ['bin','obj'])assert.equal(fs.existsSync(path.join(repo,project,output)),false,'mutagate created '+project+'/'+output);t.diagnostic(`${variant}: score=${r.score}, ${r.duration_ms}ms`);}
  if(name==='java-gradle-multimodule'){
    const file=path.join(repo,'library/src/main/java/acme/Dependency.java');fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('n + 1','n * 2'));
    const result=spawnSync(process.execPath,[path.join(root,'scripts',process.env.MUTAGATE_TEST_ENTRY||'mutagate.mjs'),'run',expected.test,'--target','acme.Dependency','--repo',repo,'--sync','--json'],{env,encoding:'utf8',timeout:600000,maxBuffer:10000000});
    const r=JSON.parse(result.stdout);assert.ok(r.raw?.some(m=>m.description.includes('multiplication')),JSON.stringify(r));
  }

});
