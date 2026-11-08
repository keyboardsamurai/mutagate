const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { glob } = require('./glob.cjs');

// Names both walks skip: tool output, then editor, OS and coverage noise.
const ignored = new Set(['node_modules', 'venv', 'build', 'target', 'state-data', '__pycache__', 'mutants', 'StrykerOutput', 'TestResults', 'htmlcov', 'test-results', '.DS_Store', 'Thumbs.db']);
const noise = /^\.coverage(?:\..+)?$|\.sw[po]$|~$/, unreadable = new Set(['EACCES', 'EPERM', 'ENOENT', 'ELOOP', 'ENOTDIR']);
const manifests = ['build.gradle', 'build.gradle.kts', 'pom.xml', 'pyproject.toml', 'setup.cfg', 'package.json', 'go.mod'];
const digestCache = new Map();
const digest = value => crypto.createHash('sha1').update(value).digest('hex');
const inside = (root, file) => file === root || file.startsWith(root + path.sep);
// A file or directory mutagate cannot read counts as empty: '' here, no entries in dirEntries, a fixed digest in fileDigest.
const read = file => { try { return fs.readFileSync(file, 'utf8'); } catch (e) { if (unreadable.has(e.code)) return ''; throw e; } };

// The stat values that change when a file changes; fileDigest and the loadResult memo compare them.
const statKey = file => { const s = fs.statSync(file, { bigint: true }); return `${s.size}:${s.mtimeNs}:${s.ctimeNs}:${s.ino}`; };
function fileDigest(file) {
  try {
    const at = statKey(file), previous = digestCache.get(file);
    if (previous?.at === at) return previous.digest;
    const entry = { at, digest: digest(fs.readFileSync(file)) };
    digestCache.set(file, entry);
    return entry.digest;
  } catch (e) { if (unreadable.has(e.code)) return 'unreadable'; throw e; }
}

const scanned = name => !ignored.has(name) && !noise.test(name);
// Directory entries for the files() and inputFiles walks, without ignored and noise names or, beside a .csproj, bin and obj
// (.NET build output); none for an unreadable dir or, below the walk root, a venv (pyvenv.cfg).
function dirEntries(dir, root = false) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { if (unreadable.has(e.code)) return []; throw e; }
  entries = !root && entries.some(e => e.name === 'pyvenv.cfg') ? [] : entries.filter(e => scanned(e.name));
  return entries.some(e => e.isFile() && e.name.endsWith('.csproj')) ? entries.filter(e => !(e.isDirectory() && ['bin', 'obj'].includes(e.name))) : entries;
}

// The files Git lists below repo (tracked and unignored untracked), or null outside Git or when it lists none (repo inside an
// ignored directory). Deleted tracked files, tracked symlinks, submodules and nested repositories are left out.
function gitFiles(repo) {
  const git = spawnSync('git', ['ls-files', '-z', '-s', '-t', '-c', '-o', '--exclude-standard'], { cwd: repo, encoding: 'utf8', maxBuffer: 2 ** 28, timeout: 10000 });
  if (git.error || git.status !== 0 || !git.stdout) return null;
  const found = new Set();
  for (const entry of git.stdout.split('\0')) {
    const file = entry[0] === '?' ? entry.slice(2) : entry.slice(entry.indexOf('\t') + 1);
    // A deleted tracked file stays in the index until staged; existsSync drops it at less cost than ls-files -d.
    if (entry[0] === '?' ? !file.endsWith('/') : entry && !/^. 1[26]0000 /.test(entry) && fs.existsSync(path.join(repo, file))) found.add(file);
  }
  return [...found];
}

// Files for detect, registration and resolution: in a Git repo the files Git lists (ADR-0016), else a walk. Both drop ignored and
// noise names, hidden names, dist, venvs below the root, bin and obj beside a .csproj, exclude globs and symlinks (Git: tracked ones only).
function files(repo, exclude) {
  const kept = (relative, name) => !name.startsWith('.') && name !== 'dist' && !exclude.some(g => glob(g).test(relative));
  const listed = gitFiles(repo);
  if (listed) {
    const venvs = new Set(), dotnets = new Set(), dirs = new Map([['.', true]]);
    for (const f of listed) if (f.endsWith('/pyvenv.cfg')) venvs.add(path.posix.dirname(f)); else if (f.endsWith('.csproj')) dotnets.add(path.posix.dirname(f));
    const dirKept = d => {
      if (!dirs.has(d)) { const parent = path.posix.dirname(d), name = path.posix.basename(d); dirs.set(d, dirKept(parent) && !venvs.has(d) && scanned(name) && !(dotnets.has(parent) && ['bin', 'obj'].includes(name)) && kept(d, name)); }
      return dirs.get(d);
    };
    return listed.filter(f => { const name = path.posix.basename(f); return dirKept(path.posix.dirname(f)) && scanned(name) && kept(f, name); });
  }
  const out = [];
  function visit(dir) {
    const entries = dirEntries(dir, dir === repo);
    for (const e of entries) {
      const p = path.join(dir, e.name), relative = path.relative(repo, p).split(path.sep).join('/');
      if (e.isSymbolicLink() || !kept(relative, e.name)) continue;
      if (e.isDirectory()) visit(p);
      else out.push(relative);
    }
  }
  visit(repo);
  return out;
}
const hasManifest = dir => manifests.some(name => fs.existsSync(path.join(dir, name))) || dirEntries(dir, true).some(e => /\.(cs|fs)proj$/.test(e.name));

