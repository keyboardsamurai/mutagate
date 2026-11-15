'use strict';
// doctor output and harness version notes; lazy, off the hook path, not in the fingerprint.
const { execFile } = require('node:child_process'), fs = require('node:fs'), path = require('node:path');
const HARNESSES = { claude: '@anthropic-ai/claude-code', codex: '@openai/codex', opencode: 'opencode-ai', pi: '@mariozechner/pi-coding-agent', copilot: '@github/copilot' }; // copilot: the CLI, not VS Code
// First stdout line of `<bin> --version`, or null when absent, failing or slower than the timeout.
const version = (bin, args = ['--version'], timeout = 3000) => new Promise(resolve => {
  setTimeout(() => resolve(null), timeout + 500).unref(); // a grandchild can hold the pipe open
  try {
    execFile(bin, args, { timeout, encoding: 'utf8', windowsHide: true, shell: process.platform === 'win32' }, (e, out) => resolve(e ? null : String(out).trim().split('\n')[0] || null));
  } catch { resolve(null); }
});
// A WARN check (pass: true) per harness on PATH whose version differs from the tested pin.
async function harnessChecks(pins, run = bin => version(bin)) {
  const found = await Promise.all(Object.keys(HARNESSES).map(bin => run(bin)));
  return Object.entries(HARNESSES).flatMap(([bin, pkg], i) => {
    const got = found[i]?.match(/\d+\.\d+\.\d+/)?.[0], pin = pins?.packages?.[pkg];
    return got && pin && got !== pin ? [{ name: `${bin} version`, pass: true, warn: true, note: `${got} differs from tested ${pin}; see README harness matrix` }] : [];
  });
}
// The skill dir that a Copilot hook file runs, from the command forms of install.cjs: the Git top wrapper, the absolute wrapper or the Windows runtime path.
function hookSkill(file, top) {
  try { const s = Object.values(JSON.parse(fs.readFileSync(file, 'utf8')).hooks).flat().flatMap(h => [h.bash, h.powershell]).join('\n'),
      rel = s.match(/show-toplevel\)\/([\w./-]+)\/hook"/), abs = s.match(/^f='(.+?)\/hook' /m) || s.match(/^& '.*?' '(.+?)[\\/]mutagate-hook\.cjs'/m);
    return rel ? path.join(top, rel[1], '..') : path.dirname(abs[1]); } catch {}
}
// Copilot checks, only with a Copilot hook file or signal (ADR-0021): the hook files of both scopes and other files there (#35 D5), a Claude project install
// that stays inert under Copilot (D25), the skill copy that Copilot loads against the copy its hooks run (D26), the cache root (D23) and setup hints.
function copilotChecks(c, { inst, cp, found, detected, cli }) {
  const files = ['project', 'user'].flatMap(s => { const d = path.dirname(inst.configFile('copilot', s, c));
    try { return fs.readdirSync(d).sort().map(n => path.join(d, n)).filter(f => f.endsWith('.json') && inst.installStamp(c, 'copilot', s, f) !== null); } catch { return []; } });
  if (!files.length && !detected.includes('copilot')) return [];
  const top = cp.top(c.repo) || c.repo, off = cp.probe(path.join(c.data, 'state')), name = 'copilot hook files',
    copies = [['.github', '.agents', '.claude'].map(d => path.join(top, d, 'skills/mutagate')).find(d => fs.existsSync(d)), hookSkill(files[0], top)],
    [a, b] = copies.map(d => { try { return fs.readFileSync(path.join(d, 'scripts/mutagate.mjs'), 'utf8').match(/^export const VERSION = '(.+)'/m)[1]; } catch {} });
  return [...files.length > 1 ? [{ name, pass: true, warn: true, note: `Copilot runs each of ${files.join(', ')}: keep one (${cli} uninstall --agent copilot [--scope user] removes a scope)` }]
    : files.length ? [{ name, pass: true, note: files[0] }] : found.some(([h, s]) => h === 'claude' && s === 'project')
      ? [{ name, pass: true, warn: true, note: `none; mutagate keeps its hooks in .claude/settings.json inert under Copilot: run ${cli} install --agent copilot` }] : [],
    ...a && b && a !== b ? [{ name: 'copilot skill copy', pass: true, warn: true, note: `Copilot loads ${copies[0]} (mutagate ${a}), its hooks run ${copies[1]} (mutagate ${b}): keep one copy` }] : [],
    { name: 'cache root writable', pass: !off, hint: off },
    { name: 'copilot setup', pass: true, note: 'Copilot loads repo hooks only in a trusted folder (copilot -p: --trust-folder), not under a managed-hooks-only policy.' }];
}
const progress = name => process.stderr.write(`checking ${name}…\n`);
const render = d => [`mutagate ${d.version}`, ...d.checks.map(x => `${x.warn ? 'WARN' : x.pass ? 'PASS' : 'FAIL'} ${x.name}${x.pass ? (x.note ? ': ' + x.note : '') : ': ' + x.hint}`),
  ...(d.checks.every(x => x.pass) ? ['All checks passed. Restart your agent so it loads the hooks.'] : [])].join('\n');
module.exports = { copilotChecks, harnessChecks, hookSkill, progress, render, version };
