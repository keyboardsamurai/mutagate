import fs from 'node:fs';
import path from 'node:path';
import {cacheRoot} from '../scripts/mutagate.mjs';
const recorded=path.join(cacheRoot(),'recorded');
if(!fs.existsSync(recorded))throw Error('No live recordings available; drift is unverified. Run the live suite with MUTAGATE_RECORD=1.');
const failures=[];let compared=0;
for(const harness of ['claude','codex','opencode','pi']) {
 const dir=path.join(recorded,harness);if(!fs.existsSync(dir)){failures.push(`${harness}: missing recordings`);continue;}
 const baseline=JSON.parse(fs.readFileSync(path.join(import.meta.dirname,'payloads',harness,'schema-keys.json')));
 for(const file of fs.readdirSync(dir)) {const payload=JSON.parse(fs.readFileSync(path.join(dir,file))),event=payload.hook_event_name,expected=baseline[event];if(!expected)continue;compared++;for(const key of expected.top.filter(k=>k!=='harness'))if(!(key in payload))failures.push(`${harness}/${event}: missing ${key}`);for(const key of expected.tool_input)if(!(key in (payload.tool_input||{})))failures.push(`${harness}/${event}: missing tool_input.${key}`);}
}
console.log(JSON.stringify({compared,failures:[...new Set(failures)]},null,2));if(failures.length||!compared)process.exitCode=1;