function projectRoot(repo, file) {
  let dir = path.dirname(path.resolve(repo, file));
  while (inside(repo, dir)) {
    if (hasManifest(dir)) return dir;
    if (dir === repo) break;
    dir = path.dirname(dir);
  }
  return repo;
}

// Scope to the owning projects and their declared local dependencies. Resources
// underneath a selected project are inputs too; documentation and run output are not.
function inputFiles(c, t) {
  const selected = new Set(t.module !== undefined && (t.module || ['java', 'kotlin'].includes(t.language)) ? [path.resolve(c.repo, t.module || '.')] : []);
  for (const file of [t.file, ...(t.tests || [])].filter(Boolean)) selected.add(projectRoot(c.repo, file));
  for (const root of c.config.mainRoots) {
    const directory = path.resolve(c.repo, root);
    if (inside(c.repo, directory)) selected.add(directory);
  }
  if (!selected.size) selected.add(c.repo);
  for (const dir of selected) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir).filter(f => f.endsWith('.csproj'))) {
      for (const match of read(path.join(dir, name)).matchAll(/<ProjectReference\b[^>]*\bInclude\s*=\s*['"]([^'"]+)['"]/g)) {
        const project = path.resolve(dir, match[1].replaceAll('\\', '/'));
        if (inside(c.repo, project) && fs.existsSync(project) && inside(c.repo, fs.realpathSync(project))) selected.add(path.dirname(fs.realpathSync(project)));
      }
    }
    const build = read(path.join(dir, 'build.gradle')) + read(path.join(dir, 'build.gradle.kts'));
    for (const match of build.matchAll(/project\s*\(\s*(?:path\s*[:=]\s*)?['"]:([^'"]+)['"]/g)) {
      const dependency = path.resolve(c.repo, match[1].replaceAll(':', '/'));
      if (inside(c.repo, dependency) && fs.existsSync(dependency)) selected.add(dependency);
    }
    // Maven reactor dependencies are matched by artifact id, not directory name.
    const pom = read(path.join(dir, 'pom.xml'));
    const rootPom = read(path.join(c.repo, 'pom.xml'));
    for (const match of rootPom.matchAll(/<module>\s*([^<]+)\s*<\/module>/g)) {
      const dependency = path.resolve(c.repo, match[1].trim());
      if (!inside(c.repo, dependency)) continue;
      const candidate = read(path.join(dependency, 'pom.xml')).replace(/<parent>[\s\S]*?<\/parent>/g, '');
      const artifact = candidate.match(/<artifactId>([^<]+)<\/artifactId>/)?.[1];
      if (artifact && [...pom.matchAll(/<dependency>[\s\S]*?<artifactId>([^<]+)<\/artifactId>[\s\S]*?<\/dependency>/g)].some(m => m[1] === artifact)) selected.add(dependency);
    }
  }
  const found = new Set();
  const owned = ['repos', 'jars', 'recorded', 'tools'].map(name => path.resolve(c.root, name));
  function visit(dir, project) {
    const root = dir === project, entries = dirEntries(dir, root);
    const go = fs.existsSync(path.join(project, 'go.mod'));
    for (const entry of entries) {
      if (go && root && (entry.isDirectory() ? entry.name === 'bin' : entry.name.endsWith('.out'))) continue;
      const file = path.join(dir, entry.name);
      // Go build output: go build -o, go test -c and extensionless executables from go build ./cmd/x.
      if (go && entry.isFile() && (/\.(?:test|exe)$/.test(entry.name) || !entry.name.includes('.') && fs.statSync(file).mode & 0o111)) continue;
      if (entry.isSymbolicLink() || entry.isDirectory() && entry.name.startsWith('.') && !['.mvn', '.config'].includes(entry.name) || owned.some(root => inside(root, file))) continue;
      const relative = path.relative(c.repo, file).split(path.sep).join('/');
      if (c.config.exclude.some(pattern => glob(pattern).test(relative))) continue;
      if (entry.isDirectory()) {
        if (file !== project && hasManifest(file) && !selected.has(file)) continue;
        if (['docs', 'reports', 'coverage', 'dist'].includes(entry.name)) continue;
        visit(file, project);
      } else if (!/\.(?:md|log|tmp)$/.test(entry.name)) found.add(file);
    }
  }
  for (const dir of selected) {
    visit(dir, dir);
    let parent = path.dirname(dir);
    while (inside(c.repo, parent)) {
      for (const name of [...manifests, 'settings.gradle', 'settings.gradle.kts', 'gradle.properties', 'gradlew', 'gradlew.bat', 'uv.lock', 'package-lock.json', 'go.sum', 'go.work', 'go.work.sum', 'global.json', 'Directory.Build.props', 'Directory.Build.targets', 'Directory.Packages.props', 'nuget.config', 'NuGet.Config', ...fs.readdirSync(parent).filter(f => /\.slnx?$/.test(f))]) {
        const file = path.join(parent, name);
        if (fs.existsSync(file)) found.add(file);
      }
      for (const name of ['gradle', 'buildSrc', '.mvn']) visit(path.join(parent, name), parent);
      if (parent === c.repo) break;
      parent = path.dirname(parent);
    }
  }
  for (const file of [t.file, ...(t.tests || [])].filter(Boolean)) {
    const absolute = path.resolve(c.repo, file);
    if (inside(c.repo, absolute) && fs.existsSync(absolute)) found.add(absolute);
  }
  return [...found].sort().map(file => path.relative(c.repo, file).split(path.sep).join('/'));
}

exports.files = files;
exports.inputFiles = inputFiles;
exports.fileDigest = fileDigest;
exports.statKey = statKey;
exports.read = read;
exports.unreadable = unreadable;
