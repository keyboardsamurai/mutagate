'use strict';
// Runners drive the mutation engines and return raw mutants; lazy, off the hook path. mutagate.mjs injects the engine helpers.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto'), { spawn, spawnSync } = require('node:child_process'), { createRequire } = require('node:module');
const ROOT = path.dirname(__dirname), read = p => fs.readFileSync(p, 'utf8'), exists = p => fs.existsSync(p), mkdir = p => fs.mkdirSync(p, { recursive: true }),
  slash = s => s.split(path.sep).join('/'), sha256 = s => crypto.createHash('sha256').update(s).digest('hex'), readIf = p => exists(p) ? read(p) : '';
// Runner process groups die with mutagate: on exit, and on SIGINT/SIGTERM/SIGHUP (exit 128+signo). Handlers install on the first spawn.
const trees = new Set(), killTree = pid => { try { if (process.platform !== 'win32') process.kill(-pid, 'SIGKILL'); else spawnSync('taskkill', ['/pid', String(pid), '/T', '/F']); } catch {} };
let reaper = () => { reaper = () => {}; process.on('exit', () => trees.forEach(killTree)); for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(s, () => process.exit(128 + os.constants.signals[s])); };
module.exports = ({ lock, atomic, json, hash, pkg, moduleRoot, fingerprint, targetKey, parsePitXML, parseMutationTestingElements }) => {
async function command(exe, args, opts = {}) {
  return new Promise((resolve, reject) => {
    let output = '',
      error = '';
    const win = process.platform === 'win32' && (/\.(bat|cmd)$/i.test(exe) || ['mvn', 'gradle'].includes(exe)),
      ps = "& '" + exe.replaceAll("'", "''") + "' " + args.map(a => "'" + String(a).replaceAll("'", "''") + "'").join(' ') + "; exit $LASTEXITCODE";
    const child = spawn(win ? 'powershell.exe' : exe, win ? ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString( 'base64')] : args, {
        cwd: opts.cwd, env: opts.env || process.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached: process .platform !== 'win32'
      });
    reaper(); trees.add(child.pid);
    const timer = setTimeout(() => killTree(child.pid), Math.max(1, opts.deadline ? opts.deadline - Date.now() :
      opts.timeout || 300000));
    child.stdout.on('data', b => { output = (output + b).slice(-4000000); });
    child.stderr.on('data', b => { error = (error + b).slice(-4000000); });
    child.on('error', e => {
      clearTimeout(timer); trees.delete(child.pid);
      reject(Error(`${path.basename(exe)} unavailable: ${e.message}`));
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer); trees.delete(child.pid);
      try { if (opts.log) fs.appendFileSync(opts.log, JSON.stringify({ exe, args, code, signal, output, error }) + '\n'); } catch {} // logging must never mask the result
      if (code === 0 || opts.allowFailure) return resolve({ output, error, code, signal });
      // Keep causes, not PIT VM/Uptime or Maven/Gradle help footers.
      const cause = (error + '\n' + output).split('\n').filter(l => /error|exception|fail|not found|could not|^e: /i.test(l) && !/^\s*at |^\[ERROR\]\s*(?:$|->|To see|Re-run|For more|\[Help)|^FAILURE: Build failed|^BUILD FAILED|^Execution failed for task|^> Compilation failed; see/.test(l)).slice(-3).map(l => l.trim()).join(' | ').slice(0, 400);
      reject(Error(`${path.basename(exe)} failed (${signal||code})${cause ? ': ' + cause : ''}`));
    });
  });
}
async function jars(c, junit5 = false, tierA = false) {
  const manifest = json(path.join(ROOT, 'references/jars.json')),
    out = [];
  for (const item of manifest.filter(x => (!x.optional || tierA) && (junit5 || x.artifact !== 'pitest-junit5-plugin'))) {
    const p = path.join(c.root, 'jars', path.basename(item.path));
    if (exists(p) && sha256(fs.readFileSync(p)) !== item.sha256) throw Error(
      `jar checksum mismatch: ${item.artifact}; remove the cached jar and retry`);
    if (!exists(p)) {
      if (process.env.MUTAGATE_OFFLINE === '1') throw Error(
        `offline: missing ${item.artifact}`);
      const response = await fetch('https://repo1.maven.org/maven2/' + item.path, {
        redirect: 'error', signal: AbortSignal.timeout(Math.max(1, Math.min(30000, (c.deadline || Infinity) - Date.now())))
      });
      if (!response.ok) throw Error(`jar download failed: ${response.status} ${item.artifact}. Preseed SHA-256 verified jars in ${path.dirname(p)} and set MUTAGATE_OFFLINE=1; see README proxy/offline setup`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (sha256(bytes) !== item.sha256) throw Error(`jar checksum mismatch: ${item.artifact}`);
      mkdir(path.dirname(p));
      const tmp = p + '.' + crypto.randomUUID();
      fs.writeFileSync(tmp, bytes);
      fs.renameSync(tmp, p);
    }
    out.push(p);
  }
  return out;
}
// Match launcher/engine; surefire injects undeclared launchers.
async function launcherJar(cp, mvn, opts) {
  const engine = cp.find(p => /junit-platform-engine-[^/\\]+\.jar$/.test(p));
  if (!engine || !cp.some(p => p.includes('junit-jupiter')) || cp.some(p => p.includes('junit-platform-launcher-'))) return null; // only the JUnit 5 plugin needs it
  const v = path.basename(engine).match(/junit-platform-engine-(.+)\.jar$/)[1], jar = engine.replaceAll('junit-platform-engine', 'junit-platform-launcher');
  if (!exists(jar) && mvn) await command(mvn, ['-q', 'dependency:get', '-Dartifact=org.junit.platform:junit-platform-launcher:' + v, '-Dtransitive=false'], { ...opts, allowFailure: true });
  if (!exists(jar)) throw Error(`JUnit Platform ${v} needs org.junit.platform:junit-platform-launcher:${v} on the test classpath (Maven test scope / Gradle testRuntimeOnly)`);
  return jar;
}
function javaExe(repo=process.cwd()) {
  const executable=home=>path.join(home,'bin',process.platform==='win32'?'java.exe':'java');
  if(process.env.JAVA_HOME)return executable(process.env.JAVA_HOME);
  const configured=readIf(path.join(repo,'gradle.properties')).match(/^org\.gradle\.java\.installations\.paths\s*=\s*(.+)$/m)?.[1].split(',')||[];
  const jdks=path.join(process.env.GRADLE_USER_HOME||path.join(os.homedir(),'.gradle'),'jdks');
  const homes=[...configured,...(exists(jdks)?fs.readdirSync(jdks).flatMap(p=>[path.join(jdks,p),path.join(jdks,p,'Contents/Home')]):[])];
  return homes.map(p=>executable(path.resolve(repo,p.trim()))).find(exists)||'java';
}
// Kotlin top-level functions use the file facade.
// ponytail: a .kt file with several targets mutates its facade in each target's run.
const pitTargets = (c, t) => [t.target, t.language === 'kotlin' && t.file.endsWith('.kt') && require('./kotlin-source.cjs').facadeClass(t.file,
  readIf(path.join(c.repo, t.file)))].filter(Boolean).flatMap(x => [x, x + '$*']).join(',');
const pitRaw = (out, xml) => /Created 0 mutation test units/.test(out) ? [] : parsePitXML(read(xml));
async function pit(c, t, dir, opts) {
  const java = javaExe(c.repo);
  const version = await command(java, ['-version'], opts);
  if (Number((version.error + version.output).match(/version "(?:1\.)?(\d+)/)?.[1] || 0) < 11) throw Error('JDK 11 or later is required');
  const module = path.resolve(c.repo, t.module),
    gradle = ['build.gradle', 'build.gradle.kts'].some(f => exists(path.join(module, f)));
  let cp, main, source, testClasses;
  const buildHash = hash(require('./inputs.cjs').inputFiles(c, t).filter(f =>
      /(?:build\.gradle(?:\.kts)?|settings\.gradle(?:\.kts)?|gradle\.properties|pom\.xml|libs\.versions\.toml)$/.test(f)).map(f => f + read(path.join(c.repo, f))).join('')),
    cacheFile = path.join(c.data, 'classpath', hash(module) + '.json'),
    cached = json(cacheFile, null),
    cacheValid = cached?.hash === buildHash && cached.cp.filter(p=>p.endsWith('.jar')).every(exists);
  const compiledFingerprint = hash(fingerprint(c, { ...t, tests: [], testNames: [] }) + java + version.output + version.error);
  const stamp = paths => hash(JSON.stringify(paths.filter(exists).map(p => {
    const stat = fs.statSync(p);
    return [p, stat.mtimeMs, stat.size];
  })));
  const outputsPresent = cached?.main?.some(exists) && cached?.testClasses?.some(exists),
    mvnw = path.join(c.repo, process.platform === 'win32' ? 'mvnw.cmd' : 'mvnw'), mvn = exists(mvnw) ? mvnw : 'mvn';
  if (cacheValid && cached.compiledFingerprint === compiledFingerprint && outputsPresent && cached.cpStamp === stamp(cached.cp)) {
    ({ cp, main, source, testClasses } = cached);
  } else if (gradle) {
    const init = path.join(dir, 'mutagate-init.gradle');
    atomic(init,
      `import groovy.json.JsonOutput\nallprojects { p -> p.plugins.withId('java') { p.tasks.register('mutagatePrintClasspath') { dependsOn p.tasks.named('testClasses'); dependsOn p.configurations.testRuntimeClasspath; doLast { def ss=p.extensions.getByName('sourceSets'); def cp=ss.test.runtimeClasspath.files; def e=cp.find{it.name.startsWith('junit-platform-engine-')}; if(e&&!cp.any{it.name.startsWith('junit-platform-launcher-')}){ try { def d=p.configurations.detachedConfiguration(p.dependencies.create('org.junit.platform:junit-platform-launcher:'+(e.name-'junit-platform-engine-'-'.jar'))); d.transitive=false; cp+=d.files } catch (ignored) {} }; println('MUTAGATE_CP='+JsonOutput.toJson([cp:cp.collect{it.absolutePath},main:ss.main.output.classesDirs.files.collect{it.absolutePath},source:ss.main.allSource.srcDirs.collect{it.absolutePath},testClasses:ss.test.output.classesDirs.files.collect{it.absolutePath}])) } } } }\n`
    );
    const wrapper = path.join(c.repo, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew'),
      cmd = exists(wrapper) ? wrapper : 'gradle',
      task = t.module ? ':' + t.module.replaceAll('/', ':') + ':mutagatePrintClasspath' : 'mutagatePrintClasspath';
    const result = await command(cmd, ['--console=plain', ...(process.platform === 'win32' ? ['--no-daemon'] : []), '--init-script', init, task], { ...opts, cwd: c.repo });
    const data = JSON.parse(result.output.match(/MUTAGATE_CP=(.+)/)?.[1] || 'null');
    if (!data) throw Error('Gradle classpath task returned no data');
    ({ cp, main, source, testClasses } = data);
  } else if (exists(path.join(module, 'pom.xml'))) {
    testClasses=[path.join(module,'target/test-classes')];const out = path.join(dir, 'classpath.txt');
    await command(mvn, cacheValid ? ['-q', 'test-compile'] : ['-q', 'test-compile', 'dependency:build-classpath', '-Dmdep.outputFile=' + out], {
      ...opts, cwd: module
    });
    if (cacheValid)({ cp, main, source } = cached);
    else {
      main = [path.join(module, 'target/classes')];
      cp = [...main, path.join(module, 'target/test-classes'), ...read(out).trim().split(path.delimiter)];
      source = ['src/main/java', 'src/main/kotlin'].map(p => path.join(module, p));
    }
  } else throw Error(
    'no supported Gradle or Maven build in target module');
  const targetModule = moduleRoot(c.repo, t.file);
  if (targetModule !== module) { main = [...new Set([...main, ...cp.filter(p => p.startsWith(targetModule + path.sep) && !p.includes('test-classes') && !p .includes(path.sep + 'test' + path.sep))])];
    source = [...source, ...['src/main/java', 'src/main/kotlin'].map(p => path.join(targetModule, p))]; }
  const launcher = await launcherJar(cp, gradle ? null : mvn, { ...opts, cwd: module });
  if (launcher) cp.push(launcher);
  atomic(cacheFile, { hash: buildHash, cp, main, source, testClasses, compiledFingerprint, cpStamp:stamp(cp) });
  const tierA = t.language === 'kotlin' && (c.config.kotlinTier === 'A' || c.config.kotlinTier === 'auto' && (exists(path.join(c.repo,
    'arcmutate-licence.txt')) || process.env.ARCMUTATE_LICENCE));
  const junit5 = cp.some(p => p.includes('junit-jupiter')),
    toolJars = await jars(c, junit5, tierA),
    tier = tierA ? 'A' : 'B';
  const history = path.join(c.data, 'history', targetKey(t) + '.hist');
  mkdir(path.dirname(history));
  const args = ['-cp', toolJars.join(path.delimiter), 'org.pitest.mutationtest.commandline.MutationCoverageReport', '--classPath', cp.filter(Boolean).join(
      ','), '--sourceDirs', source.join(','), '--mutableCodePaths', main.join(','), '--reportDir', dir, '--targetClasses', pitTargets(c, t),
    '--targetTests', t.testNames.join(','), '--outputFormats', 'XML,CSV', '--mutators', 'DEFAULTS', '--timestampedReports', 'false',
    '--historyOutputLocation', history, '--threads', String(Math.min(4, os.availableParallelism())), '--timeoutConst', '4000', '--failWhenNoMutations',
    'false'
  ];
  if (exists(history)) args.push('--historyInputLocation', history);
  if (process.env.MUTAGATE_DEBUG === '1') args.push('--verbosity', 'VERBOSE_NO_SPINNER');
  if (t.language === 'kotlin' && tier === 'A') args.push('--features', '+KOTLIN');
  const run = await command(java, args, { ...opts, cwd: c.repo });
  return { raw: pitRaw(run.output + run.error, path.join(dir, 'mutations.xml')), kotlinTier: t.language === 'kotlin' ? tier : null };
}
async function stryker(c, t, dir, opts) {
  const req = createRequire(path.join(c.toolRepo || c.repo, 'package.json'));
  let core;
  try { core = req.resolve('@stryker-mutator/core/package.json'); } catch {
    throw Error(
      'install @stryker-mutator/core and its Jest or Vitest runner in the project');
  }
  let pkgDir = path.dirname(core);
  while (!exists(path.join(pkgDir, 'package.json'))) pkgDir = path.dirname(pkgDir);
  const info = json(path.join(pkgDir, 'package.json'));
  const bin = path.resolve(pkgDir, typeof info.bin === 'string' ? info.bin : Object.values(info.bin)[0]);
  const deps = { ...json(path.join(c.repo, 'package.json')).dependencies, ...json(path.join(c.repo, 'package.json')).devDependencies },
    runner = deps.vitest ? 'vitest' : 'jest';
  const cfg = {
    mutate: [t.file], testRunner: runner, reporters: ['json'], jsonReporter: { fileName: path.join(dir, 'mutation.json') }, incremental: true,
    incrementalFile: path.join(c.data, 'history', targetKey(t) + '.json'), tempDirName: path.join(dir, 'sandbox'),
    concurrency: Math.min(4, os .availableParallelism()), thresholds: { high: 100, low: 0, break: 0 }, cleanTempDir: true
  };
  if (runner === 'jest') {
    const existing = ['jest.config.cjs', 'jest.config.js', 'jest.config.json'].map(f => path.join(c.repo, f)).find(exists);
    const
      base = existing ? req(existing) : json(path.join(c.repo, 'package.json')).jest || {};
    cfg.jest = { enableFindRelatedTests: true, config: { ...base, testMatch: t.tests.map(f => '<rootDir>/' + f), testRegex: [] } };
  } else {
    const vc = path.join(dir, 'vitest.config.mjs');
    const existing = ['vitest.config.ts', 'vitest.config.mts', 'vitest.config.js', 'vite.config.ts', 'vite.config.js'].map(
      f => path.join(c.repo, f)).find(exists);
    atomic(vc,
      `${existing?`import base from ${JSON.stringify(existing)};`:'const base = {};'}\nexport default async (env) => { const c = typeof base === 'function' ? await base(env) : await base; return {...c, root:process.cwd(), test:{...c.test,include:${JSON.stringify(t.tests)}}}; };\n`
    );
    cfg.vitest = { related: true, configFile: vc };
  }
  mkdir(path.join(c.data, 'history'));
  const config = path.join(dir, 'stryker.config.json');
  atomic(config, cfg);
  await command(process.execPath, [bin, 'run', config], { ...opts, cwd: c.repo });
  return { raw: parseMutationTestingElements(json(path.join(dir, 'mutation.json')), c.repo) };
}
async function python(c, t, dir, opts) {
  const py = process.env.VIRTUAL_ENV ? path.join(process.env.VIRTUAL_ENV, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python') : 'python3';
  const project = c.toolRepo || c.repo,
    uv = exists(path.join(project, 'uv.lock')) || exists(path.join(project, 'pyproject.toml')) && /\[tool\.uv\]|\[dependency-groups\]|uv_build/.test(read(path.join(project, 'pyproject.toml')));
  const exe = uv ? 'uv' : py;
  const pythonArgs = uv ? ['run', '--project', project, '--no-sync', 'python'] : [];
  let v; try { v = await command(exe, [...pythonArgs, '-c', 'import importlib.metadata; print(importlib.metadata.version("mutmut"))'], { ...opts, cwd: c.repo }); } catch (e) { throw Error(`mutmut 2 or 3 must be installed in the project environment (${uv ? 'uv add --dev mutmut, then uv sync' : 'pip install mutmut'}): ${String(e.message).slice(0, 300)}`); }
  const [major, minor] = v.output.trim().split('.').map(Number), mm = require('./mutmut-bridge.cjs');
  if (![2, 3].includes(major)) throw Error('mutmut 2 or 3 must be installed in the project environment');
  const prefix = uv ? ['run', '--project', project, '--no-sync', 'mutmut'] : ['-c',
    `from mutmut.__main__ import ${major===2?'climain':'cli'}; ${major===2?'climain':'cli'}()`
  ];
  const work = path.join(dir, 'python'), inputs = require('./inputs.cjs').inputFiles(c, t);
  mkdir(work);
  for (const f of inputs) {
    const dest = path.join(work, f);
    mkdir(path.dirname(dest));
    fs.copyFileSync(path.join(c.repo, f), dest);
  }
  const cfg = path.join(work, 'setup.cfg');
  atomic(cfg, readIf(cfg).replace(/\[mutmut\][\s\S]*?(?=\n\[|$)/g, '') +
    `\n[mutmut]\npaths_to_mutate=${t.file}\ntests_dir=${t.tests.map(f=>path.dirname(f)).join(',')}\nrunner=${py} -m pytest -x -q ${t.tests.map(f=>JSON.stringify(f)).join(' ')}\n`
  );
  const toml = path.join(work, 'pyproject.toml');
  if (major === 3) atomic(toml, readIf(toml).replace(/\[tool\.mutmut\][\s\S]*?(?=\n\[|$)/g, '') + mm.tomlConfig(major, minor, t, inputs));
  const run = await command(exe, [...prefix, 'run', ...(major === 3 ? ['--max-children', '4'] : [])], { ...opts, cwd: work, allowFailure: true });
  if (run.signal) throw Error('mutation run budget exceeded');
  const out = run.error + '\n' + run.output, none = run.code && /runner returned 5\b/.test(out);
  if (none || run.code && require('./errors.cjs').BASELINE_RED.some(p => p.test(out))) {
    const baseline = await command(exe, [...pythonArgs, '-m', 'pytest', '-x', '-q', ...t.tests], { ...opts, cwd: c.repo, allowFailure: true }); if (baseline.signal) throw Error('mutation run budget exceeded');
    if (none) throw baseline.code === 5 ? Error(`pytest failed (5): collected no tests from ${t.tests.join(', ')}; fix the test file or function names`) : Object.assign(Error('no tests collected in the scoped copy; an input is missing (conftest.py, pytest config or a data file); set mainRoots or exclude'), { unscored: true });
    if (!baseline.code) throw Object.assign(Error('tests pass in the repo but fail in the scoped copy; an input is missing (conftest.py, package __init__.py or a data file); set mainRoots or exclude'), { scopedCopy: true });
    throw Error(`mutmut failed (${run.code}): ${out.split('\n').find(l => require('./errors.cjs').BASELINE_RED.some(p => p.test(l)))}`);
  }
  const bridge = mm.bridgeSource(major, minor);
  const result = await command(exe, uv ? ['run', '--project', project, '--no-sync', 'python', '-c', bridge] : ['-c', bridge], { ...opts, cwd: work });
  const raw = JSON.parse(result.output);
  if (run.code && !raw.length) throw Error(/could not find any test case for any mutant/.test(out) ? `mutmut failed (${run.code}): no test in ${t.tests.join(', ')} exercises ${t.target}; write one that calls its code or target the module the test covers` : `mutmut failed (${run.code}) with no mutants; see the runner log`);
  return { raw };
}

const TOOLS = { gomutants: 'github.com/szhekpisov/gomutants@v0.6.1', gremlins: 'github.com/go-gremlins/gremlins/cmd/gremlins@v0.6.0', 'dotnet-stryker': '5.0.0' };
const toolDirectory = (c, name) => path.join(c.root, 'tools', `${name}@${TOOLS[name]?.split('@v').at(-1) || 'unknown'}`);
function toolInstall(c, name) {
  const tools = toolDirectory(c, name);
  return name === 'dotnet-stryker' ? { exe: 'dotnet', args: ['tool', 'install', name, '--tool-path', tools, '--version', TOOLS[name]],
    env: { DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1' }, hint: `dotnet tool install ${name} --tool-path "${tools}" --version ${TOOLS[name]}` } :
    { exe: 'go', args: ['install', TOOLS[name]], env: { GOBIN: tools }, hint: 'go install ' + TOOLS[name] };
}
async function tool(c, name, install, opts = {}) {
  opts = { ...opts, deadline: opts.deadline || Date.now() + (opts.timeout || 300000) };
  const dir = toolDirectory(c, name), exe = path.join(dir, name + (process.platform === 'win32' ? '.exe' : ''));
  const probe = name === 'dotnet-stryker' ? '--help' : '--version'; // Stryker.NET 5 --version requires a value.
  const checkBudget = () => { if (Date.now() >= opts.deadline) throw Error('budget exceeded locating ' + name); };
  checkBudget();
  const release = await lock(dir + '.lock', Math.max(0, opts.deadline - Date.now()));
  if (!release) throw Error('budget exceeded waiting to install ' + name);
  try {
    checkBudget();
    if (exists(exe)) return exe;
    try { await command(name, [probe], { ...opts, deadline: Math.min(opts.deadline, Date.now() + 10000) }); return name; }
    catch { checkBudget(); }
    if (process.env.MUTAGATE_OFFLINE === '1' || !install) throw Error(`${name} unavailable; install with: ${toolInstall(c, name).hint}`);
    mkdir(dir);
    try { await command(install.exe, install.args, { ...opts, cwd: os.tmpdir(), env: { ...process.env, ...install.env } }); }
    catch (e) { throw Error(`${e.message}; install with: ${install.hint || toolInstall(c, name).hint}`); }
    if (!exists(exe)) throw Error(`${name} installation did not produce ${exe}`);
    return exe;
  } finally { release(); }
}
async function selectGo(c, opts) {
  if (c.config.goRunner !== 'gremlins') {
    try { return { runner: 'gomutants', exe: await tool(c, 'gomutants', toolInstall(c, 'gomutants'), opts) }; }
    catch (e) { if (c.config.goRunner === 'gomutants' || /SIGKILL|budget exceeded/.test(e.message)) throw Object.assign(e, { runner: 'gomutants' }); }
  }
  try { return { runner: 'gremlins', exe: await tool(c, 'gremlins', c.config.goRunner === 'gremlins' ? toolInstall(c, 'gremlins') : null, opts) }; }
  catch (e) { throw Object.assign(Error(`${e.message}; Go tools: ${toolInstall(c, 'gomutants').hint}; ${toolInstall(c, 'gremlins').hint}`), { runner: c.config.goRunner === 'gremlins' ? 'gremlins' : 'gomutants' }); }
}
async function goRunner(c, t, dir, opts) {
  const { runner, exe } = await selectGo(c, opts);
  try {
    const mod = path.resolve(c.repo, t.module), pkgDir = path.dirname(path.resolve(c.repo, t.file));
    if (!exists(path.join(mod, 'go.mod'))) throw Error(`go.mod not found above ${t.file}`);
    const entries = fs.readdirSync(pkgDir), base = runner === 'gomutants' ? mod : pkgDir;
    // gremlins 0.6 guesses imports from packages; build failures may look killed.
    if (runner === 'gremlins' && pkgDir !== mod && pkg(read(path.join(c.repo, t.file))) !== path.basename(pkgDir)) throw Error('gremlins requires the subdirectory name to match its Go package; use goRunner=gomutants');
    const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const siblings = entries.filter(f => f.endsWith('.go') && !f.endsWith('_test.go') && f !== path.basename(t.file))
      .map(f => '^' + escape(slash(path.relative(base, path.join(pkgDir, f)))) + '$');
    const others = entries.filter(f => f.endsWith('_test.go') && !t.tests.includes(slash(path.relative(c.repo, path.join(pkgDir, f)))))
      .flatMap(f => [...read(path.join(pkgDir, f)).matchAll(/^\s*func\s+(Test\w*)\s*\(/gm)].map(m => m[1]));
    const cfg = path.join(dir, 'go-config.yml'), workers = `--workers=${Math.min(4, os.availableParallelism())}`;
    atomic(cfg, '{}\n');
    const tags = c.config.goTags ? [`--tags=${c.config.goTags}`] : [];
    if (runner === 'gomutants') {
      mkdir(path.join(c.data, 'history'));
      const rel = slash(path.relative(mod, pkgDir));
      await command(exe, [`--config=${cfg}`, `--output=${path.join(dir, 'gomutants.json')}`, `--stryker-output=${path.join(dir, 'mutation.json')}`,
        `--cache=${path.join(c.data, 'history', targetKey(t) + '.gomutants.json')}`, workers, ...tags,
        ...(siblings.length ? [`--exclude-files=${siblings.join(',')}`] : []), ...(others.length ? [`--test-flags=-skip=^(${[...new Set(others)].join('|')})$`] : []),
        rel ? './' + rel : '.'], { ...opts, cwd: mod });
      // gomutants 0.6 keys are package-relative, despite module projectRoot.
      return { runner, raw: parseMutationTestingElements({ ...json(path.join(dir, 'mutation.json')), projectRoot: pkgDir }, c.repo).filter(m => m.file === t.file) };
    }
    await command(exe, ['unleash', `--config=${cfg}`, `--output=${path.join(dir, 'gremlins.json')}`, '--output-statuses=lctkv', workers, ...tags,
      ...siblings.map(s => `--exclude-files=${s}`), ...entries.filter(f => fs.statSync(path.join(pkgDir, f)).isDirectory()).map(f => `--exclude-files=^${escape(f)}/`)], { ...opts, cwd: pkgDir });
    return { runner, raw: parseGremlins(json(path.join(dir, 'gremlins.json')), slash(path.relative(c.repo, pkgDir))).filter(m => m.file === t.file) };
  } catch (e) { throw Object.assign(e, { runner }); }
}
function parseGremlins(report, base) {
  if (!Array.isArray(report.files)) throw Error('invalid gremlins JSON report');
  const statuses = { KILLED: 'KILLED', LIVED: 'SURVIVED', 'TIMED OUT': 'TIMED_OUT', 'NOT COVERED': 'NO_COVERAGE', 'NOT VIABLE': 'NON_VIABLE', SKIPPED: 'NON_VIABLE', RUNNABLE: 'PENDING' };
  return report.files.flatMap(f => f.mutations.map(m => ({ file: slash(path.join(base, f.file_name)), line: m.line, method: '', mutator: m.type,
    mutation_key: JSON.stringify([m.line, m.column, m.type]), description: `${m.type} at column ${m.column}`, status: statuses[m.status] || 'PENDING' })));
}
async function dotnetRunner(c, t, dir, opts) {
  const net = require('./dotnet.cjs'), test = net.projectDir(c.repo, t.tests[0]), target = net.projectDir(c.repo, t.file), filter = net.testFilter(c.repo, t.tests);
  const exe = await tool(c, 'dotnet-stryker', toolInstall(c, 'dotnet-stryker'), opts), out = path.join(dir, 'out'), cfg = path.join(dir, 'stryker-config.json');
  mkdir(out);
  atomic(cfg, { 'stryker-config': { project: target.name, mutate: [slash(path.relative(target.dir, path.resolve(c.repo, t.file)))], reporters: ['json'],
    'mutation-level': 'Standard', 'ignore-mutations': ['String'], // ponytail: log strings are noise; make configurable only if asked.
    'coverage-analysis': 'perTest', concurrency: Math.min(4, os.availableParallelism()), thresholds: { high: 100, low: 0, break: 0 },
    ...(filter ? { 'test-case-filter': filter } : {}) } });
  // Serialize Stryker.NET builds to protect outputs.
  const releases = []; let root;
  try {
    for (const p of net.projectLocks(c.repo, [test, target])) { const release = await lock(path.join(c.data, 'locks', 'dotnet-' + hash(p) + '.lock'), Math.max(0, opts.deadline - Date.now())); if (!release) throw Error('budget exceeded waiting for another Stryker.NET run on ' + p); releases.push(release); }
    root = net.scratch(c, t, require('./inputs.cjs').inputFiles);
    await command(exe, ['--config-file', cfg, '--output', out, '--skip-version-check'], { ...opts, cwd: path.join(root, path.relative(c.repo, test.dir)), env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1' } });
  } finally { releases.forEach(r => r()); }
  return { raw: parseMutationTestingElements(json(path.join(out, 'reports', 'mutation-report.json')), root).filter(m => m.file === t.file) };
}
return { command, jars, launcherJar, javaExe, pitTargets, pitRaw, pit, stryker, python, TOOLS, toolInstall, tool, selectGo, goRunner, parseGremlins, dotnetRunner };
};
