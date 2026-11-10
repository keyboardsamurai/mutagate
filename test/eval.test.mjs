import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { checkRun, writeChecks, renderReport, writeSweep, scrub, scrubDir, evidenceRecord, packageDigest } from './eval/checks.mjs';
import { VERSION } from '../scripts/mutagate.mjs';
import { ids as axes, parseArgs, planSweep, agentEnv, scrubRun, dropTransient } from './eval/run.mjs';
import { harnesses } from './eval/harnesses.mjs';
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mutagate-eval-')));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const put = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const json = (dir, f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));

// Canned run dirs start from the real Codex continuation evidence: SessionStart, PostToolUse, Result below, Stop block, Result pass, Stop allow.
const codex = JSON.parse(fs.readFileSync(new URL('./evidence/codex-continuation.json', import.meta.url))).attempts[0];
const T = 'src/test/java/acme/UserServiceTest.java', expected = { lang: 'java', targets: [{ file: 'src/main/java/acme/UserService.java', target: 'acme.UserService' }], traps: [],
  prodFiles: ['src/main/**'], expectedProdEdits: ['src/main/java/acme/MatrixController.java'], testFiles: ['src/test/**'], testCommand: ['mvn', 'test'], toolchain: [] };
const patch = (...files) => files.map(f => `diff --git a/${f} b/${f}\nnew file mode 100644\n--- /dev/null\n+++ b/${f}\n@@ -0,0 +1 @@\n+x\n`).join('');
const line = o => JSON.stringify(o) + '\n', ev = (event, decision, extra = {}) => ({ ts: '2026-09-12T16:01:00.000Z', harness: 'codex', event, session: 's', file: [], decision, duration_ms: 5, error: null, ...extra });
// Transcripts are real envelopes (full samples in eval/transcripts/): canned run dirs are Codex runs (exec --json items, ids per run dir); as() makes a case
// another harness's run with its own transcript (OpenCode: the messages.jsonl export).
let item = 0;
const cmd = (command, output = '') => line({ type: 'item.completed', item: { id: `item_${++item}`, type: 'command_execution', command, aggregated_output: output, exit_code: 0, status: 'completed' } }),
  say = text => line({ type: 'item.completed', item: { id: `item_${++item}`, type: 'agent_message', text } }),
  as = (f, harness, transcript) => { f['meta.json'].harness = f['trace.jsonl'][0].harness = harness; f[harness === 'opencode' ? 'messages.jsonl' : 'stdout.log'] = transcript; };
// Copilot runs (#35): the canned S11 transcript (-p JSONL) or envelopes like it; native hooks exit 0, also when they block. W: the watchdog time of the
// installed agentStop timeout of 600 s (ADR-0018).
const s11 = fs.readFileSync(new URL('./eval/transcripts/copilot/stdout.log', import.meta.url), 'utf8'), W = 570000;
const cop = { user: (content, delivery = 'idle') => line({ type: 'user.message', data: { content, delivery } }), tool: (toolCallId, toolName, args) => line({ type: 'tool.execution_start', data: { toolCallId, toolName, arguments: args } }) },
  copilot = (f, transcript = s11) => { as(f, 'copilot', transcript); f['trace.jsonl'] = f['trace.jsonl'].map(e => ({ ...e, harness: 'copilot', ...(e.event !== 'Result' && { exit: 0 }) })); };
