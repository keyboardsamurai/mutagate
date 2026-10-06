import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import * as m from '../scripts/mutagate.mjs';
import { inputFiles } from '../scripts/inputs.cjs';

function fixture(t) {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mutagate-runner-review-')));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const root = path.join(repo, '.cache'), data = path.join(root, 'repos', m.hash(repo));
  const c = { repo, root, data, config: structuredClone(m.DEFAULTS), stateFile: path.join(data, 'state.json') };
  const put = (file, text) => { fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true }); fs.writeFileSync(path.join(repo, file), text); };
  return { c, put };
}
function isolatedTools(t) {
  const f = fixture(t), oldPath = process.env.PATH, oldOffline = process.env.MUTAGATE_OFFLINE;
  process.env.PATH = path.join(f.c.repo, 'empty-path');
  delete process.env.MUTAGATE_OFFLINE;
  t.after(() => { process.env.PATH = oldPath; if (oldOffline === undefined) delete process.env.MUTAGATE_OFFLINE; else process.env.MUTAGATE_OFFLINE = oldOffline; });
  return f;
}
function installer(c, version) {
  const exe = path.join(c.root, 'tools', `gomutants@${version}`, 'gomutants');
  return { exe: process.execPath, args: ['-e', `const fs=require('node:fs'); fs.appendFileSync(${JSON.stringify(path.join(c.repo, 'installs'))},${JSON.stringify('install\n')}); setTimeout(()=>{fs.mkdirSync(${JSON.stringify(path.dirname(exe))},{recursive:true});fs.writeFileSync(${JSON.stringify(exe)},'installed');},100);`] };
}

test('bin and obj sources remain discoverable and fingerprinted outside .NET projects', t => {
  const { c, put } = fixture(t);
  put('package.json', '{}'); put('bin/cli.ts', 'export const x = 1'); put('bin/cli.test.ts', 'test'); put('obj/data.ts', 'data');
  const result = m.resolveTargets(c, 'bin/cli.test.ts');
  assert.equal(result.targets?.[0].file, 'bin/cli.ts');
  const target = { file: 'bin/cli.ts', tests: ['bin/cli.test.ts'], language: 'typescript' };
  assert.ok(inputFiles(c, target).includes('obj/data.ts'));
  const before = m.fingerprint(c, target); put('bin/helper.ts', 'changed'); assert.notEqual(m.fingerprint(c, target), before);
  put('Net/Net.csproj', '<Project/>'); put('Net/bin/Generated.cs', 'class Generated {}'); put('Net/obj/Generated.cs', 'class Generated {}');
  assert.ok(!m.files(c.repo).some(f => /Net\/(bin|obj)\//.test(f)));
});

test('Go build and test outputs are not fingerprint inputs', t => {
  const { c, put } = fixture(t);
  put('mod/go.mod', 'module example.com/mod\n'); put('mod/foo.go', 'package mod\n'); put('mod/foo_test.go', 'package mod\n');
  const target = m.resolveTargets(c, 'mod/foo_test.go').targets?.[0];
  assert.equal(target?.file, 'mod/foo.go');
  const before = m.fingerprint(c, target), outputs = ['mod/bin/app', 'mod/foo.test', 'mod/cover.out', 'mod/app.exe'];
  for (const file of outputs) put(file, 'binary');
  if (process.platform !== 'win32') { put('mod/app', 'binary'); fs.chmodSync(path.join(c.repo, 'mod/app'), 0o755); outputs.push('mod/app'); }
  assert.equal(m.fingerprint(c, target), before);
  assert.deepEqual(outputs.filter(f => inputFiles(c, target).includes(f)), []);
  put('mod/testdata/golden.out', 'golden'); put('mod/Makefile', 'all:');
  assert.ok(inputFiles(c, target).includes('mod/testdata/golden.out')); assert.ok(inputFiles(c, target).includes('mod/Makefile'));
  put('mod/foo.go', 'package mod\n\nvar X = 1\n'); assert.notEqual(m.fingerprint(c, target), before);
});

test('ignored MTE mutants do not count as infrastructure errors or alter scores', t => {
  const { c, put } = fixture(t); put('Foo.cs', 'class Foo {}');
  const raw = m.parseMutationTestingElements({ files: { 'Foo.cs': { mutants: ['Killed', 'Ignored', 'CompileError'].map((status, i) => ({ status, mutatorName: 'String mutation', location: { start: { line: i + 1, column: 1 } } })) } } }, c.repo);
  const result = m.normalize(raw, c, { file: 'Foo.cs', target: 'Foo.cs', language: 'csharp' });
  assert.equal(result.error_mutants, 1); assert.equal(result.score, 1); assert.equal(result.killed, 1);
});

test('tool pin changes use a new installation and ignore legacy unversioned cache', async t => {
  const { c, put } = isolatedTools(t), old = m.TOOLS.gomutants;
  t.after(() => { m.TOOLS.gomutants = old; }); put('.cache/tools/gomutants', 'legacy');
  for (const version of ['0.0.1', '0.0.2']) {
    m.TOOLS.gomutants = 'example.invalid/gomutants@v' + version;
    const expected = path.join(c.root, 'tools', `gomutants@${version}`, 'gomutants');
    assert.equal(await m.tool(c, 'gomutants', installer(c, version)), expected);
    assert.equal(await m.tool(c, 'gomutants', installer(c, version)), expected);
  }
  assert.equal(fs.readFileSync(path.join(c.repo, 'installs'), 'utf8'), 'install\ninstall\n');
  assert.ok(fs.existsSync(path.join(c.root, 'tools/gomutants@0.0.1/gomutants')));
});

test('concurrent first-use workers install a tool once', async t => {
  const { c } = isolatedTools(t), install = installer(c, '0.6.1');
  const results = await Promise.allSettled([m.tool(c, 'gomutants', install), m.tool(c, 'gomutants', install)]);
  assert.equal(fs.readFileSync(path.join(c.repo, 'installs'), 'utf8'), 'install\n');
  assert.ok(results.every(r => r.status === 'fulfilled')); assert.equal(results[0].value, results[1].value);
});

test('tool installation lock serializes separate worker processes', async t => {
  const { c } = isolatedTools(t), install = installer(c, '0.6.1');
  const code = `import { tool } from ${JSON.stringify(new URL('../scripts/mutagate.mjs', import.meta.url).href)}; await tool(${JSON.stringify(c)}, 'gomutants', ${JSON.stringify(install)});`;
  const worker = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', code]);
    let error = ''; child.stderr.on('data', b => { error += b; });
    child.on('error', reject); child.on('close', status => status === 0 ? resolve() : reject(Error(error)));
  });
  await Promise.all([worker(), worker()]);
  assert.equal(fs.readFileSync(path.join(c.repo, 'installs'), 'utf8'), 'install\n');
});

test('waiting for another installer obeys the worker deadline and preserves its lock', async t => {
  const { c, put } = isolatedTools(t), lock = '.cache/tools/gomutants@0.6.1.lock';
  put(lock, JSON.stringify({ pid: process.pid, at: Date.now() }));
  await assert.rejects(m.tool(c, 'gomutants', installer(c, '0.6.1'), { deadline: Date.now() + 75 }), /budget exceeded waiting/);
  assert.ok(fs.existsSync(path.join(c.repo, lock)));
  assert.ok(!fs.existsSync(path.join(c.repo, 'installs')));
});
