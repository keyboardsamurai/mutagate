import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {performance} from 'node:perf_hooks';
import {command,report,cacheRoot,hash} from '../scripts/mutagate.mjs';
const root=path.resolve(import.meta.dirname,'..'),measurements=[];
for(const name of ['java-gradle','kotlin-gradle']) {
 const repo=fs.mkdtempSync(path.join(os.tmpdir(),'mutagate-runner-perf-'));
 try {
  fs.cpSync(path.join(root,'test/fixtures',name),repo,{recursive:true,filter:p=>!p.split(path.sep).some(x=>['build','.gradle'].includes(x))});
  const expected=JSON.parse(fs.readFileSync(path.join(repo,'expected.json'))),extension=path.extname(expected.test),stem=path.basename(expected.test,extension);
  fs.copyFileSync(path.join(repo,'variants',stem+'.strong'+extension),path.join(repo,expected.test));
  const runs=[];let result;
  for(let n=0;n<2;n++){const r=await command(process.execPath,[path.join(root,'scripts/mutagate.mjs'),'run',expected.test,'--repo',repo,'--sync','--json'],{timeout:300000,env:{...process.env,MUTAGATE_SESSION:'performance'}});result=JSON.parse(r.output);if(result.status!=='pass')throw Error(JSON.stringify(result));runs.push(result.duration_ms);}
  const start=performance.now();for(let n=0;n<1000;n++)report(result);const formatting=(performance.now()-start)/1000;
  const history=path.join(cacheRoot(),'repos',hash(fs.realpathSync(repo)),'history');
  const sample={fixture:name,cold_ms:runs[0],warm_ms:runs[1],improvement:1-runs[1]/runs[0],report_ms:formatting,history_present:fs.existsSync(history)&&fs.readdirSync(history).length>0};
  sample.pass=sample.cold_ms<=112500&&sample.warm_ms<=37500&&sample.improvement>=.4&&sample.report_ms<=62.5&&sample.history_present;measurements.push(sample);
 }finally{fs.rmSync(repo,{recursive:true,force:true});}
}
console.log(JSON.stringify({measurements},null,2));if(measurements.some(m=>!m.pass))process.exitCode=1;