const base = () => ({
  'meta.json': { harness: 'codex', harnessVersion: '0.154.0', model: 'gpt-5.6-sol', lang: 'java', scenario: 'forced', task: 'small', n: 1, startedAt: '2026-09-12T16:00:00.000Z',
    endedAt: '2026-09-12T16:01:00.000Z', wallMs: 60000, exitCode: 0, ended: 'exit', session: codex.trace[0].session },
  'trace.jsonl': codex.trace.map(e => ({ ...e, duration_ms: Math.min(e.duration_ms, 900) })),
  'diff.patch': patch(T),
  'status.json': [{ target: 'acme.UserService', secondary: false, blocks: 1, stale: false, in_flight: false, result: { status: 'pass', score: 1, killed: 6, survived: 0, error: null } }],
  'check.json': { code: 0, block: false, reason: '', report: 'mutagate: acme.UserService score 1.00 (6/6), threshold 0.80. 0 survivors shown of 0.', warnings: [] },
  'check.exit': '0\n', 'test-command.exit': '0\n', 'test-command.log': 'BUILD SUCCESS\n', 'stderr.log': '', 'final.txt': codex.finalResponse + 'Scores for 3 targets are in status (6/6 killed).\n',
  // Hook commands, skill examples in backticks and hook messages naming the CLI are not agent CLI calls or source reads.
  'stdout.log': cmd('cat .codex/hooks.json', JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: "'/usr/bin/node' '/r/.agents/skills/mutagate/scripts/mutagate-hook.cjs' hook Stop" }] }] } }))
    + cmd("sed -n '1,240p' .agents/skills/mutagate/SKILL.md", 'Read the result with `scripts/mutagate check --wait 120`. Use `scripts/mutagate run <test-file> --target <target>`.')
    + cmd('scripts/mutagate status', `mutagate: target unresolved for ${T}. Candidates: a, b. Select with mutagate run ${T} --target <target>.`),
  'runner-logs/acme.UserService.log': line({ exe: 'java', args: [], code: 1, signal: null, output: 'ERROR survivor', error: '' }),
  [`repo/${T}`]: 'class UserServiceTest {}'
});
let count = 0;
function runDir(edit = () => {}) {
  item = 0; const f = base(); edit(f);
  const dir = path.join(tmp, `codex-java-${f['meta.json'].scenario}-${++count}`);
  for (const [k, v] of Object.entries(f)) put(path.join(dir, k), k === 'trace.jsonl' ? v.map(line).join('') : typeof v === 'string' ? v : JSON.stringify(v));
  return dir;
}
const ids = ({ result, anomalies }) => [result.checks.filter(c => !c.passed).map(c => c.id).sort(), [...new Set(anomalies.filter(a => a.kind === 'warning').map(a => a.id))].sort()];
const below = f => { f['check.exit'] = '1\n'; f['status.json'][0].result = { status: 'below', score: .5, killed: 5, survived: 5, error: null }; };
const cases = {
  'forced block -> pass -> allow passes clean': [() => {}, [], []],
  'modified installed skill fails': [f => { f['skill-diff.txt'] = 'scripts/mutmut-bridge.cjs\n'; }, ['skill-modified'], []],
  'killed run': [f => { f['meta.json'].ended = 'killed'; }, ['ended'], []],
  'missing SessionStart': [f => { f['trace.jsonl'] = f['trace.jsonl'].filter(e => e.event !== 'SessionStart'); }, ['session-start'], []],
  'wrong harness label': [f => { f['trace.jsonl'][0].harness = 'claude'; }, ['session-start'], []],
  'test file with no registration': [f => { f['diff.patch'] += patch('src/test/java/acme/OtherTest.java'); }, ['registration'], []],
  'registration ignores Python support and empty files and accepts status tests': [f => { f['diff.patch'] += patch('src/test/__init__.py', 'src/test/conftest.py', 'src/test/EmptyTest.java', 'src/test/MovedTest.java'); f['repo/src/test/EmptyTest.java'] = ''; f['status.json'][0].tests = ['src/test/MovedTest.java']; }, [], []],
  'unscored target': [f => { Object.assign(f['status.json'][0], { stale: true, result: null }); }, ['targets-scored'], []],
  'unresolved target': [f => { f['status.json'] = []; }, ['targets-scored'], []],
  'infra error in trace': [f => { f['trace.jsonl'][7].error = 'mvn failed (1): Could not resolve dependencies'; }, ['no-errors'], []],
  'hook error without a target': [f => { f['trace.jsonl'][4].error = 'TypeError: x is undefined'; }, ['no-errors'], []],
  // The agent's own CLI usage mistakes (run on a bad path, waive without a valid id) are traced without a target; they are not infrastructure errors.
  'CLI usage errors without a target': [f => { f['trace.jsonl'].push({ ...ev('run', 'error', { error: 'test file is missing or outside repository' }), session: 'ppid-1' }, { ...ev('waive', 'error', { error: 'waive requires a survivor id and --reason' }), session: 'ppid-2' }); }, [], []],
  // Engine usage errors are no longer traced; a crashed worker or a CLI infrastructure exception has no target either and still counts.
  'worker error without a target': [f => { f['trace.jsonl'].push(ev('worker', 'error', { error: "EACCES: permission denied, open 'state.json'" })); }, ['no-errors'], []],
  'CLI infrastructure error without a target': [f => { f['trace.jsonl'].push(ev('check', 'error', { error: 'session state busy' })); }, ['no-errors'], []],
  'error Result then pass Result for the same target is recovered': [f => { Object.assign(f['trace.jsonl'][3], { score: null, decision: 'error', error: 'mvn failed (1): COMPILATION ERROR' }); }, [], ['recovered-error']],
  'error Result then pass Result for another target': [f => { Object.assign(f['trace.jsonl'][3], { score: null, decision: 'error', error: 'mvn failed (1)' }); f['trace.jsonl'][7].target = 'acme.Other'; }, ['no-errors'], []],
  'runner killed in runner log': [f => { f['runner-logs/acme.Other.log'] = line({ exe: 'mvn', args: [], code: null, signal: 'SIGKILL', output: '', error: '' }); }, ['no-errors'], []],
  'runner killed, final status scored': [f => { f[`runner-logs/${crypto.createHash('sha1').update('acme.UserService').digest('hex')}.log`] = line({ exe: 'mvn', args: [], code: null, signal: 'SIGKILL', output: '', error: '' }); }, [], ['recovered-error']],
  'runner killed in previous run log, final status scored': [f => { f[`runner-logs/${crypto.createHash('sha1').update('acme.UserService').digest('hex')}.prev.log`] = line({ exe: 'mvn', args: [], code: null, signal: 'SIGKILL', output: '', error: '' }); }, [], ['recovered-error']],
  'infra error result': [f => { f['status.json'].push({ target: 'acme.Other', blocks: 0, result: { status: 'error', score: null, killed: 0, survived: 0, error: 'java unavailable' } }); }, ['no-errors'], []],
  // The cap is per target: status.json blocks, not trace Stop blocks.
  'below threshold without block fails gate': [f => { below(f); f['meta.json'].scenario = 'natural'; f['status.json'][0].blocks = 0; }, ['gate'], []],
  'below threshold with blocks up to the cap passes gate': [f => { below(f); f['meta.json'].scenario = 'natural'; f['status.json'][0].blocks = 2; }, [], []],
  'below threshold one block short of the cap fails gate, whatever the trace': [f => { below(f); f['meta.json'].scenario = 'natural'; f['trace.jsonl'].push(ev('Stop', 'block')); }, ['gate'], []],
  'one below target at the cap, another one short': [f => { below(f); f['status.json'][0].blocks = 2; f['status.json'].push({ ...f['status.json'][0], target: 'acme.Other', blocks: 1 }); }, ['gate'], []],
  'check infrastructure error': [f => { f['check.exit'] = '3\n'; }, ['gate', 'no-errors'], []],
  'forced block -> pass without allow': [f => { f['trace.jsonl'].pop(); }, ['forced-order'], []],
  'deleted test file needs no registration': [f => { f['diff.patch'] += 'diff --git a/src/test/java/acme/OldTest.java b/src/test/java/acme/OldTest.java\ndeleted file mode 100644\n'; }, [], []],
  'forced wrong order': [f => { f['trace.jsonl'] = [...f['trace.jsonl'].filter(e => e.decision !== 'block'), ev('Stop', 'block')]; }, ['forced-order'], []],
  'natural run skips forced-order': [f => { f['meta.json'].scenario = 'natural'; f['trace.jsonl'] = f['trace.jsonl'].filter(e => e.decision !== 'block'); }, [], []],
  'prod-changed': [f => { f['diff.patch'] += patch('src/main/java/acme/UserService.java', 'src/main/java/acme/MatrixController.java'); }, [], ['prod-changed']],
  'waiver': [f => { f['stdout.log'] += cmd(`/bin/zsh -lc 'scripts/mutagate waive ${'a'.repeat(40)} --reason "equivalent"'`); }, [], ['waiver']],
  'waiver file edit': [f => { f['trace.jsonl'].push(ev('PreToolUse', 'allow', { file: ['/r/.mutagate/waivers.json'] })); }, [], ['waiver']],
  'manual-run': [f => { f['stdout.log'] += say('mutagate: acme.UserService score 0.50 (3/6), threshold 0.80. 3 survivors shown of 3.') + cmd(`node .agents/skills/mutagate/scripts/mutagate.mjs run ${T} --sync`); }, [], ['manual-run']],
  'source-read': [f => { as(f, 'claude', line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: '/r/.claude/skills/mutagate/scripts/mutagate.mjs' } }] } })); }, [], ['source-read']],
  'source reads respect command boundaries and discarded output': [f => { f['stdout.log'] += cmd('cat scripts/mutagate.mjs > /dev/null') + cmd('mutagate check | tail\nscripts/mutagate.mjs'); }, [], []],
  'source reads include runner helpers': [f => { f['stdout.log'] += cmd('sed -n 1p scripts/errors.cjs'); }, [], ['source-read']],
  'source reads include copilot.cjs': [f => { f['stdout.log'] += cmd('cat .agents/skills/mutagate/scripts/copilot.cjs'); }, [], ['source-read']],
  'source reads include runners.cjs': [f => { f['stdout.log'] += cmd('cat .agents/skills/mutagate/scripts/runners.cjs'); }, [], ['source-read']],
  'slow-hook': [f => { f['trace.jsonl'][2].duration_ms = 2500; f['trace.jsonl'].push({ ...f['trace.jsonl'][2], duration_ms: 6200, mutate: true }); }, [], ['slow-hook']],
  'slow async --mutate PostToolUse is exempt': [f => { f['trace.jsonl'].push({ ...f['trace.jsonl'][2], duration_ms: 6200, mutate: true }); }, [], []],
  'slow sync PostToolUse': [f => { f['trace.jsonl'].push({ ...f['trace.jsonl'][2], duration_ms: 6200 }); }, [], ['slow-hook']],
  'stale-deleted': [f => { f['stdout.log'] += say('mutagate: target unresolved for src/test/java/acme/GoneIT.java. Candidates: none.'); }, [], ['stale-deleted']],
  'stale-deleted: results pending for a target whose file is gone': [f => { f['stdout.log'] += say('Stop hook: mutagate: acme.UserService results pending, run mutagate check --wait 120'); }, [], ['stale-deleted']],
  'stale-deleted: stale status line, file from status.json': [f => { f['status.json'].push({ target: 'acme.Gone', file: 'src/main/java/acme/Gone.java', blocks: 0, stale: true, result: null }); f['stdout.log'] += cmd('scripts/mutagate status', 'acme.UserService: score 1.00 (6/6), pass\nacme.Gone: unscored stale'); }, [], ['stale-deleted']],
  'stale-deleted: pending target whose file exists': [f => { f['repo/src/main/java/acme/UserService.java'] = 'class UserService {}'; f['check.json'].report = 'mutagate: acme.UserService infrastructure error: results pending after source changes.'; }, [], []],
  'stale-deleted: pending error for a path-like target id': [f => { f['check.json'].report = 'mutagate: internal/gone.go infrastructure error: results pending after source changes.'; }, [], ['stale-deleted']],
  'stale-deleted: pending error in the current engine wording': [f => { f['check.json'].report = 'mutagate: internal/gone.go could not be scored: results pending after source changes. Fix the build or test compilation first; otherwise this is an infrastructure error.'; }, [], ['stale-deleted']],
  // mutagate source dumped by sed/grep/read holds the message templates.
  'stale-deleted ignores the message template in dumped source': [f => { f['stdout.log'] += cmd('rg -n "target unresolved for" .agents/skills/mutagate/scripts', '962:  return { text: `mutagate: target unresolved for ${test}. Candidates: ${list}.` };'); }, [], []],
  'waiver ignores the deny reason template in dumped source': [f => { f['stdout.log'] += cmd('rg -n "Waivers require" .agents/skills/mutagate/scripts', 'permissionDecisionReason: `Waivers require human approval. Proposed: ${proposed}. Edit .mutagate/waivers.json manually.`'); }, [], []],
  'waiver deny reason': [f => { f['stdout.log'] += say('Waivers require human approval. Proposed: acme.UserService line 12. Edit .mutagate/waivers.json manually.'); }, [], ['waiver']],
  'stale-deleted needs the repo': [f => { delete f[`repo/${T}`]; cases['stale-deleted'][0](f); }, [], []],
  'unconfirmed-claim': [f => { f['final.txt'] = 'Tests written. Mutation score is 0.95 and the gate passed.'; }, [], ['unconfirmed-claim']],
  'unconfirmed pass claim': [f => { below(f); f['status.json'][0].blocks = 2; f['final.txt'] = 'Done: all mutants killed.'; }, [], ['unconfirmed-claim']],
  'the threshold is not a claimed score': [f => { f['final.txt'] = 'All modules score ≥0.80 (1.00).\n### Mutation scores (all above 0.80 threshold):\nMutation Scores (threshold 80% ✓), all scores exceed the 0.80 threshold.'; }, [], []],
  'unconfirmed claim to pass the threshold': [f => { below(f); f['status.json'][0].blocks = 2; f['final.txt'] = 'The results are fresh and clean — all targets pass the 0.80 threshold:'; }, [], ['unconfirmed-claim']],
  'negated threshold statements are not pass claims': [f => { below(f); f['status.json'][0].blocks = 2; f['final.txt'] = 'UserService scores 0.50, which does not meet the 0.80 threshold.\nThe suite did not pass the threshold.\nIt is not above the 80% threshold and doesn\'t meet the threshold; mutation testing has not passed.'; }, [], []],
  'test-command-red': [f => { f['test-command.exit'] = '1\n'; }, [], ['test-command-red']],
  'unscored and stale Result reasons are not infrastructure failures': [f => { f['trace.jsonl'].push(ev('Result', 'unscored', { target: 'empty', error: 'no mutants to test' }), ev('Result', 'stale', { target: 'old', error: 'superseded runner failure' })); }, [], []],
  'final unscored reason is a warning, not an infrastructure error': [f => { f['status.json'].push({ target: 'empty', result: { status: 'unscored', score: null, error: 'no mutants to test' } }); }, [], ['unscored-final']],
  'tiny-mutants': [f => { f['status.json'][0].result.killed = 3; }, [], ['tiny-mutants']],
  'async ignores stale results and status before the first check': [f => { const session = codex.trace[0].session; f['meta.json'].scenario = 'natural'; f['trace.jsonl'] = [ev('SessionStart', 'allow', { session }), ev('PostToolUse', 'allow', { session, file: [T] }), ev('Result', 'stale', { session }), ev('status', 'cli', { session }), ev('Result', 'pass', { session, score: 1 }), ev('check', 'cli', { session })]; cases['async-missing'][0](f); }, [], []],
  'async-missing': [f => { f['trace.jsonl'][3].target = 'acme.Other'; f['stdout.log'] += cmd('node .agents/skills/mutagate/scripts/mutagate.mjs check --wait 120') + cmd(`scripts/mutagate run ${T}`); }, [], ['async-missing']],
  'async delivered by a PostToolUse block': [f => { f['trace.jsonl'][2].decision = 'block'; cases['async-missing'][0](f); }, [], []],
  'async delivered by an error report': [f => { f['stdout.log'] += say('mutagate: acme.UserService could not be scored: mvn failed (1). Fix the build or test compilation first; otherwise this is an infrastructure error.'); cases['async-missing'][0](f); }, [], []],
  // Nothing to deliver: every hook-session Result before the first event of another (CLI) session passed.
  'async not missing when every hook Result before the CLI passed': [f => { Object.assign(f['trace.jsonl'][3], { decision: 'pass', score: 1 }); cases['async-missing'][0](f); }, [], []],
  'async missing when no Result came before the CLI': [f => { f['trace.jsonl'] = f['trace.jsonl'].filter(e => e.event !== 'Result'); f['status.json'][0].blocks = 0; f['meta.json'].scenario = 'natural'; cases['async-missing'][0](f); }, [], ['async-missing']],
  'below Results from the first CLI-session event on do not make async missing': [f => { Object.assign(f['trace.jsonl'][3], { decision: 'pass', score: 1 }); f['trace.jsonl'].push({ ...ev('Result', 'below', { target: 'acme.UserService', score: .5 }), session: 'ppid-9' }, { ...ev('Result', 'below', { target: 'acme.UserService', score: .5 }), session: codex.trace[0].session }); cases['async-missing'][0](f); }, [], []],
  // CLI calls join the hook session and trace a cli event: Results after it are the CLI's, not the async handler's.
  'async not missing when every Result before a same-session CLI call passed': [f => { Object.assign(f['trace.jsonl'][3], { decision: 'pass', score: 1 }); f['trace.jsonl'].push({ ...ev('run', 'cli'), session: codex.trace[0].session }, { ...ev('Result', 'below', { target: 'acme.UserService', score: .5 }), session: codex.trace[0].session }); cases['async-missing'][0](f); }, [], []],
  'async missing when only a same-session CLI run produced a pass': [f => { f['trace.jsonl'] = f['trace.jsonl'].filter(e => e.event !== 'Result'); f['status.json'][0].blocks = 0; f['meta.json'].scenario = 'natural'; f['trace.jsonl'].push({ ...ev('run', 'cli'), session: codex.trace[0].session }, { ...ev('Result', 'pass', { target: 'acme.UserService', score: 1 }), session: codex.trace[0].session }); cases['async-missing'][0](f); }, [], ['async-missing']],
  'status and check CLI before any test mention': [f => { f['stdout.log'] = cmd('node .agents/skills/mutagate/scripts/mutagate.mjs status') + cmd('node .agents/skills/mutagate/scripts/mutagate.mjs check --wait 120') + f['stdout.log'] + cmd(`scripts/mutagate run ${T}`); }, [], []],
  // OpenCode and Pi echo the prompt (Pi also replays it in agent_end); the first agent line naming the test is the write.
  'OpenCode prompt echo naming the test is not a mention': [f => { f['trace.jsonl'][3].target = 'acme.Other'; as(f, 'opencode', line({ role: 'user', type: 'text', text: `Write ${T}.` })
    + line({ role: 'assistant', type: 'tool', callID: 'call_1', tool: 'bash', state: { status: 'completed', input: { command: 'node .agents/skills/mutagate/scripts/mutagate.mjs check --wait 120' } } })
    + line({ role: 'assistant', type: 'tool', callID: 'call_2', tool: 'write', state: { status: 'completed', input: { filePath: `/r/${T}` } } }) + line({ role: 'assistant', type: 'tool', callID: 'call_3', tool: 'bash', state: { status: 'completed', input: { command: `scripts/mutagate run ${T}` } } })); }, [], []],
  'Pi prompt echo and its agent_end replay are not a mention': [f => { const user = { role: 'user', content: [{ type: 'text', text: `Write ${T}.` }] }; f['trace.jsonl'][3].target = 'acme.Other';
    as(f, 'pi', line({ type: 'message_start', message: user }) + line({ type: 'message_end', message: user }) + line({ type: 'tool_execution_start', toolCallId: 'call_1', toolName: 'bash', args: { command: 'node .pi/skills/mutagate/scripts/mutagate.mjs check --wait 120' } })
      + line({ type: 'agent_end', messages: [user] }) + line({ type: 'tool_execution_start', toolCallId: 'call_2', toolName: 'write', args: { path: `/r/${T}` } }) + line({ type: 'tool_execution_start', toolCallId: 'call_3', toolName: 'bash', args: { command: `scripts/mutagate run ${T}` } })); }, [], []],
  'Claude tool results are agent lines: a listing naming the test is a mention': [f => { f['trace.jsonl'][3].target = 'acme.Other';
    as(f, 'claude', line({ type: 'user', message: { role: 'user', content: [{ tool_use_id: 'toolu_1', type: 'tool_result', content: `./${T}` }] } }) + line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_2', name: 'Bash', input: { command: 'node .claude/skills/mutagate/scripts/mutagate.mjs check --wait 120' } }] } })); }, [], ['async-missing']],
  'status after a test mention is not a run or check': [f => { f['stdout.log'] += cmd('node .agents/skills/mutagate/scripts/mutagate.mjs status'); }, [], []],
  'suggested CLI in agent text is not a call, the executed Codex command is': [f => { f['trace.jsonl'][3].target = 'acme.Other'; f['stdout.log'] += line({ type: 'item.completed', item: { id: 'item_5', type: 'agent_message', text: `Run scripts/mutagate run ${T} --sync, then scripts/mutagate check --wait 120.` } }) + line({ type: 'item.started', item: { id: 'item_6', type: 'command_execution', command: "/bin/zsh -lc 'scripts/mutagate check --wait 120'" } }) + line({ type: 'item.completed', item: { id: 'item_6', type: 'command_execution', command: "/bin/zsh -lc 'scripts/mutagate check --wait 120'", exit_code: 0 } }); }, [], ['async-missing']],
  'Claude executes Bash tool_use blocks': [f => { as(f, 'claude', line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: `scripts/mutagate waive ${'a'.repeat(40)} --reason "equivalent"` } }] } })); }, [], ['waiver']],
  'OpenCode executes bash parts of the messages.jsonl export': [f => { as(f, 'opencode', line({ role: 'assistant', type: 'tool', callID: 'call_1', tool: 'bash', state: { status: 'completed', input: { command: `node .agents/skills/mutagate/scripts/mutagate.mjs run ${T} --sync` } } })); }, [], ['manual-run']],
  'Pi executes tool_execution_start; a toolCall replayed in message_end alone is not a call': [f => { f['trace.jsonl'][3].target = 'acme.Other'; as(f, 'pi', line({ type: 'tool_execution_start', toolCallId: 'call_1', toolName: 'write', args: { path: `/r/${T}` } })
    + line({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'toolCall', id: 'call_9', name: 'bash', arguments: { command: 'scripts/mutagate waive abc --reason x' } }] } }) + line({ type: 'tool_execution_start', toolCallId: 'call_2', toolName: 'bash', args: { command: 'scripts/mutagate check --wait 120' } })); }, [], ['async-missing']],
  'async delivered by a PostToolUse that printed output': [f => { cases['async-missing'][0](f); f['trace.jsonl'][2].delivered = true; }, [], []],
  'delivered PostToolUse after the CLI boundary does not count': [f => { cases['async-missing'][0](f); f['trace.jsonl'].push({ ...ev('run', 'cli'), session: codex.trace[0].session }, { ...ev('PostToolUse', 'allow', { delivered: true }), session: codex.trace[0].session }); }, [], ['async-missing']],
  'async not missing when a later pass supersedes an earlier error for the same target': [f => { Object.assign(f['trace.jsonl'][3], { score: null, decision: 'error', error: 'mvn failed (1): COMPILATION ERROR' }); f['stdout.log'] += cmd('node .agents/skills/mutagate/scripts/mutagate.mjs check --wait 120'); }, [], ['recovered-error']],
  'error Result then no-mutants Result for the same target is recovered': [f => { Object.assign(f['trace.jsonl'][3], { score: null, decision: 'error', error: 'mvn failed (1): COMPILATION ERROR' }); Object.assign(f['trace.jsonl'][7], { score: null, decision: 'unscored', error: 'no mutants to test in src/main/java/acme/UserService.java (1 filtered as junk)' }); f['meta.json'].scenario = 'natural'; }, [], ['recovered-error']],
  'error Result then another unscored reason is not recovered': [f => { Object.assign(f['trace.jsonl'][3], { score: null, decision: 'error', error: 'mvn failed (1)' }); Object.assign(f['trace.jsonl'][7], { score: null, decision: 'unscored', error: 'no mutant is covered by the registered tests' }); f['meta.json'].scenario = 'natural'; }, ['no-errors'], []],
  'runner killed, final status no-mutants': [f => { f[`runner-logs/${crypto.createHash('sha1').update('acme.Other').digest('hex')}.log`] = line({ exe: 'mvn', args: [], code: null, signal: 'SIGKILL', output: '', error: '' }); f['status.json'].push({ target: 'acme.Other', blocks: 0, result: { status: 'unscored', score: null, killed: 0, survived: 0, error: 'no mutants to test in src/main/java/acme/Other.java' } }); }, [], ['recovered-error', 'unscored-final']],
  'stale-deleted ignores messages before the deletion and their replay after it': [f => { const msg = 'mutagate: target unresolved for src/test/java/acme/DebugTest.java. Candidates: none.'; as(f, 'pi', line({ type: 'message_end', message: { role: 'custom', content: msg } }) + line({ type: 'tool_execution_start', toolCallId: 'call_3', toolName: 'bash', args: { command: 'cd /r && rm src/test/java/acme/DebugTest.java && mvn test' } }) + line({ type: 'agent_end', messages: [{ role: 'custom', content: msg }] })); }, [], []],
  'stale-deleted: previously unseen message after the deletion': [f => { f['stdout.log'] += cmd('git rm src/test/java/acme/DebugTest.java') + say('mutagate: target unresolved for src/test/java/acme/DebugTest.java. Candidates: none.'); }, [], ['stale-deleted']],
  'stale-deleted: check.json counts whatever the deletion order': [f => { f['stdout.log'] += cmd('rm src/main/java/acme/Gone.java'); f['check.json'].report = 'mutagate: src/main/java/acme/Gone.java could not be scored: results pending after source changes.'; }, [], ['stale-deleted']],
  'unregistered assertion-free scaffold is a warning': [f => { f['diff.patch'] += patch('src/test/java/acme/UnitTest1.java'); f['repo/src/test/java/acme/UnitTest1.java'] = 'import org.junit.jupiter.api.Test;\n\npublic class UnitTest1 {\n    @Test\n    public void test1() {\n\n    }\n}\n'; }, [], ['scaffold-unregistered']],
  'Copilot S11 run: forced block -> pass -> allow with exit-0 blocks passes clean': [f => copilot(f), [], []],
  'Copilot Stop shorter than W is not slow': [f => { copilot(f); f['trace.jsonl'][4].duration_ms = W - 1; }, [], []],
  'Copilot Stop at W (watchdog deadline) is slow': [f => { copilot(f); f['trace.jsonl'].push({ ...f['trace.jsonl'][8], decision: 'deadline', duration_ms: W }); }, [], ['slow-hook']],
  'Copilot hooks other than Stop keep 1 s': [f => { copilot(f); f['trace.jsonl'][2].duration_ms = 2500; }, [], ['slow-hook']],
  'Copilot subagent agentStop (trace agent) is no Stop allow for forced-order': [f => { copilot(f); f['trace.jsonl'].at(-1).agent = '361ceb94-8b5e-4393-8450-b0a8b70b3bbb'; }, ['forced-order'], []],
  'Copilot SubagentStart keeps 1 s': [f => { copilot(f); f['trace.jsonl'].push({ ...f['trace.jsonl'][0], event: 'SubagentStart', decision: 'allow', duration_ms: 2500 }); }, [], ['slow-hook']],
  'a Stop of another harness keeps 1 s': [f => { f['trace.jsonl'][4].duration_ms = 2500; }, [], ['slow-hook']],
  'Copilot prompt echo naming the test is not a mention': [f => { f['trace.jsonl'][3].target = 'acme.Other'; copilot(f, cop.user(`Write ${T}.`) + cop.tool('toolu_1', 'bash', { command: 'node .agents/skills/mutagate/scripts/mutagate.mjs check --wait 120' })
    + cop.tool('toolu_2', 'create', { path: `/r/${T}`, file_text: 'x' }) + cop.tool('toolu_3', 'bash', { command: `scripts/mutagate run ${T}` })); }, [], []],
  'unregistered test with assertions fails registration': [f => { f['diff.patch'] += patch('src/test/java/acme/RealTest.java'); f['repo/src/test/java/acme/RealTest.java'] = 'class RealTest { @Test void t() { assertEquals(1, 1); } }'; }, ['registration'], []]
};
for (const [name, [edit, failed, warnings]] of Object.entries(cases))
  test(`checker: ${name}`, () => assert.deepEqual(ids(checkRun(runDir(edit), expected)), [failed, warnings]));

