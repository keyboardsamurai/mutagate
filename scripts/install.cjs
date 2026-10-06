'use strict';
// Hook config and install; lazy, off the hook path.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto'), { spawnSync } = require('node:child_process');
const CLI = path.join(__dirname, 'mutagate-hook.cjs'), slash = s => s.split(path.sep).join('/');
const quote = s => process.platform === 'win32' ? '"' + s.replaceAll('"', '""') + '"' : "'" + s.replaceAll("'", "'\\''") + "'";
const atomic = (p, data) => { fs.mkdirSync(path.dirname(p), { recursive: true }); const tmp = `${p}.${process.pid}.${crypto.randomUUID()}.tmp`; fs.writeFileSync(tmp, data, { mode: 0o600 }); fs.renameSync(tmp, p); };
const wrapper = rel => `f="$(git rev-parse --show-toplevel)/${rel}/hook" && [ -f "$f" ] && sh "$f"`;
const isOurs = (h, rel) => h.command?.includes('mutagate') || !!rel && !!h.command?.includes(`show-toplevel)/${rel}/hook"`);
// Scripts dir under the Git top level, or null for absolute paths (ADR-0013).
function gitRel(c) {
  if (process.platform === 'win32') return null;
  try { const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: c.repo, encoding: 'utf8', timeout: 5000 }).stdout.trim(), rel = top && slash(path.relative(fs.realpathSync(top), fs.realpathSync(__dirname)));
    return rel && !rel.startsWith('..') && !path.isAbsolute(rel) && /^[\w./-]+$/.test(rel) ? rel : null; } catch { return null; }
}
function hooks(agent, rel) {
  // Git top level wrapper or absolute form (ADR-0013).
  const command = (event, extra = '') => rel ? `${wrapper(rel)} ${event}${extra} # mutagate` : `${quote(process.execPath)} ${quote(CLI)} hook ${event}${extra}`,
    handler = (event, extra = '') => ({ type: 'command', command: command(event, extra), timeout: ['Stop', 'SubagentStop', 'TaskCompleted'].includes(event) ? 600 : extra ? 900 : 30,
      ...(agent === 'codex' && !['Stop', 'SubagentStop'].includes(event) ? { additionalContextLimit: 2500 } : {}) }), // Codex rejects it elsewhere.
    out = {};
  for (const event of ['SessionStart', 'PreToolUse', 'PostToolUse', 'Stop', 'SubagentStop', ...(agent === 'claude' ? ['TaskCompleted'] : [])]) out[event] = [{
    ...(['PreToolUse', 'PostToolUse'].includes(event) ? { matcher: agent === 'codex' ? 'Edit|Write|apply_patch' : 'Edit|Write' } : {}),
    hooks: [handler(event), ...(event === 'PostToolUse' ? [{ ...handler(event, ' --mutate'), ...(agent === 'claude' ? { asyncRewake: true } : { async: true }) }] : [])] }];
  return { hooks: out };
}
function install(c, agent, scope = 'project', remove = false) {
  if (!['project', 'user'].includes(scope)) throw Error('scope must be project or user');
  if (!remove && Number(process.versions.node.split('.')[0]) < 22) throw Error(`hooks would run ${process.execPath} (Node ${process.versions.node}); rerun install with Node 22+`);
  if (!remove) try { fs.writeFileSync(path.join(__dirname, '.node-path'), process.execPath); } catch {} // for scripts/hook, wrappers, adapters; gitignored
  const base = scope === 'user' ? os.homedir() : c.repo, rel = scope === 'project' ? gitRel(c) : null,
    message = file => `${remove ? 'Removed' : 'Installed'} mutagate: ${file}.${remove || rel || scope === 'user' ? '' : ' Paths are absolute and machine-local: do not commit it, or use --scope user.'}`;
  if (agent === 'claude' || agent === 'codex') {
    const p = agent === 'claude' ? path.join(base, '.claude/settings.json') : path.join(scope === 'user' ? (process.env.CODEX_HOME || path.join(base, '.codex')) : path.join(base, '.codex'), 'hooks.json'),
      config = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
    config.hooks ??= {};
    for (const [event, groups] of Object.entries(config.hooks)) { // isOurs: absolute form or this skill's wrapper
      config.hooks[event] = groups.map(g => ({ ...g, hooks: g.hooks.filter(h => !isOurs(h, rel)) })).filter(g => g.hooks.length);
      if (!config.hooks[event].length) delete config.hooks[event];
    }
    if (!remove) for (const [event, groups] of Object.entries(hooks(agent, rel).hooks)) config.hooks[event] = [...(config.hooks[event] || []), ...groups];
    atomic(p, JSON.stringify(config, null, 2) + '\n');
    return message(p) + (agent === 'codex' && !remove ? ' Open /hooks and trust mutagate.' : '');
  }
  if (!['opencode', 'pi'].includes(agent)) throw Error('agent must be claude, codex, opencode, pi or auto');
  const dest = agent === 'opencode' ? path.join(scope === 'user' ? path.join(process.env.XDG_CONFIG_HOME || path.join(base, '.config'), 'opencode') : path.join(base, '.opencode'), 'plugins', 'mutagate.js')
    : path.join(base, scope === 'user' ? '.pi/agent/extensions' : '.pi/extensions', 'mutagate.ts');
  if (remove) { if (fs.existsSync(dest) && fs.readFileSync(dest, 'utf8').includes('mutagate adapter')) fs.unlinkSync(dest); }
  else atomic(dest, fs.readFileSync(path.join(__dirname, 'adapters', agent === 'pi' ? 'pi.ts' : 'opencode.js'), 'utf8').replace('"__MUTAGATE_CLI__"', JSON.stringify(rel ? slash(path.relative(path.dirname(dest), CLI)) : CLI)));
  return message(dest);
}
function installed(c, file) { // doctor; raw JSON escapes quotes
  try { const hooks = JSON.parse(fs.readFileSync(file, 'utf8')).hooks ?? {}, rel = gitRel(c); return Object.values(hooks).flat().some(g => g.hooks?.some(h => isOurs(h, rel))); } catch { return false; }
}
module.exports = { hookConfig: (agent, c) => hooks(agent, c && gitRel(c)), install, installed };
