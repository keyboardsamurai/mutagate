// mutagate adapter: OpenCode; lifecycle translation only.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Relative to this file; import.meta.dirname is undefined under Pi.
const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "__MUTAGATE_CLI__");
// As scripts/hook; process.execPath may be the harness.
const node = [process.env.MUTAGATE_NODE, (() => { try { return fs.readFileSync(path.join(path.dirname(cli), '.node-path'), 'utf8').trim(); } catch {} })()].find(n => { try { fs.accessSync(n, fs.constants.X_OK); return true; } catch {} }) || 'node';
const EDITS = new Set(['write', 'edit', 'patch', 'apply_patch']);
export const Mutagate = async ({ client, directory }) => {
  const call = (event, session, tool, args, mutate = false) => new Promise((resolve) => {
    const child = spawn(node, [cli, 'hook', event, ...(mutate ? ['--mutate'] : [])], { stdio: ['pipe', 'pipe', 'pipe'] });
    let text = ''; child.stdout.on('data', b => text += b); child.stderr.resume();
    child.on('error', () => resolve({}));
    child.on('close', () => { try { resolve(JSON.parse(text)); } catch { resolve({}); } });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify({ cwd: directory, session_id: session, harness: 'opencode', hook_event_name: event, tool_name: tool === 'write' ? 'Write' : tool === 'edit' ? 'Edit' : tool, tool_input: args ? {...args, file_path: args.filePath} : undefined }));
  });
  const model = async (id) => { // keep the session's model on reprompts; fail open to the config default
    try { const m = (await client.session.messages({ path: { id } }))?.data?.findLast(x => x.info?.role === 'assistant' && x.info.providerID && x.info.modelID)?.info; return m && { model: { providerID: m.providerID, modelID: m.modelID } }; } catch { return undefined; }
  };
  const prompt = async (sessionID, text, noReply) => client.session.prompt({ path: { id: sessionID }, body: { noReply, ...await model(sessionID), parts: [{ type: 'text', text }] } });
  return {
    // The bash tool merges output.env into its env, so the agent's own mutagate CLI calls join the hook session; user ! shells and PTYs have no sessionID.
    'shell.env': async (input, output) => { if (input.sessionID) { output.env.MUTAGATE_HOOK_SESSION = input.sessionID; output.env.MUTAGATE_HARNESS = 'opencode'; } },
    'tool.execute.before': async (input, output) => {
      if (!EDITS.has(input.tool)) return;
      const r = await call('PreToolUse', input.sessionID, input.tool, output.args);
      if (r.hookSpecificOutput?.permissionDecision === 'deny') throw new Error(r.hookSpecificOutput.permissionDecisionReason);
    },
    'tool.execute.after': async (input, output) => {
      if (!EDITS.has(input.tool)) return;
      const r = await call('PostToolUse', input.sessionID, input.tool, input.args);
      if (r.hookSpecificOutput?.additionalContext) output.output += '\n' + r.hookSpecificOutput.additionalContext;
      void call('PostToolUse', input.sessionID, input.tool, input.args, true).then(r => {
        if (r.hookSpecificOutput?.additionalContext) return prompt(input.sessionID, r.hookSpecificOutput.additionalContext, true);
      }).catch(() => {});
    },
    event: async ({ event }) => {
      const session = event.properties?.sessionID || event.properties?.info?.id;
      if (!session) return;
      if (event.type === 'session.created') {
        const r = await call('SessionStart', session);
        if (r.systemMessage) await prompt(session, r.systemMessage, true);
      }
      if (event.type === 'session.idle') {
        const r = await call('Stop', session);
        if (r.decision === 'block') await prompt(session, r.reason, false);
        else if (r.systemMessage) await prompt(session, r.systemMessage, true);
      }
    },
  };
};
