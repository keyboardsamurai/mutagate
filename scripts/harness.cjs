'use strict';
// Harness profiles (ADR-0022): `pick` names the profile of a call; `base` is Claude-shaped, the others change only what differs. `write` encodes a
// handleHook intent as {code, stdout, stderr}, no side effects. Loaded by context(). Not hashed into fingerprint: it shapes output and delivery, not results.
const os = require('node:os'), path = require('node:path');
module.exports = ({ HARNESSES, SESSION_CMDS, exists, cliName, copilot, gate, schedule, updateState, deliver }) => {
  let own;
  const none = { code: 0, stdout: '', stderr: '' }, json = o => ({ code: 0, stdout: JSON.stringify(o) + '\n', stderr: '' });
  // The Copilot root agent shell: a session command, COPILOT_AGENT_SESSION_ID and no hook session id, whatever its CLAUDE_* env (ADR-0020).
  const shell = (args, p, env) => !p.cwd && SESSION_CMDS.includes(args._?.[0]) && !(env.MUTAGATE_HOOK_SESSION || env.CODEX_THREAD_ID || env.CLAUDE_CODE_SESSION_ID) && !!env.COPILOT_AGENT_SESSION_ID;
  // Copilot CLI runs the Claude project hooks; only its payloads carry `timestamp`, only its native hooks the --harness tag. No env makes them claude (ADR-0015).
  const pick = (args, p, env) => {
    if (!args.harness && p.timestamp !== undefined) return 'inherited';
    const named = args.harness || env.MUTAGATE_HARNESS || p.harness || (shell(args, p, env) ? 'copilot' : env.CODEX_HOME || p.turn_id ? 'codex' :
      env.CLAUDE_PLUGIN_ROOT || env.CLAUDE_PROJECT_DIR ? 'claude' : 'unknown');
    // Only the tag makes a native Copilot call (ADR-0020); the Copilot root agent shell and its workers (MUTAGATE_HARNESS) stay Claude-shaped.
    return named === 'copilot' && args.harness !== 'copilot' ? 'copilotShell' : HARNESSES.includes(named) ? named : 'unknown';
  };
  const base = {
    inert: false, quiet: false, waiver: 'deny', // inert: unrecorded, traced `inherited`; quiet: no stderr
    bashWait: false, label: '', // bashWait: initial_wait hint; label: rerun notice name
    events: ['SessionStart', 'PreToolUse', 'PostToolUse', 'Stop', 'SubagentStop', 'TaskCompleted'],
    read: p => ({ p, record: true }), // null: inert
    place: (args, p, shell) => ({ top: !args.repo && shell, id: () => p.agent_id || p.session_id }), // top: Git top of cwd (the Copilot root agent shell, whatever the tag); id(data): session id
    tags: () => ({}), // extra trace fields
    admit: (c, p, event) => Number(process.versions.node.split('.')[0]) < 22 ? // an intent that ends the call early, else undefined; {error}: traced only
      event === 'SessionStart' ? { notice: `mutagate inactive: hooks run Node ${process.versions.node}; need 22+. Set MUTAGATE_NODE or rerun install.` } : {} : undefined,
    ready: () => '', // SessionStart: a notice when no state can be kept
    deliveries: async () => [], // reports a PostToolUse delivers
    rerun() {}, // after a sync PostToolUse; else the async --mutate hook reruns
    // A --mutate run: the report to deliver now, or null. Redeliver changed results; a pass resets delivery.
    survivor: async (c, key, r, text) => await updateState(c, s => deliver(s, key, text)) && text || null, // a pass has no text: deliver clears the delivered report
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
    copilotShell: { ...base, harness: 'copilot', bashWait: true }, // Copilot by name, not native: traces harness copilot, the bash wait hint
    unknown: { ...base, label: '<harness>', rerun(c, keys) { for (const key of new Set(keys)) schedule(c, key, c.spawn); } }, // no async hook: a worker per target; c.spawn: test seam
    // Inert; one SessionStart notice while no native Copilot hook file exists and, without copilotCloud, no cloud marker is set (ADR-0015, ADR-0021).
    inherited: { ...base, harness: 'copilot', inert: true, write: i => i.notice ? json({ additionalContext: i.notice }) : none,
      admit: (c, p, event) => event === 'SessionStart' && ![path.join(c.repo, '.github'), process.env.COPILOT_HOME || path.join(os.homedir(), '.copilot')]
        .some(d => exists(path.join(d, 'hooks/mutagate.json'))) && (c.config.copilotCloud || !copilot().cloud()) ?
        { notice: `mutagate inactive under Copilot: this repo has only the Claude Code install; run \`${cliName(c)} install --agent copilot\`.` } : {} },
    get copilot() { return own ??= copilot().profile(base); } // copilot.cjs, lazy
  } };
};
