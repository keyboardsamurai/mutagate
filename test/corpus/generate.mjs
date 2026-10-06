// Generate raw evidence only. Labels must be reviewed separately, never computed
// by junkRule. Requires the pinned Gradle/JDK and a preseeded PIT jar cache.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { command, cacheRoot } from '../../scripts/mutagate.mjs';
const root = path.resolve(import.meta.dirname, '../..');
const output = process.argv[2];
if (!output) throw Error('Provide an output directory for raw corpus evidence.');
fs.mkdirSync(output, { recursive: true });
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mutagate-kotlin-corpus-'));
try {
  const repo = path.join(work, 'fixture');
  fs.cpSync(path.join(root, 'test/fixtures/kotlin-gradle'), repo, {
    recursive: true, filter: p => !p.split(path.sep).some(s => ['build', '.gradle', '.cache'].includes(s))
  });
  const init = path.join(work, 'corpus.gradle');
  fs.writeFileSync(init, `import groovy.json.JsonOutput
allprojects { p -> p.plugins.withId('java') { p.tasks.register('corpusClasspath') {
  dependsOn p.tasks.named('testClasses')
  doLast { println('CORPUS_CP='+JsonOutput.toJson(p.extensions.getByName('sourceSets').test.runtimeClasspath.files.collect{it.absolutePath})) }
} } }
`);
  const build = await command(path.join(repo, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew'), ['--init-script', init, 'corpusClasspath'], { cwd: repo, timeout: 180000 });
  const classpath = JSON.parse(build.output.match(/CORPUS_CP=(.+)/)[1]);
  const java = path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
  const javac = path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'javac.exe' : 'javac');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'references/jars.json')));
  const jars = manifest.filter(x => !x.optional && x.artifact !== 'pitest-junit5-plugin').map(x => path.join(cacheRoot(), 'jars', path.basename(x.path)));
  const engine = jars.find(p => path.basename(p) === 'pitest-1.21.0.jar');
  await command(javac, ['-cp', engine, '-d', work, path.join(import.meta.dirname, 'ExposeSynthetics.java')], { timeout: 30000 });
  const classes = path.join(repo, 'build/classes/kotlin/main');
  await command(java, ['-cp', [work, engine].join(path.delimiter), 'ExposeSynthetics', classes], { timeout: 30000 });
  const result = await command(java, ['-cp', jars.join(path.delimiter), 'org.pitest.mutationtest.commandline.MutationCoverageReport',
    '--classPath', classpath.join(','), '--sourceDirs', path.join(repo, 'src/main/kotlin'), '--mutableCodePaths', classes,
    '--reportDir', path.resolve(output), '--targetClasses', 'acme.*', '--targetTests', 'acme.UserServiceTest',
    '--outputFormats', 'XML', '--mutators', 'DEFAULTS,INLINE_CONSTS', '--features', '-fkotlin,-fstati',
    '--timestampedReports', 'false', '--threads', '4', '--failWhenNoMutations', 'true'], { cwd: repo, timeout: 120000 });
  fs.writeFileSync(path.join(output, 'pit.log'), result.output + result.error);
  console.log(path.resolve(output));
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
