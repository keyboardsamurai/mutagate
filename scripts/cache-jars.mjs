#!/usr/bin/env node
// Optional proxy-aware setup utility. The mutation CLI still has no npm dependencies.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cacheRoot, parseArgs } from './mutagate.mjs';
const args = parseArgs(process.argv.slice(2));
const base = args['base-url'] || 'https://repo1.maven.org/maven2';
if (!['https://repo1.maven.org/maven2', 'https://repo.maven.apache.org/maven2'].includes(base)) {
  throw Error('Use one of the two canonical Maven Central HTTPS endpoints.');
}
const root = path.join(cacheRoot(), 'jars');
fs.mkdirSync(root, { recursive: true });
const manifest = JSON.parse(fs.readFileSync(new URL('../references/jars.json', import.meta.url)));
for (const item of manifest.filter(item => !item.optional || args['tier-a'])) {
  const destination = path.join(root, path.basename(item.path));
  const valid = file => fs.existsSync(file) && crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') === item.sha256;
  if (valid(destination)) continue;
  if (fs.existsSync(destination)) throw Error(`Checksum mismatch: ${destination}; remove it before retrying.`);
  const temporary = destination + '.' + crypto.randomUUID() + '.tmp';
  try {
    // curl honors HTTPS_PROXY/HTTP_PROXY/NO_PROXY. No redirect or TLS bypass.
    const result = spawnSync('curl', ['--silent', '--show-error', '--fail', '--proto', '=https', '--max-time', '60', '--output', temporary, base + '/' + item.path], { encoding: 'utf8' });
    if (result.error || result.status !== 0) throw Error(`curl failed for ${item.artifact}; check proxy/network settings (${result.error?.code || result.status}).`);
    if (!valid(temporary)) throw Error(`Downloaded checksum mismatch: ${item.artifact}`);
    fs.renameSync(temporary, destination);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}
console.log(`Verified jar cache: ${root}. Use MUTAGATE_OFFLINE=1 to prevent runtime downloads.`);
