// Model-checks Target.tla with TLC, then replays the findings on the real code (repro.mjs).
// Run from the repo root: node .claude/skills/verify-stop-gate/check.mjs [--mutants]
// Exit 0: every check gave its expected outcome. Exit 1: read the table. Exit 2: no TLC.
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url)), REPO = path.resolve(HERE, '../../..');
const JAR = process.env.TLA2TOOLS || path.join(os.homedir(), '.cache/tla/tla2tools.jar');
const PINNED = 'd15655eeaff4b3f7b3d65c46b838bc0f35d131b2ef4b1e473689b62c98d4726f'; // TLC2 2026.10.24.013619 (rev 2ef2af8)
const SYNC = '7d3b733', COVERED = ['scripts/mutagate.mjs', 'scripts/harness.cjs', 'scripts/inputs.cjs'];
const BOUNDS = process.env.BOUNDS || 'MaxEdits = 5 MaxStops = 5 MaxRounds = 2'; // MaxRounds 2 is DEFAULTS.maxRounds; BOUNDS='...' for another run
const CONFIGS = { revert: 'Revert = TRUE', noRevert: 'Revert = FALSE' };
// [config, invariant, expected]: holds, a finding id (expected broken), or goal (expected broken: the model reaches a clean stop).
const CHECKS = [
  ['revert', 'SilentStopMeansPassOnTheseFiles', 'holds'],
  ['revert', 'UsableResultIsOfTheseFiles', 'holds'],
  ['revert', 'BelowBlocksBeforeStop', 'holds'],
  ['revert', 'BlocksAreBounded', 'holds'],
  ['revert', 'GoalNeverStopsClean', 'goal'],
  ['noRevert', 'SilentStopMeansPassOnTheseFiles', 'holds'],
  ['noRevert', 'UsableResultIsOfTheseFiles', 'holds'],
  ['noRevert', 'BelowBlocksBeforeStop', 'holds'],
  ['noRevert', 'BlocksAreBounded', 'holds'],
  ['noRevert', 'GoalNeverStopsClean', 'goal'],
];
// Broken variants of the code, written into the model: each must break the properties it names (--mutants).
const MUTANTS = [
  ['runTarget publishes without the second fingerprint and stat keys (mutagate.mjs:515 drops now === fp and unwritten)',
    'Fresh == target.generation = run.generation /\\ content = run.fp /\\ edits = run.stamp', 'Fresh == target.generation = run.generation',
    [['noRevert', 'SilentStopMeansPassOnTheseFiles', 'broken']]], // P2 still holds: the stored fingerprint is the old one, and loadResult rejects it
  ['loadResult ignores the fingerprint (mutagate.mjs:541-542)',
    '          /\\ target.fingerprint = content\n', '',
    [['noRevert', 'SilentStopMeansPassOnTheseFiles', 'broken'], ['noRevert', 'UsableResultIsOfTheseFiles', 'broken']]],
  ['claimBlock ignores maxRounds (mutagate.mjs:577)',
    '/\\ o = "below" => t.blocks < MaxRounds', '/\\ TRUE', [['noRevert', 'BlocksAreBounded', 'broken']]],
  ['claimBlock ignores the pending flag (mutagate.mjs:577)',
    '/\\ o = "pending" => ~t.pendingBlocked', '/\\ TRUE', [['noRevert', 'BlocksAreBounded', 'broken']]],
  ['F2 back: claimBlock counts the one-time blocks in t.blocks (mutagate.mjs:578-579)',
    '!.blocks = @ + (IF o = "below" THEN 1 ELSE 0)', '!.blocks = @ + 1', [['noRevert', 'BelowBlocksBeforeStop', 'broken']]],
  ['F1 back: runTarget ignores the stat keys and compares only the bytes (mutagate.mjs:515 drops unwritten)',
    'content = run.fp /\\ edits = run.stamp', 'content = run.fp',
    [['revert', 'SilentStopMeansPassOnTheseFiles', 'broken'], ['revert', 'UsableResultIsOfTheseFiles', 'broken']]],
];

if (!fs.existsSync(JAR)) {
  console.error(`No TLC at ${JAR}. Set TLA2TOOLS to a tla2tools.jar (pinned: TLC2 2026.10.24, sha256 ${PINNED}), or get one from https://github.com/tlaplus/tlaplus/releases.`);
  process.exit(2);
}
const sha = crypto.createHash('sha256').update(fs.readFileSync(JAR)).digest('hex');
if (sha !== PINNED) console.log(`warning: ${JAR} is not the pinned TLC (sha256 ${sha.slice(0, 12)}…); results can differ.`);

