'use strict';
// GitHub Copilot native hook calls (`--harness copilot`, #35, ADR-0020): origin, payload normalization, the subagent chain, agentStop output and the write probe;
// `top` also serves session commands in the Copilot root agent shell. Loaded only for those calls. Not hashed into fingerprint: it maps payloads and session ids, not results.
const fs = require('node:fs'), path = require('node:path');
// Cloud coding agent markers (ADR-0021), UNCONFIRMED until spike S16 names the marker.
const CLOUD = ['COPILOT_AGENT_PROMPT', 'GITHUB_COPILOT_API_TOKEN'];
// str_replace_editor is UNCONFIRMED: no recorded call (S1).
const TOOLS = { create: 'Write', edit: 'Edit', str_replace_editor: 'Edit', apply_patch: 'apply_patch', bash: 'Bash', powershell: 'Bash' },
  KEYS = { path: 'file_path', file_text: 'content', old_str: 'old_string', new_str: 'new_string' };
const progress = message => JSON.stringify({ type: 'progress', message }); // a display-only stdout line; the model never sees it (#35 D10)
module.exports = ({ atomic, hash, PATCH_HEADER }) => {
  const link = (data, id) => path.join(data, 'agents', hash(id));
  return {
    // 'spawned' (the --mutate handler; never installed, so never Local), 'local' (a VS Code Local payload) or 'cloud' (ADR-0021), or 'native'.
    origin: (p, args, env = process.env) => args.mutate ? 'spawned' : p.hook_event_name !== undefined ? 'local' : CLOUD.some(k => env[k]) ? 'cloud' : 'native',
    // camelCase payload to the internal shape; the Copilot keys stay. apply_patch sends the raw patch, its paths relative to cwd (S1).
    // Only the TOOLS get a tool_input: a `view {path}` that passes the hook matcher (UNCONFIRMED) names no path, so it stales and denies nothing.
    normalize(p) {
      const a = p.toolArgs, tool = TOOLS[p.toolName], input = !tool ? {} : typeof a === 'string' ? p.toolName === 'apply_patch' ? { command: typeof p.cwd === 'string' ? a.replace(PATCH_HEADER, (_, head, f) => head + path.resolve(p.cwd, f.trim())) : a } : {}
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
    // agentStop output (#35 D12): exit 0; a block is exactly one JSON object, an allow is empty or progress lines. block feeds the trace (#35 D27).
    stop: g => g.block ? { code: 0, block: true, out: { decision: 'block', reason: g.reason } } : g.reason ? { code: 0, text: progress(g.reason) } : { code: 0 },
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
};
