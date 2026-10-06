# Go and C# runners: implementation plan

Adds two languages to mutagate: **Go** (gomutants default, gremlins compatibility fallback) and **C#** (Stryker.NET). Self-contained: read this file plus the repo files it names. Tool facts in section 1 were verified against upstream sources on 2026-09-13; anything marked **VERIFY** must be confirmed on a real toolchain in Phase 0 before the code that depends on it is written.

Effort: Go small (static binary, no classpath), C# medium (build times, project resolution). Do the phases in order; each ends with a runnable check.

---

## 0. Codebase orientation (read before editing)

- **Core** is `scripts/mutagate.mjs` (ESM, one file, Node built-ins only). `scripts/mutagate-hook.cjs` is **generated** from it by `npm run generate:runtime`; never edit it by hand, `npm test` fails on drift. The generator only understands `import x from '...'` lines and `export function|const`; do not add `export { } from`, dynamic `import()`, or new `import.meta` uses.
- `test/protocol.test.mjs` caps `mutagate.mjs` at <1200 lines (currently 1174). Raise the cap to 1400 and update the README sentence "core, under 1,200 lines". The new runners follow the same inline pattern as `pit`, `stryker`, `python`; splitting them out would need a helper-injection API that does not exist.
- **Runner contract**: `async fn(c, t, dir, opts) -> { raw: Mutant[], ...meta }`. `raw[]` = `{ file, line, method, mutator, mutation_key, description, status }`, `file` repo-relative with forward slashes, `status` in `KILLED|SURVIVED|TIMED_OUT|NO_COVERAGE|NON_VIABLE|RUN_ERROR|PENDING`. `dir` is a per-run scratch dir (deleted unless `MUTAGATE_DEBUG=1`). `opts` = `{ cwd, timeout, deadline, log }`; spread it into every `command()` call. Extra keys returned next to `raw` are spread last into the result by `normalize`, so a runner can set `runner: 'gremlins'`.
- `command(exe, args, opts)` (L434): spawns detached, SIGKILLs the process group at `deadline`, rejects on nonzero exit unless `allowFailure`. The rejection message becomes the infrastructure error shown to the agent, and infrastructure errors fail open. Messages matching `/SIGKILL|budget exceeded/` become `unscored` instead of `error`.
- Dispatch sites for language and runner names (all must change): `DEFAULTS.languages` L18, `TESTS` L142, `language()` L163, `moduleRoot()` L165, `resolveTargets()` L175, `normalize()` runner field L398, `runTarget()` dispatch L710 and catch L718, `detect()` L899, `doctor()` L964, `references/result-schema.json` enums.
- **Target resolution** (`resolveTargets`): non-JVM languages use `{ file, target: file }`; primary = non-test file whose stem equals the test stem (after stripping `_test`, `Tests?`, `Spec`, `IT`); `alongside` narrows to the same directory when possible. `testNames` for non-JVM = `[test path]`.
- **Fingerprints** (`scripts/inputs.cjs`): project roots are found by manifest files; everything under a selected root except ignored dirs is hashed. Build outputs that change on every build (`bin/`, `obj/`) must be ignored or results invalidate constantly. Tool outputs must never land in the user's repo.
- **Tests**: `npm test` (deterministic; `test/core.test.mjs` uses a dense one-test-per-line style with `fixture(t)` and `m.*` exports, follow it). `MUTAGATE_FIXTURES=a,b npm run test:integration` runs real tools: copies `test/fixtures/<name>` to tmp, swaps `variants/<stem>.weak|strong.<ext>` into `expected.test`, asserts `expected.json` score ranges, asserts the manifest file is byte-identical afterwards. Run it twice, default entry and `MUTAGATE_TEST_ENTRY=mutagate-hook.cjs`.
- **Pins**: `test/harness-versions.json` must deep-equal `references/versions.json` (protocol test). Tool pins that the runtime needs live in code (section 4.8) and a test ties them to the JSON.
- This dev machine has neither `go` nor `dotnet`. Install first (macOS: `brew install go` gives 1.26+, `brew install --cask dotnet-sdk` gives SDK 10). Do not write `dotnet-tools.json`, `.gomutants.yml`, or `stryker-config.json` into any user repo or fixture.

---

## 1. Verified tool facts

### gomutants (`github.com/szhekpisov/gomutants`, v0.6.1, 2026-09-10)

- Install: `go install github.com/szhekpisov/gomutants@v0.6.1`. Requires **Go 1.26+ to build and, per README, for the project under test** (VERIFY the second half by running it against a `go 1.22` go.mod). Release tarballs for darwin/linux only, Sigstore-signed; Windows "works wherever go does", untested upstream.
- Invocation: `gomutants [flags] <package patterns>`; `unleash` as first arg is accepted and dropped (gremlins compat). **Flags must precede patterns** (std `flag` package). Use `--flag=value` form for every flag. cwd must contain `go.mod`.
- Flags used: `--output=<file>` (default `mutation-report.json` **in cwd**, always redirect), `--stryker-output=<file>` (mutation-testing-elements v2 JSON), `--cache=<file>` (default `.gomutants-cache.json` **in cwd**, always redirect; `--cache=off` disables), `--workers=N`, `--exclude-files=<re1>,<re2>` (Go regexps against module-relative slash paths; **there is no include flag**), `--test-flags=<flag>` (repeatable, forwarded verbatim to every inner `go test`: coverage, baseline, per-mutant; **rejects** `-overlay,-run,-args,-timeout,-coverprofile,-coverpkg,-c,-o,-exec`; `-skip` is not rejected, VERIFY), `--tags=a,b`, `--dry-run`, `--list-mutators`, `--version`, `--changed-since=<ref>` (not used; mutagate scopes by file).
- Exit codes: 0 success (survivors do not change it unless thresholds are set), 1 build/runtime/target error, 2 usage error, 10/11 threshold breaches (unused).
- Report: `schemaVersion "2"`, top-level `projectRoot` = absolute cwd, `files` keyed by **package-relative slash path** for the selected package (even though projectRoot names the module), each mutant `{ id, mutatorName, location{start,end}, status, replacement }`; no `method`, no `killedBy`. Status names: `Killed, Survived, NoCoverage, CompileError, Timeout, RuntimeError, Ignored (equivalent), Pending`.
- Mutator names (28): `ARITHMETIC_BASE CONDITIONALS_BOUNDARY CONDITIONALS_NEGATION INCREMENT_DECREMENT INVERT_NEGATIVES INVERT_ASSIGNMENTS INVERT_BITWISE INVERT_BITWISE_ASSIGNMENTS INVERT_LOGICAL INVERT_LOOP_CTRL REMOVE_SELF_ASSIGNMENTS REMOVE_LOGICAL_NOT ERRORF_WRAP INTEGER_INCREMENT INTEGER_DECREMENT FLOAT_INCREMENT FLOAT_DECREMENT BRANCH_IF BRANCH_ELSE BRANCH_CASE EXPRESSION_REMOVE STATEMENT_REMOVE LOOP_CONDITION RANGE_BREAK RETURN_ERROR_NIL RETURN_ZERO RETURN_TRUE RETURN_FALSE`.
- Ships its own Claude Code plugin (`/gomutants:mutants`) that proposes `*_test.go` cases for survivors. Mention it in the README as adjacent prior art.

