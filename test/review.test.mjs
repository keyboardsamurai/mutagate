import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as m from '../scripts/mutagate.mjs';
import { dataClassRule } from '../scripts/kotlin-source.cjs';
import { inputFiles } from '../scripts/inputs.cjs';
const cli = path.resolve(import.meta.dirname, '../scripts/mutagate.mjs');
function fixture(t, executable = 'mutagate.mjs') {
  const cli = path.resolve(import.meta.dirname, '../scripts', executable);
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mutagate-review-')));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const put = (file, text) => { const p = path.join(repo, file); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
  const root = path.join(repo, '.cache');
  const c = { ...m.context({ repo }, { session_id: 'review' }), root, data: path.join(root, 'repos', m.hash(repo)) };
  c.stateFile = path.join(c.data, 'state', c.session + '.json');
  put('build.gradle', "plugins { id 'java' }");
  put('src/main/java/acme/Foo.java', 'package acme; public class Foo { public int value() { return 1; } }');
  put('src/test/java/acme/FooTest.java', 'package acme; public class FooTest {}');
  const invoke = (args, payload = {}) => spawnSync(process.execPath, [cli, ...args, '--repo', repo], {
    input: JSON.stringify({ cwd: repo, session_id: 'review', ...payload }), encoding: 'utf8',
    env: { ...process.env, CLAUDE_PLUGIN_DATA: root, MUTAGATE_SESSION: 'review' }
  });
  return { c, put, invoke };
}
const mutant = { file: 'Foo.java', class: 'acme.Foo', line: 1, method: 'value', mutator: 'RETURNS', status: 'SURVIVED' };

test('data-class filtering proves the exact owner and retains user implementations', () => {
  const source = `package acme
  data class Generated(val value: Int)
  data class Custom(val value: Int) {
    override fun equals(other: Any?) = value > 0
    override fun hashCode() = value * 2
    override fun toString() = "custom"
  }
  class Ordinary { fun copy() = 1 }
  // data class Fake(val n: Int)
  val text = "data class Fake(val n: Int)"
  `;
  const check = (owner, method) => dataClassRule({ file: 'Types.kt', class: 'acme.' + owner, method }, source);
  for (const method of ['equals', 'hashCode', 'toString', 'component1', 'copy', 'copy$default']) assert.ok(check('Generated', method), method);
  for (const method of ['equals', 'hashCode', 'toString']) assert.equal(check('Custom', method), undefined, method);
  assert.ok(check('Custom', 'component1'));
  assert.equal(check('Ordinary', 'copy'), undefined);
  assert.equal(check('Fake', 'copy'), undefined);
  assert.equal(check('Outer$Generated', 'copy'), undefined);
});

test('fingerprints ignore unrelated modules and documentation but track dependencies and resources', t => {
  const { c, put } = fixture(t);
  for (const module of ['app', 'dependency', 'unrelated']) {
    put(module + '/build.gradle', module === 'app' ? "dependencies { implementation project(':dependency') }" : '');
    put(module + '/src/main/java/Value.java', 'class Value {}');
  }
  const target = { module: 'app', file: 'app/src/main/java/Value.java', tests: [] };
  const before = m.fingerprint(c, target);
  put('unrelated/src/main/java/Value.java', 'changed');
  put('README.md', 'changed');
  put('app/docs/notes.txt', 'changed');
  assert.equal(m.fingerprint(c, target), before);
  put('dependency/src/main/java/Value.java', 'dependency changed');
  assert.notEqual(m.fingerprint(c, target), before);
  const next = m.fingerprint(c, target);
  put('app/src/main/resources/rules.json', '{"feature":true}');
  assert.notEqual(m.fingerprint(c, target), next);
  assert.ok(!inputFiles(c, target).some(f => f.startsWith('unrelated/')));
});

