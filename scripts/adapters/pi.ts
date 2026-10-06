// mutagate adapter: Pi; lifecycle translation only. Valid JS, loaded as TS.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Relative to this file; import.meta.dirname is undefined under Pi.
const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "__MUTAGATE_CLI__");
// As scripts/hook; process.execPath may be the harness.
const node = [process.env.MUTAGATE_NODE, (() => { try { return fs.readFileSync(path.join(path.dirname(cli), '.node-path'), 'utf8').trim(); } catch {} })()].find(n => { try { fs.accessSync(n, fs.constants.X_OK); return true; } catch {} }) || 'node';
const EDITS = new Set(['write', 'edit']);
export default function mutagate(pi) {
  const call = (event, ctx, tool, input, mutate = false) => new Promise((resolve) => {
    const child = spawn(node, [cli, 'hook', event, ...(mutate ? ['--mutate'] : [])], { stdio: ['pipe', 'pipe', 'pipe'] });
    let text = ''; child.stdout.on('data', b => text += b); child.stderr.resume();
    child.on('error', () => resolve({}));
    child.on('close', () => { try { resolve(JSON.parse(text)); } catch { resolve({}); } });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify({ cwd: ctx.cwd, session_id: ctx.sessionManager.getSessionId(), harness: 'pi', hook_event_name: event, tool_name: tool === 'write' ? 'Write' : tool === 'edit' ? 'Edit' : tool, tool_input: input ? {...input, file_path: input.path} : undefined }));
  });
  const inject = (text, deliverAs = 'steer') => pi.sendMessage({ customType: 'mutagate', content: text, display: false }, { deliverAs });
  pi.on('session_start', async (_, ctx) => {
    process.env.MUTAGATE_HOOK_SESSION = ctx.sessionManager.getSessionId(); process.env.MUTAGATE_HARNESS = 'pi'; // ponytail: one session per pi process; the bash tool copies process.env per call
    const r = await call('SessionStart', ctx);
    if (r.systemMessage) inject(r.systemMessage, 'nextTurn');
  });
  pi.on('tool_call', async (event, ctx) => {
    if (!EDITS.has(event.toolName)) return;
    const r = await call('PreToolUse', ctx, event.toolName, event.input);
    if (r.hookSpecificOutput?.permissionDecision === 'deny') return { block: true, reason: r.hookSpecificOutput.permissionDecisionReason };
  });
  pi.on('tool_result', async (event, ctx) => {
    if (event.isError || !EDITS.has(event.toolName)) return;
    const r = await call('PostToolUse', ctx, event.toolName, event.input);
    if (r.hookSpecificOutput?.additionalContext) inject(r.hookSpecificOutput.additionalContext);
    void call('PostToolUse', ctx, event.toolName, event.input, true).then(r => {
      if (r.hookSpecificOutput?.additionalContext) inject(r.hookSpecificOutput.additionalContext);
    }).catch(() => {});
  });
  pi.on('agent_end', async (_, ctx) => {
    const r = await call('Stop', ctx);
    if (r.decision === 'block') pi.sendUserMessage(r.reason);
    else if (r.systemMessage) inject(r.systemMessage, 'nextTurn');
  });
}
