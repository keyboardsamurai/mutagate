'use strict';
// Hook config and install; lazy, off the hook path.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto'), { spawnSync } = require('node:child_process');
const CLI = path.join(__dirname, 'mutagate-hook.cjs'), slash = s => s.split(path.sep).join('/');
const quote = s => process.platform === 'win32' ? '"' + s.replaceAll('"', '""') + '"' : "'" + s.replaceAll("'", "'\\''") + "'";
const atomic = (p, data) => { fs.mkdirSync(path.dirname(p), { recursive: true }); const tmp = `${p}.${process.pid}.${crypto.randomUUID()}.tmp`; fs.writeFileSync(tmp, data, { mode: 0o600 }); fs.renameSync(tmp, p); };
// Runs scripts/hook, which picks Node at run time. [ -f ]: dash exits 2, a block, on a missing script (ADR-0013).
const wrapper = f => `f=${f} && [ -f "$f" ] && sh "$f"`;
const shells = h => [h.command, h.bash, h.powershell]; // the command fields of an entry; Copilot: bash, powershell
const isOurs = (h, rel) => shells(h).some(s => s?.includes('mutagate') || !!rel && s?.includes(`show-toplevel)/${rel}/hook"`));
// Scripts dir under the Git top level, or null for absolute paths and user installs (ADR-0013).
function gitRel(c, scope = 'project') {
  if (process.platform === 'win32' || scope !== 'project') return null;
  try { const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: c.repo, encoding: 'utf8', timeout: 5000 }).stdout.trim(), rel = top && slash(path.relative(fs.realpathSync(top), fs.realpathSync(__dirname)));
    return rel && !rel.startsWith('..') && !path.isAbsolute(rel) && /^[\w./-]+$/.test(rel) ? rel : null; } catch { return null; }
}
// Copilot event: internal event (#35 D1) and matcher from the tool lists of copilot.cjs (writes; delivery points, ADR-0019).
const { TOOLS, DRAIN } = require('./copilot.cjs'), COPILOT = { sessionStart: ['SessionStart'], preToolUse: ['PreToolUse', Object.keys(TOOLS).filter(t => TOOLS[t] !== 'Bash').join('|')],
  postToolUse: ['PostToolUse', [...DRAIN].join('|')], subagentStart: ['SubagentStart'], agentStop: ['Stop --timeout 600'] };