test('invalid glob configuration diagnoses the error and commas outside braces stay literal', t => {
  const { c, put } = fixture(t);
  assert.equal(m.glob('one,two').test('one'), false);
  assert.equal(m.glob('one,two').test('one,two'), true);
  put('.mutagate/config.json', JSON.stringify({ testGlobs: ['**/*.{java'] }));
  const config = m.configFor(c.repo, c.root, {}, {});
  assert.match(config.errors.join(), /glob/);
  assert.deepEqual(config.config.testGlobs, m.DEFAULTS.testGlobs);
});

test('empty check fails at the executable boundary with a session diagnostic', t => {
  const { invoke } = fixture(t);
  const result = invoke(['check', '--wait', '0']);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /no targets checked.*MUTAGATE_SESSION/);
});

test('waived timeouts and uncovered mutants do not inflate eligible counters', t => {
  const { c, put } = fixture(t);
  const target = m.resolveTargets(c, 'src/test/java/acme/FooTest.java').targets[0];
  const raw = ['TIMED_OUT', 'NO_COVERAGE'].map((status, i) => ({ ...mutant, status, line: i + 1 }));
  put('.mutagate/waivers.json', JSON.stringify({ schema: 1, waivers: raw.map(x => ({
    id: m.hash(`${target.file}:${x.line}:${x.mutator}:${x.method}:`), target: target.target, reason: 'reviewed equivalent'
  })) }));
  const result = m.normalize(raw, c, target);
  assert.equal(result.waived, 2);
  assert.equal(result.no_coverage, 0);
  assert.equal(result.timed_out, 0);
});

for (const executable of ['mutagate.mjs', 'mutagate-hook.cjs']) for (const harness of ['claude', 'codex', 'opencode', 'pi']) {
  test(executable + ' ' + harness + ' executable completion blocks, honors cap and permits a repaired result', async t => {
    const { c, invoke } = fixture(t, executable);
    await m.register(c, 'src/test/java/acme/FooTest.java');
    const key = Object.keys(m.state(c).targets)[0];
    await m.runTarget(c, key, async () => ({ raw: [mutant] }));
    for (const event of harness === 'claude' ? ['TaskCompleted', 'SubagentStop'] : ['Stop', 'SubagentStop']) {
      const result = invoke(['hook', event], { harness, stop_hook_active: true });
      assert.equal(result.status, 2, result.stderr);
      assert.equal(JSON.parse(result.stdout).decision, 'block');
    }
    const capped = invoke(['hook', 'Stop'], { harness });
    assert.equal(capped.status, 0);
    assert.match(capped.stdout, /round cap/);
    await m.runTarget(c, key, async () => ({ raw: [{ ...mutant, status: 'KILLED' }] }));
    const repaired = invoke(['hook', 'Stop'], { harness });
    assert.equal(repaired.status, 0);
    assert.equal(repaired.stdout, '');
    assert.deepEqual(fs.readdirSync(path.join(c.data, 'reports')), []);
  });
}