test('checker: Copilot shell commands are bash tool.execution_start events, once per toolCallId; toolRequests and results are not calls', () => {
  const waive = { command: `scripts/mutagate waive ${'a'.repeat(40)} --reason "equivalent"` };
  const { anomalies } = checkRun(runDir(f => copilot(f, s11 + line({ type: 'assistant.message', data: { content: '', toolRequests: [{ toolCallId: 'toolu_9', name: 'bash', arguments: waive }] } })
    + cop.tool('toolu_9', 'bash', waive) + cop.tool('toolu_9', 'bash', waive) + line({ type: 'tool.execution_complete', data: { toolCallId: 'toolu_9', success: true, result: { content: waive.command } } }))), expected);
  assert.deepEqual(anomalies.filter(a => a.id === 'waiver').map(a => a.evidence.map(e => e.line)), [[101]]);
});

test('checker evidence: every anomaly cites lines, warnings name only the offending items, and writeChecks writes the contract files', () => {
  const dir = runDir(f => { cases['prod-changed'][0](f); cases['slow-hook'][0](f); cases['stale-deleted'][0](f); f['meta.json'].ended = 'killed'; });
  const { result, anomalies } = writeChecks(dir, expected);
  assert.deepEqual(json(dir, 'result.json'), result);
  assert.deepEqual(json(dir, 'anomalies.json'), anomalies);
  assert.deepEqual(Object.keys(result), ['run', 'harness', 'lang', 'scenario', 'task', 'n', 'passed', 'skipped', 'ended', 'wallMs', 'checks']);
  assert.equal(result.run, path.basename(dir));
  assert.equal(result.passed, false);
  assert.deepEqual(result.checks.map(c => c.id), ['ended', 'session-start', 'registration', 'targets-scored', 'no-errors', 'gate', 'forced-order', 'skill-modified']);
  assert.ok(result.checks.every(c => Array.isArray(c.evidence) && c.evidence.every(e => typeof e === 'string')));
  for (const a of anomalies) {
    assert.deepEqual(Object.keys(a), ['kind', 'id', 'message', 'run', 'evidence']);
    assert.ok(a.evidence.length && a.evidence.every(e => typeof e.file === 'string' && Number.isInteger(e.line) && typeof e.text === 'string'), a.id);
  }
  const by = id => anomalies.find(a => a.id === id);
  assert.equal(by('ended').kind, 'check');
  assert.deepEqual(by('prod-changed').evidence.map(e => e.text), ['diff --git a/src/main/java/acme/UserService.java b/src/main/java/acme/UserService.java']);
  assert.deepEqual(by('slow-hook').evidence.map(e => e.line), [3]);
  assert.equal(by('stale-deleted').evidence.length, 1);
  assert.match(by('stale-deleted').message, /GoneIT/);
});

