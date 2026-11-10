'use strict';
// Spike evidence hook (do not merge): copies the mutagate cache root into .cloud-evidence/<event>-<pid>/ in the repo top.
// Skips jars/ and tools/. Records file paths (relative) and sizes, and the names (never the values) of the cloud marker env vars.
// Prints nothing and always exits 0.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), { execFileSync } = require('node:child_process');
try { fs.readFileSync(0); } catch {}
try {
  const event = String(process.argv[2] || 'unknown').replace(/[^\w-]/g, '_');
  let top = process.cwd();
  try { top = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || top; } catch {}
  const root = path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'mutagate');
  const dest = path.join(top, '.cloud-evidence', `${event}-${process.pid}`), copy = path.join(dest, 'cache');
  fs.mkdirSync(dest, { recursive: true });
  const files = [], errors = [];
  const walk = (rel) => {
    let entries = [];
    try { entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch (e) { errors.push({ path: rel || '.', code: e.code || 'error' }); return; }
    for (const d of entries) {
      const r = rel ? path.join(rel, d.name) : d.name;
      if (!rel && (d.name === 'jars' || d.name === 'tools')) { files.push({ path: r + '/', skipped: true }); continue; }
      if (d.isDirectory()) { walk(r); continue; }
      try {
        const st = fs.lstatSync(path.join(root, r));
        if (d.isSymbolicLink()) { files.push({ path: r, symlink: true }); continue; }
        files.push({ path: r, size: st.size });
        fs.mkdirSync(path.join(copy, path.dirname(r)), { recursive: true });
        fs.copyFileSync(path.join(root, r), path.join(copy, r));
      } catch (e) { errors.push({ path: r, code: e.code || 'error' }); }
    }
  };
  const exists = fs.existsSync(root);
  if (exists) walk('');
  const markers = Object.keys(process.env).filter(k => /COPILOT_AGENT_JOB_ID|COPILOT_AGENT_CALLBACK_URL/.test(k)).sort();
  fs.writeFileSync(path.join(dest, 'listing.json'), JSON.stringify({ event, pid: process.pid, at: new Date().toISOString(), cacheRootExists: exists,
    files: files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0), errors, markerEnvNames: markers }, null, 2) + '\n');
} catch {}
process.exitCode = 0;
