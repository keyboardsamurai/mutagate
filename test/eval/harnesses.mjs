// Live eval harness drivers (docs/eval_suite.md "Harness drivers"). Each entry is self-contained:
//  agent, skillDir            skills installer --agent id and where it puts the skill in the repo
//  preflight({env})           -> {exe, version} or {reason}; env is the agent env, exe must come from the original PATH
//  env({runDir, repo})        -> harness-specific env merged over the agent env
//  launch({exe, repo, runDir, prompt, model, env, timeoutMs, config})
//                             -> {exitCode, ended: 'exit'|'idle'|'killed', final}; writes stdout.log and stderr.log, owns done-detection
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
const pins = JSON.parse(fs.readFileSync(new URL('../harness-versions.json', import.meta.url))).packages;
export const which = (bin, PATH = process.env.PATH) => (PATH || '').split(path.delimiter).filter(Boolean).map(d => path.join(d, bin)).find(p => { try { fs.accessSync(p, fs.constants.X_OK); return fs.statSync(p).isFile(); } catch { return false; } }) ?? null;
// Prefer Claude's installed version pin, then the original PATH; --version must name the pin from test/harness-versions.json.
export function pinned(bin, pkg, home = os.homedir()) {
  const probe = exe => { const r = spawnSync(exe, ['--version'], { encoding: 'utf8', timeout: 20000 }), out = `${r.stdout || ''}${r.stderr || ''}`.trim();
    return out.split(/\s+/).includes(pins[pkg]) ? { exe, version: pins[pkg] } : { reason: `${bin} version "${out.split('\n')[0] || 'unknown'}" is not pin ${pins[pkg]}` }; };
  if (bin === 'claude') {
    const local = which(pins[pkg], path.join(home, '.local/share/claude/versions'));
    if (local) { const result = probe(local); if (!result.reason) return result; }
  }
  const exe = which(bin);
  return exe ? probe(exe) : { reason: `${bin} not on PATH` };
}
// Process groups of live harness processes, killed by run.mjs on SIGINT.
export const procs = new Set();
// Spawn detached with stdout/stderr streamed to the run dir; the whole process group is SIGKILLed on timeout and after exit.
export function spawnRun(exe, args, { cwd, env, runDir, timeoutMs, stdin = 'ignore' }) {
  const [out, err] = ['stdout.log', 'stderr.log'].map(f => fs.openSync(path.join(runDir, f), 'w'));
  const child = spawn(exe, args, { cwd, env, stdio: [stdin, out, err], detached: true });
  fs.closeSync(out); fs.closeSync(err);
  let killed = false;
  const kill = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} };
  if (child.pid) procs.add(child.pid);
  const timer = setTimeout(() => { killed = true; kill(); }, timeoutMs);
  const done = new Promise(resolve => {
    child.on('error', e => { clearTimeout(timer); fs.appendFileSync(path.join(runDir, 'stderr.log'), `spawn ${exe}: ${e.message}\n`); resolve({ code: null, signal: null, killed }); });
    child.on('exit', (code, signal) => { clearTimeout(timer); kill(); procs.delete(child.pid); resolve({ code, signal, killed }); });
  });
  return { child, done };
}

export const opencodeConfig = model => ({ model, permission: { external_directory: 'allow' } });

