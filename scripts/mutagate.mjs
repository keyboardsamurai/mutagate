#!/usr/bin/env node

import fs from 'node:fs';
import { glob } from './glob.cjs';
export { glob } from './glob.cjs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const runtimeRequire = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url)),
  ROOT = path.dirname(HERE);
export const VERSION = '0.9.0';
export const DEFAULTS = {
  schema: 1, mode: 'gate', threshold: .8, maxSurvivors: 10, maxRounds: 2, runBudgetSec: 300, gateBudgetSec: 120, gateWaitSec: 60,
  countNoCoverage: true, gateSecondaries: false, languages: ['java', 'kotlin', 'python', 'typescript', 'go', 'csharp'], testGlobs: [], mainRoots: [],
  exclude: [ '**/generated/**', '**/build/**' ], javaRunner: 'standalone', kotlinTier: 'auto', goRunner: 'auto', goTags: '', allowAgentWaivers: false
};
export const hash = (s) => crypto.createHash('sha1').update(s).digest('hex');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const read = (p) => fs.readFileSync(p, 'utf8');
const exists = (p) => fs.existsSync(p);
const json = (p, fallback = {}) => exists(p) ? JSON.parse(read(p)) : fallback;
const mkdir = (p) => fs.mkdirSync(p, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const slash = (s) => s.split(path.sep).join('/');
const clean = (s) => String(s ?? '').replace(/[\x00-\x1f\x7f]/g, ' ');
const usageError = (m) => Object.assign(Error(m), { usage: true }); // main exits 2 and does not trace it
export function atomic(p, data) {
  mkdir(path.dirname(p));
  const tmp = `${p}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(tmp, typeof data === 'string' ? data : JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, p);
}
export function safePath(repo, input) {
  if (typeof input !== 'string' || !input || input.includes('\0')) return null;
  const p = path.resolve(repo, input),
    rel = path.relative(repo, p);
  if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) return null;
  let ancestor = p;
  while (!exists(ancestor) && ancestor !== path.dirname(ancestor)) ancestor = path.dirname(ancestor);
  const real = fs.realpathSync(ancestor),
    rr = path.relative(repo, real);
  return rr === '..' || rr.startsWith('..' + path.sep) || path.isAbsolute(rr) ? null : path.join(real, path.relative(ancestor, p));
}
export function parseArgs(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) out._.push(a);
    else {
      const [k, v] = a.slice(2).split(/=(.*)/s);
      out[k] = v ?? (args[i + 1] && !args[i + 1].startsWith('--') && !['sync', 'json', 'apply', 'mutate', 'record', 'version'].includes(k) ? args[++i] : true);
    }
  }
  return out;
}
export function cacheRoot(env = process.env) {
  return env.CLAUDE_PLUGIN_DATA || (process.platform === 'win32' ? path.join(env.LOCALAPPDATA || os.homedir(),
    'mutagate') : path.join(env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'mutagate'));
}
export function configFor(repo, root, args = {}, env = process.env) {
  const errors = [],
    cfg = { ...DEFAULTS };
  for (const p of [path.join(root, 'config.json'), env.MUTAGATE_CONFIG ? path.resolve(repo, env.MUTAGATE_CONFIG) : path.join(repo, '.mutagate/config.json')]) { try { Object.assign(cfg, json(p)); } catch { errors.push(`invalid config: ${p}`); } }
  for (const k of Object.keys(DEFAULTS)) {
    const ek = 'MUTAGATE_' + k.replace(/[A-Z]/g, m => '_' + m).toUpperCase(),
      fk = k.replace(/[A-Z]/g, m => '-' + m.toLowerCase());
    const v = args[fk] ?? env[ek];
    if (v !== undefined) {
      try {
        cfg[k] = typeof DEFAULTS[k] ===
          'string' ? String(v) : JSON.parse(String(v));
      } catch { errors.push(`invalid ${k}`); }
    }
  }
  for (const [k, d] of Object.entries(DEFAULTS))
    if (Array.isArray(d) ? !Array.isArray(cfg[k]) || cfg[k].some(x => typeof x !== 'string') : typeof cfg[k] !== typeof d) errors.push(`invalid ${k}`);
  for (const k of ['maxSurvivors', 'maxRounds', 'runBudgetSec', 'gateBudgetSec', 'gateWaitSec'])
    if (!Number.isFinite(cfg[k]) || cfg[k] < 0 || !Number.isInteger(cfg[k])) errors.push(`invalid ${k}`);
  if (!(cfg.threshold >= 0 && cfg.threshold <= 1) || cfg.schema !== 1 || !['gate', 'advise'].includes(cfg.mode) || !['auto', 'A', 'B'].includes(cfg.kotlinTier) || cfg.javaRunner !== 'standalone' || !['auto', 'gomutants', 'gremlins'].includes(cfg.goRunner)) errors.push('invalid configuration value (v1 supports javaRunner=standalone)');
  for (const key of ['testGlobs', 'exclude']) for (const pattern of Array.isArray(cfg[key]) ? cfg[key] : []) { try { glob(pattern); } catch { errors.push(`invalid ${key} glob: ${pattern}`); } }
  return { config: errors.length ? structuredClone(DEFAULTS) : cfg, errors: [...new Set(errors)] };
}
export function context(args = {}, payload = {}) {
  let repo = fs.realpathSync(path.resolve(args.repo || payload.cwd || process.cwd()));
  // Claude cwd follows `cd`; project dir stays fixed.
  if (!args.repo && payload.cwd && process.env.CLAUDE_PROJECT_DIR) try { const p = fs.realpathSync(process.env.CLAUDE_PROJECT_DIR); if (safePath(p, repo)) repo = p; } catch {}
  const root = cacheRoot();
  // Session id precedence: README Sessions. ponytail: subagent Bash env carries the parent id, so subagent CLI runs gate at the parent's Stop.
  const e = process.env, agentId = payload.agent_id || payload.session_id || e.MUTAGATE_HOOK_SESSION || e.CODEX_THREAD_ID || e.CLAUDE_CODE_SESSION_ID, sid = String(agentId ||
    e.MUTAGATE_SESSION || `ppid-${process.ppid}-${Math.floor(Date.now()/43200000)}`);
  const session = hash(sid),
    data = path.join(root, 'repos', hash(repo));
  const { config, errors } = configFor(repo, root, args);
  const harness = process.env.MUTAGATE_HARNESS || payload.harness || (process.env.CODEX_HOME || payload.turn_id ? 'codex' : process.env.CLAUDE_PLUGIN_ROOT ||
    process.env.CLAUDE_PROJECT_DIR ? 'claude' : 'unknown');
  return { repo, root, data, session, sid, agentSession: !!agentId, config, errors, harness: ['claude', 'codex', 'opencode', 'pi'].includes(harness) ? harness : 'unknown', args,
    stateFile: path.join(data, 'state', session + '.json') };
}
const blankState = () => ({ schema: 1, targets: {}, choices: {}, warnings: [], events: [], notified: [] });
export const state = (c) => json(c.stateFile, blankState());
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
async function lock(p, budget = 5000) {
  mkdir(path.dirname(p));
  const end = Date.now() + budget;
  while (true) {
    try {
      const fd = fs.openSync(p, 'wx', 0o600);
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, at: Date.now() }));
      fs.closeSync(fd);
      return () => { try { fs.unlinkSync(p); } catch {} };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try {
        const owner = json(p);
        if (
          owner.pid && !alive(owner.pid)) { fs.unlinkSync(p); continue; }
      } catch { const st = fs.statSync(p, { throwIfNoEntry: false }); if (st && Date.now() - st.mtimeMs > 10000) fs.rmSync(p, { force: true }); }
      if (
        Date.now() >= end) return null;
      await sleep(25);
    }
  }
}
export async function updateState(c, fn) {
  const release = await lock(c.stateFile + '.lock');
  if (!release) throw Error('session state busy');
  try {
    const s =
      state(c);
    const result = fn(s);
    s.updated_at = Date.now();
    atomic(c.stateFile, s);
    return result;
  } finally { release(); }
}
export function trace(c, event, fields = {}) {
  if (process.env.MUTAGATE_TRACE !== '1') return;
  try { mkdir(c.data);
    fs.appendFileSync(path.join(c.data, 'trace.jsonl'), JSON.stringify({ ts: new Date().toISOString(), harness: c.harness, event, session: c.sid, ...fields }) +
      '\n'); } catch {}
}

const TESTS = ['**/src/test/**/*.{java,kt}', '**/*{Test,Tests,Spec,IT}.{java,kt,cs}', '**/*_test.go', '**/test_*.py', '**/*_test.py', '**/tests/**/*.py',
  '**/*.{test,spec}.{ts,tsx,js,jsx}', '**/__tests__/**'
];
export function isTest(file, cfg = DEFAULTS) { return (cfg.testGlobs.length ? cfg.testGlobs : TESTS).some(g => glob(g).test(slash(file))); }
const SUPPORT = /(^|\/)(conftest|__init__)\.py$/; // never registered as runnable tests
export function files(repo, cfg = DEFAULTS) {
  const out = [];

  function visit(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true }), dotnet = entries.some(e => e.isFile() && e.name.endsWith('.csproj'));
    for (const e of entries) {
      if (dotnet && e.isDirectory() && ['bin', 'obj'].includes(e.name)) continue;
      if (e.isSymbolicLink() || e.name.startsWith('.') || ['node_modules', 'venv', 'build', 'target', 'state-data', '__pycache__', 'mutants', 'StrykerOutput', 'TestResults', 'dist'].includes(e.name)) continue;
      const p = path.join(dir, e.name),
        r = slash(path.relative(repo, p));
      if (cfg.exclude.some(g => glob(g).test(r))) continue;
      if (e.isDirectory()) visit(p);
      else out.push(r);
    }
  }
  visit(repo);
  return out;
}
export const language = (p) => p.endsWith('.kt') ? 'kotlin' : p.endsWith('.java') ? 'java' : p.endsWith('.py') ? 'python' : p.endsWith('.go') ? 'go' : p.endsWith('.cs') ? 'csharp' : 'typescript';
export const RUNNER = { java: 'pitest', kotlin: 'pitest', python: 'mutmut', typescript: 'stryker', go: 'gomutants', csharp: 'stryker-net' };
const CONFIG = /(^|\/)(?:[\w.-]+\.config\.[cm]?[jt]sx?|(?:Global)?Usings\.cs|jest\.setup\.[jt]s)$/;
const GENERATED = /(?:\.pb\.go|_gen\.go|(?:^|\/)zz_generated[^/]*\.go|(?:^|\/)mock_[^/]*\.go|_mock\.go|\.Designer\.cs|\.g\.cs|\.g\.i\.cs|(?:^|\/)Migrations\/[^/]*\.cs)$/;
const pkg = (s) => s.match(/^\s*package\s+([\w.]+)/m)?.[1] || '';
export function moduleRoot(repo, file) {
  let d = path.dirname(path.resolve(repo, file));
  while (d !== repo) {
    if (['build.gradle', 'build.gradle.kts', 'pom.xml', 'go.mod'].some(f => exists(path.join(d, f))) || fs.readdirSync(d).some(f => f.endsWith('.csproj'))) return d;
    const next = path.dirname(d);
    if (next === d) break;
    d = next;
  }
  return repo;
}
export function resolveTargets(c, test, explicit) {
  const abs = safePath(c.repo, test);
  if (!abs || !fs.statSync(abs, { throwIfNoEntry: false })?.isFile()) throw usageError('test file is missing, not a file or outside repository');
  test = slash(path.relative(c.repo, abs));
  if (!isTest(test, c.config) || SUPPORT.test(test)) throw usageError(`${test} is not a test file; run it on the test, and name the production target with --target`);
  const lang = language(test),
    src = read(abs), inTestProject = lang === 'csharp' ? runtimeRequire('./dotnet.cjs').inTestProject(c.repo) : () => false, // never a test project file as the target
    all = files(c.repo, c.config).filter(f => !isTest(f, c.config) && !GENERATED.test(f) && !inTestProject(f));
  const mod = moduleRoot(c.repo, test),
    stem = path.basename(test).replace(/\.(java|kt|py|tsx?|jsx?|go|cs)$/, '').replace(/(?:Integration)?(?:Tests?|Spec|IT)$/, '').replace(/^test_/, '').replace(/_test$/, '').replace(
      /\.(test|spec)$/, '');
  const candidates = all.filter(f => language(f) === lang || ['java', 'kotlin'].includes(lang) && /\.(java|kt)$/.test(f)).flatMap(file => {
    if (!['java', 'kotlin'].includes(lang)) return [{ file, target: file }];
    const body = read(path.join(c.repo, file)),
      names = [...body.matchAll(/\b(?:class|interface|object)\s+([A-Za-z_$][\w$]*)/g)].map(m => m[1]);
    return [...new Set(names.length ? names : [path.basename(file).replace(/\.(java|kt)$/, '')])].map(name => ({
      file, target: [pkg(body), name].filter( Boolean).join('.')
    }));
  });
  const imports = [...src.matchAll(/(?:^\s*import\s+([\w.]+)|^\s*from\s+([.\w]+)\s+import\s+(?:\(([^)]*)\)|(.+))|(?:from\s*|require\(\s*)['"]([^'"]+)['"])/gm)]
    .flatMap(m => m[2] ? [m[2], ...(m[3] ?? m[4]).split(',').map(n => n.trim().split(/\s+as\s+/)[0]).filter(Boolean).map(n => m[2] + '.' + n)] : [m[1] || m[5]]); // ponytail: relative from . import x stays unresolved
  const main = candidates.filter(x => ['java', 'kotlin'].includes(lang) ? /(^|\/)src\/main\//.test(x.file) || c.config.mainRoots.some(r => x.file.startsWith(r +
    '/')) : true);
  const jvm = ['java', 'kotlin'].includes(lang), simple = x => jvm ? x.target.split('.').at(-1) : path.basename(x.file).replace(/\.\w+$/, ''), near = x => pkg(read(path.join(c.repo, x.file))) === pkg(src) && path.resolve(c.repo, x.file).startsWith(mod + path.sep),
    pre = main.filter(x => jvm ? stem.startsWith(simple(x)) : ['_', '.'].some(b => stem.startsWith(simple(x) + b))); // non-JVM: test_api_unit.py -> api.py at a word boundary
  let primary = main.filter(x => simple(x) === stem);
  if (!primary.length && jvm && stem) primary = main.filter(x => simple(x).startsWith(stem)); // ponytail: prefix guess; exact match still wins
  // FooSmokeTest -> Foo: longest local prefix.
  if (!primary.length && pre.length) { const set = [x => !jvm && path.dirname(x.file) === path.dirname(test), near].map(f => pre.filter(f)).find(s => s.length) || pre, max = Math.max(...set.map(x => simple(x).length)); primary = set.filter(x => simple(x).length === max); }
  if (jvm) {
    const local = primary.filter(near);
    if (local.length) primary = local;
  } else {
    const alongside = primary.filter(x => path.dirname(x.file) === path.dirname(test));
    if (alongside.length) primary = alongside;
  }
  const siblings = main.filter(x => path.dirname(x.file) === path.dirname(test) && /\.(py|tsx?|jsx?|go|cs)$/.test(x.file));
  if (!primary.length && lang === 'go' && siblings.length === 1) primary = siblings; // Go tests are package-scoped: a lone source file is the target.
  const chosen = explicit || state(c).choices[test];
  if (chosen) primary = main.filter(x => x.target === chosen || x.file === chosen);
  if (chosen && !primary.length) throw usageError(`no production file matches --target ${chosen}; use a repo-relative path or one of the listed candidates`);
  if (primary.length !== 1) {
    const candidates = (primary.length ? primary : (jvm ? main.filter(x => x.target.split('.').slice(0, -1).join('.') === pkg(src)) : lang === 'csharp' ? main : siblings).slice(0, 10)).map(x => x.target);
    return { test, ambiguous: true, candidates,
      message: `mutagate: target unresolved for ${test}. Candidates: ${candidates.join(', ') || 'none'}. Select with ${cliName(c)} run ${test} --target <target>.` };
  }
  const secondary = ['go', 'csharp'].includes(lang) ? [] : main.filter(x => x.file !== primary[0].file && imports.some(i => i === x.target || (i.startsWith('.') ? path.resolve(path.dirname(abs), i).replace(/\.(tsx?|jsx?)$/, '') === path.resolve(c.repo, x.file).replace(/\.(tsx?|jsx?)$/, '') : x.file.replace(/\.py$/, '').replaceAll('/', '.') === i
  )));
  return {
    test,
    targets: [primary[0], ...secondary].map((x, i) => ({
      ...x, language: language(x.file), module: slash(path.relative(c.repo, mod)), tests: [ test ],
      testNames: [ ['java', 'kotlin'].includes(lang) ? [pkg(src), path.basename(test).replace(/\.(java|kt)$/, '')].filter(Boolean).join('.') : test ],
      secondary: i > 0
    }))
  };
}
export function extractPaths(p) {
  const input = p.tool_input || {},
    out = [input.file_path, input.filePath, input.path].filter(x => typeof x === 'string');
  if (p.tool_name === 'apply_patch')
    for (const m of String(input.command || '').matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)\r?$/gm)) out.push(m[1].trim());
  return [...new Set(out)];
}
export function fingerprint(c,t) {
  const { inputFiles, fileDigest } = runtimeRequire('./inputs.cjs');
  const implementation = ['mutagate.mjs', 'inputs.cjs', 'kotlin-source.cjs', 'glob.cjs', 'mutmut-bridge.cjs', 'errors.cjs', 'dotnet.cjs'].map(f => fileDigest(path.join(HERE, f)));
  return hash(JSON.stringify([implementation, fileDigest(path.join(ROOT, 'references/kotlin-junk.yaml')), fileDigest(path.join(ROOT, 'references/jars.json')), t.tests, t.testNames, c.config, inputFiles(c,t).map(f => [f, fileDigest(path.join(c.repo,f))])]));
}
export const targetKey = t => hash([t.module, t.target].filter(Boolean).join(':'));
const resultFile = (c, key) => path.join(c.data, 'results', c.session, key + '.json');
const targetLock = (c, key) => path.join(c.data, 'locks', key + '.lock');

function inFlight(c, key) { const p = targetLock(c, key); if (!exists(p)) return false; try { return alive(json(p).pid); } catch { return true; } }
// Find repo builds by their launcher command line.
// ponytail: POSIX ps only; misses Windows, mvnd and a system gradle without the wrapper.
export function buildRunning(c) {
  if (process.platform === 'win32') return false;
  const ps = spawnSync('ps', ['-Aww', '-o', 'args='], { encoding: 'utf8', timeout: 2000 }).stdout || '';
  return ps.split('\n').some(l => [c.repo + '/', c.repo + ' '].some(p => (l + ' ').includes(p)) && /plexus\.classworlds\.launcher\.Launcher|gradle-wrapper\.jar/.test(l));
}
// Drop unresolved warnings for deleted tests.
const liveWarnings = c => state(c).warnings.filter(w => { const f = w.match(/^mutagate: target unresolved for (.+?)\. Candidates:/)?.[1]; return !f || exists(path.join(c.repo, f)); });
// Edited files without targets: hints, not obligations.
const untargeted = c => { const s = state(c), l = (s.edited || []).filter(f => !CONFIG.test(f) && !(f.endsWith('.cs') && runtimeRequire('./dotnet.cjs').inTestProject(c.repo)(f)) && !Object.values(s.targets).some(t => t.file === f) && exists(path.join(c.repo, f)));
  return l.length ? `mutagate: not mutation-tested, no test targets them: ${l.slice(0, 8).join(', ')}${l.length > 8 ? ` (+${l.length - 8} more)` : ''}. Write tests for them to gate them.` : ''; };
const gone = (c, t) => !exists(path.join(c.repo, t.file));
export function status(c, json) {
  const s = state(c), targets = Object.entries(s.targets).filter(([, t]) => !gone(c, t)).map(([key, t]) => ({
    target: t.target, file: t.file, tests: t.tests, secondary: t.secondary, blocks: t.blocks, stale: !loadResult(c, key, t), in_flight: inFlight(c, key),
    result: loadResult(c, key, t)
  }));
  if (json) return JSON.stringify(targets);
  // List survivors, waiver ids and unresolved tests.
  return [...targets.flatMap(({ target, result: r, stale, in_flight }) => {
    const flags = `${stale?' stale':''}${in_flight?' running':''}`;
    if (!r) return [`${target}: unscored${flags}`];
    if (r.status === 'unscored' && r.error) return [`${target}: unscored${flags}: ${r.error}`];
    if (r.status === 'error') return [`${target}: error${flags}: ${r.error}`];
    return [`${target}: score ${r.score===null?'unscored':r.score.toFixed(2)} (${r.killed}/${r.killed+r.survived}), ${r.status}${flags}`,
      ...r.survivors.map(m => `  ${m.file}:${m.line} ${m.method}: ${m.plain} [${m.short}] id ${m.id}`), ...(r.warnings || []).map(w => `  ${w}`)];
  }), ...liveWarnings(c), untargeted(c)].filter(Boolean).join('\n') || 'mutagate: no targets touched this session.';
}
export async function register(c, test, explicit) {
  const r = resolveTargets(c, test, explicit);
  if (!c.config.languages.includes(language(test))) return { test, targets: [], disabled: true, message: 'mutagate: language disabled by configuration' };
  // Keep unresolved warnings per test for the gate.
  const others = s => s.warnings.filter(w => !w.startsWith(`mutagate: target unresolved for ${test}.`));
  if (r.ambiguous) { await updateState(c, s => { s.warnings = [...others(s), r.message]; }); return r; }
  await updateState(c, s => {
    s.config = c.config;
    s.warnings = others(s);
    if (explicit) s.choices[r.test] = explicit;
    for (const t of r.targets) {
      const key = targetKey(t),
        old = s.targets[key],
        tests = [...new Set([...(old?.tests || []), ...t.tests])], testNames = [...new Set([...(old?.testNames || []), ...t.testNames])],
        // Same tests keep fresh results; fingerprints cover contents.
        same = old && JSON.stringify([old.tests, old.testNames]) === JSON.stringify([tests, testNames]);
      s.targets[key] = {
        ...old, ...t, tests, testNames,
        secondary: old ? old.secondary && t.secondary : t.secondary, generation: (old?.generation || 0) + (same ? 0 : 1), changedAt: same ? old.changedAt : Date.now(),
        blocks: old ?.blocks || 0, rerun_requested: inFlight(c, key)
      };
    }
  });
  return r;
}
const xmlText = (s) => s.replace(/&(?:lt|gt|amp|quot|apos);/g, x => ({ '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&apos;': "'" } [x])).replace(
  /&#(x[\da-f]+|\d+);/gi, (_, x) => String.fromCodePoint(x[0] === 'x' ? parseInt(x.slice(1), 16) : Number(x)));
export function parsePitXML(text) {
  if (!text.includes('<mutations')) throw Error('invalid PIT XML report');
  return [...text.matchAll( /<mutation\s+([^>]+)>([\s\S]*?)<\/mutation>/g)].map(m => {
    const field = n => xmlText(m[2].match(new RegExp('<' + n + '>([\\s\\S]*?)</' + n + '>'))?.[
      1
    ] || '');
    return {
      file: field('sourceFile'), class: field('mutatedClass'), method: field('mutatedMethod'), line: Number(field('lineNumber')),
      mutator: field('mutator'), description: field('description'),
      mutation_key: (m[2].match(/<indexes>([\s\S]*?)<\/indexes>/)?.[1] || '') + field( 'description'), status: m[1].match(/status=['"]([^'"]+)/)?.[1]
    };
  });
}
export function parseCSV(text) {
  const rows = [];
  let row = [],
    s = '',
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') {
        s += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && (ch === ',' || ch === '\n')) {
      row.push(s.replace(/\r$/, ''));
      s = '';
      if (ch === '\n') {
        rows.push(row);
        row = [];
      }
    } else s += ch;
  }
  if (s || row.length) {
    row.push(s);
    rows.push(row);
  }
  return rows.filter(r => r.length > 1);
}
export function parseMutationTestingElements(report, repo) {
  if (!report.files) throw Error('invalid mutation-testing-elements report');
  const real = p => { try { return fs.realpathSync(p); } catch { return p; } };
  const rel = f => slash(path.isAbsolute(f) ? path.relative(repo, real(f)) : report.projectRoot ? path.relative(repo, real(path.resolve(report.projectRoot, f))) : f);
  return Object.entries(report.files).flatMap(([file, f]) =>
    f.mutants.map(m => ({
      file: rel(file),
      line: m.location.start.line,
      method: '',
      mutator: m.mutatorName, ...(m.status === 'Ignored' ? { ignored: true } : {}),
      mutation_key: JSON.stringify([m.location, m.replacement]),
      description: `${m.mutatorName}: replaced with ${m.replacement ?? '(removed)'}`,
      status: ({
        Killed: 'KILLED', Survived: 'SURVIVED', Timeout: 'TIMED_OUT', NoCoverage: 'NO_COVERAGE', CompileError: 'NON_VIABLE', RuntimeError: 'RUN_ERROR',
        Ignored: 'NON_VIABLE', Pending: 'PENDING'
      })[m.status] || 'PENDING'
    })));
}
export function junkRule(m, rules, source = '') {
  const { dataClassRule, continuationRule } = runtimeRequire('./kotlin-source.cjs');
  const generated = dataClassRule(m, source) || continuationRule(m, source);
  if (generated) return generated;
  return m.file.endsWith('.kt') ? rules.find(r => Object.entries(r.match).length && Object.entries(r.match).every(([k, v]) =>
    new RegExp(v).test(m[k] || ''))) : undefined;
}
const MUTATORS = [
  [/ConditionalsBoundary|CONDITIONALS_BOUNDARY|EqualityOperator|Equality mutation/, 'boundary', 'comparison boundary changed and no test noticed'],
  [/NegateConditionals|RemoveConditional|NEGATE_CONDITIONALS|ConditionalExpression|BooleanLiteral|CONDITIONALS_NEGATION|INVERT_LOGICAL|REMOVE_LOGICAL_NOT|INVERT_LOOP_?CTRL|LOOP_CONDITION|RANGE_BREAK|EXPRESSION_REMOVE|Boolean mutation|Logical mutation|Negate expression|LogicalNotExpression|Conditional \(/, 'conditional', 'condition changed and no test noticed'],
  [/Return|RETURNS|RETURN_VALS|RETURN_/, 'return', 'return value replaced and no test noticed'],
  [/Math|MATH|ArithmeticOperator|ARITHMETIC_BASE|INVERT_BITWISE|INVERT_BW|INVERT_ASSIGNMENTS|REMOVE_SELF_ASSIGNMENTS|Arithmetic mutation|Bitwise mutation|AssignmentExpression to/, 'math', 'arithmetic changed and no test noticed'],
  [/Increments|INCREMENTS|UpdateOperator|INCREMENT_DECREMENT|INTEGER_(?:IN|DE)CREMENT|FLOAT_(?:IN|DE)CREMENT|IncrementExpression|DecrementExpression/, 'increment', 'increment changed and no test noticed'],
  [/ERRORF_WRAP/, 'error-wrap', 'error wrapping (%w) dropped and no test noticed'],
  [/VoidMethodCall|VOID_METHOD_CALLS|BlockStatement|STATEMENT_REMOVE|BRANCH_|Statement mutation|Block removal/, 'void-call', 'call or block removed and no test noticed'],
  [/InvertNeg|INVERT_NEGS|UnaryOperator|INVERT_NEGATIVES|UnaryMinusExpression|UnaryPlusExpression/, 'negation', 'numeric sign changed and no test noticed']
];
export function plainMutation(m, c) {
  if (m.status === 'NO_COVERAGE') return 'line was not covered by the scoped tests';
  const source = safePath(c.repo, m.file),
    line = source ? readIf(source).split('\n')[m.line - 1] || '' : '';
  if (/ConditionalsBoundary|CONDITIONALS_BOUNDARY/.test(m.mutator)) {
    const operators = line.match(/>=|<=|(?<![=>])>(?![=>])|(?<![=<])<(?![=<])/g) || [];
    if (operators.length === 1) return `${operators[0]} became ${{'>=':'>','<=':'<','>':'>=','<':'<='}[operators[0]]} and no test noticed`;
  }
  if (m.mutator.startsWith('mutmut:')) { const edits = m.description.split('; '),
      old = edits.find(x => x.startsWith('-')),
      next = edits.find(x => x.startsWith('+')); if (old && next) return `${old.slice(1).trim()} became ${next.slice(1).trim()} and no test noticed`; }
  // Mutation-testing-elements columns are 1-based and end-exclusive; gomutants counts bytes, Stryker UTF-16 units, so ASCII lines only.
  // Padded replacements such as gomutants RANGE_BREAK " break;" are insertions, not substitutions.
  try { const [loc, next] = JSON.parse(m.mutation_key), old = line.slice(loc.start.column - 1, loc.end.column - 1).trim();
    if (loc.start.line === m.line && loc.end.line === m.line && typeof next === 'string' && !/^\s|\s$|[\n\r]/.test(next) && !/[^\x00-\x7f]/.test(line) && old && old.length <= 60 && next.length <= 60) return `${old} became ${next} and no test noticed`; } catch {}
  const mapped = MUTATORS.find(x => x[0].test(m.mutator));
  return mapped?.[2] || m.description || `${m.mutator} changed and no test noticed`;
}
export const cliName = c => { const p = slash(path.relative(c.repo, path.join(HERE, 'mutagate'))); return p.startsWith('..') || path.isAbsolute(p) ? 'mutagate' : p; };
export const NO_MUTANTS = 'no mutants to test';
export function normalize(raw, c, t, meta = {}) {
  const rules = JSON.parse(read(path.join(ROOT, 'references/kotlin-junk.yaml'))),
    waivers = json(path.join(c.repo, '.mutagate/waivers.json'), { waivers: [] }).waivers;
  if (!Array.isArray(waivers)) throw Error('invalid waivers.json');
  const filtered = [],
    mutants = raw.map(m => ({ ...m, file: slash(m.file === path.basename(t.file) ? t.file : m.file) }));
  let killed = 0,
    survived = 0,
    timed_out = 0,
    no_coverage = 0,
    waived = 0,
    error_mutants = 0;
  const diff = spawnSync('git', ['diff', 'HEAD', '--unified=0', '--', t.file], { cwd: c.repo, encoding: 'utf8', timeout: 2000 }).stdout || '';
  const lines = new Set();
  for (const m of diff.matchAll(/^@@ .* \+(\d+)(?:,(\d+))? @@/gm))
    for (let n = 0; n < Number(m[2] ?? 1); n++) lines.add(Number(m[1]) + n);
  const survivors = [],
    ids = new Set();
  for (const m of mutants) {
    if (m.ignored) continue;
    const id = hash(`${m.file}:${m.line}:${m.mutator}:${m.method}:${m.mutation_key||''}`);
    ids.add(id);
    const rule = meta.kotlinTier === 'A' ? null : junkRule(m, rules, readIf(safePath(c.repo, m.file) || ''));
    if (rule) { filtered.push({ ...m, id, rule: rule.id }); continue; }
    if (!['KILLED', 'TIMED_OUT', 'SURVIVED', 'NO_COVERAGE'].includes(m.status)) { error_mutants++; continue; }
    const isWaived = waivers.some(w => w.id === id && w.target === t.target && w.reason?.trim());
    if (isWaived) { waived++; continue; }
    if (m.status === 'NO_COVERAGE') no_coverage++;
    if (m.status === 'TIMED_OUT') timed_out++;
    if (['KILLED', 'TIMED_OUT'].includes(m.status)) { killed++; continue; }
    if (m.status === 'NO_COVERAGE' && !c.config.countNoCoverage) continue;
    survived++;
    const rank = MUTATORS.findIndex(x => x[0].test(m.mutator)),
      mapped = MUTATORS[rank];
    survivors.push({
      ...m, id, plain: clean(plainMutation(m, c)),
      public: m.public ?? (t.language === 'python' ? !m.method.startsWith('_') : /\bpublic\b|\bexport\b/.test(readIf(path.join(c.repo, t.file)).split('\n')[ m.line - 1] || '') || t.language === 'kotlin' && !/\bprivate\b|\bprotected\b|\binternal\b/.test(readIf(path.join(c.repo, t.file)).split('\n')[m .line - 1] || '')),
      severity: rank < 0 ? 99 : rank, short: m.status === 'NO_COVERAGE' ? 'no coverage' : mapped?.[1] || 'mutation', in_diff: lines.has(m .line),
      waived: false
    });
  }
  survivors.sort((a, b) => Number(b.in_diff) - Number(a.in_diff) || Number(b.public || false) - Number(a.public || false) || a.severity - b.severity || a.line -
    b.line);
  const score = killed + survived ? killed / (killed + survived) : waived > 0 ? 1 : null;
  return {
    schema: 1,
    target: t.target,
    language: t.language,
    runner: RUNNER[t.language],
    tests: t.testNames,
    started_at: meta.started_at || new Date().toISOString(),
    duration_ms: meta.duration_ms || 0,
    score,
    killed,
    survived,
    timed_out,
    no_coverage,
    filtered_junk: filtered.length,
    filtered,
    waived,
    error_mutants,
    threshold: c.config.threshold,
    status: score === null ?
      'unscored' : score < c.config.threshold ? 'below' : mutants.some(m => m.status === 'PENDING') ? 'unscored' : 'pass',
    error: score !== null || mutants.some(m => m.status === 'PENDING') ? null : error_mutants ? `${no_coverage ? 'mutants' : 'every mutant'} errored (${error_mutants} of ${error_mutants + no_coverage}); the tests may not run against the mutated copy, see the runner log` : no_coverage ? 'no mutant is covered by the registered tests' : `${NO_MUTANTS} in ${t.file}${filtered.length ? ` (${filtered.length} filtered as junk)` : ''}`,
    survivors,
    warnings: waivers.filter(w => w.target === t.target && !ids.has(w.id)).map(w => `waiver ${w.id} no longer matches`),
    ...meta
  };
}
const FOOTER = "Kill survivors with tests; don't weaken reachable code to pass, and tell the user about any production change made for the gate. Details: mutagate status. Playbook: references/survivor-playbook.md.";
// One final footer avoids repeated-message noise.
export function joinReports(list, max = Infinity) {
  const bodies = list.map(s => s.endsWith('\n' + FOOTER) ? s.slice(0, -FOOTER.length - 1) : s), text = bodies.join('\n');
  return bodies.some((b, i) => b !== list[i]) ? text.slice(0, max - FOOTER.length - 1) + '\n' + FOOTER : text.slice(0, max);
}
export function report(r, cfg = DEFAULTS) {
  if (r.status === 'unscored' && r.error) return `mutagate: ${clean(r.target)} unscored: ${clean(r.error)}`;
  if (r.status === 'error') return `mutagate: ${clean(r.target)} could not be scored: ${clean(r.error)}. ${r.agent_caused ? 'Fix the failing or non-compiling tests; mutation testing needs them green.' : 'Fix the build or test compilation first; otherwise this is an infrastructure error.'}`.slice(0, 1800);
  const footer = r.survived > 0 ? '\n' + FOOTER : '', lines = [], groups = new Map();
  let shown = 0;
  const heading = n =>
    `mutagate: ${clean(r.target)} score ${r.score===null?'unscored':r.score.toFixed(2)} (${r.killed}/${r.killed+r.survived}), threshold ${r.threshold.toFixed(2)}. ${n} survivors shown of ${r.survived}.`;
  // Dedupe survivor lines.
  for (const m of r.survivors) { const k = `${clean(m.file)}:${m.line} ${clean(m.method)}: ${clean(m.plain)} [${clean(m.short)}]${m.in_diff?' (changed in this diff)':''}`; groups.set(k, (groups.get(k) || 0) + 1); }
  for (const [k, n] of [...groups].slice(0, cfg.maxSurvivors)) {
    const line = n > 1 ? `${k} ×${n}` : k;
    if ((heading(shown + n) + '\n' + [...lines, line, ...(r.warnings || [])].join('\n') + footer).length > 1800) break;
    lines.push(line); shown += n;
  }
  return [heading(shown), ...lines, ...(r.warnings || [])].join('\n').slice(0, 1800 - footer.length) + footer;
}
export async function command(exe, args, opts = {}) {
  return new Promise((resolve, reject) => {
    let output = '',
      error = '';
    const win = process.platform === 'win32' && (/\.(bat|cmd)$/i.test(exe) || ['mvn', 'gradle'].includes(exe)),
      ps = "& '" + exe.replaceAll("'", "''") + "' " + args.map(a => "'" + String(a).replaceAll("'", "''") + "'").join(' ') + "; exit $LASTEXITCODE";
    const child = spawn(win ? 'powershell.exe' : exe, win ? ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString( 'base64')] : args, {
        cwd: opts.cwd, env: opts.env || process.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached: process .platform !== 'win32'
      });
    const timer = setTimeout(() => {
      try {
        if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
        else spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
      } catch {}
    }, Math.max(1, opts.deadline ? opts.deadline - Date.now() :
      opts.timeout || 300000));
    child.stdout.on('data', b => { output = (output + b).slice(-4000000); });
    child.stderr.on('data', b => { error = (error + b).slice(-4000000); });
    child.on('error', e => {
      clearTimeout(timer);
      reject(Error(`${path.basename(exe)} unavailable: ${e.message}`));
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
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
export async function launcherJar(cp, mvn, opts) {
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
export const pitTargets = (c, t) => [t.target, t.language === 'kotlin' && t.file.endsWith('.kt') && runtimeRequire('./kotlin-source.cjs').facadeClass(t.file,
  readIf(path.join(c.repo, t.file)))].filter(Boolean).flatMap(x => [x, x + '$*']).join(',');
export const pitRaw = (out, xml) => /Created 0 mutation test units/.test(out) ? [] : parsePitXML(read(xml));
async function pit(c, t, dir, opts) {
  const java = javaExe(c.repo);
  const version = await command(java, ['-version'], opts);
  if (Number((version.error + version.output).match(/version "(?:1\.)?(\d+)/)?.[1] || 0) < 11) throw Error('JDK 11 or later is required');
  const module = path.resolve(c.repo, t.module),
    gradle = ['build.gradle', 'build.gradle.kts'].some(f => exists(path.join(module, f)));
  let cp, main, source, testClasses;
  const buildHash = hash(runtimeRequire('./inputs.cjs').inputFiles(c, t).filter(f =>
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
  const [major, minor] = v.output.trim().split('.').map(Number), mm = runtimeRequire('./mutmut-bridge.cjs');
  if (![2, 3].includes(major)) throw Error('mutmut 2 or 3 must be installed in the project environment');
  const prefix = uv ? ['run', '--project', project, '--no-sync', 'mutmut'] : ['-c',
    `from mutmut.__main__ import ${major===2?'climain':'cli'}; ${major===2?'climain':'cli'}()`
  ];
  const work = path.join(dir, 'python'), inputs = runtimeRequire('./inputs.cjs').inputFiles(c, t);
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
  if (none || run.code && runtimeRequire('./errors.cjs').BASELINE_RED.some(p => p.test(out))) {
    const baseline = await command(exe, [...pythonArgs, '-m', 'pytest', '-x', '-q', ...t.tests], { ...opts, cwd: c.repo, allowFailure: true }); if (baseline.signal) throw Error('mutation run budget exceeded');
    if (none) throw baseline.code === 5 ? Error(`pytest failed (5): collected no tests from ${t.tests.join(', ')}; fix the test file or function names`) : Object.assign(Error('no tests collected in the scoped copy; an input is missing (conftest.py, pytest config or a data file); set mainRoots or exclude'), { unscored: true });
    if (!baseline.code) throw Object.assign(Error('tests pass in the repo but fail in the scoped copy; an input is missing (conftest.py, package __init__.py or a data file); set mainRoots or exclude'), { scopedCopy: true });
    throw Error(`mutmut failed (${run.code}): ${out.split('\n').find(l => runtimeRequire('./errors.cjs').BASELINE_RED.some(p => p.test(l)))}`);
  }
  const bridge = mm.bridgeSource(major, minor);
  const result = await command(exe, uv ? ['run', '--project', project, '--no-sync', 'python', '-c', bridge] : ['-c', bridge], { ...opts, cwd: work });
  const raw = JSON.parse(result.output);
  if (run.code && !raw.length) throw Error(/could not find any test case for any mutant/.test(out) ? `mutmut failed (${run.code}): no test in ${t.tests.join(', ')} exercises ${t.target}; write one that calls its code or target the module the test covers` : `mutmut failed (${run.code}) with no mutants; see the runner log`);
  return { raw };
}

export const TOOLS = { gomutants: 'github.com/szhekpisov/gomutants@v0.6.1', gremlins: 'github.com/go-gremlins/gremlins/cmd/gremlins@v0.6.0', 'dotnet-stryker': '5.0.0' };
const toolDirectory = (c, name) => path.join(c.root, 'tools', `${name}@${TOOLS[name]?.split('@v').at(-1) || 'unknown'}`);
const DOTNET_TEST = { sdk: '17.14.1', xunit: '2.9.3', runner: '3.1.5' };
function toolInstall(c, name) {
  const tools = toolDirectory(c, name);
  return name === 'dotnet-stryker' ? { exe: 'dotnet', args: ['tool', 'install', name, '--tool-path', tools, '--version', TOOLS[name]],
    env: { DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1' }, hint: `dotnet tool install ${name} --tool-path "${tools}" --version ${TOOLS[name]}` } :
    { exe: 'go', args: ['install', TOOLS[name]], env: { GOBIN: tools }, hint: 'go install ' + TOOLS[name] };
}
export async function tool(c, name, install, opts = {}) {
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
export function parseGremlins(report, base) {
  if (!Array.isArray(report.files)) throw Error('invalid gremlins JSON report');
  const statuses = { KILLED: 'KILLED', LIVED: 'SURVIVED', 'TIMED OUT': 'TIMED_OUT', 'NOT COVERED': 'NO_COVERAGE', 'NOT VIABLE': 'NON_VIABLE', SKIPPED: 'NON_VIABLE', RUNNABLE: 'PENDING' };
  return report.files.flatMap(f => f.mutations.map(m => ({ file: slash(path.join(base, f.file_name)), line: m.line, method: '', mutator: m.type,
    mutation_key: JSON.stringify([m.line, m.column, m.type]), description: `${m.type} at column ${m.column}`, status: statuses[m.status] || 'PENDING' })));
}
async function dotnetRunner(c, t, dir, opts) {
  const net = runtimeRequire('./dotnet.cjs'), test = net.projectDir(c.repo, t.tests[0]), target = net.projectDir(c.repo, t.file), filter = net.testFilter(c.repo, t.tests);
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
    root = net.scratch(c, t, runtimeRequire('./inputs.cjs').inputFiles);
    await command(exe, ['--config-file', cfg, '--output', out, '--skip-version-check'], { ...opts, cwd: path.join(root, path.relative(c.repo, test.dir)), env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1' } });
  } finally { releases.forEach(r => r()); }
  return { raw: parseMutationTestingElements(json(path.join(out, 'reports', 'mutation-report.json')), root).filter(m => m.file === t.file) };
}
const readIf = p => exists(p) ? read(p) : '';
export async function runTarget(c, key, runner) {
  const release = await lock(targetLock(c, key), Math.max(1, (c.budgetSec ?? c.config.runBudgetSec) * 1000));
  if (!release) return null;
  try {
    const current = state(c).targets[key]; if (!current || gone(c, current)) return null;
    const cached = loadResult(c, key, current);
    if (cached && !runner && !retryable(cached)) return cached;
    for (let attempt = 0; attempt < 2; attempt++) {
      // Retry after edits; async settle waits for edits/builds.
      if (attempt && c.settle && !await c.settle()) return null;
      const t = state(c).targets[key];
      if (!t || gone(c, t)) return null;
      const start = Date.now(),
        fp = fingerprint(c, t),
        dir = path.join(c.data, 'reports', crypto.randomUUID()),
        log = path.join(c.data, 'logs', key + '.log');
      mkdir(dir);
      mkdir(path.dirname(log));
      try { fs.renameSync(log, log.slice(0, -3) + 'prev.log'); } catch {}
      fs.writeFileSync(log, ''); // last run kept as <key>.prev.log; runs are serialized by targetLock
      let result;
      try {
        const timeout = Math.max(1, (c.budgetSec ?? c.config.runBudgetSec) * 1000),
          opts = { cwd: c.repo, timeout, deadline: Math.min(c.deadline || Infinity, Date.now() + timeout), log };
        const tests = t.tests.filter(f => exists(path.join(c.repo, f))); // skip registered tests deleted since; ponytail: JVM class names stay, PIT matches none for them
        if (!tests.length) throw Object.assign(Error(`its registered tests ${t.tests.join(', ')} were deleted; write a test for it and run mutagate run <test>`), { deleted: true });
        const produced =
          await (runner || (['java', 'kotlin'].includes(t.language) ? pit : t.language === 'python' ? python : t.language === 'go' ? goRunner : t.language === 'csharp' ? dotnetRunner : stryker))({ ...c, deadline: opts.deadline }, { ...t, tests, testNames: t.testNames.filter(n => tests.includes(n) || !t.tests.includes(n)) }, dir, opts); // Drop deleted non-JVM test names.
        result = normalize(produced.raw, c, t, {
          started_at: new Date(start).toISOString(), duration_ms: Date.now() - start, kotlinTier: produced .kotlinTier, ...(produced.runner ? { runner: produced.runner } : {})
        });
        result.raw = produced.raw;
      } catch (e) {
        const killed = /SIGKILL|budget exceeded/.test(e.message), clipped = (c.budgetSec ?? c.config.runBudgetSec) < c.config.runBudgetSec;
        if (killed && clipped) { await updateState(c, s => { const t = s.targets[key]; if (t) { t.resultGeneration = null; t.lastRunMs = Math.max(Date.now() - start, t.lastRunMs || 0); } }); trace(c, 'Result', { target: t.target, decision: 'killed', error: e.message }); if (process.env.MUTAGATE_DEBUG !== '1') fs.rmSync(dir, { recursive: true, force: true }); return null; }
        if (killed) e.message = `mutation run exceeded runBudgetSec (${c.config.runBudgetSec}s); raise runBudgetSec or split the test`;
        const kind = e.unscored || e.deleted || killed ? 'unscored' : 'error', cause = kind === 'error' && !e.scopedCopy && runtimeRequire('./errors.cjs').agentCause(e.message, [...new Set(Object.values(state(c).targets).flatMap(x => x.tests).concat(state(c).edited || []))], log, f => isTest(f, c.config));
        result = {
          schema: 1, target: t.target, language: t.language,
          runner: e.runner || RUNNER[t.language], tests: t.testNames,
          started_at: new Date(start).toISOString(), duration_ms: Date.now() - start,
          status: kind, error: clean(e.message) + (cause && !e.message.includes(cause) ? '; ' + clean(cause) : '') + (e.deleted ? '' : '; log: ' + log), score: null, survivors: [], ...e.deleted ? { tests_deleted: true } : {},
          threshold: c.config.threshold, killed: 0, survived: 0, timed_out: 0, no_coverage: 0, filtered_junk: 0, filtered: [], waived: 0,
          error_mutants: 0, ...kind === 'error' ? { attempts: cached?.status === 'error' && current.fingerprint === fp ? (cached.attempts ?? 1) + 1 : 1, agent_caused: !!cause } : {}
        };
      }
      let published = false;
      await updateState(c, s => {
        const latest = s.targets[key];
        if (latest && latest.generation === t.generation && fingerprint(c, latest) === fp) {
          atomic(
            resultFile(c, key), result);
          latest.lastRunMs = Math.max(result.duration_ms, latest.lastRunMs || 0);
          latest.fingerprint = fp;
          latest.resultGeneration = t.generation;
          latest.rerun_requested = false;
          published = true;
        }
      });
      if (process.env.MUTAGATE_DEBUG !== '1') fs.rmSync(dir, { recursive: true, force: true });
      trace(c, 'Result', {
        target: t.target, score: result.score, decision: published ? result.status : 'stale', duration_ms: result.duration_ms, error: result.error
      });
      if (published) return result;
    }
    return null;
  } finally { release(); }
}
// Retry errors once (e.g. concurrent builds).
const retryable = r => r?.status === 'error' && (r.attempts ?? 1) < 2;
export function loadResult(c, key, t, expectedFingerprint) {
  const r = json(resultFile(c, key), null);
  if (!t || !r || t.resultGeneration !== t.generation || t.fingerprint !==
    (expectedFingerprint ?? fingerprint(c, t))) return null;
  return r.raw ? normalize(r.raw, c, t, { started_at: r.started_at, duration_ms: r.duration_ms, kotlinTier: r.kotlinTier }) :
    r;
}

export function schedule(c, key, run = spawn) {
  const worker = run(process.execPath, [path.join(HERE, 'mutagate.mjs'), 'worker', '--repo', c.repo, '--session', c.sid, '--key', key ], { detached: true, stdio: 'ignore', env: { ...process.env, MUTAGATE_HOOK_SESSION: c.sid, MUTAGATE_HARNESS: c.harness } });
  worker.unref();
}
// once names a one-time block flag; otherwise maxRounds applies.
async function claimBlock(c, key, once) {
  if (c.config.mode !== 'gate') return false;
  return updateState(c, s => {
    const t = s.targets[key];
    if (!t || t.blocks >= c.config.maxRounds || once && t[once]) return false;
    t.blocks++;
    if (once) t[once] = true;
    return true;
  });
}
const reportKey = s => hash(s.replace(/\x1b\[[0-9;]*m/g, '').replace(/\d{4}-\d\d-\d\dT[\d:.]+Z|\bpid \d+|\d+ ms\b|log: \S+/g, ''));
export async function gate(c, { wait, hook = false, runner } = {}) {
  const start = Date.now(),
    end = start + Math.max(c.config.gateBudgetSec, hook ? 0 : wait || 0) * 1000,
    reports = [],
    warnings = liveWarnings(c),
    blocks = [];
  let code = 0;
  if (!hook && !Object.values(state(c).targets).some(t => !t.secondary || c.config.gateSecondaries)) return { code: 1, block: false, reason: '', report: [`mutagate: no targets checked in this session. Run ${cliName(c)} run <test> first. The CLI joins the hook session automatically; MUTAGATE_SESSION is only for bare CLI use without hooks.`, untargeted(c)].filter(Boolean).join('\n'), warnings: [] };
  for (const [key, original] of Object.entries(state(c).targets)) {
    if (gone(c, original)) { await updateState(c, s => { if (s.targets[key] && gone(c, s.targets[key])) delete s.targets[key]; }); continue; }
    if (original.secondary && !c.config.gateSecondaries) continue;
    let t = state(c).targets[key]; if (!t) continue;
    const expectedFingerprint = fingerprint(c, t);
    let r = loadResult(c, key, t, expectedFingerprint);
    let needed = '', advice = b => runtimeRequire('./errors.cjs').gateAdvice(b, c.config.runBudgetSec, t.lastRunMs, Date.now() - start, cliName(c));
    const until = Math.min(end, Date.now() + (wait ?? c.config.gateWaitSec) * 1000);
    while (t && (!r || retryable(r)) && inFlight(c, key) && Date.now() < until) {
      await sleep(100);
      t = state(c).targets[key];
      r = loadResult(c, key, t, expectedFingerprint);
    }
    if (r) r = loadResult(c, key, t);
    for (let retry = 0; retry < 2 && t && (!r || retryable(r)) && !inFlight(c, key) && Date.now() < end; retry++) {
      const scoped = {
        ...c, deadline: end, budgetSec: Math.max(1, Math.min(c.config.runBudgetSec, Math.floor((end - Date .now()) / 1000)))
      };
      needed = advice(scoped.budgetSec);
      if (needed) break;
      r = await runTarget(scoped, key, runner) || r && loadResult(c, key, state(c).targets[key]);
      t = state(c).targets[key]; if (!t) break;
      if (!r) { needed = advice(0); break; }
    }
    if (!t) continue;
    if (needed && r) warnings.push(`mutagate: ${t.target}${needed}`);
    if (!r || r.tests_deleted) {
      code = Math.max(code, 1);
      const msg = r?.tests_deleted ? report(r) : `mutagate: ${t.target} results pending${needed || `; run ${cliName(c)} check --wait ${c.config.gateBudgetSec}`}`;
      if (
        hook && await claimBlock(c, key, 'pendingBlocked')) blocks.push(msg);
      else warnings.push(msg);
      continue;
    }
    if (r.status === 'unscored') { const text = report(r); if (r.error?.startsWith(NO_MUTANTS)) reports.push(text); else { code = Math.max(code, 1); warnings.push(text); } continue; }
    reports.push(report(r, c.config));
    if (['below', 'error'].includes(r.status)) await updateState(c, s => { if (s.targets[key]) s.targets[key].reported = reportKey(report(r, c.config)); });
    if (r.status === 'error') {
      if (!code) code = 3;
      // Block fixable test failures once; infrastructure errors fail open.
      // ponytail: once per target per session, never reset, like pendingBlocked.
      if (hook && r.agent_caused && await claimBlock(c, key, 'errorBlocked')) blocks.push(report(r, c.config));
      else warnings.push(report(r, c.config));
      continue;
    }
    if (r.status === 'below') {
      code = 1;
      if (hook && await claimBlock(c, key)) blocks.push(report(r, c.config));
      else if (hook) warnings.push(c.config.mode === 'advise' ? report(r, c.config) :
        `mutagate: round cap reached for ${t.target}, score ${r.score.toFixed(2)} below ${c.config.threshold.toFixed(2)}`);
    }
  }
  const reason = joinReports([...blocks, ...warnings], 1800);
  return {
    code, block: c.config.mode === 'gate' && blocks.length > 0, reason,
    report: joinReports([...new Set([...reports, ...warnings]), untargeted(c)].filter(Boolean)) || 'mutagate: no below-threshold targets.', warnings
  };
}
export async function handleHook(c, p, event) {
  const contextOutput = text => ({ code: 0, out: { hookSpecificOutput: { hookEventName: event, additionalContext: text.slice(0, 1800) } } }),
    notice = text => [ 'opencode', 'pi' ].includes(c.harness) ? { code: 0, out: { systemMessage: text } } : { code: 0, text };
  if (Number(process.versions.node.split('.')[0]) < 22) return event === 'SessionStart' ? notice(`mutagate inactive: hooks run Node ${process.versions.node}; need 22+. Set MUTAGATE_NODE or rerun install.`) : { code: 0 };
  if (event === 'PreToolUse') {
    const waiver = extractPaths(p).some(f => safePath(c.repo, f) === path.join(c.repo, '.mutagate/waivers.json'));
    if (!waiver ||
      c.config.allowAgentWaivers) return { code: 0 };
    const proposed = clean(p.tool_input?.content || p.tool_input?.new_string || p.tool_input?.command || p.tool_input?.newText || 'waiver edit').slice(0, 1000);
    return {
      code: 0,
      out: {
        hookSpecificOutput: {
          hookEventName: event,
          permissionDecision: c.harness === 'claude' ? 'ask' : 'deny',
          permissionDecisionReason: `Waivers require human approval. Proposed: ${proposed}. Edit .mutagate/waivers.json manually.`
        }
      }
    };
  }
  if (event === 'SessionStart') {
    const diagnostics=c.errors.length?await updateState(c,s=>{if(s.configWarned)return [];s.configWarned=true;return c.errors;}):[];
    const d = detect(c);
    const banner =
      `mutagate ${VERSION} active. runner=${d.runner||'unavailable'} (${d.buildTool||'none'}, ${d.language||'unknown'}). threshold ${c.config.threshold.toFixed(2)}. mode ${c.config.mode}.${diagnostics.length?' '+diagnostics.join('; '):''}`;
    return notice(banner);
  }
  if (event === 'PostToolUse') {
    if (p.tool_response?.success === false || p.tool_response?.isError) return { code: 0 };
    const paths = extractPaths(p).map(f => safePath(c.repo, f)).filter(Boolean).map(f => slash(path.relative(c.repo, f)));
    if (!paths.length) return { code: 0 };
    const src = c.args.mutate ? [] : paths.filter(f => !isTest(f, c.config) && /\.(java|kt|py|tsx?|jsx?|go|cs)$/.test(f) && !GENERATED.test(f) && !CONFIG.test(f) && c.config.languages.includes(language(f)));
    if (src.length) await updateState(c, s => { s.edited = [...new Set([...(s.edited || []), ...src])].slice(-200); });
    if (!Object.keys(state(c).targets).length && !paths.some(f => isTest(f, c.config))) return { code: 0 };
    const token = p.tool_use_id || hash(JSON.stringify([paths, p.tool_input]));
    let seen = false;
    await updateState(c, s => {
      seen = s.events.includes(token);
      if (!seen) {
        s.events = [...s.events.slice(-99), token];
        s.editedAt = Date.now();
        for (const t of Object.values(s.targets))
          if (paths.includes(t.file)) {
            t.generation++;
            t.changedAt = Date.now();
            t.rerun_requested = true;
          }
      }
    });
    let wake = false;
    const msgs = [],
      keys = [];
    for (const file of paths.filter(f => isTest(f, c.config) && !SUPPORT.test(f) && exists(path.join(c.repo, f)))) {
      let r;
      if (!seen) r = await register(c, file);
      else r = resolveTargets(c, file);
      if (r.ambiguous) {
        // Only sync announces changed candidates.
        if (!c.args.mutate) await updateState(c, s => {
          s.notified ??= [];
          if (s.notified.includes(r.message)) return;
          s.notified = [...s.notified.slice(-49), r.message];
          msgs.push(r.message);
        });
        continue;
      }
      for (const t of r.targets) keys.push(targetKey(t));
    }
    if (c.args.mutate) {
      // Any project edit stales all targets. The newest handler waits for
      // 6 s quiet (builds start 2-3 s after edits), then refreshes all; older handlers yield.
      // ponytail: reruns every stale session target; narrow to dependents if large sessions get slow.
      // Agent builds share output directories; wait for them,
      // at most gateWaitSec total: `spring-boot:run` may never finish.
      const newest = () => state(c).events.at(-1) === token, giveUp = Date.now() + c.config.gateWaitSec * 1000;
      const settle = async () => {
        for (;;) {
          if (!newest()) return false;
          const due = Math.max(6000 - (Date.now() - (state(c).editedAt || 0)), Date.now() < giveUp && buildRunning(c) ? 1000 : 0);
          if (due <= 0) return true;
          await sleep(due);
        }
      };
      if (!await settle()) return { code: 0 };
      for (const [key, t] of Object.entries(state(c).targets)) {
        if (gone(c, t) || t.secondary && !c.config.gateSecondaries && !keys.includes(key) || loadResult(c, key, t)) continue;
        if (!await settle()) break;
        const r = await runTarget({ ...c, settle }, key, c.runner), text = r && r.status !== 'pass' ? report(r, c.config) : null; // c.runner: test seam, as gate's runner
        // Redeliver changed results; a pass resets delivery.
        if (r && await updateState(c, s => { const t = s.targets[key], next = text && reportKey(text); if (!t || t.reported === next) return false; t.reported = next; return true; }) && text) {
          msgs.push(text);
          wake ||= r.status === 'below' || r.agent_caused; }
      }
    } else if (c.harness === 'unknown')
      for (const key of [...new Set(keys)]) schedule(c, key);
    if (!msgs.length) return { code: 0 };
    const text = joinReports(msgs, 1800);
    if (c.harness === 'claude' && c.args.mutate && wake) return { code: 2, err: text };
    return contextOutput(text);
  }
  if (['Stop', 'SubagentStop', 'TaskCompleted'].includes(event)) {
    const g = await gate(c, { hook: true });
    return g.block ? {
      code: 2, out: { decision: 'block', reason: g.reason }, err: g.reason
    } : g.reason ? { code: 0, out: { systemMessage: g.reason } } : { code: 0 };
  }
  return { code: 0 };
}
export function detect(c) {
  const all = files(c.repo, c.config),
    languageFound = all.some(f => f.endsWith('.kt')) ? 'kotlin' : all.some(f => f.endsWith('.java')) ? 'java' : all.some(f => f.endsWith('.py')) ? 'python' :
    all.some(f => f.endsWith('.go')) ? 'go' : all.some(f => f.endsWith('.cs')) ? 'csharp' : all.some(f => /\.[jt]sx?$/.test(f)) ? 'typescript' : null;
  const buildTool = all.some(f => /build\.gradle(?:\.kts)?$/.test(f)) ? 'gradle' : all.some(f => f.endsWith('pom.xml')) ? 'maven' : exists(path.join(c.repo, 'uv.lock')) ? 'uv' : all.some(f => /(?:^|\/)go\.mod$/.test(f)) ? 'go' : all.some(f => /\.(csproj|sln)$/.test(f)) ? 'dotnet' : exists(path.join(c.repo, 'package.json')) ? 'npm' : languageFound ===
    'python' ? 'pip' : null;
  return {
    harness: c.harness, language: languageFound, buildTool,
    runner: languageFound === 'go' && c.config.goRunner === 'gremlins' ? 'gremlins' : RUNNER[languageFound] || null,
    kotlinTier: languageFound === 'kotlin' ? (c.config .kotlinTier === 'auto' ? (exists(path.join(c.repo, 'arcmutate-licence.txt')) || process.env.ARCMUTATE_LICENCE ? 'A' : 'B') : c.config.kotlinTier) : null
  };
}
export const hookConfig = (agent, c) => runtimeRequire('./install.cjs').hookConfig(agent, c);
export const install = (c, agent, scope, remove) => runtimeRequire('./install.cjs').install(c, agent, scope, remove);

function agents(c) {
  return [...new Set([...(process.env.CLAUDE_PROJECT_DIR || process.env.CLAUDE_PLUGIN_ROOT || exists(path.join(c.repo, '.claude')) ? [ 'claude' ] : []), ...(process.env.CODEX_HOME || exists(path.join(c.repo, '.codex')) ? ['codex'] : []), ...(exists(path.join(c.repo, '.opencode')) || exists(
    path.join(c.repo, 'opencode.json')) ? ['opencode'] : []), ...(exists(path.join(c.repo, '.pi')) ? ['pi'] : [])])];
}
async function doctor(c) {
  const dr = runtimeRequire('./doctor.cjs'), step = dr.progress; step('Node 22+ and configuration');
  const checks = [{ name: 'Node 22+', pass: Number(process.versions.node.split('.')[0]) >= 22, hint: 'Install Node 22 or later, or set MUTAGATE_NODE to its path.' }, {
    name: 'configuration', pass: !c.errors.length, hint: c.errors.join('; ')
  }],
    d = detect(c); step('runner detected');
  checks.push({ name: 'runner detected', pass: !!d.runner, hint: 'Run doctor inside a supported project.' });
  if (d.runner === 'pitest') { step('JDK and verified PIT jars');
    try {
      await command(javaExe(c.repo), ['-version'], { timeout: 5000 });
      await jars(c);
      checks.push({ name: 'JDK and verified PIT jars', pass: true });
    } catch (e) {
      checks.push({
        name: 'JDK and verified PIT jars', pass: false, hint: e .message
      });
    }
  }
  if (['gomutants', 'gremlins', 'stryker-net'].includes(d.runner)) {
    const opts = { deadline: Date.now() + c.config.runBudgetSec * 1000 }; step('mutation toolchain');
    try {
      if (d.language === 'go') { await command('go', ['version'], opts); const selected = await selectGo(c, opts); d.runner = selected.runner; }
      else {
        const runtimes = await command('dotnet', ['--list-runtimes'], opts);
        if (!/^Microsoft.NETCore.App 10\./m.test(runtimes.output)) throw Error('Install the .NET 10 SDK/runtime.');
        await tool(c, 'dotnet-stryker', toolInstall(c, 'dotnet-stryker'), opts);
      }
      checks.push({ name: d.language === 'go' ? 'Go toolchain and ' + d.runner : '.NET 10 runtime and dotnet-stryker', pass: true });
    } catch (e) { checks.push({ name: 'mutation toolchain', pass: false, hint: e.message }); }
    if (d.language === 'csharp' && c.config.runBudgetSec === DEFAULTS.runBudgetSec) checks.push({ name: '.NET run budget', pass: true, note: 'Cold runs can take 2 to 5 minutes; set runBudgetSec: 600 in .mutagate/config.json.' });
  }
  step('project adapter'); const installed = agents(c).some(a => a === 'claude' || a === 'codex' ? runtimeRequire('./install.cjs').installed(c, path.join(c.repo, a === 'claude' ? '.claude/settings.json' : '.codex/hooks.json')) : exists(path.join(c.repo, a === 'pi' ? '.pi/extensions/mutagate.ts' :
    '.opencode/plugins/mutagate.js')));
  checks.push({ name: 'project adapter installed', pass: installed, hint: 'Run mutagate install --agent <harness>.' }); step('harness versions');
  const versions = json(path.join(ROOT, 'references/versions.json'), { note: 'Version manifest excluded from skill installation; see README.' }); checks.push(...await dr.harnessChecks(versions)); step('synthetic scoped mutation smoke');
  const dir = path.join(c.data, 'doctor', crypto.randomUUID());
  mkdir(dir);
  let smoke;
  try {
    const put = (f, text) => atomic(path.join(dir, f), text);
    if (d.runner === 'pitest') {
      put('src/main/java/Probe.java', 'public class Probe { public boolean eligible(int n) { return n >= 18; } }');
      put('src/test/java/ProbeTest.java',
        'import org.junit.Test; import static org.junit.Assert.*; public class ProbeTest { @Test public void boundary() { assertFalse(new Probe().eligible(17)); assertTrue(new Probe().eligible(18)); } }'
      );
      if (d.buildTool === 'gradle') {
        put('settings.gradle', "rootProject.name = 'mutagate-doctor'");
        put('build.gradle',
          "plugins { id 'java' }; repositories { mavenCentral() }; dependencies { testImplementation 'junit:junit:4.13.2' }; java { sourceCompatibility = JavaVersion.VERSION_11; targetCompatibility = JavaVersion.VERSION_11 }"
        );
        for (const f of ['gradlew', 'gradlew.bat', 'gradle/wrapper'])
          if (exists(path.join(c.repo, f))) {
            mkdir(path.dirname(path.join(dir, f)));
            fs.cpSync(path.join(c.repo, f), path.join(dir, f), { recursive: true });
          }
      } else put('pom.xml',
        '<project><modelVersion>4.0.0</modelVersion><groupId>mutagate</groupId><artifactId>doctor</artifactId><version>1</version><properties><maven.compiler.release>11</maven.compiler.release></properties><dependencies><dependency><groupId>junit</groupId><artifactId>junit</artifactId><version>4.13.2</version><scope>test</scope></dependency></dependencies></project>'
      );
      smoke = 'src/test/java/ProbeTest.java';
    } else if (['gomutants', 'gremlins'].includes(d.runner)) {
      put('go.mod', 'module probe\n\ngo 1.26\n');
      put('probe.go', 'package probe\nfunc Eligible(n int) bool { return n >= 18 }\n');
      put('probe_test.go', 'package probe\nimport "testing"\nfunc TestBoundary(t *testing.T) { if Eligible(17) || !Eligible(18) { t.Fatal("boundary") } }\n');
      smoke = 'probe_test.go';
    } else if (d.runner === 'stryker-net') {
      if (process.env.MUTAGATE_OFFLINE === '1') throw Error('offline: .NET smoke skipped');
      const props = '<PropertyGroup><TargetFramework>net10.0</TargetFramework><ImplicitUsings>enable</ImplicitUsings></PropertyGroup>';
      put('Probe/Probe.csproj', `<Project Sdk="Microsoft.NET.Sdk">${props}</Project>`);
      put('Probe/Probe.cs', 'namespace Doctor; public static class Probe { public static bool Eligible(int n) { return n >= 18; } }');
      put('Probe.Tests/Probe.Tests.csproj', `<Project Sdk="Microsoft.NET.Sdk">${props}<PropertyGroup><IsPackable>false</IsPackable><IsTestProject>true</IsTestProject></PropertyGroup><ItemGroup><PackageReference Include="Microsoft.NET.Test.Sdk" Version="${DOTNET_TEST.sdk}"/><PackageReference Include="xunit" Version="${DOTNET_TEST.xunit}"/><PackageReference Include="xunit.runner.visualstudio" Version="${DOTNET_TEST.runner}"/><ProjectReference Include="../Probe/Probe.csproj"/></ItemGroup></Project>`);
      put('Probe.Tests/ProbeTests.cs', 'using Xunit; namespace Doctor; public class ProbeTests { [Fact] public void Boundary() { Assert.False(Probe.Eligible(17)); Assert.True(Probe.Eligible(18)); } }');
      smoke = 'Probe.Tests/ProbeTests.cs';
    } else if (d.runner === 'mutmut') {
      put('probe.py', 'def eligible(n):\n    return n >= 18\n');
      put('test_probe.py', 'from probe import eligible\ndef test_boundary():\n    assert not eligible(17)\n    assert eligible(18)\n');
      smoke = 'test_probe.py';
    } else if (d.runner === 'stryker') {
      const pkg = json(path.join(c.repo, 'package.json')),
        vitest = !!(pkg.dependencies?.vitest || pkg.devDependencies?.vitest);
      put('package.json', JSON.stringify({ ...pkg, type: vitest ? 'module' : 'commonjs' }));
      if (exists(path.join(c.repo, 'node_modules'))) fs.symlinkSync(
        path.join(c.repo, 'node_modules'), path.join(dir, 'node_modules'), 'junction');
      put('probe.js', vitest ? 'export function eligible(n) { return n >= 18; }' : 'exports.eligible = n => n >= 18;');
      put('probe.test.js', (vitest ? "import {test,expect} from 'vitest'; import {eligible} from './probe.js';" :
        "const {eligible} = require('./probe.js');") + "test('boundary',()=>{expect(eligible(17)).toBe(false);expect(eligible(18)).toBe(true);});");
      smoke = 'probe.test.js';
    }
    if (!smoke) throw Error('no supported runner detected');
    const sc = { ...c, repo: fs.realpathSync(dir), toolRepo: c.repo, data: path.join(dir, 'state-data'), stateFile: path.join(dir, 'state-data/session.json') };
    const resolved = await register(sc, smoke);
    if (resolved.ambiguous) throw Error(resolved.message);
    const result = await runTarget(sc, targetKey(resolved.targets[0]));
    checks.push({
      name: 'synthetic scoped mutation smoke', pass: result?.status === 'pass',
      hint: result?.error || 'Synthetic boundary test did not produce a passing score.'
    });
  } catch (e) { checks.push({ name: 'synthetic scoped mutation smoke', pass: false, hint: e.message }); } finally {
    fs.rmSync(dir, {
      recursive: true, force: true
    });
  }
  return { version: VERSION, checks: checks.map(({ hint, ...check }) => check.pass ? check : { ...check, hint }), versions };
}
export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv),
    cmd = args._[0] || 'help',
    all = 'run <test> [--target <target>] [--sync] [--json], check [--wait seconds], status [--json], detect, doctor, waive <id> --reason <reason> [--apply (human only)], install|uninstall --agent auto|claude|codex|opencode|pi [--scope project|user], version',
    usage = 'mutagate: ' + (all.split(', ').find(u => u.split(' ')[0].split('|').includes(cmd)) || all + '. All commands accept --repo.');
  if (args.help || args._.includes('-h')) { console.log(usage); return 0; }
  if (args.version || cmd === 'version') { console.log('mutagate ' + VERSION); return 0; }
  let p = {},
    c;
  if (cmd === 'hook') {
    try {
      p = JSON.parse(fs.readFileSync(0, 'utf8'));
      if (!p || typeof p !== 'object' || Array.isArray(p)) throw Error(
        'expected object');
    } catch { console.error('mutagate: malformed hook JSON'); return 0; }
  }
  if (cmd === 'hook' && !['SessionStart', 'PreToolUse', 'PostToolUse', 'Stop', 'SubagentStop', 'TaskCompleted'].includes(args._[1] || p.hook_event_name))
    return 0;
  try {
    c = context(args, p);
    if (['run', 'check', 'status', 'waive'].includes(cmd)) trace(c, cmd, { decision: 'cli' }); // traced for the eval checker
    if (cmd === 'hook') {
      const event = args._[1] || p.hook_event_name,
        start = Date.now();
      if (args.record || process.env.MUTAGATE_RECORD === '1') atomic(path.join(c.root, 'recorded', c.harness,
        `${clean(event).replace(/[^\w-]/g,'_')}-${crypto.randomUUID()}.json`), p);
      const r = await handleHook(c, p, event);
      if (r.out) console.log(JSON.stringify(r.out));
      if (r.text) console.log(r.text);
      if (r.err) console.error(r.err);
      trace(c, event, {
        tool: p.tool_name, file: extractPaths(p), decision: r.code === 2 ? 'block' : 'allow', duration_ms: Date.now() - start, error: null, mutate: !!c.args.mutate, delivered: !!(r.out || r.text || r.err)
      });
      return r.code;
    }
    if (cmd === 'worker') {
      c.config = state(c).config || c.config;
      await sleep(3000);
      const key = args.key;
      for (let n = 0; n < 2; n++) {
        const t = state(c).targets[key];
        if (!t) return 0;
        const delay = 3000 - (Date.now() - t.changedAt);
        if (delay > 0) await sleep(delay);
        if (loadResult(c, key, state(c).targets[key])) return 0;
        await runTarget(c, key);
      }
      return 0;
    }
    if (cmd === 'detect') { console.log(JSON.stringify(detect(c))); return 0; }
    if (cmd === 'run') {
      const r = await register(c, args._[1], args.target);
      if (r.disabled) { console.log(args.json ? JSON.stringify({ status: 'disabled', message: r.message }) : r.message); return 0; }
      if (r.ambiguous) {
        console.log(args.json ? JSON.stringify(r) : r.message);
        return 1;
      }
      if (!args.sync) {
        r.targets.forEach(t => schedule(c, targetKey(t)));
        console.log(args.json ? JSON.stringify({ status: 'scheduled', targets: r.targets.map(t => t.target) }) :
          'mutagate: scoped mutation run scheduled. Use mutagate check --wait 120.');
        return 0;
      }
      let code = 0;
      const results = [];
      for (const t of r.targets) {
        const result = await runTarget(c, targetKey(t)) || normalize([], c, t, { error: 'results pending after source changes' });
        if (result) {
          results.push(result);
          if (t.secondary && !c.config.gateSecondaries) continue;
          if (result.status === 'below') code = 1;
          else if (result.status === 'error' && !code) code = 3;
          else if (result.status === 'unscored' && !result.error?.startsWith(NO_MUTANTS) && !code) code = 1;
        }
      }
      console.log(args.json ? JSON.stringify(results.length === 1 ? results[0] : results) :
        joinReports(results.map(r => report(r, c.config))));
      return code;
    }
    if (cmd === 'check') {
      if (args.wait !== undefined && (!Number.isFinite(Number(args.wait)) || Number(args.wait) < 0)) throw usageError('--wait must be a nonnegative number');
      const g = await gate(c, { wait: args.wait === undefined ? undefined : Number(args.wait) });
      console.log(args.json ? JSON.stringify(g) : g.report);
      return g.code;
    }
    if (cmd === 'status') {
      console.log(status(c, args.json));
      return 0;
    }
    if (cmd === 'waive') {
      const id = args._[1], missing = [!/^[a-f0-9]{40}$/.test(id || '') && 'a survivor id (40 hex characters taken from the survivor report)',
        !(typeof args.reason === 'string' && args.reason.trim()) && '--reason <reason>'].filter(Boolean);
      if (missing.length) throw usageError('waive requires ' + missing.join(' and '));
      if (args.apply && c.agentSession && !c.config.allowAgentWaivers) throw usageError('--apply is for humans; propose the waiver and let a person apply it or edit .mutagate/waivers.json');
      let found, stale;
      for (const [key, t] of Object.entries(state(c).targets)) {
        const r = loadResult(c, key,
          t);
        if (!r) stale = true;
        if (r?.survivors.some(m => m.id === id)) found = t;
      }
      if (!found) throw usageError(stale ? `survivor not found in fresh results; targets are being re-scored after an edit, run ${cliName(c)} check --wait 120 first` : 'survivor not found in fresh session results');
      const waiver = {
        id, target: found.target, reason: String(args.reason), by: os.userInfo().username, at: new Date().toISOString()
      };
      if (args.apply) {
        const p = path.join(c.repo, '.mutagate/waivers.json'),
          w = json(p, { schema: 1, waivers: [] });
        w.waivers = [...w.waivers.filter(x => x.id !== id), waiver];
        atomic(p, w);
      }
      console.log(JSON.stringify(waiver, null, 2));
      return 0;
    }
    if (cmd === 'install' || cmd === 'uninstall') {
      const selected = !args.agent || args.agent === 'auto' ? agents(c) : [args.agent];
      const script = path.join(HERE, process.platform === 'win32' ? 'mutagate.cmd' : 'mutagate'), repoArg = args.repo ? ' --repo ' + c.repo : '';
      if (!selected.length) { console.error([`no harness detected in ${c.repo}; run one of:`, ...['claude', 'codex', 'opencode', 'pi'].map(a => `${script} ${cmd} --agent ${a}${repoArg}`)].join('\n')); return 2; }
      for (const a of selected) console.log(install(c, a, args.scope || 'project', cmd === 'uninstall'));
      if (cmd === 'install') console.log(`Next: run ${script} doctor${repoArg}, then restart your agent so it loads the hooks.${selected.includes('codex') ? ' In Codex, open /hooks and trust mutagate.' : ''}`);
      return 0;
    }
    if (cmd === 'doctor') {
      const d = await doctor(c);
      console.log(args.json ? JSON.stringify(d) : runtimeRequire('./doctor.cjs').render(d));
      return d.checks.every(x => x.pass) ? 0 : 3;
    }
    console.log(usage);
    return cmd === 'help' ? 0 : 2;
  } catch (e) { // Usage errors (e.usage) exit 2 and are not traced as errors.
    if (c && (cmd === 'hook' || !e.usage)) trace(c, cmd, { error: clean(e.message), decision: 'error' });
    console.error('mutagate: ' + clean(e.message));
    return cmd === 'hook' ? 0 : e.usage ? 2 : 3;
  }
}
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();
