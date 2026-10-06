// Live eval checker: reads one run dir (see docs/eval_suite_spec.md "Run directory contract") plus the task's expected.json.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { DEFAULTS, targetKey, NO_MUTANTS, VERSION } from '../../scripts/mutagate.mjs';
// run.mjs imports this module: use ids only inside functions (TDZ when run.mjs is the entry).
import { ids } from './run.mjs';
const { glob } = createRequire(import.meta.url)('../../scripts/glob.cjs');
export const HARD = ['ended', 'session-start', 'registration', 'targets-scored', 'no-errors', 'gate', 'forced-order', 'skill-modified'];
export const WARN = ['prod-changed', 'waiver', 'manual-run', 'source-read', 'slow-hook', 'stale-deleted', 'unconfirmed-claim', 'test-command-red', 'tiny-mutants', 'async-missing', 'recovered-error', 'unscored-final', 'scaffold-unregistered'];
const HOOKS = ['SessionStart', 'PreToolUse', 'PostToolUse', 'Stop', 'SubagentStop', 'TaskCompleted'];
const read = (dir, f) => { try { return fs.readFileSync(path.join(dir, f), 'utf8'); } catch { return ''; } };
const json = (dir, f, d) => { try { return JSON.parse(read(dir, f)); } catch { return d; } };
const ev = (file, line, text) => ({ file, line, text: String(text).slice(0, 300) });
const grep = (dir, file, re) => read(dir, file).split('\n').flatMap((l, i) => re.test(l) ? [ev(file, i + 1, l)] : []);
const matches = (globs = [], f) => globs.some(g => glob(g).test(f));
// An agent CLI call: a path ending in /mutagate[.mjs|.cmd] not quoted in backticks (skill docs) and not bare "mutagate check" (hook messages).
const CLI = /(?:^|[\s"'=(])[\w./~-]*\/mutagate(?:\.mjs|\.cmd)?\s+(run|check|status|waive)\b([^\n"`;&|]*)/;
// Executed shell commands from harness envelopes (Claude tool_use Bash, Codex command_execution, OpenCode bash part, Pi tool_execution_start) or a bare top-level
// command (hook lines, canned runs). Codex started/completed pairs dedupe by id; Pi message_end/turn_end/agent_end replays nest toolCalls and are never read. i = stdout line index.
const commands = lines => { const seen = new Set(); return lines.flatMap((l, i) => { let o; try { o = JSON.parse(l); } catch {} if (!o || typeof o !== 'object') return [];
  const c = o.type === 'assistant' ? [o.message?.content].flat().filter(p => p?.type === 'tool_use' && p.name === 'Bash').map(p => [p.id, p.input?.command])
    : o.item?.type === 'command_execution' ? [[o.item.id, o.item.command]] : o.type === 'tool' && o.tool === 'bash' ? [[o.callID, o.state?.input?.command]]
    : o.type === 'tool_execution_start' && o.toolName === 'bash' ? [[o.toolCallId, o.args?.command]] : [[null, o.command]];
  return c.filter(([id, cmd]) => typeof cmd === 'string' && (!id || !seen.has(id) && seen.add(id))).map(([, text]) => ({ text, i, ev: ev('stdout.log', i + 1, l) })); }); };
const ASSERT = /Assert|assert|expect|should|Verify|require|t\.(?:Error|Fatal|Fail)|pytest\.raises/, DELETE = /\b(?:rm|mv)\b/;
const SOURCE = /(?:"(?:file_path|filePath|path)"\s*:\s*"|(?:^|[\s"'])(?:cat|sed|head|tail|less|more|grep|rg|awk|nl|bat)\s(?:(?!\\n)[^\n"])*?)(?:(?!\\n)[^\n"])*?(?:mutagate\.mjs|mutagate-hook\.cjs|adapters\/(?:opencode\.js|pi\.ts)|scripts\/(?:inputs|glob|kotlin-source|errors|dotnet|mutmut-bridge)\.cjs)(?![^\n"]*>\s*\/dev\/null)/;
// Negated statements ("does not meet the threshold", "mutation testing has not passed") are not claims.
const PASS_CLAIM = /\bmutation(?:(?!\bnot\b|\bnever\b|n't\b|\bfail)[^\n.]){0,40}?\b(?:pass(?:es|ed|ing)?|green|above (?:the )?threshold)\b|\ball (?:the )?(?:mutants|survivors) (?:were |are )?killed\b|\bgate (?:pass(?:es|ed)|is green|released)\b|(?<!(?:\bnot|\bnever|n't|\bfail(?:s|ed)? to)\s+(?:\w+\s+){0,2})\b(?:pass(?:es|ed)?|exceed(?:s|ed)?|above|meets?) (?:the )?(?:\d+(?:\.\d+)?%? )?threshold\b/i;
// Target-less CLI usage mistakes that run dirs from before the engine stopped tracing them hold (run on a bad path, waive without an id).
const USAGE = /^(?:test file is missing or outside repository|waive requires |survivor not found in fresh session results|--wait must be a nonnegative number)/;

export function checkRun(runDir, expected) {
  const run = path.basename(runDir), meta = json(runDir, 'meta.json', {}), status = [json(runDir, 'status.json', [])].flat(), checkExit = read(runDir, 'check.exit').trim();
  const trace = read(runDir, 'trace.jsonl').split('\n').flatMap((l, i) => { try { return [{ ...JSON.parse(l), _ev: ev('trace.jsonl', i + 1, l) }]; } catch { return []; } });
  const out = read(runDir, 'stdout.log').split('\n'), or = (list, ...fallback) => list.length ? list : [ev(...fallback)];
  const changed = [];
  read(runDir, 'diff.patch').split('\n').forEach((l, i) => {
    const m = l.match(/^diff --git a\/.+ b\/(.+)$/);
    if (m) changed.push({ file: m[1], ev: ev('diff.patch', i + 1, l) });
    else if (l.startsWith('deleted file mode') && changed.length) changed.at(-1).deleted = true;
  });
  const checks = [], anomalies = [];
  const hard = (id, passed, evidence, message) => { checks.push({ id, passed, evidence: evidence.map(e => `${e.file}:${e.line}: ${e.text}`) }); if (!passed) anomalies.push({ kind: 'check', id, message, run, evidence }); };
  const warn = (id, evidence, message) => { if (evidence.length) anomalies.push({ kind: 'warning', id, message, run, evidence }); };

  hard('ended', ['exit', 'idle'].includes(meta.ended), or(grep(runDir, 'meta.json', /"ended"/), 'meta.json', 0, `ended=${meta.ended}`), `run ended by ${meta.ended}`);
  const starts = trace.filter(e => e.event === 'SessionStart');
  hard('session-start', starts.some(e => e.harness === meta.harness), or(starts.map(e => e._ev), 'trace.jsonl', 0, 'no SessionStart event'),
    starts.length ? `SessionStart harness ${[...new Set(starts.map(e => e.harness))].join(', ')}, expected ${meta.harness}` : 'no SessionStart in trace');
  let repo = null;
  try { repo = fs.realpathSync(path.join(runDir, 'repo')); } catch {}
  const tests = changed.filter(d => !d.deleted && matches(expected.testFiles, d.file) && !/(^|\/)(__init__|conftest)\.py$/.test(d.file) && (!repo || fs.statSync(path.join(repo, d.file), { throwIfNoEntry: false })?.size !== 0)),
    unregistered = tests.filter(d => !status.some(s => s.tests?.includes(d.file)) && !trace.some(e => e.event === 'PostToolUse' && [e.file].flat().some(f => typeof f === 'string' && ('/' + f.replaceAll('\\', '/')).endsWith('/' + d.file))));
  const scaffold = unregistered.filter(d => repo && fs.existsSync(path.join(repo, d.file)) && !ASSERT.test(read(repo, d.file))), missing = unregistered.filter(d => !scaffold.includes(d));
  hard('registration', !missing.length, or((missing.length ? missing : tests).map(d => d.ev), 'diff.patch', 0, 'no test files in diff'),
    `test files without a PostToolUse registration: ${missing.map(d => d.file).join(', ')}`);
  warn('scaffold-unregistered', scaffold.map(d => d.ev), `assertion-free test scaffolds (outside the adapters' Write/Edit observation) without a PostToolUse registration: ${scaffold.map(d => d.file).join(', ')}`);
  const suffix = (a, b) => ('/' + a).endsWith('/' + b),
    unscored = expected.targets.map(t => [t, status.find(s => s.target === t.target || s.file && (suffix(s.file, t.file) || suffix(t.file, s.file)))]).filter(([, s]) => typeof s?.result?.score !== 'number');
  hard('targets-scored', !unscored.length, or(unscored.map(([t, s]) => ev('status.json', 1, `${t.target}: ${!s ? 'unresolved (not in status)' : `unscored${s.stale ? ' stale' : ''}${s.result?.status ? ' ' + s.result.status : ''}`}`)), 'status.json', 1, `${expected.targets.length} targets scored`),
    `expected targets not scored: ${unscored.map(([t, s]) => `${t.target} (${s ? 'unscored' : 'unresolved'})`).join(', ')}`);
  let logs = [];
  try { logs = fs.readdirSync(path.join(runDir, 'runner-logs'), { recursive: true }).map(String).filter(f => fs.statSync(path.join(runDir, 'runner-logs', f)).isFile()); } catch {}
  // Superseded (recovered): a trace error followed by a scored Result for the same target, or a runner-log kill (logs/<targetKey>[.prev].log) whose target's final status is scored.
  // status.json errors, check exit 3 and target-less hook errors never are. Old CLI usage errors (USAGE) are the agent's mistakes, not errors; worker and other CLI errors are.
  const done = r => !!r && (typeof r.score === 'number' && (r.status ?? r.decision) !== 'error' && !r.error || (r.status ?? r.decision) === 'unscored' && String(r.error).startsWith(NO_MUTANTS)), logTarget = f => status.find(s => targetKey(s) === path.basename(f, '.log').replace(/\.prev$/, ''))?.target;
  const errs = [...trace.flatMap((e, k) => e.error && !(e.event === 'Result' && ['unscored', 'stale'].includes(e.decision)) && (HOOKS.includes(e.event) || e.event === 'Result' || !USAGE.test(e.error)) ? [[e._ev, typeof e.target === 'string' && trace.some((x, j) => j > k && x.event === 'Result' && x.target === e.target && done(x))]] : []),
    ...status.filter(s => s.result?.status === 'error').map(s => [ev('status.json', 1, `${s.target}: ${s.result.status}: ${s.result.error}`), false]),
    ...(checkExit === '3' ? [[ev('check.exit', 1, 'check exit 3 (infrastructure error)'), false]] : []),
    ...logs.flatMap(f => read(path.join(runDir, 'runner-logs'), f).split('\n').flatMap((l, i) => { try { const x = JSON.parse(l), t = logTarget(f); return x.signal ? [[ev(`runner-logs/${f}`, i + 1, `${x.exe} ${[x.args].flat().join(' ')} killed by ${x.signal}`), !!t && status.some(s => s.target === t && done(s.result))]] : []; } catch { return []; } }))];
  const errors = errs.filter(([, ok]) => !ok).map(([e]) => e), recovered = errs.filter(([, ok]) => ok).map(([e]) => e);
  hard('no-errors', !errors.length, errors, `${errors.length} internal or infrastructure error(s)`);
  warn('recovered-error', recovered, `${recovered.length} error(s) superseded by a later scored or no-mutants result for the same target`);
  // Per-target cap: every below target was blocked DEFAULTS.maxRounds times (status.json blocks; tasks do not override maxRounds). No below target and no exit 0 fails.
  const belowT = status.filter(s => s.result?.status === 'below'), short = belowT.filter(s => (s.blocks || 0) < DEFAULTS.maxRounds);
  hard('gate', checkExit === '0' || belowT.length > 0 && !short.length, [ev('check.exit', 1, checkExit || 'missing'), ...belowT.map(s => ev('status.json', 1, `${s.target}: below, blocks ${s.blocks || 0}`))],
    `check exited ${checkExit || 'missing'}${belowT.length ? `; below the block cap ${DEFAULTS.maxRounds}: ${short.map(s => `${s.target} (blocks ${s.blocks || 0})`).join(', ')}` : ' with no below target'}`);
  if (meta.scenario === 'forced') {
    const at = (from, event, decision) => trace.findIndex((e, k) => k > from && e.event === event && e.decision === decision);
    const i = at(-1, 'Stop', 'block'), j = i < 0 ? -1 : at(i, 'Result', 'pass'), k = j < 0 ? -1 : at(j, 'Stop', 'allow');
    hard('forced-order', k >= 0, or([i, j, k].filter(x => x >= 0).map(x => trace[x]._ev), 'trace.jsonl', 0, 'no Stop block'), 'no Stop block -> Result pass -> Stop allow sequence in trace');
  }

  const modified = grep(runDir, 'skill-diff.txt', /\S/);
  hard('skill-modified', !modified.length, modified, 'installed skill files differ from the staged package');

  warn('prod-changed', changed.filter(d => matches(expected.prodFiles, d.file) && !matches(expected.testFiles, d.file) && !matches(expected.expectedProdEdits, d.file)).map(d => d.ev), 'production files changed beyond the prompt');
  const cmds = commands(out), cli = cmds.flatMap(c => { const m = c.text.match(CLI); return m ? [{ cmd: m[1], args: m[2], i: c.i, ev: c.ev }] : []; });
  warn('waiver', [...trace.filter(e => [e.file].flat().some(f => String(f).endsWith('.mutagate/waivers.json'))).map(e => e._ev), ...changed.filter(d => d.file.endsWith('.mutagate/waivers.json')).map(d => d.ev),
    ...cli.filter(c => c.cmd === 'waive').map(c => c.ev), ...grep(runDir, 'stdout.log', /Waivers require human approval(?!\. Proposed: \$\{)/)], 'waiver proposed or applied');
  warn('manual-run', cli.filter(c => c.cmd === 'run' && /--sync\b|--target\s+[^<\s]/.test(c.args)).map(c => c.ev), 'agent ran mutagate run --target/--sync by hand');
  warn('source-read', grep(runDir, 'stdout.log', SOURCE), 'agent read mutagate source');
  // Async --mutate PostToolUse handlers (trace mutate: true) wait >= 6 s of quiet by design.
  warn('slow-hook', trace.filter(e => HOOKS.includes(e.event) && e.duration_ms > 1000 && !(e.event === 'PostToolUse' && e.mutate === true)).map(e => e._ev), 'hook slower than 1 s');
  // Unresolved messages name test files (not the ${test} template of mutagate source dumped by sed/grep); pending/stale messages (gate, run --sync, status) name targets, mapped to files via status.json, expected.targets or a path-like id.
  const fileOf = t => status.find(s => s.target === t)?.file || expected.targets.find(x => x.target === t)?.file || (t.includes('/') ? t : null);
  const named = (f, l, i) => [...[...l.matchAll(/target unresolved for ([^\s"\\]+?)\. Candidates/g)].map(m => [m[1], m[0]]), ...[...l.matchAll(/(?:mutagate: ([^\s"\\]+) (?:infrastructure error: |could not be scored: )?results pending|(?<=^|[\s"']|\\n)([^\s"\\]+): (?:unscored|error|score [\d.]+ \(\d+\/\d+\), \w+) stale\b)/g)].map(m => [fileOf(m[1] || m[2]), m[0]])]
    .filter(([file]) => file && !file.includes('${') && !fs.existsSync(path.join(repo, file))).map(([file, frag]) => ({ file, frag, i, ev: ev(f, i + 1, l) }));
  const found = !repo ? [] : ['stdout.log', 'check.json'].flatMap(f => read(runDir, f).split('\n').flatMap((l, i) => named(f, l, i))), deletedAt = file => cmds.find(c => DELETE.test(c.text) && c.text.includes(path.basename(file)))?.i ?? -1;
  const gone = found.filter(g => { const d = g.ev.file === 'check.json' ? -1 : deletedAt(g.file); return d < 0 || g.i > d && !found.some(x => x.ev.file === 'stdout.log' && x.file === g.file && x.frag === g.frag && x.i <= d); });
  warn('stale-deleted', gone.map(g => g.ev), `unresolved/stale messages for files no longer in the repo: ${[...new Set(gone.map(g => g.file))].join(', ')}`);
  const final = read(runDir, 'final.txt'), confirmed = new Set([...status.map(s => s.result?.score), ...[...read(runDir, 'check.json').matchAll(/score (\d+\.\d+)/g)].map(m => +m[1])].filter(x => typeof x === 'number').map(x => x.toFixed(2)));
  warn('unconfirmed-claim', final.split('\n').flatMap((l, i) => PASS_CLAIM.test(l) && checkExit !== '0' || [...l.matchAll(/\bscores?\b[^\n\d]{0,20}?(\d+(?:\.\d+)?)\s?(%)?/gi)]
    .some(m => { const v = m[2] ? m[1] / 100 : +m[1]; return v <= 1 && v !== DEFAULTS.threshold && !confirmed.has(v.toFixed(2)); }) ? [ev('final.txt', i + 1, l)] : []), `final text claims a pass or score that check (exit ${checkExit || 'missing'}) does not confirm`);
  const testExit = read(runDir, 'test-command.exit').trim();
  warn('test-command-red', testExit === '0' ? [] : [ev('test-command.exit', 1, testExit || 'missing'), ...read(runDir, 'test-command.log').split('\n').map((l, i) => ev('test-command.log', i + 1, l)).filter(e => e.text.trim()).slice(-3)],
    `task test command exited ${testExit || 'missing'}`);
  warn('unscored-final', status.filter(s => s.result?.status === 'unscored' && s.result.error).map(s => ev('status.json', 1, `${s.target}: ${s.result.error}`)), 'final unscored targets');
  warn('tiny-mutants', status.filter(s => s.result && !['error', 'unscored'].includes(s.result.status) && (s.result.killed || 0) + (s.result.survived || 0) < 5)
    .map(s => ev('status.json', 1, `${s.target}: ${(s.result.killed || 0) + (s.result.survived || 0)} mutants`)), 'fewer than 5 mutants on a target');
  // Only a run/check call after the first stdout mention of a registered test file counts (status/waive/install before any test are not).
  // User-role lines are skipped: OpenCode and Pi echo the prompt, which can name the test file before it exists.
  const runs = cli.filter(c => ['run', 'check'].includes(c.cmd)), first = runs[0], registered = tests.filter(d => !unregistered.includes(d)), mention = out.findIndex(l => !l.includes('"role":"user"') && registered.some(d => l.includes(d.file)));
  // Nothing to deliver: there were Results before the first agent CLI call and all passed (no Result at all still warns). CLI calls trace a cli event
  // in the hook session; older run dirs mark them only by a non-hook session.
  const hookSessions = new Set(trace.filter(e => HOOKS.includes(e.event)).map(e => e.session)), explicitCli = trace.findIndex(e => e.decision === 'cli' && ['run', 'check'].includes(e.event)), cliAt = explicitCli >= 0 ? explicitCli : trace.findIndex(e => !hookSessions.has(e.session)),
    pre = trace.slice(0, cliAt < 0 ? trace.length : cliAt), early = [...new Map(pre.filter(e => e.event === 'Result' && e.decision !== 'stale').map(e => [e.target, e])).values()];
  const delivered = early.length && early.every(e => e.decision === 'pass') || pre.some(e => e.event === 'PostToolUse' && e.delivered === true) || trace.some(e => e.event === 'PostToolUse' && e.decision === 'block') || first && out.slice(0, first.i).some(l => /survivors shown of|infrastructure error:|could not be scored:/.test(l));
  warn('async-missing', first && mention >= 0 && first.i > mention && !delivered ? runs.map(c => c.ev) : [], 'no async survivor report reached the agent before it ran the mutagate CLI');

  return { result: { run, harness: meta.harness, lang: meta.lang, scenario: meta.scenario, task: meta.task || 'small', n: meta.n, passed: checks.every(c => c.passed), skipped: null, ended: meta.ended, wallMs: meta.wallMs, checks }, anomalies };
}
export function writeChecks(runDir, expected) {
  const r = checkRun(runDir, expected);
  fs.writeFileSync(path.join(runDir, 'result.json'), JSON.stringify(r.result, null, 2));
  fs.writeFileSync(path.join(runDir, 'anomalies.json'), JSON.stringify(r.anomalies, null, 2));
  return r;
}

const rank = (k, v) => { const i = ids[k].indexOf(v); return i < 0 ? ids[k].length : i; };
const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function load(sweepDir) {
  return fs.readdirSync(sweepDir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort(cmp)
    .map(name => ({ result: json(path.join(sweepDir, name), 'result.json', null), anomalies: json(path.join(sweepDir, name), 'anomalies.json', []) })).filter(r => r.result);
}
export function renderReport(sweepDir) {
  const runs = load(sweepDir), results = runs.map(r => r.result), anomalies = runs.flatMap(r => r.anomalies), cell = t => (t || '').replaceAll('|', '\\|').replaceAll('\n', ' ');
  const langs = [...new Set(results.map(r => r.lang))].sort((a, b) => rank('lang', a) - rank('lang', b) || cmp(a, b));
  const rows = [...new Map(results.map(r => [[r.harness, r.scenario, r.task].join('\0'), r])).values()]
    .sort((a, b) => rank('harness', a.harness) - rank('harness', b.harness) || cmp(a.harness, b.harness) || rank('scenario', a.scenario) - rank('scenario', b.scenario) || cmp(a.scenario, b.scenario) || rank('task', a.task) - rank('task', b.task) || cmp(a.task, b.task));
  const matrix = rows.map(row => `| ${row.harness} | ${row.scenario} | ${row.task} | ${langs.map(lang => {
    const all = results.filter(r => r.harness === row.harness && r.scenario === row.scenario && r.task === row.task && r.lang === lang), ran = all.filter(r => !r.skipped);
    if (!all.length) return '—';
    if (!ran.length) return `SKIP (${cell([...new Set(all.map(r => r.skipped))].join('; '))})`;
    const passed = ran.filter(r => r.passed).length;
    return `${passed ? 'PASS' : 'FAIL'} ${passed}/${ran.length} · ${(ran.reduce((s, r) => s + (r.wallMs || 0), 0) / 60000).toFixed(1)}m`;
  }).join(' | ')} |`);
  const warnings = [...new Set(anomalies.filter(a => a.kind === 'warning').map(a => a.id))].map(id => { const list = anomalies.filter(a => a.kind === 'warning' && a.id === id); return [id, list.length, new Set(list.map(a => a.run)).size]; })
    .sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]));
  const idx = a => a.kind === 'check' ? HARD.indexOf(a.id) : HARD.length + WARN.indexOf(a.id);
  const top = anomalies.map((a, i) => [a, i]).sort(([a, i], [b, j]) => (a.kind === 'check' ? 0 : 1) - (b.kind === 'check' ? 0 : 1) || cmp(a.run, b.run) || idx(a) - idx(b) || i - j).map(([a]) => a);
  const count = s => results.filter(s).length;
  const rec = anomalies.filter(a => a.id === 'recovered-error').map(a => `${a.run} ${parseInt(a.message)}`);
  return [`# mutagate eval sweep ${path.basename(sweepDir)}`, '', `Runs: ${count(r => !r.skipped && r.passed)} passed, ${count(r => !r.skipped && !r.passed)} failed, ${count(r => r.skipped)} skipped.`, '',
    '## Matrix', '', `| Harness | Scenario | Task | ${langs.join(' | ')} |`, `|---|---|---|${langs.map(() => '---|').join('')}`, ...matrix, '',
    '## Warnings', '', '| Warning | Count | Runs |', '|---|---|---|', ...warnings.map(w => `| ${w.join(' | ')} |`), '', ...(rec.length ? [`Recovered errors per run: ${rec.join(', ')}.`, ''] : []),
    '## Top anomalies', '', ...top.slice(0, 20).map((a, i) => `${i + 1}. ${a.kind} \`${a.id}\` [${a.run}](${a.run}/): ${cell(a.message)}${a.evidence?.[0] ? ` ([${a.evidence[0].file}:${a.evidence[0].line}](${a.run}/${a.evidence[0].file}))` : ''}`),
    ...(top.length > 20 ? ['', `${top.length - 20} more in anomalies.json.`] : []), ''].join('\n');
}
export function writeSweep(sweepDir) {
  const md = renderReport(sweepDir);
  fs.writeFileSync(path.join(sweepDir, 'report.md'), md);
  fs.writeFileSync(path.join(sweepDir, 'anomalies.json'), JSON.stringify(load(sweepDir).flatMap(r => r.anomalies), null, 2));
  return md;
}