export const harnesses = {
  claude: {
    agent: 'claude-code', skillDir: '.claude/skills/mutagate',
    preflight() { const p = pinned('claude', '@anthropic-ai/claude-code'); return p.reason || process.env.CLAUDE_CODE_OAUTH_TOKEN ? p : { reason: 'CLAUDE_CODE_OAUTH_TOKEN not set' }; },
    // Fresh config dir per run: no user CLAUDE.md, skills, plugins or settings. Never --bare: it skips hooks and OAuth.
    env({ runDir }) { const dir = path.join(runDir, 'claude-config'); fs.mkdirSync(dir, { recursive: true }); return { CLAUDE_CONFIG_DIR: dir, CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN, DISABLE_AUTOUPDATER: '1' }; },
    async launch({ exe, repo, runDir, prompt, model, env, timeoutMs }) {
      const r = await spawnRun(exe, ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--include-hook-events', '--dangerously-skip-permissions', '--model', model], { cwd: repo, env, runDir, timeoutMs }).done;
      let final = '';
      for (const l of fs.readFileSync(path.join(runDir, 'stdout.log'), 'utf8').split('\n')) try { const e = JSON.parse(l); if (e.type === 'result' && typeof e.result === 'string') final = e.result; } catch {}
      return { exitCode: r.code, ended: r.killed ? 'killed' : 'exit', final };
    },
  },
  codex: {
    agent: 'codex', skillDir: '.agents/skills/mutagate',
    home: path.join(process.env.HOME || '', '.codex'),
    preflight({ env }) {
      const p = pinned('codex', '@openai/codex'); if (p.reason) return p;
      return spawnSync(p.exe, ['login', 'status'], { env: { ...env, CODEX_HOME: this.home }, stdio: 'ignore', timeout: 20000 }).status === 0 ? p : { reason: 'codex login status failed (no ChatGPT login in ~/.codex)' };
    },
    // The user's real ~/.codex for the ChatGPT login only: --ignore-user-config skips its config.toml (MCP servers, plugins, project trust), --ignore-rules its .rules,
    // --ephemeral writes no session files. CODEX_HOME is set for this harness alone because mutagate's harness detection keys on it.
    env() { return { CODEX_HOME: this.home }; },
    // Codex loads project .codex/ config and hooks only for a trusted project, and trust lived in the ignored config.toml (an ancestor such as ~ trusted there), so
    // the run repo is trusted by -c. User skills in $CODEX_HOME/skills and ~/.agents/skills load whatever the config says: each is disabled by path (listed and real).
    userSkillsOff() {
      const files = [path.join(this.home, 'skills'), path.join(process.env.HOME || '', '.agents/skills')].flatMap(root => { try { return fs.readdirSync(root).filter(d => !d.startsWith('.')).map(d => path.join(root, d, 'SKILL.md')).filter(f => fs.existsSync(f)); } catch { return []; } });
      return `skills.config=[${[...new Set(files.flatMap(f => [f, fs.realpathSync(f)]))].map(f => `{path=${JSON.stringify(f)},enabled=false}`).join(',')}]`;
    },
    async launch({ exe, repo, runDir, prompt, model, env, timeoutMs, config }) {
      const trust = `projects={${JSON.stringify(fs.realpathSync(repo))}={trust_level="trusted"}}`;
      const args = ['exec', '--json', '--dangerously-bypass-hook-trust', '--dangerously-bypass-approvals-and-sandbox', '--ignore-user-config', '--ignore-rules', '--ephemeral', '-m', model, '-c', `model_reasoning_effort=${config.codexEffort}`, '-c', trust, '-c', this.userSkillsOff(), '-C', repo, prompt];
      const r = await spawnRun(exe, args, { cwd: repo, env, runDir, timeoutMs }).done;
      // Last agent message in the JSONL stream: item.completed {item:{type:"agent_message",text}}, or a last_agent_message field on the turn/task events.
      let final = '';
      const walk = o => { if (!o || typeof o !== 'object') return; if (o.type === 'agent_message' && typeof (o.text ?? o.message) === 'string') final = o.text ?? o.message; else if (typeof o.last_agent_message === 'string') final = o.last_agent_message; Object.values(o).forEach(walk); };
      for (const l of fs.readFileSync(path.join(runDir, 'stdout.log'), 'utf8').split('\n')) try { walk(JSON.parse(l)); } catch {}
      return { exitCode: r.code, ended: r.killed ? 'killed' : 'exit', final };
    },
  },
  opencode: {
    agent: 'opencode', skillDir: '.agents/skills/mutagate',
    preflight() { const p = pinned('opencode', 'opencode-ai'); return p.reason || process.env.OPENROUTER_API_KEY ? p : { reason: 'OPENROUTER_API_KEY not set' }; },
    // Per-run config, data and state; XDG_CACHE_HOME stays shared because it is mutagate's cacheRoot. OPENCODE_TEST_HOME moves opencode's own home lookups
    // (~/.agents/skills, ~/.claude) off the user's home without touching the agent's HOME; project .agents/skills still load. The bash tool runs $SHELL: pin bash, not the user's zsh.
    env({ runDir }) { const d = s => path.join(runDir, 'opencode', s); return { SHELL: '/bin/bash', XDG_CONFIG_HOME: d('config'), XDG_DATA_HOME: d('data'), XDG_STATE_HOME: d('state'), OPENCODE_TEST_HOME: d('home'), OPENCODE_DISABLE_CLAUDE_CODE: '1', OPENCODE_DISABLE_AUTOUPDATE: '1', OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY }; },
    // `run` exits on the first idle, so a long-lived `serve` hosts the session and mutagate's plugin can re-prompt it from the Stop gate. Done when for settleMs no
    // session is busy or changed and no mutagate process of this repo is alive (hooks and workers are the only lock holders; a --mutate hook settles before it locks).
    // stdout.log is the server's message export, one line per part over all sessions in time order, so re-prompted turns are in it; run.jsonl is `run --format json`.
    async launch({ exe, repo, runDir, prompt, model, env, timeoutMs, config }) {
      const file = f => path.join(runDir, f), sleep = ms => new Promise(r => setTimeout(r, ms)), deadline = Date.now() + timeoutMs, fd = fs.openSync(file('serve.log'), 'w');
      // The configured default model, as a real user has. mutagate's plugin now re-prompts with the session's model, but it falls back to the default when no
      // assistant message has one; before that fix, a bare config made opencode pick openrouter/google/gemini-3-pro-image-preview (no tool support).
      fs.mkdirSync(path.join(env.XDG_CONFIG_HOME, 'opencode'), { recursive: true }); fs.writeFileSync(path.join(env.XDG_CONFIG_HOME, 'opencode/opencode.json'), JSON.stringify(opencodeConfig(model)) + '\n');
      const serve = spawn(exe, ['serve', '--port', '0'], { cwd: repo, env, stdio: ['ignore', fd, fd], detached: true });
      fs.closeSync(fd); if (serve.pid) procs.add(serve.pid);
      let up = true, run, code = null, running = false, ended = 'idle', final = '';
      serve.on('exit', () => { up = false; }).on('error', () => { up = false; });
      const scripts = path.join(repo, '.agents/skills/mutagate/scripts') + path.sep, hooksAlive = () => (spawnSync('ps', ['-Aww', '-o', 'args='], { encoding: 'utf8', timeout: 5000 }).stdout || '').includes(scripts);
      const kill = p => { try { process.kill(-p, 'SIGKILL'); } catch {} };
      try {
        let url;
        while (!(url = fs.readFileSync(file('serve.log'), 'utf8').match(/listening on (http:\S+)/)?.[1])) { if (!up || Date.now() > deadline) throw Error('opencode serve did not start, see serve.log'); await sleep(200); }
        const get = async p => { const r = await fetch(url + p, { signal: AbortSignal.timeout(30000) }); if (!r.ok) throw Error(`GET ${p}: ${r.status}`); return r.json(); };
        // The prompt goes in on stdin: `run` wraps positional words that contain spaces in quotes.
        run = spawnRun(exe, ['run', '--attach', url, '--format', 'json', '--auto', '-m', model], { cwd: repo, env, runDir, timeoutMs, stdin: 'pipe' });
        run.child.stdin.on('error', () => {}).end(prompt); running = true; run.done.then(r => { code = r.code; running = false; });
        for (let sig, quiet = Date.now(); ; await sleep(1000)) {
          if (Date.now() > deadline) { ended = 'killed'; break; }
          if (!up) { ended = 'exit'; break; }
          const s = await Promise.all([get('/session/status'), get('/session')]).catch(() => null), now = JSON.stringify(s?.[1].map(x => [x.id, x.time]));
          if (!s || running || Object.values(s[0]).some(x => x.type !== 'idle') || now !== sig || hooksAlive()) { sig = now; quiet = Date.now(); }
          else if (Date.now() - quiet >= config.settleMs) break;
        }
        if (up) {
          const msgs = (await Promise.all((await get('/session')).map(x => get(`/session/${x.id}/message`)))).flat().sort((a, b) => a.info.time.created - b.info.time.created);
          fs.renameSync(file('stdout.log'), file('run.jsonl'));
          fs.writeFileSync(file('stdout.log'), msgs.flatMap(m => [...m.parts.map(p => ({ role: m.info.role, model: m.info.modelID ?? m.info.model?.modelID, ...p })), ...m.info.error ? [{ role: m.info.role, sessionID: m.info.sessionID, messageID: m.info.id, error: m.info.error }] : []]).map(x => JSON.stringify(x) + '\n').join(''));
          for (const m of msgs.filter(m => m.info.error)) fs.appendFileSync(file('stderr.log'), `opencode session error in ${m.info.id} (${m.info.modelID}): ${m.info.error.name}: ${m.info.error.data?.message ?? ''}\n`);
          final = msgs.filter(m => m.info.role === 'assistant').map(m => m.parts.filter(p => p.type === 'text').map(p => p.text).join('\n')).filter(Boolean).at(-1) ?? '';
        }
      } catch (e) { fs.appendFileSync(file('stderr.log'), `mutagate eval driver: ${e.message}\n`); if (ended === 'idle') ended = 'exit'; }
      kill(serve.pid); procs.delete(serve.pid);
      if (run) { kill(run.child.pid); code = (await run.done).code; }
      fs.rmSync(path.join(env.XDG_CONFIG_HOME, 'opencode/node_modules'), { recursive: true, force: true }); // ~60 MB plugin SDK install per run
      // The session database duplicates stdout.log's export and cannot be string-scrubbed (SQLite pages, WAL); delete it once serve is dead.
      for (const f of ['opencode.db', 'opencode.db-wal', 'opencode.db-shm']) fs.rmSync(path.join(env.XDG_DATA_HOME, 'opencode', f), { force: true });
      return { exitCode: code, ended, final };
    },
  },
  pi: {
    agent: 'pi', skillDir: '.pi/skills/mutagate',
    preflight() { const p = pinned('pi', '@mariozechner/pi-coding-agent'); return p.reason || process.env.OPENROUTER_API_KEY ? p : { reason: 'OPENROUTER_API_KEY not set' }; },
    // Fresh agent dir per run. Pi reads user skills from ~/.agents/skills whatever PI_CODING_AGENT_DIR says; "!**" in the user settings drops them, project .pi/ skills and extensions still load.
    env({ runDir }) {
      const dir = path.join(runDir, 'pi-agent'); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'settings.json'), '{"skills":["!**"]}\n');
      return { PI_CODING_AGENT_DIR: dir, PI_TELEMETRY: '0', PI_SKIP_VERSION_CHECK: '1', OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY };
    },
    // RPC session (pi docs/rpc.md): one prompt, then poll get_state. Done when the session is idle for settleMs and no mutagate process of this repo is alive:
    // a superset of "no target lock held", since locks are only taken inside hook/worker processes and a --mutate hook settles before it locks.
    async launch({ exe, repo, runDir, prompt, model, env, timeoutMs, config }) {
      const log = fs.createWriteStream(path.join(runDir, 'stdout.log')), err = fs.openSync(path.join(runDir, 'stderr.log'), 'w'), sleep = ms => new Promise(r => setTimeout(r, ms));
      const child = spawn(exe, ['--mode', 'rpc', '--provider', 'openrouter', '--model', model], { cwd: repo, env, stdio: ['pipe', 'pipe', err], detached: true });
      fs.closeSync(err); if (child.pid) procs.add(child.pid);
      const exited = new Promise(r => { child.on('exit', code => r({ code })); child.on('error', e => { fs.appendFileSync(path.join(runDir, 'stderr.log'), `spawn ${exe}: ${e.message}\n`); r({ code: null }); }); });
      const waiting = new Map(); let seq = 0, buf = '', done = false;
      exited.then(() => { done = true; });
      // stdout.log keeps every event except the streaming deltas, which repeat the whole partial message per chunk (message_end/tool_execution_end carry it), and the get_state polls.
      child.stdout.setEncoding('utf8').on('data', s => {
        const lines = (buf + s).split('\n'); buf = lines.pop();
        for (const l of lines) {
          let e = {}; try { e = JSON.parse(l); } catch {}
          if (e.type === 'response' && waiting.has(e.id)) { waiting.get(e.id)(e); waiting.delete(e.id); if (e.command === 'get_state') continue; }
          if (!['message_update', 'tool_execution_update'].includes(e.type) && !log.writableEnded) log.write(l + '\n');
        }
      });
      child.stdin.on('error', () => {});
      const send = (type, extra, ms = 60000) => Promise.race([new Promise(r => { const id = String(++seq); waiting.set(id, r); child.stdin.write(JSON.stringify({ id, type, ...extra }) + '\n'); }), exited.then(() => null), new Promise(r => setTimeout(r, ms).unref()).then(() => null)]);
      const scripts = path.join(repo, '.pi/skills/mutagate/scripts') + path.sep, hooksAlive = () => (spawnSync('ps', ['-Aww', '-o', 'args='], { encoding: 'utf8', timeout: 5000 }).stdout || '').includes(scripts);
      const deadline = Date.now() + timeoutMs; let ended = 'exit', idleSince = 0;
      await send('prompt', { message: prompt });
      while (!done) {
        await sleep(1000);
        if (Date.now() > deadline) { ended = 'killed'; break; }
        const s = (await send('get_state'))?.data;
        if (!s) continue;
        idleSince = !s.isStreaming && !s.isCompacting && !s.pendingMessageCount && !hooksAlive() ? idleSince || Date.now() : 0;
        if (idleSince && Date.now() - idleSince >= config.settleMs) { ended = 'idle'; break; }
      }
      const final = done ? '' : (await send('get_last_assistant_text', {}, 10000))?.data?.text ?? '';
      if (ended === 'idle') { child.stdin.end(); await Promise.race([exited, sleep(10000)]); }
      try { process.kill(-child.pid, 'SIGKILL'); } catch {}
      procs.delete(child.pid);
      const { code } = await Promise.race([exited, sleep(5000).then(() => ({ code: null }))]);
      if (!child.stdout.closed) await Promise.race([new Promise(r => child.stdout.once('close', r)), sleep(2000)]);
      await new Promise(r => log.end(r));
      return { exitCode: code, ended, final };
    },
  },
};
