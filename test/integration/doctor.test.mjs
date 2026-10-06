import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'../..');
test('doctor passes synthetic smoke after isolated installation',{timeout:300000,skip:process.env.MUTAGATE_FIXTURES&&!process.env.MUTAGATE_FIXTURES.includes('java-maven')},t=>{
 const repo=fs.mkdtempSync(path.join(os.tmpdir(),'mutagate-doctor-test-'));t.after(()=>fs.rmSync(repo,{recursive:true,force:true}));
 fs.copyFileSync(path.join(root,'test/fixtures/java-maven/pom.xml'),path.join(repo,'pom.xml'));
 fs.writeFileSync(path.join(repo,'Marker.java'),'class Marker {}');
 const cli=path.join(root,'scripts',process.env.MUTAGATE_TEST_ENTRY||'mutagate.mjs');let r=spawnSync(process.execPath,[cli,'install','--agent','claude','--repo',repo],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
 r=spawnSync(process.execPath,[cli,'doctor','--repo',repo,'--json'],{encoding:'utf8',timeout:300000});assert.equal(r.status,0,r.stdout+r.stderr);const data=JSON.parse(r.stdout);assert.ok(data.checks.every(x=>x.pass));assert.ok(!fs.existsSync(path.join(repo,'src')));
});
