'use strict';
// The Copilot harness profile (ADR-0022) of native calls (`--harness copilot`, #35, ADR-0020) and the Git top of the Copilot root agent shell:
// origin, payload normalization, the subagent chain, the agentStop gate and its output, the outbox and the write probe. Loaded only for those calls, the inherited SessionStart notice (`cloud`), doctor and install (TOOLS, DRAIN: the hook matchers). Not hashed into fingerprint: it maps payloads and session ids, not results.
const fs = require('node:fs'), path = require('node:path');
// Cloud coding agent markers (ADR-0021): in the cloud hook env of spike S16, in no local CLI hook or agent shell env.
const CLOUD = ['COPILOT_AGENT_JOB_ID', 'COPILOT_AGENT_CALLBACK_URL'], cloud = (env = process.env) => CLOUD.some(k => env[k]);
// str_replace_editor is UNCONFIRMED: no recorded call (S1).
const TOOLS = { create: 'Write', edit: 'Edit', str_replace_editor: 'Edit', apply_patch: 'apply_patch', bash: 'Bash', powershell: 'Bash' },
  KEYS = { path: 'file_path', file_text: 'content', old_str: 'old_string', new_str: 'new_string' };
const progress = message => JSON.stringify({ type: 'progress', message }); // a display-only stdout line; the model never sees it (#35 D10)
const DRAIN = new Set([...Object.keys(TOOLS), 'read_bash']); // delivery points (ADR-0019): read_bash ends a backgrounded bash command (S13)
module.exports = ({ atomic, hash, PATCH_HEADER, state, updateState, loadResult, reportKey, gate, detached, spawn }) => {
  const link = (data, id) => path.join(data, 'agents', hash(id));
  const cp = {
    // 'spawned' (the --mutate handler; never installed, so never Local), 'local' (a VS Code Local payload) or 'cloud' (ADR-0021), or 'native'.
    origin: (p, args, env = process.env) => args.mutate ? 'spawned' : p.hook_event_name !== undefined ? 'local' : cloud(env) ? 'cloud' : 'native', cloud,
    // camelCase payload to the internal shape; the Copilot keys stay. apply_patch sends the raw patch, its paths relative to cwd (S1).
    // Only the TOOLS get a tool_input: a `view {path}` that passes the hook matcher (UNCONFIRMED) names no path, so it stales and denies nothing.
    // The cloud agent sends toolArgs as JSON text, except for apply_patch (S16).
    normalize(p) {
      let a = p.toolArgs; if (typeof a === 'string' && p.toolName !== 'apply_patch') try { a = JSON.parse(a); } catch { a = null; }
      const tool = TOOLS[p.toolName], input = !tool ? {} : typeof a === 'string' ? p.toolName === 'apply_patch' ? { command: typeof p.cwd === 'string' ? a.replace(PATCH_HEADER, (_, head, f) => head + path.resolve(p.cwd, f.trim())) : a } : {}
        : a && typeof a === 'object' ? Object.fromEntries(Object.entries(a).map(([k, v]) => [KEYS[k] ?? k, v])) : {};
      return { ...p, session_id: p.sessionId, tool_name: tool ?? p.toolName, tool_input: input };
    },
    // SubagentStart records agentId -> parentAgentId for the repo: one file per agent, atomic, no state lock.
    link(data, p) { if ([p.agentId, p.parentAgentId].every(x => typeof x === 'string' && x)) atomic(link(data, p.agentId), p.parentAgentId); },
    // The session of a call (ADR-0020): sessionId for a root call. A subagent call (agentId; its sessionId is its own agentId) walks
    // parentAgentId through the records until an id has none: that id is the root sessionId. No parentAgentId or a loop: its own session.
    session(data, p) {
      if (!p.agentId) return p.sessionId;
      for (let id = p.parentAgentId, n = 0; typeof id === 'string' && id && n < 64; n++) { try { id = fs.readFileSync(link(data, id), 'utf8'); } catch { return id; } }
      return p.sessionId;
    },
    // The spawned handler queues the report of a run for the next delivery point (ADR-0019): one entry per target, from its newest run;
    // run is the run's started_at. A pass empties it (runTarget resets reported).
    queue(s, key, text, run) { if (!s.targets[key]) return; s.outbox = (s.outbox || []).filter(e => e.key !== key); if (text) s.outbox.push({ key, run, text }); },
    // A delivery point (ADR-0019), a root-agent write or shell postToolUse, takes the outbox entries whose run still gives the current result
    // (a later run, a change or a pass makes an entry stale) and that are not yet reported, and marks them reported; stale entries leave too.
    // Results are checked before the state lock (fingerprint); an entry queued since stays.
    async drain(c, p) {
      if (c.args.mutate || p.agentId || !DRAIN.has(p.toolName)) return [];
      const { outbox = [], targets } = state(c);
      if (!outbox.length) return [];
      const checked = new Map(outbox.map(e => [e.key, { run: e.run, current: loadResult(c, e.key, targets[e.key])?.started_at }]));
      return updateState(c, s => {
        const sent = [];
        s.outbox = (s.outbox || []).filter(e => {
          const t = s.targets[e.key], k = checked.get(e.key);
          if (k?.run !== e.run) return true;
          if (k.current === e.run && t && t.reported !== reportKey(e.text)) { sent.push(e.text); t.reported = reportKey(e.text); }
          return false;
        });
        return sent;
      });
    },
    // The native agentStop (ADR-0018). A subagent's own agentStop never gates: the root agentStop gates the subagent's writes (ADR-0020).
    // No gate without a writable state dir (ADR-0021). stop_hook_active false resets the stored block streak.
    agentStop(c, p) {
      if (p.agentId) return {};
      const off = cp.probe(path.join(c.data, 'state'));
      if (off) return cp.stop({ reason: off });
      const { T, G, W } = cp.clamp(c.args.timeout, c.config.gateBudgetSec), old = state(c).stopStreak || 0, streak = p.stop_hook_active ? old : 0;
      return cp.watchdog((async () => { if (streak !== old) await updateState(c, s => { s.stopStreak = 0; }); return cp.stop(await gate(c, { ...cp.gateOptions, budget: G, streak })); })(), T, W);
    },
    // agentStop's gate options (see gate): ADR-0018, ADR-0019.
    gateOptions: { hook: true, schedulePending: true, blocksOnly: true },
    // The agentStop intent of a gate result (ADR-0022); a block feeds the trace (#35 D27).
    stop: g => g.block ? { block: g.reason } : g.reason ? { warn: g.reason } : {},
    // Native output (#35 D12): exit 0, no stderr; a block is exactly one JSON object, a warn a progress line, other intents one object with top-level fields.
    write(i) {
      const out = s => ({ code: 0, stdout: s + '\n', stderr: '' }), text = i.context ?? i.survivors ?? i.notice;
      return i.block ? out(JSON.stringify({ decision: 'block', reason: i.block })) : i.warn ? out(progress(i.warn)) :
        i.confirm ? out(JSON.stringify({ permissionDecision: 'deny', permissionDecisionReason: i.confirm })) : text ? out(JSON.stringify({ additionalContext: text.slice(0, 1800) })) : { code: 0, stdout: '', stderr: '' };
    },
    // ADR-0018: from the installed agentStop timeout T (--timeout, else Copilot's default 30 s), the margin M, the gate deadline G and the watchdog time W.
    clamp(timeout, budget) { const T = Number(timeout) > 0 ? Number(timeout) : 30, M = Math.min(30, Math.floor(T / 4)); return { T, G: Math.min(budget, T - 2 * M), W: T - M }; },
    // The agentStop result, or at W s an allow with a progress line; main then exits, and the runners.cjs exit handler kills the runner process groups,
    // which Copilot's kill at T does not reach (S5).
    watchdog(work, T, W) {
      let timer;
      return Promise.race([work, new Promise(res => { timer = setTimeout(res, W * 1000, { deadline: true, warn: `mutagate: gate stopped at ${W} s of the ${T} s agentStop timeout; allowed` }); })])
        .finally(() => clearTimeout(timer));
    },
    // The profile of the tag only (ADR-0022). Local inert, cloud too unless copilotCloud (ADR-0021); repo: the Git top of cwd (ADR-0020).
    profile: base => ({ ...base, quiet: true, bashWait: true, events: [...base.events, 'SubagentStart'],
      read(p, args) { const o = cp.origin(p, args); return o === 'local' ? null : { p: cp.normalize(p), cloud: o === 'cloud', record: o !== 'spawned' }; },
      place: (args, p, shell) => ({ top: !args.repo && (!!p.cwd || shell), id: data => cp.session(data, p) }),
      // Never a ppid- session (ADR-0020).
      admit: (c, p, event) => !p.session_id ? { error: 'Copilot hook payload without sessionId' } : base.admit(c, p, event) ?? (event === 'SubagentStart' ? (cp.link(c.data, p), {}) : undefined),
      ready: c => cp.probe(path.join(c.data, 'state')), // ADR-0021
      deliveries: (c, p) => cp.drain(c, p), // the outbox (ADR-0019)
      // No async hook: spawn the --mutate handler, raw payload on stdin (ADR-0019).
      rerun(c, keys, raw, seen) { if (!seen) detached(c.spawn || spawn, ['hook', 'PostToolUse', '--mutate', '--harness', 'copilot'], {}, JSON.stringify(raw)); },
      survivor: async (c, key, r, text) => { await updateState(c, s => cp.queue(s, key, text, r.started_at)); return null; },
      stop: (c, p) => cp.agentStop(c, p), // ADR-0018
      write: i => cp.write(i),
      tags: (c, p) => p.agentId ? { agent: p.agentId, ...(c.sid === p.agentId && { chain: 'unresolved' }) } : {} }),
    // The repo of a native call (ADR-0020): the Git top of cwd, the nearest dir with a .git entry; null outside Git.
    top(dir) { for (let d = dir; ; d = path.dirname(d)) { if (fs.existsSync(path.join(d, '.git'))) return d; if (path.dirname(d) === d) return null; } },
    // ADR-0021: a hook without a writable state dir (a sandbox) keeps no state. The notice naming dir, or '' when a file can be written there.
    // The probe removes the empty dirs it made, so an unused repo gets no data dir.
    probe(dir) {
      const f = path.join(dir, `.probe-${process.pid}`); let made;
      try { made = fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(f, ''); fs.rmSync(f); return ''; } catch { return `mutagate inactive: cannot write ${dir}`; }
      finally { for (let d = dir; made; d = path.dirname(d)) { try { fs.rmdirSync(d); } catch { break; } if (d === made) break; } }
    }
  };
  return cp;
};
Object.assign(module.exports, { TOOLS, DRAIN }); // the Copilot hook matchers of install.cjs