### gremlins (`github.com/go-gremlins/gremlins`, v0.6.0, 2025-12-06)

- Install: `go install github.com/go-gremlins/gremlins/cmd/gremlins@v0.6.0` (Go 1.25+ to build). Windows: manual zip install only.
- Invocation: `gremlins unleash [path]` where `[path]` is a **directory** (module init); run with cwd = package dir so coverage and mutation cover `./<pkg>/...`. Flags (cobra, `--flag=value` fine): `--output=<file>` (JSON), `--tags=`, `--workers=N`, `--exclude-files=<re>` (repeatable, `-E`), `--output-statuses=lctkvsr` (VERIFY default; pass `lctkv` explicitly so killed mutants are always present), `--dry-run`. **No test-selection flag and no way to pass `go test` args.** Exit 0 with survivors unless thresholds set; 10/11 on thresholds.
- JSON: `{ go_module, files: [{ file_name, mutations: [{ type, status, line, column }] }], test_efficacy, ... }`. `file_name` is relative to the run directory (VERIFY: run dir vs module root), slash-separated. Statuses **contain spaces**: `"LIVED" "KILLED" "NOT COVERED" "TIMED OUT" "NOT VIABLE" "SKIPPED" "RUNNABLE"`. Types are the 11 gremlins names (note `INVERT_LOOPCTRL`, `INVERT_BWASSIGN` spellings).

### Stryker.NET (`dotnet-stryker` 5.0.0 on NuGet, 2026-09-11)

- The tool itself needs the **.NET 10 runtime** (targets net10.0). Projects under test may target older frameworks, but that runtime must also be installed to run their tests. .NET Framework needs `--solution`; out of scope for v1.
- Install: `dotnet tool install dotnet-stryker --tool-path <dir> --version 5.0.0` produces `<dir>/dotnet-stryker` (`.exe` on Windows), directly executable. `--version` prints the version.
- CLI: `-f|--config-file <path>` (VERIFY absolute path accepted; docs say "relative-path"), `-p|--project <csproj file NAME, not path>`, `-tp|--test-project <path>` (unneeded when cwd is the test project), `-s|--solution`, `-m|--mutate <glob>` (repeatable, `!` prefix excludes; VERIFY whether relative to the project-under-test directory), `-O|--output <dir>` (**must already exist**; with it set, the JSON lands at `<dir>/reports/mutation-report.json` and nothing is written to cwd), `-r|--reporter json`, `-l|--mutation-level Basic|Standard|Advanced|Complete` (default Standard), `-c|--concurrency N`, `-b|--break-at`, `--skip-version-check`, `-V|--verbosity`, `-t|--test-runner vstest|mtp` (default vstest).
- Config-file-only keys: `"ignore-mutations": ["String", ...]` (names matched case-insensitively against `Statement, Arithmetic, Block, Equality, Boolean, Logical, Assignment, Unary, Update, Checked, Linq, String, Bitwise, Initializer, Regex, NullCoalescing, Math, StringMethod, Conditional, CollectionExpression`), `"coverage-analysis": "perTest"` (default; each mutant runs only against covering tests), `"test-case-filter": "<dotnet test --filter syntax>"` (applied to the initial run **and** every mutant run; this is the test-routing hook), `"additional-timeout"` ms, `"report-file-name"`, `"thresholds": {high, low, break}`. Config file shape: `{ "stryker-config": { ... } }` (VERIFY wrapper key).
- Initial test run executes the whole test project minus `test-case-filter`. Stryker builds the project itself via MSBuild; VERIFY whether a prior `dotnet restore` is required on a fresh clone (expect yes when `obj/project.assets.json` is missing).
- Exit codes (source): 0 success, 1 other error, 2 break-threshold violated (docs wrongly say 1). Score NaN (no mutants) exits 0.
- JSON report: `schemaVersion "2"`, `projectRoot` absolute, **`files` keys are absolute paths**, `testFiles` present. `mutatorName` values are display strings, not enum names: `"Arithmetic mutation"`, `"Equality mutation"`, `"Logical mutation"`, `"Bitwise mutation"`, `"Boolean mutation"`, `"Negate expression"`, `"Block removal mutation"`, `"Statement mutation"`, `"String mutation"`, `"Remove checked expression"`, `"Array|Collection|Object initializer mutation"`, `"Conditional (true|false) mutation"`, `"Null coalescing mutation (...)"`, `"Linq method mutation (First() to FirstOrDefault())"`, `"Math method mutation (...)"`, `"String Method Mutation (...)"`, Roslyn-kind forms like `"AddAssignmentExpression to SubtractAssignmentExpression mutation"`, `"PostIncrementExpression to PostDecrementExpression mutation"`, `"UnaryMinusExpression to UnaryPlusExpression mutation"`, `"LogicalNotExpression to un-LogicalNotExpression mutation"`.
- `--with-baseline` skips mutants in files unchanged since a commit. mutagate mutates one file that is usually the changed one, and build time is the real cost, so baseline buys nothing here. **Not used.**
- F#: all mutators are C# Roslyn syntax; F# is not supported by this runner. VB.NET unsupported. Say both in the README.

---

## 2. Decisions

