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
// Copilot native hooks (#35 AC 29): the event from the file name (<internal event>-<uuid>.json; Stop is agentStop), the union baseline of the cli-native corpus,
// in which the subagent keys (custom agents add agentDescription and agentDisplayName) and the bash-only toolArgs and the bash description (the model omits it in 8 of 370 recorded calls) are optional. No recordings before the first live Copilot eval: skipped, not failed.
// toolArgs are checked on postToolUse only: preToolUse carries the model's raw arguments before Copilot validates them (an edit without path, sweep 20261110-071431-9f45).
const cdir=path.join(recorded,'copilot'),OPTIONAL=['agentId','agentType','parentAgentId','agentDescription','agentDisplayName','initial_wait','mode','shellId','description'];
if(!fs.existsSync(cdir))console.log('copilot: no recordings yet (run the live Copilot eval); skipped');
else{const baseline=JSON.parse(fs.readFileSync(path.join(import.meta.dirname,'payloads/copilot/cli-native/schema-keys.json')));
 for(const file of fs.readdirSync(cdir)){const internal=file.split('-')[0],event=internal==='Stop'?'agentStop':internal[0].toLowerCase()+internal.slice(1),expected=baseline[event];if(!Array.isArray(expected))continue;
  const payload=JSON.parse(fs.readFileSync(path.join(cdir,file))),args=baseline.toolArgs[payload.toolName];compared++;
  for(const key of expected.filter(k=>!OPTIONAL.includes(k)))if(!(key in payload))failures.push(`copilot/${event}: missing ${key}`);
  if(event==='preToolUse')continue;
  if(args==='string'){if(typeof payload.toolArgs!=='string')failures.push(`copilot/${event}: ${payload.toolName} toolArgs is not a string`);}
  else for(const key of (args||[]).filter(k=>!OPTIONAL.includes(k)))if(!(key in (payload.toolArgs||{})))failures.push(`copilot/${event}: missing toolArgs.${key}`);}}
console.log(JSON.stringify({compared,failures:[...new Set(failures)]},null,2));if(failures.length||!compared)process.exitCode=1;