export const scrub = (text, secrets) => secrets.filter(Boolean).reduce((t, s) => t.replaceAll(s, '<redacted>'), text);
export function scrubDir(dir, secrets) {
  if (!secrets.some(Boolean)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!['.git', 'node_modules'].includes(e.name)) scrubDir(p, secrets); continue; }
    if (!e.isFile() || fs.statSync(p).size > 5 * 1024 * 1024) continue;
    const b = fs.readFileSync(p);
    // Binaries (e.g. opencode.db) get a same-length 'x' fill so their structure stays valid; text gets '<redacted>'.
    if (b.includes(0)) { let hit = false; for (const s of secrets.filter(Boolean).map(x => Buffer.from(x))) for (let i = b.indexOf(s); i >= 0; i = b.indexOf(s, i + s.length)) { b.fill(0x78, i, i + s.length); hit = true; } if (hit) fs.writeFileSync(p, b); continue; }
    const text = b.toString('utf8'), clean = scrub(text, secrets);
    if (clean !== text) fs.writeFileSync(p, clean);
  }
}

// sha256 over each file's relative POSIX path and bytes, paths sorted, NUL-separated; null when the tree is missing.
export function packageDigest(dir) {
  if (!fs.existsSync(dir)) return null;
  const h = crypto.createHash('sha256');
  for (const f of fs.readdirSync(dir, { recursive: true }).map(String).map(f => f.split(path.sep).join('/')).sort()) if (fs.statSync(path.join(dir, f)).isFile()) h.update(f + '\0').update(fs.readFileSync(path.join(dir, f))).update('\0');
  return h.digest('hex');
}