1. One `go` runner. `goRunner: 'auto'` picks gomutants when resolvable (cache dir, PATH, or installable), else gremlins on PATH, else infrastructure error listing both install commands. `'gomutants'`/`'gremlins'` force one.
2. Tools install into `<cacheRoot>/tools/<name>@<version>/` (same idea as PIT jars in `<cacheRoot>/jars/`): `GOBIN=<tools> go install <module>@<pin>` and `dotnet tool install --tool-path <tools>`. Lookup order: `<tools>/<exe>`, then PATH (`--version` probe), then install unless `MUTAGATE_OFFLINE=1`. Pins are exact versions; Go's sumdb and NuGet signatures give integrity, so no SHA manifest.
3. Go test scoping: mutation restricted to the target file by listing every sibling non-test `.go` file in `--exclude-files`; tests restricted to the scoped file by `--test-flags=-skip=^(OtherTest1|OtherTest2)$` built from `func Test\w*` names in the package's other `_test.go` files. If Phase 0 shows `-skip` is rejected, drop the skip and document "Go scope = package tests that cover the target file" (same semantics as the Jest related-tests path). gremlins gets file scoping only.
4. C# test scoping: `test-case-filter: FullyQualifiedName~<namespace>.<class>` parsed from the test file. Mutation scoped by `mutate: [<target path>]`. Both runners also post-filter `raw` to `m.file === t.file` as a belt-and-braces guard.
5. Noise control: hardcoded `"ignore-mutations": ["String"]` and `mutation-level: Standard` for C# (mark with a `// ponytail:` comment; make configurable only if asked). Generated files are excluded at **target resolution** (a `GENERATED` regex over candidates), not at mutation time, because mutation is already single-file. Patterns: `*.pb.go`, `*_gen.go`, `zz_generated*.go`, `mock_*.go`, `*_mock.go`, `*.Designer.cs`, `*.g.cs`, `*.g.i.cs`, `Migrations/*.cs`.
6. `parseStryker` becomes `parseMutationTestingElements(report, repo)` and relativizes file keys (absolute, or `projectRoot`-relative) to the repo. Shared by ts, go, csharp. Stryker JS keys are cwd-relative and `projectRoot` is cwd, so its behaviour is unchanged.
7. Result `runner` names: `gomutants`, `gremlins`, `stryker-net`. Language names: `go`, `csharp`. Target for both = repo-relative file path (like TS/Python). Module = nearest `go.mod` dir, or nearest dir containing a `.csproj`.
8. No secondary targets for Go/C# (import regex yields nothing useful; leave it).
9. Budgets unchanged. Document that cold Stryker.NET runs take 2 to 5 minutes and recommend `runBudgetSec: 600` in `.mutagate/config.json` for .NET repos; the existing "pending blocks once, then allows" gate behaviour covers the rest.
10. Windows: not claimed for either language in v1; CI runs them on ubuntu only.

---

## 3. Phase 0: toolchain spike (do before writing runner code)

Goal: resolve every VERIFY above and capture real outputs. Append findings to the "Spike log" section at the end of this file.

1. Install Go 1.26+, .NET SDK 10. `go install github.com/szhekpisov/gomutants@v0.6.1`, `go install github.com/go-gremlins/gremlins/cmd/gremlins@v0.6.0`, `dotnet tool install dotnet-stryker --tool-path /tmp/mt-tools --version 5.0.0`. Note wall times.
2. Build the draft `go-module` fixture from section 5.3 in a tmp dir. From the module dir run:
   ```sh
   gomutants --list-mutators
   gomutants --output=/tmp/g/out.json --stryker-output=/tmp/g/mte.json --cache=/tmp/g/cache.json --workers=4 \
     --exclude-files='^pricing\.pb\.go$' --test-flags=-skip='^(TestOtherDiscount)$' .
   ```
   Record: exit code with survivors; whether `-skip` is accepted; whether `pricing.pb.go` mutants are absent; whether the weak test still scores low despite `other_test.go`; `files` keys and `projectRoot` in `mte.json`; distinct `mutatorName` values; that nothing new appeared in the module dir (`ls -la` before/after); behaviour when go.mod says `go 1.22`; warm rerun time with the cache file.
3. Same fixture with gremlins: `cd mod && gremlins unleash --output=/tmp/gr.json --output-statuses=lctkv -E '^pricing\.pb\.go$'`. Record: `file_name` base dir, status strings, whether killed mutants are present without `-S`, exit code.
4. Build the draft `dotnet-xunit` fixture from section 6.3. From `Acme.Tests/`: write `/tmp/s/stryker-config.json` as in section 6.1, `mkdir /tmp/s/out`, run `dotnet-stryker -f /tmp/s/stryker-config.json -O /tmp/s/out --skip-version-check`. Record: whether `-f` takes an absolute path; wrapper key; whether `mutate: ["Pricing.cs"]` (project-relative) selects the file, else try `"**/Pricing.cs"`; whether `--project Acme.csproj` is accepted with one ProjectReference; whether a prior `dotnet restore` is needed on a fresh copy; report path; `files` key form; distinct `mutatorName` values; that the weak variant still scores low despite `OtherTests.cs` (proves `test-case-filter`); cold and warm wall times; that nothing was written into the fixture except `bin/` and `obj/`.
5. Confirm `gremlins --version` and `dotnet-stryker --version` exit 0 (used as the PATH probe).

---

## 4. Phase 1: shared changes in `scripts/mutagate.mjs` and helpers

4.1 **Config** (`DEFAULTS`, L16): add `languages: [..., 'go', 'csharp']`, `goRunner: 'auto'`, `goTags: ''`. In `configFor` add `!['auto','gomutants','gremlins'].includes(cfg.goRunner)` to the "invalid configuration value" condition. Env/flag mapping (`MUTAGATE_GO_RUNNER`, `--go-tags`) comes for free from the existing loop.

4.2 **Test globs** (`TESTS`, L142): add `'**/*_test.go'` and change the JVM brace to `'**/*{Test,Tests,Spec,IT}.{java,kt,cs}'`.

4.3 **Language** (L163): `p.endsWith('.go') ? 'go' : p.endsWith('.cs') ? 'csharp' : 'typescript'` inserted before the typescript fallback. Add one table used everywhere a runner name is derived:
```js
const RUNNER = { java: 'pitest', kotlin: 'pitest', python: 'mutmut', typescript: 'stryker', go: 'gomutants', csharp: 'stryker-net' };
```
Replace the three ternaries (normalize L398, runTarget L718, detect L907) with `RUNNER[lang]`.

4.4 **moduleRoot** (L165): add `'go.mod'` to the file list and `|| fs.readdirSync(d).some(f => f.endsWith('.csproj'))`.

4.5 **resolveTargets** (L175):
- `const GENERATED = /(\.pb\.go|_gen\.go|\/zz_generated[^/]*\.go|\/mock_[^/]*\.go|_mock\.go|\.Designer\.cs|\.g\.cs|\.g\.i\.cs|\/Migrations\/[^/]*\.cs)$/;` and `all = files(...).filter(f => !isTest(f, c.config) && !GENERATED.test(f))`.
- Extend both extension regexes: stem strip `/\.(java|kt|py|tsx?|jsx?|go|cs)$/`, primary compare `/\.(py|tsx?|jsx?|go|cs)$/`.
- Nothing else: `_test` and `Tests?` stripping already exists; `alongside` narrows Go to the package dir; C# tests live in another project so basename match across the repo is the intended behaviour (ambiguity falls to the existing `--target` prompt).

4.6 **files()** ignore list (L150): add `'obj', 'StrykerOutput', 'TestResults'`.

