import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs, planSweep, aggregate, evidenceCells, ids, runRepo, stepTimeout, diffSince } from './eval/run.mjs';
import { scrubDir } from './eval/checks.mjs';
import { harnesses, opencodeConfig, pinned } from './eval/harnesses.mjs';
const config = JSON.parse(fs.readFileSync(new URL('./eval/config.json', import.meta.url)));
const { harness, lang, scenario } = ids, all = { harness, lang, scenario };

test('config pins models, timeout, jobs, repeat and settle period', () => {
  assert.deepEqual(config, { models: { claude: 'claude-sonnet-5', codex: 'gpt-5.6-sol', opencode: 'openrouter/deepseek/deepseek-v4.1-flash', pi: 'deepseek/deepseek-v4-flash' }, codexEffort: 'medium', timeoutMs: 1800000, jobs: 4, repeat: 2, settleMs: 20000 });
  assert.equal(JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url))).scripts.eval, 'node test/eval/run.mjs');
});

test('parseArgs defaults every list to all ids and task to small', () => {
  assert.deepEqual(parseArgs([]), { ...all, task: 'small', repeat: undefined, jobs: undefined, model: {}, report: undefined });
});

test('parseArgs accepts comma-separated, repeated and = forms', () => {
  const f = parseArgs(['--harness', 'pi,claude', '--harness=codex', '--lang', 'go', '--lang', 'java', '--scenario', 'forced', '--task', 'greenfield', '--repeat', '3', '--jobs=1', '--model', 'claude=claude-opus-5', '--model', 'pi=x/y=z', '--report', 'test/.cache/eval/x']);
  assert.deepEqual(f, { harness: ['pi', 'claude', 'codex'], lang: ['go', 'java'], scenario: ['forced'], task: 'greenfield', repeat: 3, jobs: 1, model: { claude: 'claude-opus-5', pi: 'x/y=z' }, report: 'test/.cache/eval/x' });
});

test('parseArgs rejects unknown ids, flags and bad values with clear messages', () => {
  for (const [argv, re] of [[['--harness', 'cursor'], /unknown harness "cursor"/], [['--lang', 'rust'], /unknown lang "rust"/], [['--scenario', 'quality'], /unknown scenario/], [['--task', 'big'], /unknown task "big"/],
    [['--bogus'], /unknown flag "--bogus"/], [['java'], /unknown argument "java"/], [['--harness'], /--harness needs a value/], [['--lang', '--scenario', 'forced'], /--lang needs a value/], [['--repeat', '0'], /--repeat must be a positive integer/], [['--jobs', 'x'], /--jobs must be a positive integer/],
    [['--model', 'claude'], /--model expects <harness>=<id>/], [['--model', 'cursor=x'], /unknown harness "cursor"/], [['--task', 'small,greenfield'], /--task takes one value/], [['--report'], /--report needs a value/]]) assert.throws(() => parseArgs(argv), re, argv.join(' '));
});

test('planSweep expands harness x lang x scenario x n with contract names and models', () => {
  const plan = planSweep({ flags: parseArgs(['--harness', 'claude,pi', '--lang', 'java,go', '--model', 'pi=m']), config, preflight: () => null });
  assert.equal(plan.length, 16);
  assert.deepEqual(plan.slice(0, 5).map(r => r.name), ['claude-java-natural-1', 'claude-java-natural-2', 'claude-java-forced-1', 'claude-java-forced-2', 'claude-go-natural-1']);
  assert.deepEqual(plan[0], { name: 'claude-java-natural-1', cell: 'claude-java-natural', harness: 'claude', lang: 'java', scenario: 'natural', task: 'small', n: 1, model: 'claude-sonnet-5', skip: null });
  assert.equal(plan.at(-1).name, 'pi-go-forced-2');
  assert.equal(plan.at(-1).model, 'm');
  const green = planSweep({ flags: parseArgs(['--harness', 'codex', '--lang', 'python', '--scenario', 'forced', '--task', 'greenfield', '--repeat', '3']), config, preflight: () => null });
  assert.deepEqual(green.map(r => [r.name, r.cell, r.task]), [1, 2, 3].map(n => [`codex-python-forced-greenfield-${n}`, 'codex-python-forced-greenfield', 'greenfield']));
});