function hooks(agent, rel, stamp) {
  // Wrapper under the Git top level or at its absolute path; Windows: absolute Node and runtime (ADR-0013). SessionStart carries the install stamp (ADR-0017).
  const sh = wrapper(rel ? `"$(git rev-parse --show-toplevel)/${rel}/hook"` : quote(path.join(__dirname, 'hook'))), ps = s => `'${s.replaceAll("'", "''")}'`;
  // Copilot, flat (ADR-0021): never `command`, which also runs under PowerShell. Each entry exits 0, as a failed preToolUse denies the edit.
  if (agent === 'copilot') {
    const entries = {};
    for (const [event, [internal, matcher]] of Object.entries(COPILOT)) { const a = `${internal}${event === 'sessionStart' ? ` --installed ${stamp}` : ''} --harness copilot`;
      entries[event] = [{ type: 'command', ...(matcher ? { matcher } : {}), ...(process.platform === 'win32' ? { powershell: `& ${ps(process.execPath)} ${ps(CLI)} hook ${a}; exit 0` }
        : { bash: `${sh} ${a} || true # mutagate`, powershell: 'exit 0 # mutagate' }), timeoutSec: event === 'agentStop' ? 600 : 30 }]; }
    return { version: 1, hooks: entries };
  }
  // Claude commands that never block end in || true: Copilot also runs .claude/settings.json and denies the edit on a failed PreToolUse (ADR-0013).
  const gate = ['Stop', 'SubagentStop', 'TaskCompleted'], command = (event, extra = '', a = `${event}${event === 'SessionStart' ? ` --installed ${stamp}` : ''}${extra}`) => process.platform === 'win32' ? `${quote(process.execPath)} ${quote(CLI)} hook ${a}`
      : `${sh} ${a}${agent === 'claude' && !extra && !gate.includes(event) ? ' || true' : ''} # mutagate`,
    handler = (event, extra = '') => ({ type: 'command', command: command(event, extra), timeout: gate.includes(event) ? 600 : extra ? 900 : 30,
      ...(agent === 'codex' && !['Stop', 'SubagentStop'].includes(event) ? { additionalContextLimit: 2500 } : {}) }), // Codex rejects it elsewhere.
    out = {};
  for (const event of ['SessionStart', 'PreToolUse', 'PostToolUse', 'Stop', 'SubagentStop', ...(agent === 'claude' ? ['TaskCompleted'] : [])]) out[event] = [{
    ...(['PreToolUse', 'PostToolUse'].includes(event) ? { matcher: agent === 'codex' ? 'Edit|Write|apply_patch' : 'Edit|Write' } : {}),
    hooks: [handler(event), ...(event === 'PostToolUse' ? [{ ...handler(event, ' --mutate'), ...(agent === 'claude' ? { asyncRewake: true } : { async: true }) }] : [])] }];
  return { hooks: out };
}
const ADAPTERS = { opencode: 'opencode.js', pi: 'pi.ts' }; // file in scripts/adapters per adapter harness; Claude, Codex and Copilot get native JSON hooks
// Config file (Claude, Codex, Copilot) or adapter (OpenCode, Pi) of agent's install, under the home dir for user scope, else the repo.
function configFile(agent, scope, c) {
  const user = scope === 'user', base = user ? os.homedir() : c.repo;
  if (agent === 'claude') return path.join(base, '.claude/settings.json');
  if (agent === 'codex') return path.join(user ? process.env.CODEX_HOME || path.join(base, '.codex') : path.join(base, '.codex'), 'hooks.json');
  if (agent === 'copilot') return path.join(user ? process.env.COPILOT_HOME || path.join(base, '.copilot') : path.join(base, '.github'), 'hooks', 'mutagate.json'); // never a settings.json (#35 D2)
  if (agent === 'opencode') return path.join(user ? path.join(process.env.XDG_CONFIG_HOME || path.join(base, '.config'), 'opencode') : path.join(base, '.opencode'), 'plugins', 'mutagate.js');
  if (agent === 'pi') return path.join(base, user ? '.pi/agent/extensions' : '.pi/extensions', 'mutagate.ts');
  throw Error('agent must be claude, codex, opencode, pi, copilot or auto');
}
function install(c, agent, scope = 'project', remove = false, version) {
  if (!['project', 'user'].includes(scope)) throw Error('scope must be project or user');
  if (!remove && Number(process.versions.node.split('.')[0]) < 22) throw Error(`hooks would run ${process.execPath} (Node ${process.versions.node}); rerun install with Node 22+`);
  if (!remove) try { fs.writeFileSync(path.join(__dirname, '.node-path'), process.execPath); } catch {} // for scripts/hook, wrappers, adapters; gitignored
  const rel = gitRel(c, scope), stamp = `${version}:${scope}`, // install stamp (ADR-0017)
    message = file => `${remove ? 'Removed' : 'Installed'} mutagate: ${file}.${remove || rel || scope === 'user' ? '' : ' Paths are absolute and machine-local: do not commit it, or use --scope user.'}`;
  if (!ADAPTERS[agent]) {
    const p = configFile(agent, scope, c), flat = agent === 'copilot', other = scope === 'user' ? 'project' : 'user', config = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : flat ? { version: 1 } : {};
    if (flat && !remove && installStamp(c, agent, other) !== null) throw Object.assign(Error(`copilot is installed in ${configFile(agent, other, c)}; Copilot would run both: uninstall it first`), { usage: true }); // ADR-0021
    config.hooks ??= {};
    for (const [event, groups] of Object.entries(config.hooks)) { // isOurs: absolute form or this skill's wrapper
      config.hooks[event] = flat ? groups.filter(h => !isOurs(h, rel)) : groups.map(g => ({ ...g, hooks: g.hooks.filter(h => !isOurs(h, rel)) })).filter(g => g.hooks.length);
      if (!config.hooks[event].length) delete config.hooks[event];
    }
    if (!remove) for (const [event, groups] of Object.entries(hooks(agent, rel, stamp).hooks)) config.hooks[event] = [...(config.hooks[event] || []), ...groups];
    if (flat && remove && !Object.keys(config.hooks).length && Object.keys(config).every(k => ['version', 'hooks'].includes(k))) { // only ours
      fs.rmSync(p, { force: true }); if (scope === 'project') try { fs.rmdirSync(path.dirname(p)); } catch {} } // an empty .github/hooks still selects copilot (agents)
    else atomic(p, JSON.stringify(config, null, 2) + '\n');
    return message(p) + (agent === 'codex' && !remove ? ' Open /hooks and trust mutagate.' : '');
  }
  const dest = configFile(agent, scope, c);
  if (remove) { if (fs.existsSync(dest) && fs.readFileSync(dest, 'utf8').includes('mutagate adapter')) fs.unlinkSync(dest); }
  else atomic(dest, fs.readFileSync(path.join(__dirname, 'adapters', ADAPTERS[agent]), 'utf8').replace('"__MUTAGATE_CLI__"', JSON.stringify(rel ? slash(path.relative(path.dirname(dest), CLI)) : CLI)).replace('"__MUTAGATE_INSTALLED__"', JSON.stringify(stamp)));
  return message(dest);
}
// --agent auto (ADR-0021): a .claude/ of only skills/ yields to a Copilot signal, as Copilot reads .claude/skills; a Copilot install of the
// other scope already runs, so auto leaves Copilot out (D5); doctor (all) keeps both.
function agents(c, scope, all) {
  const e = process.env, has = f => fs.existsSync(path.join(c.repo, f)), signal = !!(e.COPILOT_CLI || e.COPILOT_AGENT_SESSION_ID) || has('.github/hooks') || has('.github/copilot') ||
    scope === 'user' && !!(e.COPILOT_HOME || fs.existsSync(path.join(os.homedir(), '.copilot'))), copilot = signal && (all || installStamp(c, 'copilot', scope === 'user' ? 'project' : 'user') === null);
  let skills; try { skills = fs.readdirSync(path.join(c.repo, '.claude')).every(f => f === 'skills'); } catch {}
  return Object.entries({ claude: e.CLAUDE_PROJECT_DIR || e.CLAUDE_PLUGIN_ROOT || has('.claude') && (all || !(signal && skills)), codex: e.CODEX_HOME || has('.codex'), opencode: has('.opencode') || has('opencode.json'),
    pi: has('.pi'), copilot }).filter(x => x[1]).map(x => x[0]);
}
// doctor: the install stamp of agent's install in scope, '' without one, or null when not installed (ADR-0017). Raw JSON escapes quotes.
function installStamp(c, agent, scope, file = configFile(agent, scope, c)) { // file: another Copilot hook file of scope (doctor)
  try { const text = fs.readFileSync(file, 'utf8');
    if (ADAPTERS[agent]) return text.match(/installed: "([^"]*)"/)?.[1] ?? '';
    const rel = gitRel(c, scope), ours = Object.values(JSON.parse(text).hooks ?? {}).flat().flatMap(g => g.hooks ?? [g]).filter(h => isOurs(h, rel)); // [g]: flat (Copilot)
    return ours.length ? ours.map(h => shells(h).join(' ').match(/ SessionStart --installed (\S+)/)?.[1]).find(Boolean) ?? '' : null; } catch { return null; }
}
module.exports = { hookConfig: (agent, c, version) => hooks(agent, c && gitRel(c), version), install, installStamp, agents, configFile };