test('prod-changed ignores test files matching prodFiles, with the Go and TypeScript task globs', () => {
  const task = lang => JSON.parse(fs.readFileSync(new URL(`./eval/tasks/${lang}/expected.json`, import.meta.url), 'utf8'));
  const prod = (exp, ...files) => checkRun(runDir(f => { f['diff.patch'] = patch(...files); }), exp).anomalies.filter(a => a.id === 'prod-changed').flatMap(a => a.evidence.map(e => e.text.split(' b/')[1]));
  assert.deepEqual(prod({ ...expected, prodFiles: ['src/**'] }, T, 'src/main/java/acme/UserService.java'), ['src/main/java/acme/UserService.java']);
  assert.deepEqual(prod(task('go'), 'internal/matrix/service.go', 'internal/matrix/service_test.go', 'cmd/matrixd/matrix_api_test.go', 'internal/api/page.go', 'internal/api/sum.go', 'go.mod'), ['internal/api/page.go', 'internal/api/sum.go', 'go.mod']);
  assert.deepEqual(prod(task('typescript'), 'src/matrixController.ts', 'src/matrixApi.test.ts', 'src/app.spec.ts', 'src/app.ts', 'src/sum.ts', 'test/app.test.ts'), ['src/app.ts', 'src/sum.ts']);
});