test('multi-file patch registers each test at the executable boundary', t => {
  const { c, put, invoke } = fixture(t);
  put('src/main/java/acme/Bar.java', 'package acme; class Bar {}');
  put('src/test/java/acme/BarTest.java', 'package acme; class BarTest {}');
  const result = invoke(['hook', 'PostToolUse'], { harness: 'codex', tool_name: 'apply_patch', tool_input: {
    command: '*** Begin Patch\n*** Update File: src/test/java/acme/FooTest.java\n*** Add File: src/test/java/acme/BarTest.java\n*** End Patch'
  } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(Object.keys(m.state(c).targets).length, 2);
});

test('shipped hook template is generated from the installer configuration', async () => {
  const { sharedHooks } = await import('./generate-hooks.mjs');
  const shipped = JSON.parse(fs.readFileSync(new URL('../scripts/hooks.json', import.meta.url)));
  assert.deepEqual(shipped, sharedHooks());
  // Codex rejects additionalContextLimit on events that cannot emit additionalContext.
  for (const [event, groups] of Object.entries(m.hookConfig('codex').hooks)) for (const handler of groups.flatMap(group => group.hooks))
    assert.equal('additionalContextLimit' in handler, !['Stop', 'SubagentStop'].includes(event), event);
});

test('Kotlin corpus source and raw evidence hashes match their labeled version', async () => {
  const { createHash } = await import('node:crypto');
  const base = new URL('./fixtures/kotlin-gradle/', import.meta.url);
  const corpus = JSON.parse(fs.readFileSync(new URL('labeled-mutants.json', base)));
  const sha256 = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  for (const [file, digest] of Object.entries(corpus.source_sha256)) {
    assert.equal(sha256(new URL('src/main/kotlin/acme/' + file, base)), digest);
  }
  assert.equal(sha256(new URL('./corpus/kotlin-unfiltered.xml', import.meta.url)), corpus.raw_xml_sha256);
});

test('same-file marker interfaces permit data-class filtering without losing overrides', () => {
  const source = `package acme
interface Marker
interface Empty {}
interface Behavioral { fun hashCode(): Int }
interface Derived : Marker
open class Base { override fun hashCode() = 9 }
data class Safe(val value: Int) : Marker, acme.Empty
data class Custom(val value: Int) : Marker { override fun hashCode() = value * 7 }
data class Unknown(val value: Int) : External
data class Inherited(val value: Int) : Base()
data class Risky(val value: Int) : Behavioral
data class Transitive(val value: Int) : Derived
`;
  const check = (owner, method = 'hashCode') => dataClassRule({ file: 'Types.kt', class: 'acme.' + owner, method }, source);
  assert.ok(check('Safe'));
  assert.ok(check('Custom', 'component1'));
  for (const owner of ['Custom', 'Unknown', 'Inherited', 'Risky', 'Transitive']) assert.equal(check(owner), undefined, owner);
  assert.equal(dataClassRule({ file: 'Types.kt', class: 'acme.Bad', method: 'hashCode' }, 'package acme\ninterface Marker\n : External\ndata class Bad(val n: Int) : Marker'), undefined);
});

test('installed hook runtime is generated from the core and used by every installer', async t => {
  const { hookRuntime } = await import('./generate-hook-runtime.mjs');
  assert.equal(fs.readFileSync(new URL('../scripts/mutagate-hook.cjs', import.meta.url), 'utf8'), hookRuntime());
  assert.match(hookRuntime(), /'export function eligible/); // Preserve embedded runner source.
  const { c } = fixture(t);
  for (const harness of ['claude', 'codex']) {
    const entries = Object.values(m.hookConfig(harness).hooks).flatMap(groups => groups.flatMap(group => group.hooks));
    assert.ok(entries.every(entry => entry.command.includes('mutagate-hook.cjs')));
  }
  for (const harness of ['opencode', 'pi']) {
    m.install(c, harness);
    const file = path.join(c.repo, harness === 'opencode' ? '.opencode/plugins/mutagate.js' : '.pi/extensions/mutagate.ts');
    assert.match(fs.readFileSync(file, 'utf8'), /mutagate-hook.cjs/);
  }
});

test('hook installation remains idempotent when the package path has no skill name', async t => {
  const { packageSkill } = await import('./package.mjs');
  const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'package-check-')));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const installed = path.join(parent, 'runtime'), repo = path.join(parent, 'project');
  packageSkill(installed);
  fs.mkdirSync(repo);
  for (const operation of ['install', 'install', 'uninstall']) {
    const result = spawnSync(process.execPath, [path.join(installed, 'scripts/mutagate.mjs'), operation, '--agent', 'claude', '--repo', repo], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const config = JSON.parse(fs.readFileSync(path.join(repo, '.claude/settings.json')));
    assert.equal(config.hooks.Stop?.length || 0, operation === 'uninstall' ? 0 : 1);
    if (operation === 'install') { assert.match(result.stdout, /machine-local/); assert.ok(config.hooks.Stop[0].hooks[0].command.includes(installed)); } // skill outside the repo: absolute
  }
});

test('project install with the skill inside the Git repo writes the same repo-relative config at any location', async t => {
  const { packageSkill } = await import('./package.mjs');
  const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'portable-')));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const files = ['.claude/settings.json', '.codex/hooks.json', '.opencode/plugins/mutagate.js', '.pi/extensions/mutagate.ts'];
  const configs = ['one', 'two words'].map(name => {
    const repo = path.join(parent, name, 'repo'), skill = path.join(repo, 'tools/gate'); // no "mutagate" in the command: removal matches the wrapper
    packageSkill(skill);
    assert.equal(spawnSync('git', ['init', '-q'], { cwd: repo }).status, 0);
    const own = ['sh "$CLAUDE_PROJECT_DIR/.claude/scripts/hook" lint', 'sh "$(git rev-parse --show-toplevel)/.claude/scripts/hook" Stop'].map(command => ({ type: 'command', command })); // unrelated wrappers survive install and uninstall
    fs.mkdirSync(path.join(repo, '.claude')); fs.writeFileSync(path.join(repo, '.claude/settings.json'), JSON.stringify({ hooks: { Stop: [{ hooks: own }] } }));
    for (const operation of ['install', 'install', 'uninstall', 'install']) for (const agent of ['claude', 'codex', 'opencode', 'pi']) {
      const result = spawnSync(process.execPath, [path.join(skill, 'scripts/mutagate.mjs'), operation, '--agent', agent, '--repo', repo], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      assert.doesNotMatch(result.stdout, /machine-local/);
    }
    const texts = files.map(f => fs.readFileSync(path.join(repo, f), 'utf8'));
    for (const d of ['.opencode', '.pi']) fs.rmSync(path.join(repo, d), { recursive: true }); // doctor must find the native hooks alone
    const doctor = spawnSync(process.execPath, [path.join(skill, 'scripts/mutagate.mjs'), 'doctor', '--repo', repo], { encoding: 'utf8', env: { ...process.env, CLAUDE_PLUGIN_DATA: path.join(parent, 'data') } });
    assert.match(doctor.stdout, /PASS project adapter installed/, doctor.stdout + doctor.stderr);
    return texts;
  });
  assert.deepEqual(configs[0], configs[1]);
  for (const text of configs[0]) assert.ok(!text.includes(parent) && !text.includes(process.execPath), text);
  const claude = JSON.parse(configs[0][0]).hooks;
  assert.deepEqual(claude.Stop, [{ hooks: [{ type: 'command', command: 'sh "$CLAUDE_PROJECT_DIR/.claude/scripts/hook" lint' }, { type: 'command', command: 'sh "$(git rev-parse --show-toplevel)/.claude/scripts/hook" Stop' }] }, { hooks: [{ type: 'command', command: 'f="$(git rev-parse --show-toplevel)/tools/gate/scripts/hook" && [ -f "$f" ] && sh "$f" Stop # mutagate', timeout: 600 }] }]);
  assert.equal(claude.PostToolUse[0].hooks[1].command, 'f="$(git rev-parse --show-toplevel)/tools/gate/scripts/hook" && [ -f "$f" ] && sh "$f" PostToolUse --mutate # mutagate');
  assert.match(configs[0][2], /"\.\.\/\.\.\/tools\/gate\/scripts\/mutagate-hook\.cjs"/);
  assert.match(configs[0][3], /"\.\.\/\.\.\/tools\/gate\/scripts\/mutagate-hook\.cjs"/);
});

