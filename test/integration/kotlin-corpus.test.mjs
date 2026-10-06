import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { parsePitXML } from '../../scripts/mutagate.mjs';
const selected = process.env.MUTAGATE_FIXTURES;
test('Kotlin adversarial corpus reproduces actual PIT mutants', {
  skip: Boolean(selected && !selected.split(',').includes('kotlin-gradle')), timeout: 240000
}, t => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'mutagate-corpus-check-'));
  t.after(() => fs.rmSync(output, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, [path.resolve(import.meta.dirname, '../corpus/generate.mjs'), output], { encoding: 'utf8', timeout: 220000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const identities = raw => raw.map(({ status, ...identity }) => JSON.stringify(identity)).sort();
  const actual = parsePitXML(fs.readFileSync(path.join(output, 'mutations.xml'), 'utf8'));
  const expected = parsePitXML(fs.readFileSync(new URL('../corpus/kotlin-unfiltered.xml', import.meta.url), 'utf8'));
  assert.deepEqual(identities(actual), identities(expected));
  t.diagnostic(`${actual.length} actual mutants match labeled evidence`);
});