const R = (run, passed, extra = {}) => {
  const [, harness, lang, scenario, g, n] = run.match(/^(\w+)-(\w+)-(\w+)(-greenfield)?-(\d+)$/);
  return { run, harness, lang, scenario, task: g ? 'greenfield' : 'small', n: +n, passed, skipped: null, ended: 'exit', wallMs: 60000, checks: [], ...extra };
};
const A = (run, kind, id, file = 'trace.jsonl') => ({ kind, id, message: `${id} in ${run}`, run, evidence: [{ file, line: 4, text: 'x' }] });
function sweep() {
  const dir = fs.mkdtempSync(path.join(tmp, 'sweep-')), write = (r, anomalies) => { put(path.join(dir, r.run, 'result.json'), JSON.stringify(r)); if (anomalies) put(path.join(dir, r.run, 'anomalies.json'), JSON.stringify(anomalies)); };
  write(R('claude-java-forced-2', false, { wallMs: 90000 }), [A('claude-java-forced-2', 'warning', 'slow-hook'), A('claude-java-forced-2', 'check', 'gate', 'check.exit'), { ...A('claude-java-forced-2', 'warning', 'recovered-error'), message: '3 error(s) superseded' }, ...Array(24).fill(A('claude-java-forced-2', 'warning', 'slow-hook'))]);
  write(R('claude-java-forced-1', true, { wallMs: 30000 }), []);
  write(R('codex-java-forced-1', false, { skipped: 'codex 0.153.0 != pinned 0.154.0', ended: null, wallMs: null }));
  write(R('claude-go-natural-1', false), [A('claude-go-natural-1', 'warning', 'slow-hook'), A('claude-go-natural-1', 'warning', 'manual-run'), { ...A('claude-go-natural-1', 'warning', 'recovered-error'), message: '1 error(s) superseded' }]);
  write(R('claude-java-natural-greenfield-1', true), []);
  fs.mkdirSync(path.join(dir, 'not-a-run'));
  return dir;
}
test('report: matrix cells, run counts, wall time, warning groups and top 20 anomalies, deterministically', () => {
  const dir = sweep(), md = renderReport(dir);
  assert.equal(renderReport(dir), md);
  for (const row of ['| Harness | Scenario | Task | java | go |', '| claude | natural | small | — | FAIL 0/1 · 1.0m |', '| claude | natural | greenfield | PASS 1/1 · 1.0m | — |',
    '| claude | forced | small | PASS 1/2 · 2.0m | — |', '| codex | forced | small | SKIP (codex 0.153.0 != pinned 0.154.0) | — |', '| slow-hook | 26 | 2 |', '| manual-run | 1 | 1 |', '| recovered-error | 2 | 2 |', 'Recovered errors per run: claude-go-natural-1 1, claude-java-forced-2 3.'])
    assert.ok(md.split('\n').includes(row), row);
  const rows = md.split('\n');
  assert.ok(rows.indexOf('| slow-hook | 26 | 2 |') < rows.indexOf('| manual-run | 1 | 1 |'));
  const top = rows.filter(l => /^\d+\. /.test(l));
  assert.equal(top.length, 20);
  assert.equal(top[0], '1. check `gate` [claude-java-forced-2](claude-java-forced-2/): gate in claude-java-forced-2 ([check.exit:4](claude-java-forced-2/check.exit))');
  assert.ok(md.includes('10 more in anomalies.json'));
  assert.equal(writeSweep(dir), md);
  assert.equal(fs.readFileSync(path.join(dir, 'report.md'), 'utf8'), md);
  const merged = json(dir, 'anomalies.json');
  assert.equal(merged.length, 30);
  assert.deepEqual([...new Set(merged.map(a => a.run))], ['claude-go-natural-1', 'claude-java-forced-2']);
});

test('scrub replaces every secret occurrence in text and binary files, skipping .git, node_modules and files over 5 MB', () => {
  const token = `sk-or-v1-${crypto.randomBytes(16).toString('hex')}`, token2 = `sk-ant-oat01-${crypto.randomBytes(8).toString('hex')}`;
  assert.equal(scrub(`a ${token} b ${token} ${token2}`, ['', token, token2]), 'a <redacted> b <redacted> <redacted>');
  assert.equal(scrub('nothing', []), 'nothing');
  const dir = runDir(f => { f['stdout.log'] += cmd('env', `OPENROUTER_API_KEY=${token}`); f['trace.jsonl'][3].error = `auth ${token}`; f['diff.patch'] += `+key=${token}\n`; f['status.json'][0].result.error = token2;
    f['repo/src/main/App.java'] = `// ${token}`; f['repo/.git/config'] = token; f['repo/node_modules/x.js'] = token; f['big.log'] = token + 'x'.repeat(5 * 1024 * 1024); f['bin.dat'] = `\0${token}`; });
  scrubDir(dir, [token, token2, '']);
  for (const f of ['stdout.log', 'trace.jsonl', 'diff.patch', 'status.json', 'repo/src/main/App.java']) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!text.includes(token) && !text.includes(token2) && text.includes('<redacted>'), f);
  }
  for (const f of ['repo/.git/config', 'repo/node_modules/x.js', 'big.log']) assert.ok(fs.readFileSync(path.join(dir, f), 'utf8').includes(token), f);
  // Binaries (e.g. opencode.db) keep their length: each secret byte becomes 'x'.
  assert.deepEqual(fs.readFileSync(path.join(dir, 'bin.dat')), Buffer.from(`\0${'x'.repeat(token.length)}`));
});

