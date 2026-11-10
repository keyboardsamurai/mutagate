import fs from 'node:fs';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {report,cacheRoot,hash} from '../scripts/mutagate.mjs';
import {root,scratch} from './scratch.mjs';
const measurements=[];
for(const name of ['java-gradle','kotlin-gradle']) {
 const fixture=path.join(root,'test/fixtures',name),s=scratch(fixture,{session:'performance'}),{repo}=s;
 try {
  const expected=JSON.parse(fs.readFileSync(path.join(fixture,'expected.json')));
  s.swap(expected.test,'strong');
  const runs=[];let result;
  for(let n=0;n<2;n++){if(n)fs.appendFileSync(path.join(repo,expected.test),'\n');const r=s.cli(['run',expected.test,'--sync','--json'],{entry:'mutagate.mjs',timeout:300000});if(r.status)throw Error(r.stdout+r.stderr);result=JSON.parse(r.stdout);if(result.status!=='pass')throw Error(JSON.stringify(result));runs.push(result.duration_ms);}
  const start=performance.now();for(let n=0;n<1000;n++)report(result);const formatting=(performance.now()-start)/1000;
  const history=path.join(cacheRoot(s.env),'repos',hash(repo),'history');
  const sample={fixture:name,cold_ms:runs[0],warm_ms:runs[1],improvement:1-runs[1]/runs[0],report_ms:formatting,history_present:fs.existsSync(history)&&fs.readdirSync(history).length>0};
  sample.pass=sample.cold_ms<=112500&&sample.warm_ms<=37500&&sample.improvement>=.4&&sample.report_ms<=62.5&&sample.history_present;measurements.push(sample);
 }finally{s.rm();}
}
console.log(JSON.stringify({measurements},null,2));if(measurements.some(m=>!m.pass))process.exitCode=1;