test('hooks under Node older than 22 stay inactive and say so at session start', async t => {
  const { c } = fixture(t), versions = process.versions;
  t.after(() => Object.defineProperty(process, 'versions', { value: versions }));
  Object.defineProperty(process, 'versions', { value: { ...versions, node: '21.7.3' } });
  assert.deepEqual(await m.handleHook(c, {}, 'SessionStart'), { code: 0, text: 'mutagate inactive: hooks run Node 21.7.3; need 22+. Set MUTAGATE_NODE or rerun install.' });
  assert.deepEqual(await m.handleHook({ ...c, harness: 'pi' }, {}, 'SessionStart'), { code: 0, out: { systemMessage: 'mutagate inactive: hooks run Node 21.7.3; need 22+. Set MUTAGATE_NODE or rerun install.' } });
  assert.deepEqual(await m.handleHook(c, { tool_name: 'Write', tool_input: { file_path: 'src/test/java/acme/FooTest.java' } }, 'PostToolUse'), { code: 0 });
  assert.deepEqual(m.state(c).targets, {});
});

test('portable hook identity survives skill relocation and Git failure', { skip: process.platform === 'win32' }, async t => {
  const { packageSkill } = await import('./package.mjs');
  const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hook-identity-')));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  for (const agent of ['claude', 'codex']) {
    const repo = path.join(parent, agent), original = path.join(repo, 'tools/gate'), moved = path.join(repo, 'tools/quality');
    packageSkill(original);
    assert.equal(spawnSync('git', ['init', '-q'], { cwd: repo }).status, 0);
    const file = path.join(repo, agent === 'claude' ? '.claude/settings.json' : '.codex/hooks.json');
    const own = { type: 'command', command: 'sh "$(git rev-parse --show-toplevel)/.claude/scripts/hook" Stop' };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ hooks: { Stop: [{ hooks: [own] }] } }));
    const invoke = (skill, operation, env = process.env) => {
      const result = spawnSync(process.execPath, [path.join(skill, 'scripts/mutagate.mjs'), operation, '--agent', agent, '--repo', repo], { env, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
    };
    const stop = () => JSON.parse(fs.readFileSync(file, 'utf8')).hooks.Stop.flatMap(g => g.hooks);
    invoke(original, 'install');
    // Upgrade an existing unmarked command while its old path is still known.
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replaceAll(' # mutagate', ''));
    invoke(original, 'install');
    assert.equal(stop().length, 2);
    fs.renameSync(original, moved);
    const { default: helper } = await import(path.join(moved, 'scripts/install.cjs'));
    assert.equal(helper.installed({ repo }, file), true);
    invoke(moved, 'install');
    assert.equal(stop().length, 2, 'relocation must replace the old command');
    assert.ok(stop()[1].command.includes('/tools/quality/scripts/hook'));
    invoke(moved, 'uninstall');
    assert.deepEqual(stop(), [own]);
    invoke(moved, 'install');
    const noGit = { ...process.env, PATH: path.join(parent, 'missing-bin') };
    invoke(moved, 'install', noGit);
    assert.equal(stop().length, 2, 'absolute fallback must replace the portable command');
    assert.ok(stop()[1].command.includes('mutagate-hook.cjs'));
    invoke(moved, 'install');
    invoke(moved, 'uninstall', noGit);
    assert.deepEqual(stop(), [own], 'uninstall must also work without Git');
  }
});

test('portable hook command fails open without Git or the skill dir, also under dash', { skip: process.platform === 'win32' }, t => {
  const command = m.hookConfig('claude', { repo: path.resolve(import.meta.dirname, '..') }).hooks.Stop[0].hooks[0].command;
  assert.match(command, /\[ -f "\$f" \]/);
  const noGit = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hook-open-'))), noSkill = path.join(noGit, 'repo');
  t.after(() => fs.rmSync(noGit, { recursive: true, force: true }));
  fs.mkdirSync(noSkill); assert.equal(spawnSync('git', ['init', '-q'], { cwd: noSkill }).status, 0);
  const env = { ...process.env, GIT_CEILING_DIRECTORIES: path.dirname(noGit) }; // dash exits 2 on a missing script
  for (const shell of ['sh', ...(fs.existsSync('/bin/dash') ? ['/bin/dash'] : [])]) for (const cwd of [noGit, noSkill]) {
    const status = spawnSync(shell, ['-c', command], { cwd, env, input: '{}' }).status;
    assert.ok(status !== 0 && status !== 2, `${shell} in ${cwd}: ${status}`);
  }
});
