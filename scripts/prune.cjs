'use strict';
// Cache prune, run detached at most once a day from SessionStart. Only <cache root>/repos/ is pruned:
// jars/, tools/, recorded/ and config.json stay. A data dir with a held lock is left for the next prune.
const fs = require('node:fs'), path = require('node:path');
const DAY = 86400000, IDLE = 14 * DAY, TRACE_BYTES = 10 * 1024 * 1024;
const list = d => { try { return fs.readdirSync(d); } catch { return []; } },
  stat = p => fs.statSync(p, { throwIfNoEntry: false }),
  rm = p => fs.rmSync(p, { recursive: true, force: true }),
  // Only ENOENT and ENOTDIR mean gone: a repo that a sandbox hides (EPERM, EACCES) still exists.
  gone = p => { try { fs.statSync(p); return false; } catch (e) { return ['ENOENT', 'ENOTDIR'].includes(e.code); } };
module.exports = async function prune(root, { lock, abandoned }, now = Date.now()) {
  const repos = path.join(root, 'repos');
  for (const name of list(repos)) {
    const d = path.join(repos, name), at = (...f) => stat(path.join(d, ...f))?.mtimeMs ?? now, old = (age, ...f) => now - at(...f) > age;
    try {
      if (!stat(d)?.isDirectory()) continue;
      const locks = [...list(path.join(d, 'locks')).map(f => path.join(d, 'locks', f)), ...list(path.join(d, 'state')).filter(f => /\.lock(\.break)?$/.test(f)).map(f => path.join(d, 'state', f))];
      if (locks.some(p => stat(p) && !abandoned(p))) continue;
      let repo = '';
      try { repo = fs.readFileSync(path.join(d, 'repo-path'), 'utf8'); } catch {}
      // Data dirs written before the repo-path marker existed go after 14 days without a write. Their files are
      // not pruned: a deletion would touch the dir mtimes that this idle check reads. SessionStart or register marks a used one.
      const marked = path.isAbsolute(repo);
      if (marked ? gone(repo) : now - Math.max(at(), ...list(d).map(f => at(f))) > IDLE) { rm(d); continue; }
      if (!marked) continue;
      for (const f of list(path.join(d, 'reports'))) if (old(DAY, 'reports', f)) rm(path.join(d, 'reports', f));
      for (const f of list(path.join(d, 'state')).filter(f => f.endsWith('.json') && old(IDLE, 'state', f))) {
        const p = path.join(d, 'state', f), release = await lock(p + '.lock', 0);
        if (release) try { if (old(IDLE, 'state', f)) fs.rmSync(p, { force: true }); } finally { release(); }
      }
      // Production edits keep a session's state fresh without rewriting its results: results go only with their state.
      for (const f of list(path.join(d, 'results'))) if (old(IDLE, 'results', f) && !stat(path.join(d, 'state', f + '.json'))) rm(path.join(d, 'results', f));
      const trace = path.join(d, 'trace.jsonl');
      if ((stat(trace)?.size ?? 0) > TRACE_BYTES) fs.renameSync(trace, trace + '.1');
    } catch {} // one unreadable data dir does not stop the others
  }
};
