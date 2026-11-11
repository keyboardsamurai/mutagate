// Replays model paths on the real scripts/mutagate.mjs. Run: node --test repro.mjs (check.mjs runs it).
// "holds" tests must pass. "finding" tests assert a bug as it is today: when one fails, the finding may be fixed (SKILL.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const m = await import(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../scripts/mutagate.mjs'));

// The fixture of test/core.test.mjs: one Java target, a temp cache root, the Claude profile.
function fixture(t, config = {}) {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mutagate-')));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const put = (f, s) => { fs.mkdirSync(path.dirname(path.join(repo, f)), { recursive: true }); fs.writeFileSync(path.join(repo, f), s); };
  put('src/main/java/acme/Foo.java', 'package acme; public class Foo { public int price(int n) { return n >= 5 ? 10 : 20; }}');
  put('build.gradle', "plugins { id 'java' }");
  const root = path.join(repo, '.cache'), data = path.join(root, 'repos', m.hash(repo));
  const c = { repo, root, data, session: 'test', sid: 'test', harness: 'claude', profile: m.harness().profiles.claude, args: {}, config: { ...structuredClone(m.DEFAULTS), ...config }, errors: [], stateFile: path.join(data, 'state/test.json') };
  return { c, put, test: 'src/test/java/acme/FooTest.java', key: m.hash('acme.Foo') };
}
const WEAK = 'package acme; public class FooTest {}', WEAK2 = WEAK + '\n', STRONG = 'package acme; public class FooTest { /* asserts the boundary */ }';
const mutant = status => [{ file: 'Foo.java', class: 'acme.Foo', line: 1, method: 'price', mutator: 'CONDITIONALS_BOUNDARY', description: 'changed conditional boundary', status }];
// The stand-in for PIT: it reads the test file and kills the mutant only when the test is the strong one.
const pit = f => async () => ({ raw: mutant(fs.readFileSync(path.join(f.c.repo, f.test), 'utf8') === STRONG ? 'KILLED' : 'SURVIVED') });
const write = (f, text, id) => { f.put(f.test, text); return m.handleHook(f.c, { tool_use_id: id, tool_input: { file_path: path.join(f.c.repo, f.test) } }, 'PostToolUse'); };
const stop = (f, runner, wait) => m.gate(f.c, { hook: true, runner, wait }); // the Claude Stop hook (harness.cjs:32) with the runner seam

test('holds: a Stop on the weak test blocks with the survivor', async t => {
  const f = fixture(t);
  await write(f, WEAK, 'a');
  const g = await stop(f, pit(f));
  assert.equal(g.block, true);
  assert.match(g.reason, /score 0\.00/);
});

test('holds (P1, P2 without Revert): the files change during the gate run to new bytes, and the gate does not pass the old measurement', async t => {
  const f = fixture(t);
  await write(f, WEAK, 'a');                                   // the agent writes a test
  let calls = 0;
  const g = await stop(f, async () => {                        // the agent tries to stop; the gate runs the target in the hook
    if (calls++) return pit(f)();                              //   attempt 2 measures the files as they are
    f.put(f.test, STRONG);                                     //   attempt 1: the files change with no hook call
    const produced = await pit(f)();                           //   the runner reads the strong test
    f.put(f.test, WEAK2);                                      //   the files change again, to new bytes
    return produced;
  });
  assert.equal(calls, 2, 'attempt 1 measured other bytes and must not publish');
  assert.equal(g.block, true);
  assert.match(g.reason, /score 0\.00/);
});

