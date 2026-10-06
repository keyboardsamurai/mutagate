'use strict';
// Stryker.NET helpers, required lazily by resolveTargets (C# only) and dotnetRunner.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const slash = p => p.split(path.sep).join('/');

// The one .csproj in the nearest directory above file.
function projectDir(repo, file) {
  for (let d = path.dirname(path.resolve(repo, file)); ; d = path.dirname(d)) {
    const projects = fs.readdirSync(d).filter(f => f.endsWith('.csproj'));
    if (projects.length === 1) return { dir: d, name: projects[0] };
    if (projects.length > 1) throw Error(`multiple .csproj files above ${file}; use one project per directory`);
    if (d === repo || d === path.dirname(d)) throw Error(`no .csproj above ${file}`);
  }
}

// VSTest filter over every class of every registered test file that still exists; comments and strings do not count.
// ponytail: the first namespace of a file only; nested classes match through their outer class.
function testFilter(repo, tests) {
  const names = tests.flatMap(f => {
    let src;
    try { src = fs.readFileSync(path.resolve(repo, f), 'utf8'); } catch { return []; }
    src = src.replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    const ns = src.match(/^\s*namespace\s+([\w.]+)/m)?.[1];
    return [...src.matchAll(/\bclass\s+(\w+)/g)].map(m => [ns, m[1]].filter(Boolean).join('.'));
  });
  return [...new Set(names)].map(n => 'FullyQualifiedName~' + n).join('|');
}

// Stryker.NET builds the test project and the target project (projectDir results), so a run holds a lock per project (sorted: no deadlock).
// Targets of different production projects tested from one test project share its lock too.
const projectLocks = (repo, projects) => [...new Set(projects.map(p => slash(path.relative(repo, path.join(p.dir, p.name)))))].sort();

const TEST_SDK = /Microsoft\.NET\.Test\.Sdk|MSTest\.Sdk|<IsTestProject>\s*true|["'](?:xunit|nunit|mstest)[\w.]*["']/i;
// A predicate for .cs files inside a test project (a .csproj referencing a test SDK), cached per directory for one resolution.
function inTestProject(repo) {
  const cache = new Map();
  return file => {
    if (!file.endsWith('.cs')) return false; // other files are never C# targets: skip the directory walk on the hook path
    const dir = path.dirname(path.resolve(repo, file));
    if (!cache.has(dir)) try { const p = projectDir(repo, file); cache.set(dir, TEST_SDK.test(fs.readFileSync(path.join(p.dir, p.name), 'utf8'))); } catch { cache.set(dir, false); }
    return cache.get(dir);
  };
}

// Called while project locks are held; persisted build outputs remain private to mutagate.
function scratch(c, t, inputFiles) {
  const test = projectDir(c.repo, t.tests[0]), key = slash(path.relative(c.repo, path.join(test.dir, test.name)));
  const dir = path.join(c.data, 'dotnet', crypto.createHash('sha256').update(key).digest('hex').slice(0, 16)), manifest = path.join(dir, '.copied.json');
  const inputs = inputFiles(c, t), current = new Set(inputs); // inputFiles excludes project build outputs.
  let previous = []; try { previous = JSON.parse(fs.readFileSync(manifest, 'utf8')); } catch {}
  for (const f of previous) if (!current.has(f)) fs.rmSync(path.join(dir, f), { force: true });
  for (const f of inputs) { const dest = path.join(dir, f); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(path.join(c.repo, f), dest); }
  const tmp = manifest + '.tmp';
  try { fs.writeFileSync(tmp, JSON.stringify(inputs)); fs.renameSync(tmp, manifest); } finally { fs.rmSync(tmp, { force: true }); }
  return dir;
}

module.exports = { projectDir, testFilter, projectLocks, inTestProject, scratch };