test('evidenceRecord: harness, version, model, task, scenario, passed-if-any, attempts with checks and scrubbed normalized trace', () => {
  const secret = `sk-secret-${crypto.randomBytes(6).toString('hex')}`;
  const one = runDir(f => { f['final.txt'] = `done ${secret} ${os.homedir()}/x ${os.homedir()}XYZ`; f['stage/SKILL.md'] = 'skill'; f['stage/scripts/a.cjs'] = 'a'; }), two = runDir(f => { Object.assign(f['meta.json'], { n: 2, ended: 'killed', exitCode: null, endedAt: '2026-09-12T16:40:00.000Z' }); f['check.exit'] = '1\n'; });
  fs.appendFileSync(path.join(one, 'trace.jsonl'), line(ev('PostToolUse', 'allow', { file: [path.join(one, 'repo', T)], error: null, tool: secret })));
  for (const d of [one, two]) writeChecks(d, expected);
  const r = evidenceRecord('codex-java-forced', [two, one], [secret]);
  assert.deepEqual(Object.keys(r), ['harness', 'version', 'model', 'mutagate', 'package', 'lang', 'task', 'scenario', 'passed', 'checked_at', 'attempts']);
  assert.deepEqual([r.harness, r.version, r.model, r.mutagate, r.lang, r.task, r.scenario, r.passed, r.checked_at], ['codex', '0.154.0', 'gpt-5.6-sol', VERSION, 'java', 'small', 'forced', true, '2026-09-12T16:40:00.000Z']);
  // package: sha256 over the sorted relative paths and bytes of the run's packaged stage (what the run installed).
  assert.equal(r.package, packageDigest(path.join(one, 'stage')));
  assert.equal(r.package, crypto.createHash('sha256').update('SKILL.md\0skill\0scripts/a.cjs\0a\0').digest('hex'));
  assert.equal(evidenceRecord('codex-java-forced', [two]).package, null);
  assert.deepEqual(r.attempts.map(a => [a.n, a.ok, a.exit, a.finalCheck, a.duration_ms, a.checks.ended]), [[1, true, 0, 0, 60000, true], [2, false, null, 1, 60000, false]]);
  assert.deepEqual(Object.keys(r.attempts[0]), ['n', 'ok', 'checks', 'exit', 'finalCheck', 'duration_ms', 'finalResponse', 'transcript_sha256', 'trace']);
  assert.equal(r.attempts[0].transcript_sha256, crypto.createHash('sha256').update(fs.readFileSync(path.join(one, 'stdout.log'))).digest('hex'));
  // OpenCode: the hash covers the messages.jsonl export the reader reads (re-prompted turns), not the raw `run` stdout.log.
  const oc = runDir(f => as(f, 'opencode', line({ role: 'user', type: 'text', text: 'go' })));
  assert.equal(evidenceRecord('opencode-java-forced', [oc]).attempts[0].transcript_sha256, crypto.createHash('sha256').update(fs.readFileSync(path.join(oc, 'messages.jsonl'))).digest('hex'));
  assert.equal(r.attempts[0].finalResponse, `done <redacted> ~/x ${os.homedir()}XYZ`);
  assert.equal(r.attempts[0].trace.length, codex.trace.length + 1);
  assert.deepEqual(r.attempts[0].trace.at(-1).file, [`<repo>/${T}`]);
  assert.ok(!JSON.stringify(r).includes(secret));
});

// README harness × language matrix: 5 harness rows × 6 language columns of ✅/⏳/❌; every ✅ needs passing natural and forced evidence records.
function readmeMatrix(md) {
  const lines = md.split('\n'), at = lines.indexOf('| Harness | Java | Kotlin | Python | TypeScript | Go | C# |'), rows = [];
  if (at < 0) return null;
  for (const l of lines.slice(at + 2)) { if (!l.startsWith('|')) break; const [name, ...cells] = l.split('|').slice(1, -1).map(c => c.trim()); rows.push([name.split(/\s/)[0].toLowerCase(), cells]); }
  return rows;
}
const passing = (dir, cell) => axes.scenario.every(s => { try { return JSON.parse(fs.readFileSync(path.join(dir, `${cell}-${s}.json`), 'utf8')).passed === true; } catch { return false; } });
const unbacked = (rows, dir) => rows.flatMap(([h, cells]) => cells.flatMap((c, i) => c === '✅' && !passing(dir, `${h}-${axes.lang[i]}`) ? [`${h}-${axes.lang[i]}`] : []));
test('README matrix: 5 harnesses × 6 languages of ✅/⏳/❌, every ✅ backed by passing natural and forced evidence records', () => {
  const dir = path.join(tmp, 'live'), head = '| Harness | Java | Kotlin | Python | TypeScript | Go | C# |\n|---|---|---|---|---|---|---|\n';
  for (const [f, passed] of [['codex-java-forced', true], ['codex-java-natural', true], ['pi-go-forced', true], ['pi-go-natural', false], ['pi-kotlin-forced', true]]) put(path.join(dir, f + '.json'), JSON.stringify({ passed }));
  const rows = readmeMatrix(`intro\n\n${head}| Codex CLI | ✅ | ⏳ | ❌ | ⏳ | ⏳ | ⏳ |\n| Pi | ⏳ | ✅ | ⏳ | ⏳ | ✅ | ✅ |\n\n| Harness | Pinned |\n|---|---|\n| Claude Code | ✅ |\n`);
  assert.deepEqual(rows.map(r => r[0]), ['codex', 'pi']);
  assert.deepEqual(unbacked(rows, dir), ['pi-kotlin', 'pi-go', 'pi-csharp']);
  const root = new URL('../', import.meta.url), readme = readmeMatrix(fs.readFileSync(new URL('README.md', root), 'utf8'));
  assert.ok(readme, 'README has the harness × language matrix');
  assert.deepEqual(readme.map(r => r[0]), axes.harness);
  for (const [h, cells] of readme) assert.ok(cells.length === axes.lang.length && cells.every(c => ['✅', '⏳', '❌'].includes(c)), `${h}: ${cells.join(' ')}`);
  assert.deepEqual(unbacked(readme, new URL('test/evidence/live/', root).pathname), []);
});
test('every live evidence record holds both runs of its cell (ADR-0011)', () => {
  const dir = new URL('evidence/live/', import.meta.url);
  assert.deepEqual(fs.readdirSync(dir).filter(f => f.endsWith('.json') && JSON.parse(fs.readFileSync(new URL(f, dir), 'utf8')).attempts.length < 2), []);
});