4.7 **Parser** (L305): rename and relativize.
```js
export function parseMutationTestingElements(report, repo) {
  if (!report.files) throw Error('invalid mutation-testing-elements report');
  const real = p => { try { return fs.realpathSync(p); } catch { return p; } };
  const rel = f => slash(path.isAbsolute(f) ? path.relative(repo, real(f)) : report.projectRoot ? path.relative(repo, real(path.resolve(report.projectRoot, f))) : f);
  return Object.entries(report.files).flatMap(([file, f]) => f.mutants.map(m => ({
    file: rel(file), line: m.location.start.line, method: '', mutator: m.mutatorName,
    mutation_key: JSON.stringify([m.location, m.replacement]),
    description: `${m.mutatorName}: replaced with ${m.replacement ?? '(removed)'}`,
    status: ({ Killed: 'KILLED', Survived: 'SURVIVED', Timeout: 'TIMED_OUT', NoCoverage: 'NO_COVERAGE', CompileError: 'NON_VIABLE', RuntimeError: 'RUN_ERROR', Ignored: 'NON_VIABLE', Pending: 'PENDING' })[m.status] || 'PENDING'
  })));
}
```
Update the `stryker()` call site to pass `c.repo`. `c.repo` is already realpath'd, which matters on macOS where tmp dirs are symlinks.

4.8 **Tool pins and lookup**:
```js
export const TOOLS = { gomutants: 'github.com/szhekpisov/gomutants@v0.6.1', gremlins: 'github.com/go-gremlins/gremlins/cmd/gremlins@v0.6.0', 'dotnet-stryker': '5.0.0' };
async function tool(c, name, install) {
  const exe = path.join(c.root, 'tools', process.platform === 'win32' ? name + '.exe' : name);
  if (exists(exe)) return exe;
  try { await command(name, ['--version'], { timeout: 10000 }); return name; } catch {}
  if (process.env.MUTAGATE_OFFLINE === '1' || !install) throw Error(`${name} unavailable; install with: ${install?.hint || name}`);
  mkdir(path.dirname(exe));
  await command(install.exe, install.args, { cwd: os.tmpdir(), env: { ...process.env, ...install.env }, timeout: 300000 });
  if (!exists(exe)) throw Error(`${name} installation did not produce ${exe}`);
  return exe;
}
```
Install specs: gomutants `{ exe: 'go', args: ['install', TOOLS.gomutants], env: { GOBIN: <tools dir> }, hint: 'go install ' + TOOLS.gomutants }`; gremlins same shape; dotnet-stryker `{ exe: 'dotnet', args: ['tool', 'install', 'dotnet-stryker', '--tool-path', <tools dir>, '--version', TOOLS['dotnet-stryker']], env: { DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1' } }`. Add `'tools'` to the `owned` list in `inputs.cjs` so a cache root inside the repo is never fingerprinted.

4.9 **MUTATORS** (L328): extend the regexes so new tool names get a `short` label and playbook mapping. Order matters (first match wins), keep `Negate expression` in the conditional row.
```js
[/ConditionalsBoundary|CONDITIONALS_BOUNDARY|EqualityOperator|Equality mutation/, 'boundary', ...],
[/NegateConditionals|RemoveConditional|NEGATE_CONDITIONALS|ConditionalExpression|BooleanLiteral|CONDITIONALS_NEGATION|INVERT_LOGICAL|REMOVE_LOGICAL_NOT|BRANCH_|LOOP_CONDITION|RANGE_BREAK|Boolean mutation|Logical mutation|Negate expression|Conditional \(/, 'conditional', ...],
[/Return|RETURNS|RETURN_VALS|RETURN_/, 'return', ...],
[/Math|MATH|ArithmeticOperator|ARITHMETIC_BASE|INVERT_BITWISE|INVERT_ASSIGNMENTS|Arithmetic mutation|Bitwise mutation|AssignmentExpression to/, 'math', ...],
[/Increments|INCREMENTS|UpdateOperator|INCREMENT_DECREMENT|INTEGER_(?:IN|DE)CREMENT|FLOAT_(?:IN|DE)CREMENT|IncrementExpression|DecrementExpression/, 'increment', ...],
[/VoidMethodCall|VOID_METHOD_CALLS|BlockStatement|STATEMENT_REMOVE|EXPRESSION_REMOVE|ERRORF_WRAP|Statement mutation|Block removal/, 'void-call', ...],
[/InvertNeg|INVERT_NEGS|UnaryOperator|INVERT_NEGATIVES|UnaryMinusExpression|UnaryPlusExpression/, 'negation', ...]
```
Check the Phase 0 mutator lists against this table and add anything missed.

