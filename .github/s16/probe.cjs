#!/usr/bin/env node
'use strict';
// S16 hook probe (spike, do not merge). Usage: node .github/s16/probe.cjs <event> <source>
// Per call it writes one JSON file to <repo top>/.s16-out/<source>-<event>-<pid>.json.
// It records env var NAMES; values only for ALLOW. Other names that match SECRETISH get {present, length}.
// It prints nothing and always exits 0.
const fs = require('fs');
const path = require('path');

const ALLOW = ['COPILOT_CLI', 'COPILOT_CLI_BINARY_VERSION', 'COPILOT_HOOK_DEPTH', 'CI', 'GITHUB_ACTIONS', 'RUNNER_OS',
  'RUNNER_ENVIRONMENT', 'GITHUB_EVENT_NAME', 'GITHUB_WORKFLOW', 'GITHUB_JOB'];
const SECRETISH = /COPILOT|AGENT|TOKEN/i;
const clean = (s) => String(s || 'unknown').replace(/[^\w.-]/g, '_').slice(0, 60);

const event = clean(process.argv[2]);
const source = clean(process.argv[3]);
const top = path.resolve(__dirname, '..', '..');
const out = path.join(top, '.s16-out');

function finish(raw, endedBy) {
  try {
    const names = Object.keys(process.env).sort();
    const values = {};
    const masked = {};
    for (const k of names) {
      if (ALLOW.includes(k)) values[k] = process.env[k];
      else if (SECRETISH.test(k)) masked[k] = { present: true, length: String(process.env[k]).length };
    }
    let json = null;
    try { json = raw.trim() ? JSON.parse(raw) : null; } catch (e) { json = null; }
    const rec = {
      probe: 's16', source, event, argv: process.argv, at: new Date().toISOString(), cwd: process.cwd(),
      stdin: { endedBy, bytes: Buffer.byteLength(raw), raw, keys: json && typeof json === 'object' ? Object.keys(json) : null },
      envNames: names, values, masked,
    };
    fs.mkdirSync(out, { recursive: true });
    const base = path.join(out, `${source}-${event}-${process.pid}`);
    for (let i = 0; i < 50; i++) {
      try { fs.writeFileSync(base + (i ? `-${i}` : '') + '.json', JSON.stringify(rec, null, 2) + '\n', { flag: 'wx' }); break; }
      catch (e) { if (e.code !== 'EEXIST') break; }
    }
  } catch (e) { /* the probe never fails the hook */ }
  process.exit(0);
}

try {
  const chunks = [];
  let done = false;
  const end = (how) => { if (done) return; done = true; clearTimeout(timer); try { process.stdin.destroy(); } catch (e) {} finish(Buffer.concat(chunks).toString('utf8'), how); };
  const timer = setTimeout(() => end('timeout'), 5000);
  if (process.stdin.isTTY) end('tty');
  else {
    process.stdin.on('data', (d) => chunks.push(d));
    process.stdin.on('end', () => end('eof'));
    process.stdin.on('error', () => end('error'));
  }
} catch (e) { process.exit(0); }