// --variant <name>: tasks/<lang>/prompt.<name>.md replaces the natural prompt of the small task; cells get a suffix and no evidence record is written.
test('parseArgs --variant: one lowercase name, scenario defaults to natural, forced and greenfield are rejected', () => {
  const f = parseArgs(['--variant', 'pbt', '--harness', 'claude', '--lang', 'python']);
  assert.equal(f.variant, 'pbt');
  assert.deepEqual(f.scenario, ['natural']);
  assert.deepEqual(parseArgs(['--variant=pbt-2', '--scenario', 'natural']).variant, 'pbt-2');
  for (const argv of [['--variant', 'pbt', '--scenario', 'forced'], ['--scenario', 'forced', '--variant', 'pbt'], ['--variant', 'pbt', '--scenario', 'natural,forced'], ['--variant', 'pbt', '--task', 'greenfield'], ['--task', 'greenfield', '--variant', 'pbt']])
    assert.throws(() => parseArgs(argv), /^Error: --variant applies to the small task, natural scenario$/, argv.join(' '));
  for (const name of ['Pbt!', 'PBT', '1pbt', '-pbt', 'p_bt', 'pbt.md', 'a b']) assert.throws(() => parseArgs(['--variant', name]), /--variant must match/, name);
  assert.throws(() => parseArgs(['--variant']), /--variant needs a value/);
  const plain = parseArgs(['--harness', 'claude', '--lang', 'python']);
  assert.equal(plain.variant, undefined);
  assert.ok(!('variant' in plain), 'no variant key without --variant');
  assert.deepEqual(plain.scenario, axes.scenario);
});
test('planSweep --variant: cell and run names carry the suffix, every run carries variant, preflight sees it, nothing changes without it', () => {
  const config = { repeat: 2, models: { claude: 'm' } }, preflight = () => null, argv = ['--harness', 'claude', '--lang', 'python'];
  const plan = planSweep({ flags: parseArgs([...argv, '--variant', 'pbt']), config, preflight });
  assert.deepEqual(plan.map(r => [r.name, r.cell, r.variant]), [1, 2].map(n => [`claude-python-natural-pbt-${n}`, 'claude-python-natural-pbt', 'pbt']));
  assert.deepEqual(plan[0], { name: 'claude-python-natural-pbt-1', cell: 'claude-python-natural-pbt', harness: 'claude', lang: 'python', scenario: 'natural', task: 'small', n: 1, model: 'm', skip: null, variant: 'pbt' });
  const seen = [];
  planSweep({ flags: parseArgs([...argv, '--variant', 'pbt', '--repeat', '3']), config, preflight: (...a) => (seen.push(a), 'prompt missing') }).forEach(r => assert.equal(r.skip, 'prompt missing'));
  assert.deepEqual(seen, [['claude', 'python', 'small', 'pbt']]);
  const plain = planSweep({ flags: parseArgs(argv), config, preflight });
  assert.deepEqual(plain.map(r => r.name), ['claude-python-natural-1', 'claude-python-natural-2', 'claude-python-forced-1', 'claude-python-forced-2']);
  assert.ok(plain.every(r => r.variant === undefined && !('variant' in r)), 'no variant key without --variant');
});
test('python pbt prompt variant is the natural prompt plus the Hypothesis nudge, and Hypothesis is pinned in the dev group', () => {
  const task = new URL('eval/tasks/python/', import.meta.url), read = f => fs.readFileSync(new URL(f, task), 'utf8');
  const nudge = ' Hypothesis is installed; use property-based tests with @given wherever they fit, alongside example tests.';
  assert.equal(read('prompt.pbt.md'), read('prompt.natural.md').replace('Make sure `uv run pytest -q` passes.\n', `Make sure \`uv run pytest -q\` passes.${nudge}\n`));
  assert.notEqual(read('prompt.pbt.md'), read('prompt.natural.md'));
  assert.match(read('pyproject.toml'), /^dev = \[.*"hypothesis==\d+\.\d+\.\d+".*\]$/m);
  assert.ok(read('.gitignore').split('\n').includes('.hypothesis/'));
});
test('evidence records carry no home paths, API keys or GitHub tokens', () => {
  const dir = new URL('evidence/', import.meta.url), leak = /\/Users\/[^/;\s\]]+\/|\/home\/[a-z]|sk-[A-Za-z0-9-]{10,}|github_pat_\w{20,}|\bgh[opsur]_[A-Za-z0-9]{20,}/;
  for (const t of [`github_pat_${'11AB0'.repeat(5)}_${'x'.repeat(40)}`, ...['ghp', 'gho', 'ghs', 'ghu', 'ghr'].map(p => `${p}_${'A1b2'.repeat(9)}`), `sk-or-v1-${'f00d'.repeat(4)}`]) assert.match(`key ${t}`, leak, t);
  const files = fs.readdirSync(dir, { recursive: true }).map(String).filter(f => f.endsWith('.json'));
  assert.ok(files.includes('codex-async.json') && files.some(f => f.startsWith('live/')));
  for (const f of files) assert.doesNotMatch(fs.readFileSync(new URL(f, dir), 'utf8'), leak, f);
});