const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-stop-gate-'));
function tlc(spec, config, inv, name) {
  const dir = path.join(OUT, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'Target.tla'), spec);
  fs.writeFileSync(path.join(dir, 'Target.cfg'), `SPECIFICATION Spec\nCONSTANTS ${BOUNDS} ${CONFIGS[config]}\nINVARIANT ${inv}\n`);
  return new Promise(resolve => {
    const p = spawn('java', ['-XX:+UseParallelGC', '-cp', JAR, 'tlc2.TLC', '-deadlock', '-workers', '1', '-metadir', path.join(dir, 'states'), '-config', 'Target.cfg', 'Target.tla'], { cwd: dir });
    let out = '';
    p.stdout.on('data', d => out += d); p.stderr.on('data', d => out += d);
    p.on('close', () => {
      fs.writeFileSync(path.join(dir, 'tlc.out'), out);
      const got = new RegExp(`Invariant ${inv} is violated`).test(out) ? 'broken' : /No error has been found/.test(out) ? 'holds' : 'error';
      resolve({ got, states: [...out.matchAll(/([\d,]+) distinct states found/g)].at(-1)?.[1] || '?', version: out.match(/TLC2 Version \S+/)?.[0], file: path.join(dir, 'tlc.out') });
    });
  });
}

const base = fs.readFileSync(path.join(HERE, 'Target.tla'), 'utf8');
const jobs = CHECKS.map(([config, inv, expected]) => tlc(base, config, inv, `${config}-${inv}`).then(r => ({ config, inv, expected, ...r })));
if (process.argv.includes('--mutants')) MUTANTS.forEach(([what, from, to, expects], i) => {
  if (!base.includes(from)) { console.log(`mutant ${i + 1} no longer applies (model text changed): ${what}`); process.exitCode = 1; return; }
  for (const [config, inv, expected] of expects)
    jobs.push(tlc(base.replace(from, to), config, inv, `mutant${i + 1}-${config}-${inv}`).then(r => ({ config, inv, expected, mutant: `${i + 1}. ${what}`, ...r })));
});
const results = await Promise.all(jobs);

let bad = 0;
console.log(results[0].version || 'TLC version unknown', `| bounds ${BOUNDS} | outputs ${OUT}`);
for (const r of results) {
  const want = ['holds'].includes(r.expected) ? 'holds' : 'broken';
  const verdict = r.got === 'error' ? 'MODEL ERROR: read the output' : r.got === want ? (r.mutant ? (want === 'holds' ? 'ok, holds on this variant' : 'ok, mutant caught') : r.expected === 'holds' ? 'ok' : r.expected === 'goal' ? 'ok, goal reached' : `ok, known finding ${r.expected}`)
    : r.got === 'broken' ? 'NEW COUNTEREXAMPLE: real bug or model error, see SKILL.md' : r.mutant ? 'MUTANT SURVIVED: the check no longer guards this code' : `NOT BROKEN: ${r.expected} looks fixed, update SKILL.md`;
  if (!verdict.startsWith('ok')) { bad++; console.log(`  output: ${r.file}`); }
  console.log(`${r.mutant ? `[mutant ${r.mutant}] ` : ''}${r.config.padEnd(8)} ${r.inv.padEnd(32)} ${r.got.padEnd(6)} ${String(r.states).padStart(7)} states  ${verdict}`);
}

const diff = spawnSync('git', ['diff', '-U0', SYNC, '--', ...COVERED], { cwd: REPO, encoding: 'utf8' }).stdout || '';
const hunks = diff.split('\n').filter(l => l.startsWith('+++ ') || l.startsWith('@@'));
console.log(hunks.length ? `covered files changed since sync commit ${SYNC}; check these hunks against SKILL.md "Coverage":\n  ${hunks.join('\n  ')}` : `covered files unchanged since sync commit ${SYNC}`);

const repro = spawnSync(process.execPath, ['--test', '--test-reporter=spec', 'repro.mjs'], { cwd: HERE, encoding: 'utf8' });
const lines = (repro.stdout + repro.stderr).split('\n').filter(l => /^\s*[✔✖]/.test(l));
console.log(`real-code replays (repro.mjs):\n${lines.join('\n')}`);
if (repro.status !== 0) { bad++; console.log(repro.stdout.slice(-3000)); }
console.log(bad ? `${bad} unexpected outcome(s)` : 'all outcomes as expected');
process.exit(bad ? 1 : 0);