4.10 **inputs.cjs**:
- Replace `manifests.some(name => fs.existsSync(path.join(dir, name)))` (two sites) with `hasManifest(dir)` = existing names OR any `*.csproj`/`*.fsproj` in the dir; add `'go.mod'` to `manifests`.
- `ignored` set: add `'bin', 'obj', 'StrykerOutput', 'TestResults'`.
- Parent-walk file list: add `'go.mod', 'go.sum', 'go.work', 'go.work.sum', 'global.json', 'Directory.Build.props', 'Directory.Build.targets', 'Directory.Packages.props', 'nuget.config', 'NuGet.Config'` and any `*.sln` in the parent.
- Follow `<ProjectReference Include="...">` from every `*.csproj` in a selected dir (resolve relative to that csproj, add the referenced project's dir if inside the repo), mirroring the Gradle `project(':x')` block.

4.11 **Schema** (`references/result-schema.json`): `language` enum add `go`, `csharp`; `runner` enum add `gomutants`, `gremlins`, `stryker-net`.

4.12 **Line cap**: `test/protocol.test.mjs` L25 `<1200` to `<1400`; README "under 1,200 lines" to "under 1,400 lines".

4.13 Regenerate: `npm run generate:runtime`. Run `npm test`; fix the parser rename fallout (there are no direct `parseStryker` test references).

Check for Phase 1: `npm test` green; `MUTAGATE_FIXTURES=ts-jest,ts-vitest npm run test:integration` still green (parser change).

---

## 5. Phase 2: Go runner

### 5.1 Runner (insert after `python`, before `readIf`)

```js
async function goRunner(c, t, dir, opts) {
  const mod = path.resolve(c.repo, t.module);
  if (!exists(path.join(mod, 'go.mod'))) throw Error(`go.mod not found above ${t.file}`);
  const pkgDir = path.dirname(path.resolve(c.repo, t.file)),
    modRel = p => slash(path.relative(mod, p)),
    escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    entries = fs.readdirSync(pkgDir);
  const siblings = entries.filter(f => f.endsWith('.go') && !f.endsWith('_test.go') && f !== path.basename(t.file)).map(f => '^' + escape(modRel(path.join(pkgDir, f))) + '$');
  const others = entries.filter(f => f.endsWith('_test.go') && !t.tests.includes(slash(path.relative(c.repo, path.join(pkgDir, f)))))
    .flatMap(f => [...read(path.join(pkgDir, f)).matchAll(/^func (Test\w*)\(/gm)].map(m => m[1]));
  const tools = path.join(c.root, 'tools');
  let runner = c.config.goRunner, exe;
  if (runner !== 'gremlins') { try { exe = await tool(c, 'gomutants', { exe: 'go', args: ['install', TOOLS.gomutants], env: { GOBIN: tools }, hint: 'go install ' + TOOLS.gomutants }); runner = 'gomutants'; } catch (e) { if (runner === 'gomutants') throw e; } }
  if (!exe) { exe = await tool(c, 'gremlins', { exe: 'go', args: ['install', TOOLS.gremlins], env: { GOBIN: tools }, hint: 'go install ' + TOOLS.gremlins }); runner = 'gremlins'; }
  const workers = String(Math.min(4, os.availableParallelism())), tags = c.config.goTags ? [`--tags=${c.config.goTags}`] : [];
  mkdir(path.join(c.data, 'history'));
  if (runner === 'gomutants') {
    const rel = modRel(pkgDir);
    await command(exe, [`--output=${path.join(dir, 'gomutants.json')}`, `--stryker-output=${path.join(dir, 'mutation.json')}`,
      `--cache=${path.join(c.data, 'history', targetKey(t) + '.gomutants.json')}`, `--workers=${workers}`, ...tags,
      ...(siblings.length ? [`--exclude-files=${siblings.join(',')}`] : []),
      ...(others.length ? [`--test-flags=-skip=^(${others.join('|')})$`] : []),   // ponytail: drop if Phase 0 shows -skip is rejected
      rel ? './' + rel : '.'], { ...opts, cwd: mod });
    return { runner, raw: parseMutationTestingElements({ ...json(path.join(dir, 'mutation.json')), projectRoot: pkgDir }, c.repo).filter(m => m.file === t.file) };
  }
  await command(exe, ['unleash', `--output=${path.join(dir, 'gremlins.json')}`, '--output-statuses=lctkv', `--workers=${workers}`, ...tags, ...siblings.map(s => `--exclude-files=${s}`)], { ...opts, cwd: pkgDir });
  return { runner, raw: parseGremlins(json(path.join(dir, 'gremlins.json')), slash(path.relative(c.repo, pkgDir))).filter(m => m.file === t.file) };
}
export function parseGremlins(report, base) {
  const S = { KILLED: 'KILLED', LIVED: 'SURVIVED', 'TIMED OUT': 'TIMED_OUT', 'NOT COVERED': 'NO_COVERAGE', 'NOT VIABLE': 'NON_VIABLE', SKIPPED: 'NON_VIABLE', RUNNABLE: 'PENDING' };
  return (report.files || []).flatMap(f => f.mutations.map(m => ({
    file: slash(path.join(base, f.file_name)), line: m.line, method: '', mutator: m.type, mutation_key: JSON.stringify([m.line, m.column, m.type]),
    description: `${m.type} at column ${m.column}`, status: S[m.status] || 'PENDING'
  })));
}
```
Notes: gremlins `--exclude-files` regex is matched against the same base as `file_name` (VERIFY in Phase 0; adjust `siblings` for the gremlins branch if it is module-relative). `--output`, `--cache` and `--stryker-output` are absolute so nothing lands in the user's module. Do not set `GOFLAGS`. Hook `runTarget` dispatch: `t.language === 'go' ? goRunner : ...` and pass `runner: produced.runner` into the `normalize` meta so gremlins shows up in results.

### 5.2 Config surface
`goRunner` and `goTags` only. Build tags in `//go:build` lines are the user's concern via `goTags` (comma list, forwarded as `--tags`).

### 5.3 Fixture `test/fixtures/go-module/`
```
expected.json                 {"test":"mod/pricing/pricing_test.go","weak":[0,0.5],"strong":[0.8,1],"must_report":[],"manifest":"mod/go.mod","file":"mod/pricing/pricing.go"}
mod/go.mod                    module acme/pricing            (blank line)   go 1.26
mod/pricing/pricing.go                package pricing
                              func Discount(count int) int { if count >= 10 { return 20 }; return 0 }   (write it on multiple lines)
mod/pricing/pricing.pb.go             // Code generated by protoc-gen-go. DO NOT EDIT.
                              package pricing
                              func Generated(n int) int { return n + 1 }
mod/pricing/other_test.go             package pricing; TestOtherDiscount asserts 9→0, 10→20, 11→20   (proves -skip scoping; delete if Phase 0 rejects -skip)
mod/pricing/pricing_test.go           copy of the strong variant
variants/pricing_test.weak.go   package pricing; import "testing"; func TestDiscount(t *testing.T) { Discount(20) }
variants/pricing_test.strong.go package pricing; import "testing"; func TestDiscount(t *testing.T) { table over (9,0),(10,20),(11,20) with t.Fatalf on mismatch }
```
`go.mod` lives in `mod/` on purpose: `variants/` stays outside the module so Go tooling never compiles it, and the runner's module-relative to repo-relative path mapping gets exercised. Port the logic 1:1 from `test/fixtures/ts-jest/pricing.ts`.

### 5.4 Integration test knobs (`test/integration/runners.test.mjs`)
- `const buildFile = expected.manifest || (existing chain)`.
- After parsing each result: `if (expected.file) assert.ok(r.raw.every(m => m.file === expected.file), JSON.stringify(r.raw.map(m => m.file)));`.
- Add `go-module` and `dotnet-xunit` to the default `selected` list.

### 5.5 Unit tests (`test/core.test.mjs`, one line each)
- `resolveTargets` on `mod/foo_test.go` with `mod/foo.go` + `mod/foo.pb.go` picks `mod/foo.go`; with only `mod/foo.pb.go` returns `ambiguous` with zero candidates.
- `parseMutationTestingElements` relativizes absolute keys and `projectRoot`-relative keys to the repo.
- `parseGremlins` maps `"NOT COVERED"`/`"LIVED"`/`"TIMED OUT"` and prefixes `base`.
- `isTest('a/b_test.go')` and `isTest('X.Tests/FooTests.cs')` true; `language` returns `go`/`csharp`; `RUNNER`/schema enums agree (extend the schema test if one exists, else assert `JSON.parse(schema).properties.runner.enum` includes the three names).

Check for Phase 2: `MUTAGATE_FIXTURES=go-module npm run test:integration` green on both entries; `MUTAGATE_GO_RUNNER=gremlins MUTAGATE_FIXTURES=go-module npm run test:integration` green after deleting `other_test.go` in a scratch copy (gremlins cannot scope tests; document, do not commit a gremlins-specific fixture).

---

## 6. Phase 3: C# runner

### 6.1 Runner

```js
async function dotnetRunner(c, t, dir, opts) {
  const csproj = d => fs.readdirSync(d).find(f => f.endsWith('.csproj'));
  const projectDir = file => { let d = path.dirname(path.resolve(c.repo, file)); while (!csproj(d)) { if (d === c.repo) throw Error(`no .csproj above ${file}`); d = path.dirname(d); } return d; };
  const testDir = projectDir(t.tests[0]), targetDir = projectDir(t.file), src = read(path.resolve(c.repo, t.tests[0]));
  const filter = [src.match(/^\s*namespace\s+([\w.]+)/m)?.[1], src.match(/\bclass\s+(\w+)/)?.[1]].filter(Boolean).join('.');
  const tools = path.join(c.root, 'tools'), env = { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1' };
  const exe = await tool(c, 'dotnet-stryker', { exe: 'dotnet', args: ['tool', 'install', 'dotnet-stryker', '--tool-path', tools, '--version', TOOLS['dotnet-stryker']], env, hint: `dotnet tool install dotnet-stryker --tool-path ${tools} --version ${TOOLS['dotnet-stryker']}` });
  const out = path.join(dir, 'out'), cfg = path.join(dir, 'stryker-config.json');
  mkdir(path.join(out, 'reports'));
  atomic(cfg, { 'stryker-config': {
    project: csproj(targetDir), mutate: [slash(path.relative(targetDir, path.resolve(c.repo, t.file)))],   // VERIFY base; fallback '**/' + basename
    reporters: ['json'], 'mutation-level': 'Standard', 'ignore-mutations': ['String'],   // ponytail: string literals mostly survive in log messages; make configurable if asked
    'coverage-analysis': 'perTest', concurrency: Math.min(4, os.availableParallelism()), thresholds: { high: 100, low: 0, break: 0 },
    ...(filter ? { 'test-case-filter': `FullyQualifiedName~${filter}` } : {})
  } });
  if (!exists(path.join(testDir, 'obj', 'project.assets.json'))) await command('dotnet', ['restore', '--nologo'], { ...opts, cwd: testDir, env });   // VERIFY necessity
  await command(exe, ['--config-file', cfg, '--output', out, '--skip-version-check'], { ...opts, cwd: testDir, env });
  return { raw: parseMutationTestingElements(json(path.join(out, 'reports', 'mutation-report.json')), c.repo).filter(m => m.file === t.file) };
}
```
Notes: cwd is the test project dir, so no `--test-project`; `--project` is the csproj **file name**; if Phase 0 shows `-f` rejects absolute paths use `path.relative(testDir, cfg)`. A user `stryker-config.json` in the test project is ignored because `-f` overrides discovery (same policy as the Stryker JS runner). Stryker.NET writes `bin/`, `obj/` in the user's repo like any build; the fingerprint ignores them (4.10). Hook dispatch: `t.language === 'csharp' ? dotnetRunner : ...`.

### 6.2 Budget note
Cold: MSBuild evaluation + compile + initial test run, typically 2 to 5 minutes. The async `run` uses `runBudgetSec` (300 default). Document `runBudgetSec: 600` for .NET repos; doctor prints the same hint when `detect().runner === 'stryker-net'` and the config still has the default.

### 6.3 Fixture `test/fixtures/dotnet-xunit/`
```
expected.json                     {"test":"Acme.Tests/PricingTests.cs","weak":[0,0.5],"strong":[0.8,1],"must_report":[],"manifest":"Acme.Tests/Acme.Tests.csproj","file":"Acme/Pricing.cs"}
Acme.sln                          references both projects (dotnet new sln; dotnet sln add)
Acme/Acme.csproj                  Sdk="Microsoft.NET.Sdk", TargetFramework net10.0, Nullable enable, ImplicitUsings enable
Acme/Pricing.cs                   namespace Acme; public static class Pricing { public static int Discount(int count) { if (count >= 10) return 20; return 0; } }
Acme.Tests/Acme.Tests.csproj      net10.0, IsPackable false, PackageReference Microsoft.NET.Test.Sdk 17.x, xunit 2.9.x, xunit.runner.visualstudio 3.x (pin exact versions found in Phase 0), ProjectReference ../Acme/Acme.csproj
Acme.Tests/PricingTests.cs        copy of the strong variant
Acme.Tests/OtherTests.cs          namespace Acme.Tests; public class OtherTests { [Fact] strong asserts on Discount }   (proves test-case-filter scoping)
variants/PricingTests.weak.cs     namespace Acme.Tests; public class PricingTests { [Fact] public void Discount() { Pricing.Discount(20); } }
variants/PricingTests.strong.cs   asserts 9→0, 10→20, 11→20 with Assert.Equal
```
`variants/` sits outside both project dirs so MSBuild globbing never compiles it. Add `bin/` and `obj/` to the repo `.gitignore`. Do not commit `bin/`, `obj/`, `StrykerOutput/`.

### 6.4 Unit tests
- `resolveTargets` on `Acme.Tests/PricingTests.cs` with `Acme/Pricing.cs` + `Acme/Pricing.Designer.cs` picks `Acme/Pricing.cs`; `module` equals `Acme.Tests`.
- `inputFiles` for that fixture layout includes both project dirs and follows the `ProjectReference` when the target lives in a third project; `obj/` contents are excluded.

Check for Phase 3: `MUTAGATE_FIXTURES=dotnet-xunit npm run test:integration` green on both entries; weak variant stays ≤0.5 with `OtherTests.cs` present.

---

## 7. Phase 4: detect, doctor, CI, docs, pins

7.1 **detect()** (L899): language chain becomes `kotlin, java, python, go (.go), csharp (.cs), typescript`. `buildTool`: add `go.mod` → `'go'` and `.csproj`/`.sln` → `'dotnet'` before the npm check. `runner: RUNNER[languageFound] || null`.

7.2 **doctor()** (L964):
- Toolchain checks: for `gomutants` run `go version` and `tool(c, 'gomutants', ...)` → check "Go toolchain and gomutants" (hint includes both `go install` commands). For `stryker-net` run `dotnet --list-runtimes` and require a line starting `Microsoft.NETCore.App 10.`, then `tool(c, 'dotnet-stryker', ...)` → check ".NET 10 runtime and dotnet-stryker".
- Smoke: `gomutants` → `go.mod` (`module probe`, `go 1.26`), `probe.go` (`func Eligible(n int) bool { return n >= 18 }`), `probe_test.go` (asserts 17 false, 18 true); smoke test file `probe_test.go`. `stryker-net` → `Probe/Probe.csproj`, `Probe/Probe.cs`, `Probe.Tests/Probe.Tests.csproj` (same xunit pins as the fixture), `Probe.Tests/ProbeTests.cs`; smoke test file `Probe.Tests/ProbeTests.cs`. The .NET smoke needs NuGet; when `MUTAGATE_OFFLINE=1` push a failing check with hint "offline: .NET smoke skipped" rather than attempting it.
- Add the budget hint from 6.2.

7.3 **CI** (`.github/workflows/ci.yml`, job `tier2`): add
```yaml
- uses: actions/setup-go@v5
  with: { go-version: '1.26.x' }
- run: go install github.com/szhekpisov/gomutants@v0.6.1
- uses: actions/setup-dotnet@v4
  with: { dotnet-version: '10.0.x' }
- run: |
    dotnet tool install dotnet-stryker --tool-path "$RUNNER_TEMP/dotnet-tools" --version 5.0.0
    echo "$RUNNER_TEMP/dotnet-tools" >> "$GITHUB_PATH"
```
and extend `MUTAGATE_FIXTURES` with `go-module,dotnet-xunit`. The runner finds both on PATH, so CI never exercises the network install path; the doctor smoke does that locally.

7.4 **Pins**: add to both `test/harness-versions.json` and `references/versions.json` (must stay deep-equal): `"go": "1.26"`, `"gomutants": "0.6.1"`, `"gremlins": "0.6.0"`, `"dotnet-sdk": "10.0"`, `"dotnet-stryker": "5.0.0"`, `"xunit": "<pinned>"`. Extend the protocol test "shipped version metadata matches CI pins" with `assert.equal(m.TOOLS.gomutants.split('@v')[1], versions.gomutants)` and the same for gremlins and dotnet-stryker.

7.5 **README**:
- Supported languages line: add **Go** (gomutants, gremlins fallback) and **C#** (Stryker.NET).
- Requirements: "Go 1.26+ (gomutants is fetched with `go install` into mutagate's cache), or .NET SDK 10 (dotnet-stryker is installed into mutagate's cache with `--tool-path`; nothing is written to your project)".
- Runners section, two bullets: Go: scope = target file (`--exclude-files`) and the scoped test file's functions (`-skip`), incremental cache under the data dir, `goRunner`/`goTags` keys, gremlins fallback has file scoping only, generated files (`*.pb.go` etc.) are never targets, projects below Go 1.26 need gremlins (if Phase 0 confirms). C#: test project = nearest `.csproj` above the test file, `test-case-filter` routes to the test class, `String` mutator off and `Standard` level, `*.Designer.cs`/`*.g.cs`/`Migrations` never targets, cold runs 2 to 5 minutes so set `runBudgetSec: 600`, VB.NET and F# unsupported, .NET Framework unsupported in v1, Windows unqualified for both.
- Prior art sentence: gomutants ships a Claude Code plugin that proposes test cases for survivors in Go; mutagate is the cross-language, cross-harness gate on top of the same engine.
- Validation status: fixture count 9 → 11; list the new pins.

7.6 **prd.md**: 7.2 rows `Go | gomutants (gremlins fallback) | go modules | 2`, `C# | Stryker.NET | dotnet SDK-style projects, xunit/nunit/mstest via VSTest | 2`, `F# | not supported (Stryker.NET mutators are C#-only) | - | -`. 9.3 new FR-3.17..3.24 tables mirroring sections 5 and 6 (install location, scoping, exclusions, parser sharing, budget). 11.2 rows for `go-module` and `dotnet-xunit`. 11.11 row "runner integration Go + .NET (L4) | PR | ubuntu | Go 1.26, .NET SDK 10, gomutants, dotnet-stryker".

7.7 **references/survivor-playbook.md**: add "**Go:** assert returned `error` values; `RETURN_ERROR_NIL` and `ERRORF_WRAP` survive when tests ignore `err`." and "**C#:** `Conditional (true|false)` survivors mean a branch was never observed; assert both outcomes of each ternary or `if`."

7.8 Regenerate `mutagate-hook.cjs`, run `npm test`, `npm run test:performance` (runner code is only reached from `runTarget`, hook latency must stay under 80 ms p95), `node test/package.mjs /tmp/skill` (< 250 KB).

---

## 8. Acceptance checklist

- [x] Phase 0 spike log filled in below; every VERIFY resolved or its fallback applied.
- [x] `npm test` green, including the new unit tests and the regenerated runtime equality check.
- [x] `MUTAGATE_FIXTURES=go-module,dotnet-xunit npm run test:integration` green with default entry and with `MUTAGATE_TEST_ENTRY=mutagate-hook.cjs`.
- [x] Existing fixtures still green: `MUTAGATE_FIXTURES=ts-jest,ts-vitest,python-uv npm run test:integration` (parser and inputs changes).
- [x] Weak variants stay ≤0.5 with the sibling strong tests present (`other_test.go`, `OtherTests.cs`), proving test routing.
- [x] After each integration run the fixture copy contains nothing new except `bin/`, `obj/` (dotnet); `git status`-style directory diff for the Go module is empty.
- [x] `scripts/mutagate doctor --repo test/fixtures/go-module` and `... --repo test/fixtures/dotnet-xunit` pass after `install --agent claude` in a scratch copy.
- [x] `npm run test:performance` still passes; skill package < 250 KB; `mutagate.mjs` < 1400 lines.
- [x] README, prd.md, result-schema.json, versions JSON, playbook updated; CI `tier2` extended.

## 9. Not doing in v1 (say so in README where user-visible)

- go-mutesting v2 (bespoke "agentic" JSON, separate parser); add on request.
- Auto-selecting between multiple C# candidate targets by ProjectReference; the existing `--target` prompt handles it.
- Merging user `stryker-config.json`/`.gomutants.yml`; mutagate always writes its own config into scratch.
- Configurable `ignore-mutations` for C#; hardcoded `String`.
- `--with-baseline`, `--since`, `--changed-since` (single-file scoping supersedes them).
- Windows qualification for Go and C#; .NET Framework (`--solution`) projects; F#/VB.NET.

---

## Spike log (2026-09-13, macOS ARM64)

Verified with temporary Go 1.26.8 and .NET SDK 10.0.401 installations. Tool installs took 4.76 s (gomutants), 6.76 s (gremlins), and 3.42 s (Stryker.NET). These observed results supersede the VERIFY assumptions and sample code above. No global toolchain installation was needed. NuGet dependencies pinned to Microsoft.NET.Test.Sdk 17.14.1, xunit 2.9.3, xunit.runner.visualstudio 3.1.5.

| Item | Result | Consequence |
|---|---|---|
| gomutants accepts `--test-flags=-skip=...` | Yes; weak test scores 0 with strong TestOtherDiscount present. | Keep skip routing; flags before package pattern. |
| gomutants on `go 1.22` go.mod | Works under Go 1.26.8; exit 0, weak score 0. | Require Go 1.26+ toolchain, not a go.mod directive bump. |
| gomutants writes nothing to cwd with `--output/--cache/--stryker-output` set | Yes; source listing unchanged. Cold weak 4.57 s, cached weak 0.77 s, changed strong 4.10 s. | Use absolute report/cache paths and explicit scratch --config={} to bypass project discovery. |
| gomutants distinct `mutatorName` on fixture; strong/weak scores | BRANCH_IF, CONDITIONALS_BOUNDARY, CONDITIONALS_NEGATION, INTEGER_DECREMENT, INTEGER_INCREMENT, RETURN_ZERO. Strong 1, weak 0. All 28 names listed successfully. projectRoot absolute, files key pricing.go. | Runner overrides projectRoot with the selected package directory before shared parsing; the original root-level spike did not expose this distinction. Extend labels for all Go families. |
| gremlins `file_name` base; `-S` default; `--exclude-files` base | Both paths relative to invocation/package directory, verified in a nested package. Default JSON includes killed mutants; explicit lctkv accepted. Spaced statuses verified. Exit 0 with LIVED. Root weak score 0. | Pass lctkv and package-relative exclusions; exclude descendant directories too. Subdirectory names differing from package names falsely report build failures as kills; reject that layout with gomutants hint. Matching nested package weak score 0. |
| Stryker.NET `-f` absolute path; wrapper key | Absolute path accepted; stryker-config wrapper accepted. | Use explicit scratch config and pre-created output directory; report at out/reports/mutation-report.json. |
| Stryker.NET `mutate` base (project-relative vs `**/`) | Pricing.cs selects the source project file; report keys absolute and projectRoot is source project directory. | Use project-relative target and shared realpath-aware parser. |
| Stryker.NET needs `dotnet restore` first | No. On fresh projects it retries MSBuild evaluation with NuGet restore, then builds successfully. | Omit redundant explicit restore. |
| Stryker.NET `--project Acme.csproj` with one reference | Accepted through project config property with one ProjectReference. | Keep source project filename and test-project cwd. |
| Stryker.NET weak score with `OtherTests.cs` present (filter works) | Score 0; log finds one test. Strong variant scores 1 with OtherTests still present. | Keep FullyQualifiedName namespace/class filter. |
| Stryker.NET distinct `mutatorName`; cold/warm wall time | Block removal mutation (including Ignored), Equality mutation, Negate expression. Cold 9.43 s, warm/strong 6.60 s on tiny fixture. | Keep conditional/boundary/block mappings. Document larger cold builds may take minutes. |
| `gremlins --version`, `dotnet-stryker --version` exit 0 | gremlins exits 0 (go install build prints dev). Stryker.NET --version exits 1: missing value. --help exits 0. | Probe Stryker.NET with --help. Preserve exact installation pins; do not infer version from gremlins banner. |

Implementation clarification: auto Go fallback uses only existing cached/PATH gremlins; explicit gremlins selection may install it. Lookup and install share the run deadline. Both Go tools accept an explicit empty scratch YAML config. Stryker.NET builds may leave bin/obj; configuration, reports, and mutation history remain outside the project.

Validation completed on 2026-09-13 with Node 24.19.0 and canonical macOS temporary paths:

- 76 deterministic tests pass, including generated-runtime equality, offline lookup, automatic/forced tool selection, installation deadlines, path normalization, and fingerprint stability.
- ESM and CommonJS Go/C# fixture runs both score weak=0 and strong=1; fixture snapshots assert unchanged files except .NET bin/obj.
- Forced gremlins scratch runs without other_test.go score 0/1 on both entries.
- Existing ts-jest, ts-vitest, and python-uv integrations pass after refreshing local fixture dependencies; manifests remain unchanged.
- Both doctor smokes pass after scratch adapter installation, including actual mutation-tool installation into an empty cache. Offline .NET doctor skips its NuGet-dependent smoke with the documented failing check.
- Hook latency: 31.64 ms p95 over 100 samples (80 ms budget). Core: 1,296 lines. Packaged skill: approximately 201 KB (250 KB limit). Graft refreshed and wiring graph freshness passes.
- CI configuration is updated; remote CI and Windows qualification were not run in this session.

## Code review corrections

- The fixture package now lives under `mod/pricing/`, with `go.mod` one level above. gomutants 0.6.1 reports `pricing.go` relative to the selected package while reporting the module directory as `projectRoot`. Override that root at the Go call site; keep module-relative exclusion arguments unchanged.
- Tools use `tools/<name>@<version>/<executable>` for both lookup and install, with a per-version lock and cache recheck after acquisition. Lock waiting consumes the run deadline. The original section 4.8 flat-cache sample is superseded by `toolDirectory`, `toolInstall`, and `tool` in the implementation; old flat cache entries are not reused automatically.
- `bin` and `obj` are only build-output exclusions when their parent directory contains a `.csproj`, in discovery and fingerprints. TypeScript CLI sources under `bin/` remain eligible.
- Test fixtures canonicalize newly created temporary roots with `realpathSync`. No TMPDIR override is required on macOS.
- MTE `Ignored` mutants carry `ignored: true` and are skipped by scoring without increasing `error_mutants`; the existing raw status vocabulary stays compatible.
- Go `-skip` only covers sibling `Test\w*` functions, not Example/Fuzz functions. C# `FullyQualifiedName~` is a substring filter and may include classes such as PricingTestsExtra. These limits are documented rather than claiming exact file/class isolation.

Review-fix verification (Node 22.17.1, macOS ARM64, stock TMPDIR): 82/82 deterministic tests pass, including separate-process installation locking and deadline expiry while waiting. Nested Go and C# weak/strong scores are 0/1 on ESM and CommonJS. Existing Jest, Vitest and Python/uv integrations and both doctor smokes pass. Tool installs populated versioned directories despite the old flat cache being present. Hook p95 is 26.89 ms over 100 samples; core 1,307 lines; package approximately 204 KB. Graft was rebuilt and passes freshness. Remote CI and Windows remain unverified.

Residual-nit follow-up: README documents the explicit exclude needed for centralized UseArtifactsOutput directories and clarifies that every Stryker Ignored mutant, including Block removal, stays in raw output without affecting score/error counts. Doctor strips failure hints from passing checks and exposes the .NET budget recommendation as a note in JSON and text. All 82 tests pass; real Go/ESM and C#/CommonJS doctor smokes pass; offline .NET retains its failure hint. Package: 204,447 bytes. Graft freshness passes.
