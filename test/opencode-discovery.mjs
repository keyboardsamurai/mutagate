// A pinned binary check; does not call a model or use model credentials.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { context, install } from '../scripts/mutagate.mjs';
const binary = process.env.MUTAGATE_OPENCODE_BIN || 'opencode';
const version = spawnSync(binary, ['--version'], { encoding: 'utf8' });
assert.equal(version.status, 0, version.error?.message || version.stderr);
assert.equal(version.stdout.trim(), '1.18.30');
const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'mutagate-opencode-discovery-'));
try {
  const c = context({ repo });
  install(c, 'opencode');
  const env = { ...process.env, XDG_CONFIG_HOME: path.join(repo, '.config'), XDG_DATA_HOME: path.join(repo, '.data'), XDG_CACHE_HOME: path.join(repo, '.cache') };
  const result = spawnSync(binary, ['debug', 'config'], { cwd: repo, env, encoding: 'utf8', timeout: 45000 });
  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(result.stdout);
  assert.equal(config.plugin.filter(p => p.endsWith('/.opencode/plugins/mutagate.js')).length, 1);
  console.log(JSON.stringify({ version: version.stdout.trim(), discovery: '.opencode/plugins/mutagate.js', occurrences: 1, passed: true }));
} finally {
  fs.rmSync(repo, { recursive: true, force: true });
}