// Evidence record for one cell (<harness>-<lang>-<scenario>), shaped like test/evidence/codex-continuation.json.
export function evidenceRecord(cell, runDirs, secrets = [process.env.CLAUDE_CODE_OAUTH_TOKEN, process.env.OPENROUTER_API_KEY]) {
  const runs = runDirs.map(dir => ({ dir, meta: json(dir, 'meta.json', {}), result: json(dir, 'result.json', {}) })).sort((a, b) => (a.meta.n ?? 0) - (b.meta.n ?? 0));
  const [harness, lang, scenario] = cell.split('-'), m = runs[0]?.meta || {};
  const attempts = runs.map(({ dir, meta, result }) => {
    const repo = path.join(dir, 'repo'), real = fs.existsSync(repo) ? fs.realpathSync(repo) : repo, exit = read(dir, 'check.exit').trim();
    // JSON-escaped forms first (trace lines are JSON text), then plain forms (final.txt is plain text); repo before home.
    const esc = s => JSON.stringify(s).slice(1, -1), at = s => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w.-])', 'g'); // whole path segment only: <home>XYZ stays
    const norm = t => [[real, '<repo>'], [repo, '<repo>'], [os.homedir(), '~']].reduce((x, [from, to]) => x.replace(at(esc(from)), to).replace(at(from), to), scrub(t, secrets));
    return { n: meta.n, ok: result.passed === true, checks: Object.fromEntries((result.checks || []).map(c => [c.id, c.passed])), exit: meta.exitCode ?? null, finalCheck: exit === '' ? null : Number(exit),
      duration_ms: meta.wallMs ?? null, finalResponse: norm(read(dir, 'final.txt')), transcript_sha256: crypto.createHash('sha256').update(fs.existsSync(path.join(dir, 'stdout.log')) ? fs.readFileSync(path.join(dir, 'stdout.log')) : '').digest('hex'),
      trace: read(dir, 'trace.jsonl').split('\n').flatMap(l => { try { return [JSON.parse(norm(l))]; } catch { return []; } }) };
  });
  // package: digest of the first stage/ found in the runs, the packageSkill tree the run installed (stage/ is kept in the run dir).
  return { harness: m.harness ?? harness, version: m.harnessVersion ?? null, model: m.model ?? null, mutagate: VERSION, package: runs.map(r => packageDigest(path.join(r.dir, 'stage'))).find(Boolean) ?? null, lang: m.lang ?? lang, task: m.task || 'small', scenario: m.scenario ?? scenario,
    passed: attempts.some(a => a.ok), checked_at: runs.map(r => r.meta.endedAt).filter(Boolean).sort().at(-1) ?? null, attempts };
}
