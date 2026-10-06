'use strict';
// doctor output and harness version notes; lazy, off the hook path, not in the fingerprint.
const { execFile } = require('node:child_process');
const HARNESSES = { claude: '@anthropic-ai/claude-code', codex: '@openai/codex', opencode: 'opencode-ai', pi: '@mariozechner/pi-coding-agent' };
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
const progress = name => process.stderr.write(`checking ${name}…\n`);
const render = d => [`mutagate ${d.version}`, ...d.checks.map(x => `${x.warn ? 'WARN' : x.pass ? 'PASS' : 'FAIL'} ${x.name}${x.pass ? (x.note ? ': ' + x.note : '') : ': ' + x.hint}`),
  ...(d.checks.every(x => x.pass) ? ['All checks passed. Restart your agent so it loads the hooks.'] : [])].join('\n');
module.exports = { harnessChecks, progress, render, version };
