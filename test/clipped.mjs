// Real Stryker.NET recovery across a clipped gate and its advised CLI command.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {root,scratch} from './scratch.mjs';
const s=scratch(path.join(root,'test/fixtures/dotnet-xunit'),{session:'clip',env:{MUTAGATE_GATE_BUDGET_SEC:'5',MUTAGATE_RUN_BUDGET_SEC:'300',MUTAGATE_TRACE:'1'}}),{repo}=s;
for(const k of Object.keys(process.env))if(!(k in s.env))delete process.env[k];Object.assign(process.env,s.env); // the engine also runs in this process
const m=await import('../scripts/mutagate.mjs'),c=m.context({repo}),registration=await m.register(c,'Acme.Tests/PricingTests.cs'),key=m.targetKey(registration.targets[0]);
const cli=(...args)=>s.cli(args,{entry:'mutagate-hook.cjs',timeout:360000});
const first=cli('check','--wait','5');assert.equal(first.status,1,first.stdout+first.stderr);
const advice=first.stdout.match(/results pending; needs about \d+ s; run \S*mutagate check --wait (\d+)/);assert.ok(advice,first.stdout+first.stderr);
const clipped=m.state(c).targets[key].lastRunMs,trace=()=>fs.readFileSync(path.join(c.data,'trace.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
assert.ok(trace().some(e=>e.event==='Result'&&e.decision==='killed'));
const second=cli('check','--wait',advice[1]);assert.ok([0,1].includes(second.status),second.stdout+second.stderr);assert.match(second.stdout,/score \d\.\d\d/);assert.doesNotMatch(second.stdout,/needs about|results pending/);
const status=cli('status','--json');assert.equal(status.status,0,status.stderr);assert.ok(JSON.parse(status.stdout).some(s=>['pass','below'].includes(s.result?.status)));assert.ok(m.state(c).targets[key].lastRunMs>=clipped);
const results=trace().filter(e=>e.event==='Result');assert.ok(results.findIndex(e=>e.decision==='killed')<results.findIndex(e=>['pass','below'].includes(e.decision)));
console.log(JSON.stringify({repo,trace:path.join(c.data,'trace.jsonl'),firstExit:first.status,retryExit:second.status,advice:advice[0],lastRunMs:m.state(c).targets[key].lastRunMs}));for(const r of results)console.log(JSON.stringify(r));
// Preserve the temporary repo, runner logs and trace for the closure evidence.
