'use strict';
// Harness profiles (ADR-0022): `pick` names the profile of a call; `base` is Claude-shaped, the others change only what differs. `write` encodes a
// handleHook intent as {code, stdout, stderr}, no side effects. Loaded by context(). Not hashed into fingerprint: it shapes output and delivery, not results.
const os = require('node:os'), path = require('node:path');
module.exports = ({ HARNESSES, SESSION_CMDS, exists, cliName, copilot, gate, schedule, detached, spawn, updateState, reportKey }) => {
  const none = { code: 0, stdout: '', stderr: '' }, json = o => ({ code: 0, stdout: JSON.stringify(o) + '\n', stderr: '' });
  // The Copilot root agent shell: a session command, COPILOT_AGENT_SESSION_ID and no hook session id, whatever its CLAUDE_* env (ADR-0020).
  const shell = (args, p, env) => !p.cwd && SESSION_CMDS.includes(args._?.[0]) && !(env.MUTAGATE_HOOK_SESSION || env.CODEX_THREAD_ID || env.CLAUDE_CODE_SESSION_ID) && !!env.COPILOT_AGENT_SESSION_ID;
  // Copilot CLI runs the Claude project hooks; only its payloads carry `timestamp`, only its native hooks the --harness tag. No env makes them claude (ADR-0015).
  const pick = (args, p, env) => {
    if (!args.harness && p.timestamp !== undefined) return 'inherited';
    const named = args.harness || env.MUTAGATE_HARNESS || p.harness || (shell(args, p, env) ? 'copilot' : env.CODEX_HOME || p.turn_id ? 'codex' :
      env.CLAUDE_PLUGIN_ROOT || env.CLAUDE_PROJECT_DIR ? 'claude' : 'unknown');
    return HARNESSES.includes(named) ? named : 'unknown';
  };
  const base = {
    inert: false, quiet: false, waiver: 'deny', // inert: no recording, traced `inherited`; quiet: no stderr note on corrupt state
    admit: (c, p, event) => Number(process.versions.node.split('.')[0]) < 22 ? // an intent that ends the call early, else undefined
      event === 'SessionStart' ? { notice: `mutagate inactive: hooks run Node ${process.versions.node}; need 22+. Set MUTAGATE_NODE or rerun install.` } : {} : undefined,
    ready: () => '', // SessionStart: a notice when no state can be kept
    deliveries: async () => [], // reports a PostToolUse delivers
    rerun() {}, // after a sync PostToolUse; else the async --mutate hook reruns
    // A --mutate run: the report to deliver now, or null. Redeliver changed results; a pass resets delivery.
    survivor: async (c, key, r, text) => await updateState(c, s => { const t = s.targets[key], next = text && reportKey(text); if (!t || t.reported === next) return false; t.reported = next; return true; }) && text || null,
    async stop(c) { const g = await gate(c, { hook: true }); return g.block ? { block: g.reason } : g.reason ? { warn: g.reason } : {}; },
    write(i, event) {
      const own = x => json({ hookSpecificOutput: { hookEventName: event, ...x } }), text = i.context ?? i.survivors;
      if (i.block) return { code: 2, stdout: JSON.stringify({ decision: 'block', reason: i.block }) + '\n', stderr: i.block + '\n' };
      if (i.warn) return json({ systemMessage: i.warn });
      if (i.confirm) return own({ permissionDecision: this.waiver, permissionDecisionReason: i.confirm });
      if (text) return own({ additionalContext: text.slice(0, 1800) });
      return i.notice ? { code: 0, stdout: i.notice + '\n', stderr: '' } : none;
    }
  };
  const agent = { ...base, write(i, event) { return i.notice ? json({ systemMessage: i.notice }) : base.write.call(this, i, event); } }; // OpenCode, Pi
  return { pick, shell, base, profiles: {
    // Claude asks the human; its async hook wakes the agent: exit 2, survivors on stderr.
    claude: { ...base, waiver: 'ask', write(i, event) { return i.survivors && i.wake ? { code: 2, stdout: '', stderr: i.survivors + '\n' } : base.write.call(this, i, event); } },
    codex: base, opencode: agent, pi: agent,
    unknown: { ...base, rerun(c, keys) { for (const key of new Set(keys)) schedule(c, key, c.spawn); } }, // no async hook: a worker per target; c.spawn: test seam
    // Inert; one SessionStart notice while no native Copilot hook file exists and, without copilotCloud, no cloud marker is set (ADR-0015, ADR-0021).
    inherited: { ...base, harness: 'copilot', inert: true, write: i => i.notice ? json({ additionalContext: i.notice }) : none,
      admit: (c, p, event) => event === 'SessionStart' && ![path.join(c.repo, '.github'), process.env.COPILOT_HOME || path.join(os.homedir(), '.copilot')]
        .some(d => exists(path.join(d, 'hooks/mutagate.json'))) && (c.config.copilotCloud || !copilot().cloud()) ?
        { notice: `mutagate inactive under Copilot: this repo has only the Claude Code install; run \`${cliName(c)} install --agent copilot\`.` } : {} },
    // Native Copilot hook calls (copilot.cjs).
    copilot: { ...base, quiet: true,
      admit: (c, p, event) => base.admit(c, p, event) ?? (event === 'SubagentStart' ? (copilot().link(c.data, p), {}) : undefined), // ADR-0020
      ready: c => copilot().probe(path.join(c.data, 'state')), // ADR-0021
      deliveries: (c, p) => copilot().drain(c, p), // the outbox (ADR-0019)
      rerun(c, keys, raw, seen) { if (!seen) detached(c.spawn || spawn, ['hook', 'PostToolUse', '--mutate', '--harness', 'copilot'], {}, JSON.stringify(raw)); }, // c.spawn: test seam
      survivor: async (c, key, r, text) => { await updateState(c, s => copilot().queue(s, key, text, r.started_at)); return null; },
      stop: (c, p) => copilot().agentStop(c, p), // ADR-0018
      write: i => copilot().write(i) }
  } };
};
