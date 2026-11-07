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
export const VERSION = '0.9.1';
export const DEFAULTS = {
  schema: 1, mode: 'gate', threshold: .8, maxSurvivors: 10, maxRounds: 2, runBudgetSec: 300, gateBudgetSec: 120, gateWaitSec: 60,
  countNoCoverage: true, gateSecondaries: false, languages: ['java', 'kotlin', 'python', 'typescript', 'go', 'csharp'], testGlobs: [], mainRoots: [],
  exclude: [ '**/generated/**', '**/build/**' ], javaRunner: 'standalone', kotlinTier: 'auto', goRunner: 'auto', goTags: '', allowAgentWaivers: false
};
export const hash = (s) => crypto.createHash('sha1').update(s).digest('hex');
const read = (p) => fs.readFileSync(p, 'utf8');
const exists = (p) => fs.existsSync(p);
const json = (p, fallback = {}) => exists(p) ? JSON.parse(read(p)) : fallback;
// atomic() does not fsync, so a crash can leave cache JSON torn; torn cache JSON reads as the fallback (missing).
const cacheJson = (p, fallback = null) => { try { return json(p, fallback); } catch (e) { if (e instanceof SyntaxError) return fallback; throw e; } };
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
  // repo is a realpath: resolve the deepest existing ancestor before the containment check, so an alias (macOS /tmp) still matches.
  const p = path.resolve(repo, input);
  let ancestor = p;
  while (!exists(ancestor) && ancestor !== path.dirname(ancestor)) ancestor = path.dirname(ancestor);
  let real; try { real = path.join(fs.realpathSync(ancestor), path.relative(ancestor, p)); } catch { return null; } // Windows: an unmapped drive or share root
  const rel = path.relative(repo, real);
  return rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel) ? null : real;
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
  const real = p => fs.realpathSync(path.resolve(p));
  let repo;
  // A deleted hook cwd (cd build/x, then a clean) must not skip every hook, Stop included.
  try { repo = real(args.repo || payload.cwd || process.cwd()); } catch (e) { if (args.repo || !payload.cwd || e.code !== 'ENOENT') throw e; repo = real(process.env.CLAUDE_PROJECT_DIR || process.cwd()); }
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
let noted; // one note per corrupt state file
export function state(c) {
  try { return json(c.stateFile, blankState()); } catch (e) {
    if (!(e instanceof SyntaxError)) throw e;
    if (noted !== c.stateFile) { noted = c.stateFile; process.stderr.write(`mutagate: session state ${c.stateFile} is not valid JSON; it starts blank, so earlier test registrations are lost\n`); }
    return blankState();
  }
}
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
// Holders touch the lock every 10 s; a lock is abandoned when that heartbeat is over 60 s old or its pid is dead.
const owner = p => { try { return json(p); } catch { return {}; } }, dead = o => !!o.pid && !alive(o.pid);
const abandoned = (p, o = owner(p), st = fs.statSync(p, { throwIfNoEntry: false })) => !!st && (Date.now() - st.mtimeMs > 60000 || dead(o));
async function lock(p, budget = 5000) {
  mkdir(path.dirname(p));
  const end = Date.now() + budget, token = crypto.randomUUID();
  let seen = {};
  while (true) {
    try {
      const fd = fs.openSync(p, 'wx', 0o600);
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, token }));
      fs.closeSync(fd);
      const beat = setInterval(() => { try { fs.utimesSync(p, new Date(), new Date()); } catch {} }, 10000); beat.unref();
      return () => { clearInterval(beat); try { if (owner(p).token === token) fs.unlinkSync(p); } catch {} };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      // Only the waiter holding <lock>.break removes an abandoned lock, and only while the lock still holds the token it saw.
      // Timers do not count system sleep, so after a wake a live holder heartbeats up to 10 s late: break a live pid's
      // lock only after this waiter saw its mtime unchanged for 15 s of monotonic time (half its budget if shorter).
      const o = owner(p), st = fs.statSync(p, { throwIfNoEntry: false }), now = performance.now();
      if (st?.mtimeMs !== seen.m) seen = { m: st?.mtimeMs, at: now };
      const unbreak = abandoned(p, o, st) && (dead(o) || now - seen.at >= Math.min(15000, budget / 2)) && await lock(p + '.break', 0);
      if (unbreak) { try { const n = owner(p); if (n.token === o.token && abandoned(p, n)) fs.rmSync(p, { force: true }); } finally { unbreak(); } continue; }
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
export function isTest(file, cfg = DEFAULTS) { file = slash(file); return (cfg.testGlobs.length ? cfg.testGlobs : TESTS).some(g => glob(g).test(file)); }
const SUPPORT = /(^|\/)(conftest|__init__)\.py$/; // never registered as runnable tests
export const files = (repo, cfg = DEFAULTS) => runtimeRequire('./inputs.cjs').files(repo, cfg.exclude);
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
    all = files(c.repo, c.config).filter(f => (language(f) === lang || ['java', 'kotlin'].includes(lang) && /\.(java|kt)$/.test(f)) && !isTest(f, c.config) && !GENERATED.test(f) && !inTestProject(f)), source = runtimeRequire('./inputs.cjs').read; // '' for a file mutagate cannot read
  const mod = moduleRoot(c.repo, test),
    stem = path.basename(test).replace(/\.(java|kt|py|tsx?|jsx?|go|cs)$/, '').replace(/(?:Integration)?(?:Tests?|Spec|IT)$/, '').replace(/^test_/, '').replace(/_test$/, '').replace(
      /\.(test|spec)$/, '');
  const candidates = all.flatMap(file => {
    if (!['java', 'kotlin'].includes(lang)) return [{ file, target: file }];
    const body = source(path.join(c.repo, file)),
      names = [...body.matchAll(/\b(?:class|interface|object)\s+([A-Za-z_$][\w$]*)/g)].map(m => m[1]);
    return [...new Set(names.length ? names : [path.basename(file).replace(/\.(java|kt)$/, '')])].map(name => ({
      file, target: [pkg(body), name].filter( Boolean).join('.')
    }));
  });
  const imports = [...src.matchAll(/(?:^\s*import\s+([\w.]+)|^\s*from\s+([.\w]+)\s+import\s+(?:\(([^)]*)\)|(.+))|(?:from\s*|require\(\s*)['"]([^'"]+)['"])/gm)]
    .flatMap(m => m[2] ? [m[2], ...(m[3] ?? m[4]).split(',').map(n => n.trim().split(/\s+as\s+/)[0]).filter(Boolean).map(n => m[2] + '.' + n)] : [m[1] || m[5]]); // ponytail: relative from . import x stays unresolved
  const main = candidates.filter(x => ['java', 'kotlin'].includes(lang) ? /(^|\/)src\/main\//.test(x.file) || c.config.mainRoots.some(r => x.file.startsWith(r +
    '/')) : true);
  const jvm = ['java', 'kotlin'].includes(lang), simple = x => jvm ? x.target.split('.').at(-1) : path.basename(x.file).replace(/\.\w+$/, ''), near = x => pkg(source(path.join(c.repo, x.file))) === pkg(src) && path.resolve(c.repo, x.file).startsWith(mod + path.sep),
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
  const implementation = ['mutagate.mjs', 'inputs.cjs', 'kotlin-source.cjs', 'glob.cjs', 'mutmut-bridge.cjs', 'errors.cjs', 'dotnet.cjs', 'runners.cjs'].map(f => fileDigest(path.join(HERE, f)));
  return hash(JSON.stringify([implementation, fileDigest(path.join(ROOT, 'references/kotlin-junk.yaml')), fileDigest(path.join(ROOT, 'references/jars.json')), t.tests, t.testNames, c.config, inputFiles(c,t).map(f => [f, fileDigest(path.join(c.repo,f))])]));
}
export const targetKey = t => hash([t.module, t.target].filter(Boolean).join(':'));
const resultFile = (c, key) => path.join(c.data, 'results', c.session, key + '.json');
const targetLock = (c, key) => path.join(c.data, 'locks', key + '.lock');