test('planSweep memoizes preflight per harness, lang and task and skips whole cells', () => {
  const calls = [];
  const plan = planSweep({ flags: parseArgs(['--harness', 'claude,codex', '--lang', 'java,kotlin']), config: { ...config, repeat: 1 }, preflight: (h, l, t) => (calls.push([h, l, t]), h === 'codex' && l === 'kotlin' ? 'missing toolchain gradle' : null) });
  assert.deepEqual(calls, [['claude', 'java', 'small'], ['claude', 'kotlin', 'small'], ['codex', 'java', 'small'], ['codex', 'kotlin', 'small']]);
  assert.deepEqual(plan.map(r => [r.name, r.skip]), [['claude-java-natural-1', null], ['claude-java-forced-1', null], ['claude-kotlin-natural-1', null], ['claude-kotlin-forced-1', null],
    ['codex-java-natural-1', null], ['codex-java-forced-1', null], ['codex-kotlin-natural-1', 'missing toolchain gradle'], ['codex-kotlin-forced-1', 'missing toolchain gradle']]);
});

test('runRepo uses unpredictable siblings beneath the sweep directory', () => {
  assert.equal(runRepo('s', 'r', '/home/u', '0123456789abcdef'), '/home/u/.cache/mutagate-eval/s/r-0123456789abcdef');
  const a = runRepo('s', 'r'), b = runRepo('s', 'r');
  assert.notEqual(a, b);
  for (const p of [a, b]) { assert.equal(path.dirname(p), path.join(os.homedir(), '.cache/mutagate-eval/s')); assert.match(path.basename(p), /^r-[a-f0-9]{16}$/); }
});

test('stepTimeout: one deadline from run start covers setup and agent, collection gets a fixed 5 min grace, never 0', () => {
  const min = 60000, start = 1e12, b = { start, timeoutMs: 30 * min };
  assert.equal(stepTimeout(b, start + 10 * min), 20 * min);
  assert.equal(stepTimeout(b, start + 29 * min), 1 * min);
  assert.equal(stepTimeout(b, start + 31 * min), 1);
  assert.equal(stepTimeout(b, start + 30 * min), 1);
  assert.equal(stepTimeout({ ...b, agentEnd: start + 30 * min }, start + 31 * min), 4 * min);
  assert.equal(stepTimeout({ ...b, agentEnd: start + 5 * min }, start + 6 * min), 4 * min);
  assert.equal(stepTimeout({ ...b, agentEnd: start + 5 * min }, start + 11 * min), 1);
});

test('diffSince shows new files without writing their content to .git, so scrubDir leaves no token anywhere', t => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'mutagate-eval-diff-')), token = 'sk-or-v1-' + 'f00d'.repeat(8);
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const git = (...args) => { const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], { cwd: repo, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout; };
  fs.writeFileSync(path.join(repo, 'tracked.txt'), 'base\n');
  git('init', '-q'); git('add', '-A'); git('commit', '-qm', 'baseline');
  const baseline = git('rev-parse', 'HEAD').trim();
  fs.writeFileSync(path.join(repo, 'tracked.txt'), `base\nkey=${token}\n`);
  fs.writeFileSync(path.join(repo, 'new.txt'), `OPENROUTER_API_KEY=${token}\n`);
  fs.writeFileSync(path.join(repo, 'session.db'), Buffer.concat([Buffer.from([0, 1, 2, 0]), Buffer.from(token), Buffer.from([0, 255])]));
  const patch = diffSince(repo, baseline);
  assert.match(patch, /^diff --git a\/new\.txt b\/new\.txt$/m);
  assert.match(patch, /^diff --git a\/tracked\.txt b\/tracked\.txt$/m);
  scrubDir(repo, [token]);
  for (const f of ['tracked.txt', 'new.txt', 'session.db']) assert.ok(!fs.readFileSync(path.join(repo, f)).includes(token), f);
  assert.equal(fs.statSync(path.join(repo, 'session.db')).size, 4 + token.length + 2, 'binary scrub keeps the length');
  const objects = spawnSync('git', ['cat-file', '--batch-all-objects', '--batch'], { cwd: repo, maxBuffer: 1 << 26 }).stdout;
  assert.ok(objects.length && !objects.includes(token), 'token in .git objects');
});