// Copilot driver (#35 D29, D30): parse, model and README row; preflight under the driver env; tokens only in its env; launch; the scrub of every run artifact.
test('copilot is an eval harness: --harness copilot, model claude-sonnet-5, README matrix row Copilot CLI', () => {
  assert.deepEqual(parseArgs(['--harness', 'copilot']).harness, ['copilot']);
  const config = JSON.parse(fs.readFileSync(new URL('./eval/config.json', import.meta.url), 'utf8'));
  assert.equal(config.models.copilot, 'claude-sonnet-5');
  assert.deepEqual(planSweep({ flags: parseArgs(['--harness', 'copilot', '--lang', 'java', '--scenario', 'forced']), config: { ...config, repeat: 1 }, preflight: () => null }).map(r => [r.name, r.model]), [['copilot-java-forced-1', 'claude-sonnet-5']]);
  assert.match(fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8'), /^\| Copilot CLI \|/m);
});
// process.env as it was before a test's first override, restored once after it (t.after hooks run in registration order, so per-override restores would leave a middle value).
const envs = new WeakMap(), saveEnv = t => { if (envs.has(t)) return; const env = { ...process.env }; envs.set(t, env); t.after(() => { for (const k of Object.keys(process.env)) if (!(k in env)) delete process.env[k]; Object.assign(process.env, env); }); };
const fake = (t, script) => { saveEnv(t); const bin = fs.mkdtempSync(path.join(tmp, 'bin-')); fs.writeFileSync(path.join(bin, 'copilot'), `#!/bin/sh\n${script}\n`, { mode: 0o755 }); process.env.PATH = bin; return path.join(bin, 'copilot'); };
const envVar = (t, k, v) => { saveEnv(t); if (v === undefined) delete process.env[k]; else process.env[k] = v; };
test('Copilot preflight: copilot --version under the driver env names the pin; a set classic ghp_ token skips', t => {
  const pin = JSON.parse(fs.readFileSync(new URL('./harness-versions.json', import.meta.url), 'utf8')).packages['@github/copilot'], seen = path.join(tmp, 'seen-home');
  // The launcher names its own version unless the driver env (a fresh COPILOT_HOME, auto-update off) selects the package a run executes.
  const exe = fake(t, `echo "$COPILOT_HOME" > ${seen}; [ -d "$COPILOT_HOME" ] && [ -d "$COPILOT_CACHE_HOME" ] && [ "$COPILOT_AUTO_UPDATE" = false ] && echo "GitHub Copilot CLI ${pin}." || echo "GitHub Copilot CLI 1.0.104."`);
  envVar(t, 'COPILOT_GITHUB_TOKEN', undefined);
  assert.deepEqual(harnesses.copilot.preflight({ env: { PATH: '/usr/bin:/bin' } }), { exe, version: pin });
  assert.ok(!fs.existsSync(fs.readFileSync(seen, 'utf8').trim()), 'the probe home is deleted');
  envVar(t, 'COPILOT_GITHUB_TOKEN', `github_pat_${'11AB0'.repeat(5)}`);
  assert.deepEqual(harnesses.copilot.preflight({ env: {} }), { exe, version: pin });
  envVar(t, 'COPILOT_GITHUB_TOKEN', `ghp_${'A1b2'.repeat(9)}`);
  assert.match(harnesses.copilot.preflight({ env: {} }).reason, /COPILOT_GITHUB_TOKEN is a classic ghp_ token/);
  envVar(t, 'COPILOT_GITHUB_TOKEN', undefined);
  fake(t, 'echo "GitHub Copilot CLI 1.0.104."');
  assert.deepEqual(harnesses.copilot.preflight({ env: {} }), { reason: `copilot version "GitHub Copilot CLI 1.0.104." is not pin ${pin}` });
});
test('agentEnv has no COPILOT_*, GH_TOKEN or GITHUB_TOKEN; only the Copilot driver env carries COPILOT_GITHUB_TOKEN, when set', t => {
  const token = `github_pat_${'22CD0'.repeat(5)}`, runDir = fs.mkdtempSync(path.join(tmp, 'env-'));
  for (const [k, v] of [['COPILOT_GITHUB_TOKEN', token], ['COPILOT_HOME', '/x'], ['COPILOT_ALLOW_ALL', 'true'], ['GH_TOKEN', 'gh'], ['GITHUB_TOKEN', 'gh']]) envVar(t, k, v);
  assert.deepEqual(Object.keys(agentEnv()).filter(k => /^COPILOT_|^GH_TOKEN$|^GITHUB_TOKEN$/.test(k)), []);
  for (const h of axes.harness.filter(h => h !== 'copilot')) assert.ok(!Object.values(harnesses[h].env({ runDir, repo: runDir })).includes(token), h);
  const d = s => path.join(runDir, 'copilot', s);
  assert.deepEqual(harnesses.copilot.env({ runDir }), { COPILOT_HOME: d('home'), COPILOT_CACHE_HOME: d('cache'), COPILOT_AUTO_UPDATE: 'false', COPILOT_GITHUB_TOKEN: token });
  envVar(t, 'COPILOT_GITHUB_TOKEN', undefined);
  assert.ok(!('COPILOT_GITHUB_TOKEN' in harnesses.copilot.env({ runDir })));
});
test('Copilot launch: -p with the D29 flags in the repo, done at exit; the per-run COPILOT_HOME and cache are transient', async t => {
  const runDir = fs.mkdtempSync(path.join(tmp, 'run-')), repo = fs.mkdtempSync(path.join(tmp, 'repo-')), transcript = path.join(import.meta.dirname, 'eval/transcripts/copilot/stdout.log');
  const exe = fake(t, `printf '%s\\n' "$@" > argv.txt; echo "$COPILOT_HOME" > home.txt; touch "$COPILOT_HOME/state"; cat ${transcript}`);
  const env = { PATH: '/usr/bin:/bin', ...harnesses.copilot.env({ runDir }) };
  assert.deepEqual(await harnesses.copilot.launch({ exe, repo, runDir, prompt: 'write tests', model: 'claude-sonnet-5', env, timeoutMs: 60000, config: { settleMs: 20000 } }), { exitCode: 0, ended: 'exit' });
  assert.deepEqual(fs.readFileSync(path.join(repo, 'argv.txt'), 'utf8').trim().split('\n'), ['-p', 'write tests', '--output-format', 'json', '--trust-folder', '--allow-all', '--no-ask-user', '--no-auto-update',
    '--disable-builtin-mcps', '--log-dir', path.join(runDir, 'copilot-logs'), '--model', 'claude-sonnet-5']);
  assert.equal(fs.readFileSync(path.join(repo, 'home.txt'), 'utf8').trim(), path.join(runDir, 'copilot/home'));
  assert.equal(fs.readFileSync(path.join(runDir, 'stdout.log'), 'utf8'), s11);
  dropTransient({ harness: 'copilot', dir: runDir });
  assert.ok(!fs.existsSync(path.join(runDir, 'copilot')), 'per-run COPILOT_HOME and COPILOT_CACHE_HOME deleted');
});
// D29 done rule, second half: a spawned --mutate handler (a detached process running the repo's skill scripts) outlives -p, and launch waits for it.
test('Copilot launch: after -p exits, waits until no mutagate process of the repo is alive (needs ps)', { skip: !spawnSync('ps', ['-Aww', '-o', 'args='], { encoding: 'utf8' }).stdout && 'ps unavailable (sandbox)' }, async () => {
  const runDir = fs.mkdtempSync(path.join(tmp, 'run-')), repo = fs.mkdtempSync(path.join(tmp, 'repo-')), done = path.join(runDir, 'handler-done'), bin = fs.mkdtempSync(path.join(tmp, 'bin-'));
  const hook = path.join(repo, harnesses.copilot.skillDir, 'scripts/mutagate-hook.cjs'), exe = path.join(bin, 'copilot');
  put(hook, `setTimeout(() => require('fs').writeFileSync(process.argv[2], ''), 2500);`);
  fs.writeFileSync(exe, `#!/bin/sh\n"${process.execPath}" -e "require('child_process').spawn(process.execPath, ['${hook}', '${done}'], { detached: true, stdio: 'ignore' }).unref()"\n`, { mode: 0o755 });
  assert.deepEqual(await harnesses.copilot.launch({ exe, repo, runDir, prompt: 'p', model: 'm', env: { PATH: '/usr/bin:/bin' }, timeoutMs: 60000, config: {} }), { exitCode: 0, ended: 'exit' });
  assert.ok(fs.existsSync(done), 'launch returned while the handler was still running');
});
test('GitHub tokens are scrubbed without a secret value: text, binaries, stdout.log and copilot-logs/ over 5 MB, login and home paths, the cacheRoot data and recorded payloads, evidence', () => {
  const pat = `github_pat_${'11AB0'.repeat(5)}_${crypto.randomBytes(20).toString('hex')}`, gho = `gho_${crypto.randomBytes(18).toString('hex')}`, big = 'x'.repeat(5 * 1024 * 1024);
  assert.equal(scrub(`a ${pat} b ${gho}`, []), 'a <redacted> b <redacted>');
  const dir = runDir(f => { f['stdout.log'] += cmd('env', `COPILOT_GITHUB_TOKEN=${pat}`) + big; f['bin.dat'] = `\0${gho}`; f['final.txt'] = `done ${pat}`; f['big.log'] = pat + big;
    f['copilot-logs/process-1.log'] = `${pat} account: "https://github.com:octo-cat:github" ${os.homedir()}/Library/x\n${big}`; });
  scrubDir(dir, []);
  for (const f of ['stdout.log', 'final.txt']) assert.ok(!fs.readFileSync(path.join(dir, f), 'utf8').includes(pat), f);
  assert.deepEqual(fs.readFileSync(path.join(dir, 'bin.dat')), Buffer.from(`\0${'x'.repeat(gho.length)}`));
  assert.equal(fs.readFileSync(path.join(dir, 'copilot-logs/process-1.log'), 'utf8').split('\n')[0], '<redacted> account: "https://github.com:<login>:github" ~/Library/x');
  assert.ok(fs.readFileSync(path.join(dir, 'big.log'), 'utf8').startsWith(pat), 'other files over 5 MB are skipped');
  scrubDir(path.join(dir, 'gone'), []); // a dir a worker deleted mid-walk
  // The run's cacheRoot data dir (trace, results, runner logs) and its recorded payloads in the shared recorded/ dir (named by repo path, since its start) are scrubbed in place.
  const data = path.join(tmp, 'cache-data'), rec = path.join(tmp, 'recorded'), repo = path.join(tmp, 'eval-repo'), since = Date.now() - 1000, at = f => path.join(rec, 'copilot', f);
  for (const f of [path.join(data, 'trace.jsonl'), path.join(data, 'logs/t.log')]) put(f, `{"x":"${pat}"}\n`);
  for (const [f, cwd] of [['PostToolUse-1.json', repo], ['PostToolUse-2.json', path.join(tmp, 'other-repo')], ['PostToolUse-3.json', repo]]) put(at(f), `{"cwd":${JSON.stringify(cwd)},"x":"${pat}"}\n`);
  fs.utimesSync(at('PostToolUse-3.json'), new Date(since - 60000), new Date(since - 60000));
  scrubRun({ dir, repo, data, rec, since }, []);
  for (const f of [path.join(data, 'trace.jsonl'), path.join(data, 'logs/t.log')]) assert.equal(fs.readFileSync(f, 'utf8'), '{"x":"<redacted>"}\n', f);
  assert.equal(fs.readFileSync(at('PostToolUse-1.json'), 'utf8'), `{"cwd":${JSON.stringify(repo)},"x":"<redacted>"}\n`);
  for (const f of ['PostToolUse-2.json', 'PostToolUse-3.json']) assert.ok(fs.readFileSync(at(f), 'utf8').includes(pat), `${f}: payloads of other runs are left alone`);
  const fresh = runDir(f => { f['final.txt'] = `done ${pat}`; f['trace.jsonl'][3].error = `auth ${gho}`; });
  assert.doesNotMatch(JSON.stringify(evidenceRecord('codex-java-forced', [fresh])), /github_pat_|gho_/);
});
test('SIGINT, SIGTERM and SIGHUP kill the sweep after deleting per-run Copilot homes and scrubbing every started run', () => {
  const pat = `github_pat_${'33EF0'.repeat(5)}_${crypto.randomBytes(20).toString('hex')}`, secret = `sk-or-v1-${crypto.randomBytes(16).toString('hex')}`, run = new URL('./eval/run.mjs', import.meta.url).href;
  for (const [sig, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) {
    // A run killed mid-agent: its recorded payloads are found in the shared dir, not handed over by collection.
    const dir = fs.mkdtempSync(path.join(tmp, `sig-${sig}-`)), rec = fs.mkdtempSync(path.join(tmp, `rec-${sig}-`)), started = { harness: 'copilot', dir, repo: path.join(dir, 'r'), data: path.join(dir, 'd'), rec, since: 0 };
    for (const f of ['stdout.log', 'r/a.txt', 'd/trace.jsonl']) put(path.join(dir, f), `${pat} ${secret}\n`);
    put(path.join(rec, 'copilot/PostToolUse-1.json'), `${pat} ${started.repo}\n`);
    put(path.join(dir, 'copilot/home/session-state/events.jsonl'), pat);
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', `const { trap } = await import(${JSON.stringify(run)}); trap([${JSON.stringify(started)}], [${JSON.stringify(secret)}]); process.kill(process.pid, '${sig}'); setTimeout(() => {}, 9000);`], { encoding: 'utf8' });
    assert.equal(r.status, code, sig + r.stderr);
    for (const f of ['stdout.log', 'r/a.txt', 'd/trace.jsonl']) assert.equal(fs.readFileSync(path.join(dir, f), 'utf8'), '<redacted> <redacted>\n', `${sig} ${f}`);
    assert.equal(fs.readFileSync(path.join(rec, 'copilot/PostToolUse-1.json'), 'utf8'), `<redacted> ${started.repo}\n`, sig);
    assert.ok(!fs.existsSync(path.join(dir, 'copilot')), sig);
  }
});