function inFlight(c, key) { const p = targetLock(c, key); return exists(p) && !abandoned(p); }
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
// prune.cjs removes a data dir whose marked repo path is gone.
const markRepo = c => { const f = path.join(c.data, 'repo-path'); if (!exists(f)) atomic(f, c.repo); };
export async function register(c, test, explicit) {
  const r = resolveTargets(c, test, explicit);
  if (!c.config.languages.includes(language(test))) return { test, targets: [], disabled: true, message: 'mutagate: language disabled by configuration' };
  // Keep unresolved warnings per test for the gate.
  const others = s => s.warnings.filter(w => !w.startsWith(`mutagate: target unresolved for ${test}.`));
  if (r.ambiguous) { await updateState(c, s => { s.warnings = [...others(s), r.message]; }); return r; }
  markRepo(c);
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
const BAD_WAIVERS = '.mutagate/waivers.json is invalid, so no waivers apply; it must be JSON with a "waivers" array of {"id", "target", "reason"} objects';
export function normalize(raw, c, t, meta = {}) {
  const rules = JSON.parse(read(path.join(ROOT, 'references/kotlin-junk.yaml')));
  let waivers; try { waivers = json(path.join(c.repo, '.mutagate/waivers.json'), { waivers: [] }).waivers; } catch {}
  const invalid = !Array.isArray(waivers) || !waivers.every(w => w?.constructor === Object && typeof w.reason === 'string');
  if (invalid) waivers = []; // an invalid file adds no waivers; it must not turn the gate off
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
    warnings: [...invalid ? [BAD_WAIVERS] : [],
      ...waivers.filter(w => w.target === t.target && !ids.has(w.id)).map(w => `waiver ${w.id} no longer matches`)],
    ...meta
  };
}
const FOOTER = "Kill survivors with tests; don't weaken reachable code to pass, and tell the user about any production change made for the gate. Details: mutagate status. Playbook: references/survivor-playbook.md.";
// One final footer and one first invalid-waivers line (a repo-wide fact) avoid repeated-message noise.
export function joinReports(list, max = Infinity) {
  const footer = list.some(s => s.endsWith('\n' + FOOTER)), bad = list.some(s => s.includes('\n' + BAD_WAIVERS)),
    text = [...bad ? [BAD_WAIVERS] : [], ...list.map(s => (s.endsWith('\n' + FOOTER) ? s.slice(0, -FOOTER.length - 1) : s).replace('\n' + BAD_WAIVERS, ''))].join('\n');
  return footer ? text.slice(0, max - FOOTER.length - 1) + '\n' + FOOTER : text.slice(0, max);
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
// Runners live in runners.cjs, loaded on first use.
let loaded;
export const runners = () => loaded ??= runtimeRequire('./runners.cjs')({ lock, atomic, json, cacheJson, hash, pkg, moduleRoot, fingerprint, targetKey, parsePitXML, parseMutationTestingElements });
const DOTNET_TEST = { sdk: '17.14.1', xunit: '2.9.3', runner: '3.1.5' };
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
          await (runner || runners()[{ java: 'pit', kotlin: 'pit', python: 'python', go: 'goRunner', csharp: 'dotnetRunner' }[t.language] || 'stryker'])({ ...c, deadline: opts.deadline }, { ...t, tests, testNames: t.testNames.filter(n => tests.includes(n) || !t.tests.includes(n)) }, dir, opts); // Drop deleted non-JVM test names.
        result = normalize(produced.raw, c, t, {
          started_at: new Date(start).toISOString(), duration_ms: Date.now() - start, kotlinTier: produced .kotlinTier, ...(produced.runner ? { runner: produced.runner } : {})
        });
        result.raw = produced.raw;
      } catch (e) {
        const killed = /SIGKILL|budget exceeded/.test(e.message), clipped = (c.budgetSec ?? c.config.runBudgetSec) < c.config.runBudgetSec || c.deadline - start < c.config.runBudgetSec * 1000;
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
      const now = fingerprint(c, t); // hash the inputs outside the state lock, which hooks wait at most 5 s for; one generation keeps its tests
      await updateState(c, s => {
        const latest = s.targets[key];
        if (latest && latest.generation === t.generation && now === fp) {
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
const normalized = new Map(), stamp = p => { try { return runtimeRequire('./inputs.cjs').stamp(p); } catch { return ''; } };
export function loadResult(c, key, t, expectedFingerprint) {
  // Normalize once per process while the result file, the fingerprint and waivers.json are unchanged; stamps are taken before the reads.
  const file = resultFile(c, key), at = [stamp(file), t?.fingerprint, stamp(path.join(c.repo, '.mutagate/waivers.json'))].join('|'), r = cacheJson(file);
  if (!t || !r || t.resultGeneration !== t.generation || t.fingerprint !==
    (expectedFingerprint ?? fingerprint(c, t))) return null;
  if (!r.raw) return r;
  if (normalized.get(file)?.at !== at) normalized.set(file, { at, r: normalize(r.raw, c, t, { started_at: r.started_at, duration_ms: r.duration_ms, kotlinTier: r.kotlinTier, runner: r.runner }) });
  return normalized.get(file).r;
}

const detached = (run, args, env) => run(process.execPath, [path.join(HERE, 'mutagate.mjs'), ...args], { detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env, ...env } }).on('error', () => {}).unref(); // a failed spawn emits 'error' later; hooks fail open
export function schedule(c, key, run = spawn) {
  detached(run, ['worker', '--repo', c.repo, '--session', c.sid, '--key', key], { MUTAGATE_HOOK_SESSION: c.sid, MUTAGATE_HARNESS: c.harness });
}
// SessionStart starts the cache prune (prune.cjs) at most once a day; the stamp mtime records the last start (a clock jump also restarts it).
export function schedulePrune(c, run = spawn) {
  const stamp = path.join(c.root, 'repos', '.pruned'), st = fs.statSync(stamp, { throwIfNoEntry: false });
  if (st && Math.abs(Date.now() - st.mtimeMs) < 86400000) return;
  atomic(stamp, new Date().toISOString());
  detached(run, ['prune'], { CLAUDE_PLUGIN_DATA: c.root });
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
  for (const [key, original] of Object.entries(state(c).targets)) try { // an exception skips only this target
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
  } catch (e) { if (!code) code = 3; warnings.push(`mutagate: ${clean(original.target)} skipped: ${clean(e.message)}`); trace(c, 'Result', { target: original.target, decision: 'skipped', error: clean(e.message) }); }
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
    try { if (exists(c.data)) markRepo(c); schedulePrune(c); } catch {} // cache housekeeping never costs the banner; register marks new data dirs
    const diagnostics=c.errors.length?await updateState(c,s=>{if(s.configWarned)return [];s.configWarned=true;return c.errors;}):[];
    const d = detect(c);
    const stamp = c.args.installed ?? p.installed, banner = // install stamp: --installed in the hook command, installed in the adapter payload
      `mutagate ${VERSION} active. runner=${d.runner||'unavailable'} (${d.buildTool||'none'}, ${d.language||'unknown'}). threshold ${c.config.threshold.toFixed(2)}. mode ${c.config.mode}.${diagnostics.length?' '+diagnostics.join('; '):''}${stamp === VERSION ? '' : ` ${reinstall(c, stamp, c.harness === 'unknown' ? '<harness>' : c.harness)} (add --scope user for a user install).`}`;
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
      // at most gateWaitSec total and not past `end`: `spring-boot:run` may never finish.
      // The handler ends by `end`, inside the 900 s async hook timeout (install.cjs).
      const newest = () => state(c).events.at(-1) === token, end = Date.now() + 850000, giveUp = Math.min(end, Date.now() + c.config.gateWaitSec * 1000);
      const settle = async () => {
        // editedAt changes only with a newer event, which makes this handler yield: wait for quiet once, at most 6 s (clock jumps).
        for (let quiet = Math.min(6000, 6000 - (Date.now() - (state(c).editedAt || 0))); ; quiet = 0) {
          if (!newest()) return false;
          const due = Math.max(quiet, Date.now() < giveUp && buildRunning(c) ? 1000 : 0);
          if (due <= 0) return true;
          await sleep(due);
        }
      };
      if (!await settle()) return { code: 0 };
      for (const [key, t] of Object.entries(state(c).targets)) {
        if (gone(c, t) || t.secondary && !c.config.gateSecondaries && !keys.includes(key) || loadResult(c, key, t)) continue;
        if (!await settle()) break;
        // Start a target only when its last run fits before `end`, like the gate; the gate runs the rest.
        const budgetSec = Math.min(c.config.runBudgetSec, Math.floor((end - Date.now()) / 1000));
        if (budgetSec < 1) break;
        if (runtimeRequire('./errors.cjs').gateAdvice(budgetSec, c.config.runBudgetSec, t.lastRunMs)) continue;
        const r = await runTarget({ ...c, settle, deadline: end, budgetSec }, key, c.runner), text = r && r.status !== 'pass' ? report(r, c.config) : null; // c.runner: test seam, as gate's runner
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
export const hookConfig = (agent, c) => runtimeRequire('./install.cjs').hookConfig(agent, c, VERSION);
export const install = (c, agent, scope, remove) => runtimeRequire('./install.cjs').install(c, agent, scope, remove, VERSION);
// SessionStart and doctor text when the install stamp is missing or differs (ADR-0017).
const reinstall = (c, stamp, agent) => `Hooks are from ${/^\d[\w.+-]*$/.test(stamp) ? 'mutagate ' + stamp : 'an older mutagate'}, skill is ${VERSION}: rerun ${cliName(c)} install --agent ${agent}`;

function agents(c) {
  return [...new Set([...(process.env.CLAUDE_PROJECT_DIR || process.env.CLAUDE_PLUGIN_ROOT || exists(path.join(c.repo, '.claude')) ? [ 'claude' ] : []), ...(process.env.CODEX_HOME || exists(path.join(c.repo, '.codex')) ? ['codex'] : []), ...(exists(path.join(c.repo, '.opencode')) || exists(
    path.join(c.repo, 'opencode.json')) ? ['opencode'] : []), ...(exists(path.join(c.repo, '.pi')) ? ['pi'] : [])])];
}
async function doctor(c) {
  const dr = runtimeRequire('./doctor.cjs'), step = dr.progress, { command, javaExe, jars, selectGo, tool, toolInstall } = runners(); step('Node 22+ and configuration');
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
  step('project adapter'); const stamps = agents(c).map(a => [a, runtimeRequire('./install.cjs').installed(c, a)]).filter(([, stamp]) => stamp !== null);
  checks.push({ name: 'project adapter installed', pass: stamps.length > 0, hint: 'Run mutagate install --agent <harness>.' },
    ...stamps.filter(([, stamp]) => stamp !== VERSION).map(([a, stamp]) => ({ name: `${a} install`, pass: true, warn: true, note: reinstall(c, stamp, a) }))); step('harness versions');
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
    if (cmd === 'prune') { await runtimeRequire('./prune.cjs')(cacheRoot(), { lock, abandoned }); return 0; } // internal, started by schedulePrune
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
        const delay = Math.min(3000, 3000 - (Date.now() - t.changedAt)); // clock jumps
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