test('holds (P1, P2, F1 fixed): the files change and change back during the gate run, and the gate does not pass the weak test', async t => {
  const f = fixture(t);
  await write(f, WEAK, 'a');                                   // 1. the agent writes a test
  let calls = 0;
  const g = await stop(f, async () => {                        // 2-3. the agent tries to stop; the gate runs the target in the hook
    if (calls++) return pit(f)();                              //    attempt 2 measures the files as they are
    f.put(f.test, STRONG);                                     // 4. the files change with no hook call (a new mtime)
    const produced = await pit(f)();                           //    the runner reads the files
    f.put(f.test, WEAK);                                       // 5. the files change back with no hook call (a new mtime again)
    return produced;
  });                                                          // 6. the stat keys changed: attempt 1 publishes nothing
  assert.equal(fs.readFileSync(path.join(f.c.repo, f.test), 'utf8'), WEAK);
  assert.equal(calls, 2, 'attempt 1 saw a write and must not publish');
  assert.equal(g.block, true);                                 // P1: the gate blocks with the survivor report
  assert.match(g.reason, /score 0\.00/);
  assert.match(m.status(f.c), /score 0\.00 \(0\/1\), below$/m); // P2: status shows the score of the weak test
});

test('holds (P1, P2, F1 fixed), agent edits only: the agent strengthens the test and undoes it during the background run, and the gate does not pass the weak test', async t => {
  const f = fixture(t);
  await write(f, WEAK, 'a');                                   // 1. the agent writes a test
  let calls = 0;
  const r = await m.runTarget(f.c, f.key, async () => {        // 2. the background run starts (the --mutate handler's call)
    if (calls++) return pit(f)();                              //    attempt 2 measures the files as they are
    await write(f, STRONG, 'b');                               // 3. the agent edits the test (PostToolUse)
    const produced = await pit(f)();                           //    the runner reads the files
    await write(f, WEAK, 'c');                                 // 4. the agent edits the test back (PostToolUse)
    return produced;
  });                                                          // 5. the stat keys changed: attempt 1 publishes nothing
  assert.equal(calls, 2, 'attempt 1 saw a write and must not publish');
  assert.equal(r.status, 'below');
  assert.equal(m.verdict(f.c, f.key, m.state(f.c).targets[f.key]).kind, 'below'); // P2: the weak test has its own score
  const g = await stop(f, pit(f));                             // 6. the agent tries to stop; the gate finds the result
  assert.equal(g.block, true);                                 // P1: the gate blocks with the survivor report
  assert.match(g.reason, /score 0\.00/);
});

test('holds (P3, F2 fixed): a pending block and a failing-tests block use no round, and the low score still blocks', async t => {
  const f = fixture(t);
  await write(f, WEAK, 'a');                                   // 1. the agent writes a test
  let release; const held = new Promise(r => { release = r; });
  const red = async (c, tt, dir, opts) => { fs.appendFileSync(opts.log, JSON.stringify({ exe: 'gradlew', args: [], code: 1, output: path.join(f.c.repo, f.test) + ':3: error: cannot find symbol', error: '' }) + '\n'); throw Error('gradlew failed (1): > Compilation error'); };
  const background = m.runTarget(f.c, f.key, async (...a) => { await held; return red(...a); }); // 3. the background run starts
  await new Promise(r => setTimeout(r, 50));
  const first = await stop(f, pit(f), 0.2);                    // 2, 4. the agent tries to stop; the wait for the run in flight ends
  assert.equal(first.block, true); assert.match(first.reason, /results pending/);
  release(); await background;                                 // 6. the background run publishes an error (tests fail, attempt 1)
  const second = await stop(f, red);                           // the gate retries, the error is final, and the gate blocks
  assert.equal(second.block, true); assert.match(second.reason, /cannot find symbol/);
  await write(f, WEAK + ' ', 'b');                             // the agent edits the test; it compiles and is still weak
  const third = await stop(f, pit(f));                         // 9. the gate's run publishes a score below the threshold
  assert.equal(third.block, true);                             // the gate blocks with the survivor report, round 1
  assert.match(third.reason, /score 0\.00/);
  assert.doesNotMatch(third.reason, /round cap reached/);
  assert.equal(m.state(f.c).targets[f.key].blocks, 1);
});