const r = (run, passed, extra = {}) => { const [harness, lang, scenario] = run.split('-'); return { run, harness, lang, scenario, task: run.includes('greenfield') ? 'greenfield' : 'small', n: +run.split('-').at(-1), passed, skipped: null, ended: 'exit', wallMs: 1000, checks: [], ...extra }; };
const skip = run => r(run, false, { skipped: 'harness binary missing', ended: undefined, wallMs: undefined });

test('aggregate passes a cell when any executed run passed and exits 0', () => {
  const a = aggregate([r('claude-java-forced-1', false), r('claude-java-forced-2', true), skip('pi-go-natural-1'), skip('pi-go-natural-2'), r('codex-go-natural-greenfield-1', true, { wallMs: 5 })]);
  assert.deepEqual(a.cells, [
    { cell: 'claude-java-forced', harness: 'claude', lang: 'java', scenario: 'forced', task: 'small', status: 'pass', passed: 1, total: 2, wallMs: 2000 },
    { cell: 'pi-go-natural', harness: 'pi', lang: 'go', scenario: 'natural', task: 'small', status: 'skip', passed: 0, total: 0, wallMs: 0 },
    { cell: 'codex-go-natural-greenfield', harness: 'codex', lang: 'go', scenario: 'natural', task: 'greenfield', status: 'pass', passed: 1, total: 1, wallMs: 5 }]);
  assert.equal(a.exitCode, 0);
  assert.match(a.message, /2 passed, 0 failed, 1 skipped/);
});

test('aggregate exits 1 when an executed cell failed, skips do not matter', () => {
  const a = aggregate([r('claude-java-forced-1', true), r('opencode-python-natural-1', false), r('opencode-python-natural-2', false), skip('pi-go-natural-1')]);
  assert.deepEqual(a.cells.map(c => [c.cell, c.status]), [['claude-java-forced', 'pass'], ['opencode-python-natural', 'fail'], ['pi-go-natural', 'skip']]);
  assert.equal(a.exitCode, 1);
  assert.match(a.message, /1 passed, 1 failed, 1 skipped.*opencode-python-natural/);
});

test('evidenceCells keeps only passing small cells with both runs (ADR-0011)', () => {
  const { cells } = aggregate([r('claude-java-forced-1', true), r('claude-java-forced-2', false), r('codex-java-forced-1', true), r('pi-go-natural-1', false), r('pi-go-natural-2', false), r('codex-go-natural-greenfield-1', true), r('codex-go-natural-greenfield-2', true)]);
  assert.deepEqual(evidenceCells(cells).map(c => c.cell), ['claude-java-forced']);
});

test('aggregate exits 1 saying no cell executed when everything skipped or empty', () => {
  for (const results of [[], [skip('pi-go-natural-1'), skip('claude-java-forced-1')]]) {
    const a = aggregate(results);
    assert.equal(a.exitCode, 1);
    assert.match(a.message, /no cell executed/);
  }
});

test('importing run.mjs has no side effects', () => {
  const out = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(new URL('./eval/run.mjs', import.meta.url).href)});console.log('ok')`], { encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  assert.equal(out.stdout, 'ok\n');
});

test('the OpenCode driver runs bash tools with /bin/bash, not the user\'s login shell', () => {
  assert.equal(harnesses.opencode.env({ runDir: os.tmpdir() }).SHELL, '/bin/bash');
});

test('OpenCode allows external directories for skill hooks', () => {
  assert.equal(opencodeConfig('m').permission.external_directory, 'allow');
  assert.equal(opencodeConfig('m').model, 'm');
});

test('Claude resolves its executable pin before PATH', t => {
  const pin = JSON.parse(fs.readFileSync(new URL('./harness-versions.json', import.meta.url), 'utf8')).packages['@anthropic-ai/claude-code'];
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mutagate-claude-pin-')), exe = path.join(home, '.local/share/claude/versions', pin), oldPath = process.env.PATH;
  t.after(() => { process.env.PATH = oldPath; fs.rmSync(home, { recursive: true, force: true }); });
  fs.mkdirSync(path.dirname(exe), { recursive: true });
  fs.writeFileSync(exe, `#!/bin/sh\nprintf "${pin} (Claude Code)\\n"\n`, { mode: 0o755 });
  process.env.PATH = home;
  assert.deepEqual(pinned('claude', '@anthropic-ai/claude-code', home), { exe, version: pin });
});
