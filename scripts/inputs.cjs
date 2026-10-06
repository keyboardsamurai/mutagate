const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { glob } = require('./glob.cjs');

const ignored = new Set(['node_modules', 'venv', 'build', 'target', 'state-data', '__pycache__', 'mutants', 'StrykerOutput', 'TestResults']);
const manifests = ['build.gradle', 'build.gradle.kts', 'pom.xml', 'pyproject.toml', 'setup.cfg', 'package.json', 'go.mod'];
const digestCache = new Map();
const digest = value => crypto.createHash('sha1').update(value).digest('hex');
const inside = (root, file) => file === root || file.startsWith(root + path.sep);
const read = file => fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';

function fileDigest(file) {
  const stat = fs.statSync(file, { bigint: true });
  const stamp = `${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}:${stat.ino}`;
  const previous = digestCache.get(file);
  if (previous?.stamp === stamp) return previous.digest;
  const entry = { stamp, digest: digest(fs.readFileSync(file)) };
  digestCache.set(file, entry);
  return entry.digest;
}

const hasManifest = dir => fs.existsSync(dir) && (manifests.some(name => fs.existsSync(path.join(dir, name))) || fs.readdirSync(dir).some(name => /\.(cs|fs)proj$/.test(name)));

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
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true }), dotnet = entries.some(e => e.isFile() && e.name.endsWith('.csproj'));
    const go = fs.existsSync(path.join(project, 'go.mod')), root = dir === project;
    for (const entry of entries) {
      if (dotnet && entry.isDirectory() && ['bin', 'obj'].includes(entry.name)) continue;
      if (go && root && (entry.isDirectory() ? entry.name === 'bin' : entry.name.endsWith('.out'))) continue;
      const file = path.join(dir, entry.name);
      // Go build output: go build -o, go test -c and extensionless executables from go build ./cmd/x.
      if (go && entry.isFile() && (/\.(?:test|exe)$/.test(entry.name) || !entry.name.includes('.') && fs.statSync(file).mode & 0o111)) continue;
      if (entry.isSymbolicLink() || ignored.has(entry.name) || entry.isDirectory() && entry.name.startsWith('.') && !['.mvn', '.config'].includes(entry.name) || owned.some(root => inside(root, file))) continue;
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

exports.inputFiles = inputFiles;
exports.fileDigest = fileDigest;
