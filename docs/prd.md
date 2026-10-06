# mutagate: Product Requirements Document

**Product:** mutagate, a cross-harness mutation-score gate for AI coding agents
**Version:** 1.0 (implementation handoff)
**Date:** 2026-09-12
**Status:** Ready for engineering
**Target harnesses:** Claude Code, OpenAI Codex CLI, OpenCode, Pi
**Target languages (v1):** Java, Kotlin, Python, TypeScript/JavaScript, Go, C#

This document is self-contained. Everything an engineer needs to build, test and ship v1 is here or linked in section 16. Items marked **VERIFY** are facts about third-party tools that were true when this was written and must be re-checked against the pinned versions in `test/harness-versions.json` before implementation, because every harness in scope ships breaking changes monthly.

---

## 1. Summary

AI coding agents are very good at writing tests that pass and assert nothing. Line coverage cannot detect this. Mutation testing can, but it is too slow and too noisy to sit inside an agent's inner loop as it is normally run.

mutagate makes mutation testing usable inside the agent loop with three techniques: scope every run to the one test file the agent just wrote and the one production class it targets, run it in the background, and refuse to let the agent declare a task done while mutants survive. It ships as a single Agent Skills folder that installs into any compliant harness, with one zero-dependency CLI that does all the work and a thin adapter per harness that only translates lifecycle events.

The Kotlin support is a first-class deliverable, not an afterthought. Bytecode-level mutation of Kotlin produces "junk" mutants that no test can kill. mutagate ships a maintained filter so Kotlin teams get a usable score without a commercial plugin.

---

## 2. Problem and motivation

### 2.1 The failure mode

When an agent is asked to "add tests for `UserService`", it typically produces a test file that compiles, runs green, and exercises code paths without asserting on results, or asserts only the happy path. Coverage reports 90 percent. The suite catches nothing. Reviewers rarely notice because the tests look plausible.

### 2.2 Why existing tools do not fix it

- Coverage tools measure execution, not detection.
- Mutation testing tools (pitest, mutmut, Stryker) measure detection but are built for CI: whole-repo runs that take minutes to hours, output HTML reports, and assume a human reads them.
- No mutation tool integrates with agent lifecycle hooks. None can say "no" to an agent.
- Kotlin on pitest without the commercial Arcmutate plugin produces so many junk mutants that teams abandon it.

### 2.3 What makes it possible now

All four target harnesses expose lifecycle hooks or plugin events that can (a) observe file writes, (b) inject text into the model's context, and (c) refuse or re-prompt when the agent tries to stop. Claude Code and Codex share a nearly identical JSON hook schema. OpenCode and Pi expose TypeScript plugin APIs that can shell out. The Agent Skills standard (agentskills.io) gives a single distribution format that all four discover.

---

## 3. Goals and non-goals

### 3.1 Goals

- G1. When an agent writes or edits a test file, a scoped mutation run happens automatically and its survivors are shown to the agent as concrete, actionable lines.
- G2. The agent cannot finish a task, subagent, or turn while any target it touched is below the configured mutation score threshold, on harnesses that support hard gating. On other harnesses it is re-prompted until the score passes or a round cap is reached.
- G3. One codebase serves all four harnesses. Adapters contain no business logic.
- G4. Zero runtime dependencies beyond Node 22+ and the language toolchain the project already has (JDK, Python, Node).
- G5. No modification of the user's build files. mutagate runs mutation tools out-of-band.
- G6. Kotlin scores are usable on plain open-source pitest through a maintained junk filter.
- G7. Waivers for equivalent mutants exist and require a human.
- G8. Installable as a skill via `npx skills add`, with enforcement bootstrapped by a single command.

### 3.2 Non-goals (v1)

- Whole-repo mutation runs or CI reporting dashboards.
- Replacing the harness's own test runner or TDD workflow.
- Languages beyond Java, Kotlin, Python, TS/JS, Go, C#. Rust (cargo-mutants) remains a stretch item.
- Android (AGP) projects. Tracked as a follow-up because classpath resolution differs.
- Mutating test code itself.
- Any hosted service or telemetry.

---

## 4. Users and scenarios

**Primary user:** a developer using one of the four harnesses on a JVM, Python or TS codebase who wants agent-written tests to be real tests.

**Secondary user:** a team lead who commits `.mutagate/config.json` to a repo so every contributor's agent is gated the same way.

### 4.1 Core scenario

1. Developer asks the agent to add tests for `UserService.kt`.
2. Agent writes `UserServiceTest.kt`.
3. mutagate resolves the target (`com.acme.UserService`), runs pitest scoped to that class and that test in the background.
4. Ninety seconds later the agent is shown: "UserService.kt:42 isEligible: `>=` became `>` and no test noticed (boundary)". Plus up to nine more.
5. Agent adds boundary cases and return-value assertions. mutagate re-runs.
6. Agent says "done". The Stop gate checks the score: 0.86, above the 0.80 threshold. Allowed.

### 4.2 Waiver scenario

The agent believes a surviving mutant is equivalent (the mutation cannot change observable behavior). It proposes a waiver with a reason. The human edits `.mutagate/waivers.json` or approves the agent's edit through the harness permission prompt. The gate now ignores that mutant.

### 4.3 Bare scenario (no adapter installed)

Skill installed, `mutagate install` never run. The skill text still tells the agent to run `mutagate run <test>` after writing tests and `mutagate check` before finishing. Advisory only. This is the graceful-degradation floor.

---

## 5. Background concepts

**Mutation testing.** A tool makes small deliberate changes ("mutants") to production code, such as flipping `>=` to `>`, deleting a method call, or replacing a return value, then runs the tests. If a test fails, the mutant is "killed". If tests still pass, it "survived". Mutation score = killed / (killed + survived). A survivor is a concrete gap in the tests.

**Equivalent mutant.** A mutation that cannot change behavior (for example mutating dead code). It can never be killed. These need waivers.

**Junk mutant (Kotlin).** pitest mutates JVM bytecode. The Kotlin compiler emits bytecode that has no source equivalent: null-check intrinsics, data class synthetics, default-argument bitmask methods, `when` mapping tables, coroutine state machines, inlined function copies. Mutants in that bytecode are unkillable and meaningless. Without filtering, Kotlin scores are dominated by them.

**Scoped run.** Instead of mutating the whole codebase and running the whole suite, mutate only the class(es) under test and run only the test file just written. This turns a 40-minute run into seconds to a couple of minutes.

---

## 6. Product principles

1. **One code path.** All logic lives in `mutagate.mjs`. Adapters translate events and nothing else. Every harness-specific quirk is handled inside the CLI behind a `harness` field in the payload.
2. **Hook enforces, script executes, skill teaches.** Each layer works when the layer above is missing.
3. **Token frugality.** Anything shown to the model is short, ranked, and factual. Never dump tool output into the model.
4. **No build-file edits.** The user's Gradle, Maven, pyproject, or package.json is never modified.
5. **Humans own waivers.** The agent can propose, never approve.
6. **Fail open on infrastructure, fail closed on quality.** If pitest cannot run (no JDK, download failed), report it and do not block. If pitest ran and the score is low, block.
7. **Factual hook text.** Text injected into the model reads as project state ("UserService.kt:42 has a surviving mutant"), never as imperative system commands, which trigger prompt-injection defenses in at least one harness.

---

## 7. Support matrix

### 7.1 Harnesses

| Harness | Hook mechanism | Hard gate on "done" | Async post-write run | Waiver approval prompt | Tested version (pin in `harness-versions.json`) |
|---|---|---|---|---|---|
| Claude Code | `hooks.json` (plugin or settings), skill frontmatter hooks | Yes: `Stop`, `SubagentStop`, `TaskCompleted` | Yes: `asyncRewake` | Yes: `permissionDecision: ask` | VERIFY |
| Codex CLI | `.codex/hooks.json` or `[hooks]` in `config.toml`, plugin-bundled | Yes: `Stop`, `SubagentStop` (continuation prompt) | Partial: `async: true`, output delivered at next safe point | No: `ask` parsed but unsupported, use `deny` with message | VERIFY |
| OpenCode | JS plugin in `.opencode/plugin/` or `opencode.json` `plugin` list | Soft: `session.idle` then re-prompt, round cap | Yes: adapter spawns detached, appends to tool output | Block via throw in `tool.execute.before` | VERIFY |
| Pi | TS extension in `.pi/extensions/` or package | Soft: `agent_end` then `sendUserMessage`, round cap | Yes: adapter spawns, `sendMessage` steer | Block via `{ block: true }` in `tool_call` | VERIFY |

### 7.2 Languages and tools

| Language | Tool | Build tools | Tier |
|---|---|---|---|
| Java | pitest (command-line jar) | Gradle, Maven | 1 |
| Kotlin/JVM | pitest + mutagate junk filter (Tier B) or Arcmutate plugin if licence present (Tier A) | Gradle, Maven | 1 |
| Python | mutmut | pyproject / setup.cfg, uv, pip | 2 |
| TS/JS | Stryker | npm/pnpm/yarn, Jest, Vitest | 2 |
| Go | gomutants (gremlins fallback) | go modules | 2 |
| C# | Stryker.NET | dotnet SDK-style projects, xunit/nunit/mstest via VSTest | 2 |
| F# | not supported (C#-only mutators) | - | - |
| Rust | cargo-mutants | cargo | stretch |

Tier 1 blocks the release. Tier 2 must work on the fixture repos but may have known gaps documented in README.

---

## 8. Architecture

### 8.1 Repository layout (the skill folder is the whole product)

```
mutagate/
  SKILL.md                         # Agent Skills spec. Harness-agnostic instructions.
  README.md
  LICENSE
  scripts/
    mutagate.mjs                   # single-file CLI, ESM, zero deps, Node 22+
    hook                           # POSIX shim: exec node "$(dirname "$0")/mutagate.mjs" hook "$@"
    hook.cmd                       # Windows shim
    hooks.json                     # shared Claude Code + Codex hook config
    adapters/
      opencode.js                  # < 60 lines
      pi.ts                        # < 60 lines
  references/
    kotlin-junk.yaml               # junk mutant filter rules
    survivor-playbook.md           # how to kill common survivor classes
    result-schema.json             # JSON schema for result files
  test/                            # dev repo only; not on the generated `skill` branch (ADR-0014)
    ...
```

Runtime state never lives in the skill folder. See 8.5.

### 8.2 Event flow

```
agent writes test file
  -> harness fires post-tool event
  -> adapter or hooks.json invokes: mutagate hook PostToolUse  (stdin: payload)
  -> CLI: is it a test file? resolve target. invalidate stale. spawn scoped run (async)
  -> run finishes: write result JSON. if below threshold, surface survivors to model
     (Claude: asyncRewake exit 2 + stderr. Codex: additionalContext at next safe point.
      OpenCode/Pi: adapter injects a message)

agent edits production file
  -> mutagate hook PostToolUse -> mark every score for that class stale (sync, < 50 ms)

agent tries to stop / complete task / subagent finishes
  -> mutagate hook Stop | SubagentStop | TaskCompleted
  -> gate: for each target touched this session: fresh score above threshold? allow.
     stale or missing? run now within budget. below threshold? block with survivors.
     round cap reached? allow + system warning.

agent tries to edit .mutagate/waivers.json
  -> mutagate hook PreToolUse -> ask (Claude) / deny with instructions (others)
```

### 8.3 Hook protocol

The CLI accepts one input shape on stdin and emits one output shape on stdout. It is the Claude Code hook JSON. Codex uses the same shape natively. OpenCode and Pi adapters construct it.

**Input (common fields, all events):**

```json
{
  "session_id": "string",
  "cwd": "/abs/path",
  "hook_event_name": "PostToolUse",
  "harness": "claude|codex|opencode|pi",
  "tool_name": "Write",
  "tool_input": { "file_path": "src/test/kotlin/com/acme/UserServiceTest.kt" },
  "tool_response": {},
  "stop_hook_active": false
}
```

`harness` is a mutagate extension. Claude Code and Codex do not send it. The CLI infers it: `CLAUDE_PLUGIN_ROOT` or `CLAUDE_PROJECT_DIR` set and no `CODEX_HOME` implies claude, `CODEX_HOME` or a `turn_id` field implies codex, adapters set it explicitly. `MUTAGATE_HARNESS` env var overrides.

**Codex delta (FR-11.2):** file edits arrive as `tool_name: "apply_patch"` with the patch text in `tool_input.command`, not `file_path`. The CLI must extract paths from `*** Add File:`, `*** Update File:`, `*** Delete File:` and `*** Move to:` lines.

**OpenCode delta:** tool names are lowercase (`edit`, `write`, `bash`), argument key is `filePath`. Adapter normalizes before calling the CLI.

**Pi delta:** `event.toolName`, `event.input.path` or similar. Adapter normalizes. VERIFY field names against pinned Pi version.

**Output shapes the CLI emits:**

PostToolUse, informational:
```json
{ "hookSpecificOutput": { "hookEventName": "PostToolUse", "additionalContext": "<report>" } }
```

PostToolUse async wake (Claude only): exit code 2, report on stderr.

Stop / SubagentStop / TaskCompleted, block:
```json
{ "decision": "block", "reason": "<report>" }
```
Also exit code 2 with the report on stderr, for harnesses that only honor exit codes. The CLI does both (JSON on stdout, report on stderr, exit 2). Claude Code and Codex both accept this combination. VERIFY.

Stop, allow with warning:
```json
{ "systemMessage": "mutagate: round cap reached for com.acme.UserService, score 0.71 below 0.80" }
```

PreToolUse waiver protection:
```json
{ "hookSpecificOutput": { "hookEventName": "PreToolUse",
  "permissionDecision": "ask",
  "permissionDecisionReason": "Waivers require human approval. Proposed: <id> because <reason>" } }
```
On Codex the CLI emits `"permissionDecision": "deny"` with the same reason plus "edit .mutagate/waivers.json manually".

SessionStart: plain text on stdout, one line, for example
`mutagate 1.0 active. runner=pitest (gradle, kotlin tier B). threshold 0.80. mode gate.`

### 8.4 Result schema

One file per target per session. `references/result-schema.json` is authoritative. Summary:

```json
{
  "schema": 1,
  "target": "com.acme.UserService",
  "language": "kotlin",
  "runner": "pitest",
  "tests": ["com.acme.UserServiceTest"],
  "started_at": "2026-09-12T10:22:03Z",
  "duration_ms": 41200,
  "score": 0.62,
  "killed": 31, "survived": 19, "timed_out": 0, "no_coverage": 4,
  "filtered_junk": 11, "waived": 2,
  "threshold": 0.80,
  "status": "below|pass|error|unscored",
  "error": null,
  "survivors": [
    {
      "id": "sha1(file:line:mutator:method)",
      "file": "src/main/kotlin/com/acme/UserService.kt",
      "line": 42,
      "method": "isEligible",
      "mutator": "CONDITIONALS_BOUNDARY",
      "plain": ">= became > and no test noticed",
      "severity": 3,
      "in_diff": true,
      "waived": false
    }
  ]
}
```

`score` excludes junk and waived mutants from both numerator and denominator. `no_coverage` mutants are reported separately and count as survivors only when `config.countNoCoverage` is true (default true: uncovered code in the target class is a real gap).

### 8.5 State and storage

Root: `$CLAUDE_PLUGIN_DATA` if set (Claude Code and Codex both export it for plugins), else `$XDG_CACHE_HOME/mutagate` or `~/.cache/mutagate`. Windows: `%LOCALAPPDATA%\mutagate`.

```
<root>/
  jars/                     # pitest jars, sha256-verified, shared across repos
  repos/<sha1(repo-root)>/
    history/<target>.hist   # pitest incremental history
    results/<session_id>/<target>.json
    state/<session_id>.json # targets touched, block counts, in-flight locks
    locks/<target>.lock
    trace.jsonl             # if MUTAGATE_TRACE=1, see testing
```

Repo-owned, committed:
```
<repo>/.mutagate/config.json
<repo>/.mutagate/waivers.json
```

Session identity comes from `session_id` in the payload. If absent (bare CLI use), derive from `MUTAGATE_SESSION` env or fall back to `ppid` with a 12-hour TTL.

---

## 9. Functional requirements

Numbered for traceability. Priority P0 blocks release, P1 should ship in v1, P2 may slip.

### 9.1 CLI (`scripts/mutagate.mjs`)

| ID | Requirement | Pri |
|---|---|---|
| FR-1.1 | `mutagate hook <Event>` reads JSON from stdin, dispatches on event, writes JSON to stdout, uses exit codes per 8.3. Unknown events exit 0 with no output. Malformed JSON exits 0 with a one-line stderr diagnostic (never block on our own bug). | P0 |
| FR-1.2 | `mutagate run <test-file> [--sync] [--json]` resolves target and runs. Default async unless `--sync`. Prints the survivor report to stdout, exit 1 if below threshold, 0 otherwise, 3 on infrastructure error. | P0 |
| FR-1.3 | `mutagate check [--wait <sec>]` evaluates the gate for the current session and prints the report. Exit codes as FR-1.2. Used by the skill and by tests. | P0 |
| FR-1.4 | `mutagate status` lists targets touched this session with score, staleness, in-flight state. | P1 |
| FR-1.5 | `mutagate waive <survivor-id> --reason "<text>"` prints the JSON that would be added to waivers.json and, unless `--apply` is given by a human, does not write. `--apply` writes. The skill instructs agents never to pass `--apply`. | P1 |
| FR-1.6 | `mutagate install [--agent auto\|claude\|codex\|opencode\|pi] [--scope project\|user]` writes the adapter or hook config to the correct location. Idempotent. Prints exact next steps (for Codex: "open /hooks and trust mutagate"). | P0 |
| FR-1.7 | `mutagate doctor` checks: Node version, JDK present, build tool detected, jars present and verified, adapter installed for the detected harness, config valid, a dry scoped run on a synthetic class succeeds. Exit 0 when all pass. | P0 |
| FR-1.8 | `mutagate detect` prints `{harness, language, buildTool, runner, kotlinTier}` as JSON. | P1 |
| FR-1.9 | All commands honor `--repo <path>` and `MUTAGATE_CONFIG` override. | P1 |
| FR-1.10 | Startup time of `mutagate hook` for the invalidate path is under 80 ms p95 on a warm machine (measured in test). | P1 |

### 9.2 Test file detection and target resolution

| ID | Requirement | Pri |
|---|---|---|
| FR-2.1 | A written file is a test file if it matches `config.testGlobs`. Defaults: `**/src/test/**/*.{java,kt}`, `**/*Test.{java,kt}`, `**/*Tests.{java,kt}`, `**/*Spec.{java,kt}`, `**/*IT.{java,kt}`, `**/test_*.py`, `**/*_test.py`, `**/tests/**/*.py`, `**/*.test.{ts,tsx,js,jsx}`, `**/*.spec.{ts,tsx,js,jsx}`, `**/__tests__/**`. | P0 |
| FR-2.2 | JVM resolution: strip `Test`, `Tests`, `Spec`, `IT` suffix from the class name, read the `package` declaration, confirm a main-source class with that FQN exists (search `src/main/java`, `src/main/kotlin`, plus `config.mainRoots`). Add any main-source classes imported by the test as secondary targets. Primary target is scored, secondaries are reported but not gated unless `config.gateSecondaries` is true. | P0 |
| FR-2.3 | Python resolution: `test_foo.py` or `foo_test.py` to `foo.py` in the package mirror, plus modules imported via `from x import` that resolve inside the repo. | P1 |
| FR-2.4 | TS/JS resolution: `foo.test.ts`, `foo.spec.ts`, `__tests__/foo.ts` to `foo.ts` alongside or in the mirrored `src/` path, plus relative imports. | P1 |
| FR-2.5 | When resolution finds zero or more than one primary candidate, the CLI does not guess. It returns `additionalContext` stating the candidates and asking the agent to name the target with `mutagate run <test> --target <fqn>`. The answer is cached for the session. | P0 |
| FR-2.6 | Survivors on lines present in `git diff HEAD` (unified, zero context) are marked `in_diff: true`. If the repo is not git, the field is false for all. | P1 |
| FR-2.7 | Writes are debounced per target for 3 seconds. A write during an in-flight run marks `rerun_requested`, and the runner re-queues once on completion. | P0 |

### 9.3 Runners

Every runner implements: `detect(repo) -> bool`, `prepare(repo) -> env`, `run(target, tests, opts) -> RawResult`, `normalize(RawResult) -> Result`. Runners never write outside the mutagate data dir except for tool-required temp files, which they clean up.

**pitest (Java, Kotlin)**

| ID | Requirement | Pri |
|---|---|---|
| FR-3.1 | Detect Gradle via `build.gradle(.kts)` or `settings.gradle(.kts)`, Maven via `pom.xml`. Multi-module: the module is the nearest ancestor of the test file containing a build file. | P0 |
| FR-3.2 | Jars: `org.pitest:pitest-command-line`, `org.pitest:pitest`, `org.pitest:pitest-entry`, `org.pitest:pitest-junit5-plugin` (and `pitest-junit-plugin` if JUnit 4 detected), downloaded from Maven Central into `<root>/jars`, versions and SHA-256 pinned in the CLI. Download only when missing, never when `MUTAGATE_OFFLINE=1`. VERIFY exact artifact set for pitest 1.21.x. | P0 |
| FR-3.3 | Classpath and class dirs come from the build tool without editing build files. Gradle: run `./gradlew` (or `gradle`) with `--init-script <tmp>/mutagate-init.gradle.kts` that registers a `mutagatePrintClasspath` task printing `testRuntimeClasspath` plus main and test class output dirs as JSON, after ensuring `testClasses` is up to date. Maven: `mvn -q dependency:build-classpath -Dmdep.outputFile=<tmp>` plus `target/classes` and `target/test-classes`, after `mvn -q test-compile`. Cache the classpath per module keyed by build-file hash. | P0 |
| FR-3.4 | Invoke `java -cp <pitest jars> org.pitest.mutationtest.commandline.MutationCoverageReport` with `--classPath`, `--sourceDirs`, `--mutableCodePaths`, `--reportDir <data>/reports/<run>`, `--targetClasses <fqn>`, `--targetTests <test fqn>`, `--outputFormats CSV`, `--mutators DEFAULTS`, `--timestampedReports false`, `--historyInputLocation` and `--historyOutputLocation <history/<target>.hist>`, `--threads <min(4, cores)>`, `--timeoutConst 4000`. VERIFY flag names against pinned pitest. | P0 |
| FR-3.5 | Parse CSV output (`sourceFile,mutatedClass,mutator,method,lineNumber,status,killingTest`). VERIFY column order. Map statuses: `KILLED`, `SURVIVED`, `TIMED_OUT` (counts as killed), `NO_COVERAGE`, `NON_VIABLE`/`MEMORY_ERROR`/`RUN_ERROR` (dropped and counted in `error_mutants`). | P0 |
| FR-3.6 | If the repo already configures the pitest Gradle or Maven plugin, `config.javaRunner` may be set to `project` to invoke the project's own task with target overrides. Default remains `standalone`. | P2 |
| FR-3.7 | JDK detection: `JAVA_HOME`, then Gradle toolchain, then `java` on PATH. Minimum Java 11. Missing JDK is an infrastructure error (fail open). | P0 |

**Kotlin specifics**

| ID | Requirement | Pri |
|---|---|---|
| FR-3.8 | Tier A: if `arcmutate-licence.txt` exists at repo root or `ARCMUTATE_LICENCE` is set, add `com.arcmutate:pitest-kotlin-plugin` (VERIFY coordinates) to the pitest classpath and enable the `KOTLIN` feature. Skip the Tier B filter. | P1 |
| FR-3.9 | Tier B (default): pass `--avoidCallsTo kotlin.jvm.internal`, `--excludedMethods component*,copy,copy$default,equals,hashCode,toString`, then apply `references/kotlin-junk.yaml` post-filter (9.4). | P0 |
| FR-3.10 | Detect Kotlin by presence of `src/main/kotlin` or `.kt` files in the target module, or the `kotlin` Gradle plugin. Mixed Java/Kotlin modules apply the filter only to mutants whose `sourceFile` ends in `.kt`. | P0 |

**mutmut (Python)**

| ID | Requirement | Pri |
|---|---|---|
| FR-3.11 | Detect via `pyproject.toml`, `setup.cfg`, or `requirements*.txt` plus `pytest` importable. Prefer `uv run` when `uv.lock` exists, else the active interpreter. | P1 |
| FR-3.12 | Restrict mutation to the resolved module path and the test run to the single test file. mutmut 2.x and 3.x have different CLIs and config keys. The runner must detect the major version (`mutmut --version`) and branch. VERIFY both. | P1 |
| FR-3.13 | Normalize mutmut results (`mutmut results` / `mutmut show` output or its result store) into the result schema, with `plain` text derived from the mutation diff. | P1 |

**Stryker (TS/JS)**

| ID | Requirement | Pri |
|---|---|---|
| FR-3.14 | Detect via `package.json`. Require `@stryker-mutator/core` resolvable from the repo (never install into the user's project). If missing, infrastructure error with the install hint. | P1 |
| FR-3.15 | Run `stryker run --mutate <target file> --incremental --incrementalFile <data>/history/<target>.json --reporters json --jsonReporter.fileName <data>/reports/<run>/mutation.json`, plus runner-specific related-test narrowing (Jest `enableFindRelatedTests`, Vitest related-file option). VERIFY flags. | P1 |
| FR-3.16 | Parse the mutation-testing-elements JSON schema report. Map `Killed`, `Survived`, `Timeout` (killed), `NoCoverage`, `RuntimeError`/`CompileError` (dropped). | P1 |

**Go and C#**

| ID | Requirement | Priority |
|---|---|---|
| FR-3.17 | Detect Go tests and nearest go.mod. Install pinned gomutants in a versioned, installation-locked tool cache; auto fallback uses only existing gremlins. Explicit selection may install either tool. Offline mode prevents installation. | P1 |
| FR-3.18 | Go mutation targets one file via exclusions. gomutants skips other test files' Test functions (not Example/Fuzz); gremlins runs broader tests. Forward goTags and store incremental history outside source. | P1 |
| FR-3.19 | Exclude generated Go sources and C# designer/generated/migration files during target resolution. No secondary targets for these languages. | P1 |
| FR-3.20 | Detect C# tests and nearest csproj projects. Install Stryker.NET in the tool cache; require .NET 10 runtime. Ambiguous targets use explicit selection. | P1 |
| FR-3.21 | Route Stryker.NET using a namespace/class substring filter and target-file scratch config; use Standard mutations with String ignored. Let Stryker restore/build. | P1 |
| FR-3.22 | Share the mutation-testing-elements parser across TS, Go, C#. Normalize absolute and project-relative report paths to repository paths; parse gremlins spaced statuses separately. Preserve actual runner identity. | P1 |
| FR-3.23 | Include Go manifests/workspaces and transitive C# ProjectReferences in fingerprints. Ignore tool cache, StrykerOutput and TestResults; ignore bin/obj only beside a csproj. All subprocesses honor the run deadline. | P1 |
| FR-3.24 | Preserve default budgets; recommend runBudgetSec=600 for .NET. Add doctor smokes and ubuntu CI fixtures. .NET Framework, F#/VB.NET and Windows qualification are outside v1; reject gremlins subdirectory/package mismatches rather than score its build failures as kills. | P1 |


**cargo-mutants (Rust)**: stretch. Native `--file` and `--in-diff` scoping make it nearly free.

### 9.4 Kotlin junk filter (`references/kotlin-junk.yaml`)

| ID | Requirement | Pri |
|---|---|---|
| FR-4.1 | Rules are a list of `{ id, match: { class?: regex, method?: regex, mutator?: regex, description?: regex }, reason }`. A mutant is junk if any rule's non-empty fields all match. | P0 |
| FR-4.2 | Initial rule set must cover: `$WhenMappings` classes, `$default` methods (default-argument bitmask), `invokeSuspend` and `ContinuationImpl` subclasses (coroutine state machines), `$DefaultImpls`, lateinit access checks (`throwUninitializedPropertyAccessException`), `Intrinsics` calls not caught by `avoidCallsTo`, `getEMPTY`/`INSTANCE` static accessors, `$lambda` and `$1` synthetic classes where the mutator is `VOID_METHOD_CALLS` on `invoke`. | P0 |
| FR-4.3 | Filtered mutants are counted in `filtered_junk`, listed in `--json` output with the rule id, and never shown to the model. | P0 |
| FR-4.4 | The filter is validated against a labeled corpus (11.6). Precision on junk at least 0.95. Real mutants wrongly dropped at most 2 percent. | P0 |
| FR-4.5 | Known gap, documented: inline function bodies. pitest cannot map inlined copies back to source without Arcmutate. Tier B reports mutants in inline call sites as-is. README states this plainly. | P0 |

### 9.5 Gate logic and loop safety

| ID | Requirement | Pri |
|---|---|---|
| FR-5.1 | The gate evaluates every target in `state.targets` that has at least one test file written or edited in this session. Targets touched only on the production side without a test write are not gated (they are invalidated, and a later test write picks them up). | P0 |
| FR-5.2 | Per target decision: `pass` (fresh result, score at or above threshold, or all survivors waived) allows. `below` blocks with the report. `stale` or `unscored` with no run in flight: run synchronously if remaining `gateBudgetSec` (default 120) allows, else block once with "results pending, run `mutagate check --wait 120`", then on the next gate allow with a system warning. In flight: wait up to `gateWaitSec` (default 60) polling the lock, then decide. `error` allows with a system warning naming the error. | P0 |
| FR-5.3 | Round cap: each target may block at most `maxRounds` (default 2) times per session. On the cap, allow and emit `systemMessage`. `stop_hook_active: true` alone does not force allow, the count does. | P0 |
| FR-5.4 | `SubagentStop` uses the subagent's own session scope when the payload carries `agent_id`, otherwise the parent. | P1 |
| FR-5.5 | `TaskCompleted` (Claude only) applies the same decision as Stop. | P1 |
| FR-5.6 | `mode: advise` turns every block into `additionalContext` or `systemMessage` and never blocks. | P0 |
| FR-5.7 | The gate never blocks on its own failure. Any exception in gate code logs to trace and exits 0. | P0 |

### 9.6 Survivor report format

| ID | Requirement | Pri |
|---|---|---|
| FR-6.1 | Plain text, at most `maxSurvivors` (default 10) lines plus a two-line header and one-line footer. Hard cap 1,800 characters. | P0 |
| FR-6.2 | Header: `mutagate: <target> score <score> (<killed>/<killed+survived>), threshold <t>. <n> survivors shown of <total>.` | P0 |
| FR-6.3 | Line: `<file>:<line> <method>: <plain> [<mutator short>]` with ` (changed in this diff)` appended when `in_diff`. | P0 |
| FR-6.4 | Ranking: `in_diff` first, then public methods, then severity (`CONDITIONALS_BOUNDARY`, `NEGATE_CONDITIONALS`, `RETURN_VALS`/`EMPTY_RETURNS`/`NULL_RETURNS`/`PRIMITIVE_RETURNS`/`TRUE_RETURNS`/`FALSE_RETURNS`, `MATH`, `INCREMENTS`, `VOID_METHOD_CALLS`, `INVERT_NEGS`), then line number. | P0 |
| FR-6.5 | Footer: `Details: mutagate status. Playbook: references/survivor-playbook.md.` No HTML report paths, no XML, no tool stdout. | P0 |
| FR-6.6 | `plain` text table maps every default pitest, mutmut and Stryker mutator to a one-clause sentence. Unknown mutators fall back to the tool's description. | P0 |
| FR-6.7 | Report text is written as factual statements. No "you must", no all-caps. | P0 |

### 9.7 Waivers

| ID | Requirement | Pri |
|---|---|---|
| FR-7.1 | `.mutagate/waivers.json`: `{ "schema": 1, "waivers": [ { "id": "<survivor id>", "target": "<fqn>", "reason": "<text>", "by": "<name or email>", "at": "<iso>" } ] }`. | P1 |
| FR-7.2 | Survivor ids are stable across runs (hash of file, line, mutator, method). A code change that moves the line invalidates the waiver, and the gate reports "waiver <id> no longer matches". | P1 |
| FR-7.3 | PreToolUse on Edit/Write to the waivers file: Claude emits `ask`. Codex emits `deny` with the reason. OpenCode and Pi adapters block. In all cases the reason text includes the agent's proposed waiver so the human can copy it. | P1 |
| FR-7.4 | `config.allowAgentWaivers: true` disables FR-7.3 for teams that accept the risk. Default false. | P2 |

### 9.8 Configuration (`.mutagate/config.json`)

```json
{
  "schema": 1,
  "mode": "gate",
  "threshold": 0.80,
  "maxSurvivors": 10,
  "maxRounds": 2,
  "runBudgetSec": 300,
  "gateBudgetSec": 120,
  "gateWaitSec": 60,
  "countNoCoverage": true,
  "gateSecondaries": false,
  "languages": ["java", "kotlin", "python", "typescript", "go", "csharp"],
  "goRunner": "auto",
  "goTags": "",
  "testGlobs": [],
  "mainRoots": [],
  "exclude": ["**/generated/**", "**/build/**"],
  "javaRunner": "standalone",
  "kotlinTier": "auto",
  "allowAgentWaivers": false
}
```

| ID | Requirement | Pri |
|---|---|---|
| FR-8.1 | Precedence: CLI flags, then env `MUTAGATE_*` (uppercase snake of the key), then repo config, then user config `<root>/config.json`, then defaults. | P0 |
| FR-8.2 | Invalid config is an infrastructure error reported once per session at SessionStart and on `doctor`, and the CLI runs with defaults. | P0 |
| FR-8.3 | Harness plugin option systems (Claude `user_config`, Codex plugin config) map onto the same keys via env. | P2 |

### 9.9 Install and doctor

| ID | Requirement | Pri |
|---|---|---|
| FR-9.1 | `install --agent claude --scope project` merges the hook entries from `scripts/hooks.json` into `.claude/settings.json` under `hooks`, adds the Claude-only overlay (`asyncRewake` on the PostToolUse mutate handler, `TaskCompleted` gate, `if` filters), and runs the skill's `scripts/hook` wrapper as `f="$(git rev-parse --show-toplevel)/<rel>/hook" && [ -f "$f" ] && sh "$f" <Event>` when the skill is inside the Git top level (ADR-0013). Without Git, with the skill outside the top level, an unsafe relative path, `--scope user` or Windows, it uses absolute paths and warns for project scope that they are machine-local. `--scope user` targets `~/.claude/settings.json`. Existing unrelated hooks are preserved. Re-running replaces only entries whose command contains `mutagate` or this skill's Git-top-level wrapper path. | P0 |
| FR-9.2 | `install --agent codex` writes `.codex/hooks.json` (or merges into an existing one) using shell-form commands, no `args`, no `if`, no `asyncRewake`, `additionalContextLimit: 2500`. Ends by printing the trust instruction. | P0 |
| FR-9.3 | `install --agent opencode` copies `adapters/opencode.js` to `.opencode/plugin/mutagate.js` with the CLI path baked in. VERIFY directory name (`plugin` vs `plugins`) against pinned OpenCode. | P0 |
| FR-9.4 | `install --agent pi` copies `adapters/pi.ts` to `.pi/extensions/mutagate.ts` (project) or `~/.pi/agent/extensions/` (user). Also documents the package route: adding the repo to `packages` in Pi settings. VERIFY. | P0 |
| FR-9.5 | `install --agent auto` detects: `CLAUDE_PLUGIN_ROOT` or `CLAUDE_PROJECT_DIR` implies claude, `CODEX_HOME` or `.codex/` implies codex, `.opencode/` or `opencode.json` implies opencode, `.pi/` implies pi. Multiple matches install all. None: print the four manual commands and exit 2. | P0 |
| FR-9.6 | `uninstall --agent <x>` reverses the above. | P1 |
| FR-9.7 | `doctor` output is a checklist with pass/fail per item and one remediation line per failure. Exit 0 only when every P0 item passes. | P0 |

### 9.10 SKILL.md

| ID | Requirement | Pri |
|---|---|---|
| FR-10.1 | Frontmatter: `name: mutagate`, `description` under 200 characters, mentioning "mutation testing", "test quality", "surviving mutants", "before finishing tests" so harness routers trigger it when tests are written. | P0 |
| FR-10.2 | Body under 60 lines. Content: (1) after writing or changing a test file run `scripts/mutagate run <test-file>` and read the survivors, (2) before reporting a task complete run `scripts/mutagate check`, non-zero means not done, (3) kill survivors using the playbook, (4) never edit waivers or pass `--apply`, propose instead, (5) first use in a repo run `scripts/mutagate install --agent auto` once, (6) paths are relative to the skill directory. | P0 |
| FR-10.3 | Identical text for all harnesses. No harness-specific instructions in the body. | P0 |
| FR-10.4 | Claude Code frontmatter may additionally carry the hooks block so enforcement activates on skill invocation without `install`. This is optional and behind a documented tradeoff (only active after invocation). If included, the skills validator must still pass. | P2 |

### 9.11 Harness adapters

Common adapter contract: build the payload of 8.3, spawn `node <cli> hook <Event>` with the payload on stdin, parse stdout JSON, apply the native reaction. Adapters contain no path logic, no scoring, no thresholds. Each adapter is under 60 lines and has no imports beyond the Node standard library and the harness's own plugin types.

**Claude Code (no adapter, `hooks.json` + overlay)**

| Event | Handler | Notes |
|---|---|---|
| SessionStart | `hook SessionStart` | stdout banner becomes context |
| PostToolUse `Write\|Edit` | `hook PostToolUse` sync (invalidate) | under 80 ms |
| PostToolUse `Write\|Edit` | `hook PostToolUse --mutate` with `asyncRewake: true` | exits 0 for non-test files immediately, exit 2 with report on survivors |
| PreToolUse `Write\|Edit` with `if: Write(**/.mutagate/waivers.json)` and a second handler for `Edit(...)` | `hook PreToolUse` | `ask` |
| Stop, SubagentStop, TaskCompleted | `hook <Event>` | timeout 600 |

**Codex CLI**

| Event | Handler | Notes |
|---|---|---|
| SessionStart | same | plain stdout is developer context |
| PostToolUse `Edit\|Write` | sync invalidate + `async: true` mutate | async output arrives at next safe point, cannot block |
| PreToolUse `Edit\|Write` | `hook PreToolUse` | `deny` with instructions, since `ask` is unsupported |
| Stop, SubagentStop | `hook <Event>` | block creates a continuation prompt from `reason` |
| Not available | TaskCompleted, `if`, `args`, `asyncRewake` | overlay omitted |

Codex requires the user to review and trust hooks via `/hooks`. Trust is recorded against the hook definition hash, so any change to `hooks.json` requires re-trust. `install` prints this every time. Hook output is capped at roughly 2,500 tokens before spilling to disk, well above the 1,800-character report cap.

**OpenCode (`adapters/opencode.js`)**

| OpenCode hook | Maps to | Reaction |
|---|---|---|
| `tool.execute.before` for `edit`/`write` | PreToolUse | throw on deny |
| `tool.execute.after` for `edit`/`write` | PostToolUse | append `additionalContext` to `output.output`, spawn detached mutate, on completion inject via SDK client session prompt (VERIFY: `client.session.prompt` with `noReply`-style option if available, else a normal prompt) |
| `event` `session.created` | SessionStart | buffer banner, deliver with first message |
| `event` `session.idle` | Stop | on block, re-prompt with `reason`, honoring round cap in the CLI |

Known behaviors to test: `tool.execute.after` fires only for successful tool calls, and at least one OpenCode release shipped with the hook declared but never triggered. The adapter test suite includes a canary that fails loudly if `tool.execute.after` never fires during the live E2E.

**Pi (`adapters/pi.ts`)**

| Pi event | Maps to | Reaction |
|---|---|---|
| `session_start` | SessionStart | `pi.sendMessage` with `display: false` or system-prompt injection at `before_agent_start` (VERIFY best channel) |
| `tool_call` for edit/write tools | PreToolUse | return `{ block: true, reason }` |
| `tool_result` for edit/write tools | PostToolUse | spawn mutate, on completion `pi.sendMessage(report, { deliverAs: "steer" })` |
| `agent_end` | Stop | on block `pi.sendUserMessage(reason)`, round cap in the CLI |

Pi has no permission system, so waiver protection is a hard block in `tool_call`. Pi loads project extensions from `.pi/extensions/` and user extensions from `~/.pi/agent/extensions/`, and can install a git repo as a package that provides `extensions/` and `skills/`. VERIFY current package manifest conventions.

---

## 10. Non-functional requirements

| ID | Requirement |
|---|---|
| NFR-1 | Runtime: Node 22 LTS or later. Also runs under Bun (OpenCode) for the adapter path. No `package.json` dependencies. No build step. No Python for the core. |
| NFR-2 | Size: `mutagate.mjs` under 1,400 lines. Adapters under 60 lines each. Whole skill folder under 300 KB excluding `test/`. |
| NFR-3 | Portability: macOS, Linux, Windows (Git Bash and PowerShell shims). CI runs Ubuntu and macOS, Windows smoke only. |
| NFR-4 | Performance: sync hook paths under 80 ms p95. Scoped pitest on the Java fixture under 90 s cold, under 30 s warm (history) on a GitHub-hosted 4-core runner. Report generation under 50 ms. |
| NFR-5 | Security: the CLI never executes strings taken from tool payloads. File paths from payloads are resolved and must stay inside the repo root or they are ignored. Jar downloads are pinned by SHA-256 and fetched only from `https://repo1.maven.org/maven2`. No other network access. `MUTAGATE_OFFLINE=1` disables downloads. Hook stdout never includes secrets or environment dumps. |
| NFR-6 | Privacy: no telemetry, no network calls except jar download. Trace file is local and opt-in. |
| NFR-7 | Robustness: every hook entry point is wrapped so that internal errors log to trace and exit 0. The only exit 2 paths are deliberate blocks. |
| NFR-8 | Observability: `MUTAGATE_TRACE=1` appends one JSON line per hook invocation to `<root>/repos/<hash>/trace.jsonl` with `ts, harness, event, tool, file, decision, target, score, duration_ms, error`. `MUTAGATE_DEBUG=1` additionally logs runner commands and raw tool output to a per-run log file. |
| NFR-9 | Compatibility policy: tested harness and tool versions are pinned in `test/harness-versions.json` and printed by `doctor`. A nightly drift job (11.7) detects payload schema changes. |
| NFR-10 | Licensing: MIT for mutagate. pitest is Apache 2. Arcmutate is commercial and never bundled. |

---

## 11. Testing strategy

The core problem in testing this product is that live agent runs are slow, non-deterministic and cost money, while the correctness that matters (gate decisions, loop safety, payload parsing, junk filtering) is entirely deterministic. The strategy separates those: deterministic tests run on every PR, live cross-harness tests run nightly and before release, and a drift job watches for harness schema changes.

### 11.1 Layers

| Layer | What it tests | Runs on | Determinism |
|---|---|---|---|
| L1 Unit | pure functions: target resolution, CSV/JSON parsers, junk filter, ranking, report formatting, config precedence, apply_patch path extraction | every PR | full |
| L2 Protocol conformance | `mutagate hook <Event>` against a golden payload corpus per harness, asserting exact stdout JSON, stderr and exit code | every PR | full |
| L3 Adapter | OpenCode and Pi adapters driven in-process with fake harness objects | every PR | full |
| L4 Runner integration | real pitest, mutmut, Stryker against fixture repos, asserting scores within tolerance and survivor lists | every PR (JVM), nightly (all) | high, tool version pinned |
| L5 Scripted harness driver | replays a scripted sequence of hook events against a fixture repo, including the "agent fixes the test" step, asserting gate decisions and round caps end to end without a model | every PR | full |
| L6 Live cross-harness E2E | real harness CLIs in headless mode with a real model, asserting on the trace file, not on model text | nightly, release | low, smoke assertions only |
| L7 Drift | records raw hook payloads from each live harness and diffs key sets against goldens | nightly | n/a |
| L8 Performance | timing budgets from NFR-4 | nightly | medium |

### 11.2 Fixture repos (`test/fixtures/`)

Each fixture is a minimal but realistic project committed to the repo. Each contains a target class with known mutant counts, a **weak** test (passes, kills few), a **strong** test (kills nearly all), and an **expected.json** with score ranges for each.

| Fixture | Contents | Purpose |
|---|---|---|
| `java-gradle` | `UserService.java` with boundary logic, `UserServiceTest.weak.java`, `UserServiceTest.strong.java`, Gradle wrapper, JUnit 5 | Tier 1 baseline |
| `java-maven` | same code, `pom.xml` | Maven classpath path |
| `java-gradle-multimodule` | two modules, test in module B targeting class in B, importing A | module resolution, secondary targets |
| `kotlin-gradle` | `UserService.kt` using data classes, default args, `when` over enum, a suspend function, lateinit, an inline helper. Weak and strong tests. `labeled-mutants.json` hand-labels every pitest mutant as `junk` or `real`. | Tier B filter precision and recall |
| `kotlin-java-mixed` | one module with both | filter scoping by file extension |
| `python-uv` | `pricing.py`, `test_pricing.weak.py`, `test_pricing.strong.py`, `pyproject.toml`, `uv.lock` | mutmut 3 |
| `python-pip` | same with `setup.cfg` and mutmut 2 pinned | mutmut 2 branch |
| `ts-vitest` | `pricing.ts`, `pricing.test.weak.ts`, `pricing.test.strong.ts`, Stryker configured | Stryker + Vitest |
| `ts-jest` | same with Jest | Stryker + Jest related tests |
| `go-module` | go.mod with nested pricing package, generated source, weak/strong and sibling tests | gomutants scoping and path normalization |
| `dotnet-xunit` | SDK projects with ProjectReference, PricingTests and OtherTests | C# target/class scoping and build-output fingerprint stability |
| `ambiguous` | `FooTest.kt` with two plausible `Foo` classes in different packages | FR-2.5 ask path |
| `nojdk` | Java fixture run with `JAVA_HOME` pointed at an empty dir | fail-open path |

Fixtures are activated by copying `*.weak.*` or `*.strong.*` to the canonical test file name. The L5 driver does this to simulate the agent improving the test.

### 11.3 L2 Protocol conformance corpus (`test/payloads/`)

```
test/payloads/
  claude/   SessionStart.json PostToolUse-write-test.json PostToolUse-edit-prod.json
            PreToolUse-waiver-write.json Stop.json Stop-active.json SubagentStop.json TaskCompleted.json
  codex/    SessionStart.json PostToolUse-apply_patch-add-test.json PostToolUse-apply_patch-update-prod.json
            PostToolUse-apply_patch-multi-file.json PreToolUse-apply_patch-waiver.json Stop.json Stop-active.json SubagentStop.json
  opencode/ (payloads as produced by the adapter after normalization, plus the raw plugin inputs that produced them)
  pi/       (same structure)
```

Each payload has a sibling `*.expected.json` with `{ stdout, stderr_contains, exit_code }`. The test harness seeds a fixture repo and result files so that the gate decision is determined, then runs the CLI and asserts. Coverage requirements: every event in section 9.11 for every harness, both the allow and block branches, and the round-cap branch.

Payloads are initially hand-written from the harness docs, then replaced by recorded payloads from L7 as soon as the live runs exist. Recorded payloads are scrubbed of absolute paths and session ids by a fixed rewrite (`/abs/repo` and `sess_fixture`).

### 11.4 L3 Adapter tests

`test/adapters/opencode.test.mjs` imports `adapters/opencode.js` with a fake `{ client, directory }`, calls the returned hook functions with recorded raw OpenCode inputs, and asserts: the CLI was invoked with the normalized payload (spy on `child_process`), `output.output` was appended, `client.session.prompt` was called with the block reason on `session.idle`, and it was not called after the round cap. Same for `test/adapters/pi.test.mjs` with a fake `pi` collecting `on` registrations and `sendUserMessage`/`sendMessage` calls.

A canary test asserts each adapter file is under 60 lines and imports nothing outside `node:*` and the harness type package.

### 11.5 L4 Runner integration

For each fixture and each of weak and strong: run `mutagate run <test> --sync --json`, assert `status`, that `score` falls within `expected.json` ranges (tolerance accounts for pitest version drift), that every survivor listed in `expected.json` as `must_report` appears, and that `filtered_junk` is within range for Kotlin. Second run asserts `duration_ms` dropped by at least 40 percent (history file working).

Cross-platform: the JVM fixtures run on Ubuntu and macOS in CI. Windows runs `java-gradle` only.

### 11.6 Junk filter validation

`kotlin-gradle/labeled-mutants.json` is the labeled corpus. A test runs pitest unfiltered, applies the filter, and computes precision (junk flagged that is labeled junk) and the real-mutant drop rate. Thresholds from FR-4.4. Any change to `kotlin-junk.yaml` must keep both within bounds. New Kotlin constructs are added to the fixture and labeled when reported.

### 11.7 L5 Scripted harness driver (`test/driver/`)

A Node script that plays a harness: it invokes `mutagate hook` in the exact order a real session would, using the corpus payloads templated with the fixture path, and asserts each decision. Scenarios:

1. **Happy path:** SessionStart, PostToolUse(write weak test), wait for result, Stop (expect block, report mentions the known boundary survivor), copy strong test into place, PostToolUse(edit test), wait, Stop (expect allow).
2. **Round cap:** weak test never improves. Stop, Stop with `stop_hook_active`, Stop again. Expect block, block, allow with `systemMessage`.
3. **Stale invalidation:** strong test passes, then PostToolUse(edit production class) making a method untested, Stop. Expect a synchronous re-run and a block.
4. **Unscored with budget exceeded:** `gateBudgetSec=1`. Expect one "results pending" block then allow with warning.
5. **Waiver:** block on a known survivor, write a waiver for it, Stop. Expect allow. Move the line, Stop. Expect "waiver no longer matches".
6. **Waiver protection:** PreToolUse on the waivers file for each harness. Expect `ask` (claude), `deny` (codex).
7. **Ambiguous target:** expect the ask context, then `--target` resolves and caching works.
8. **Fail open:** `nojdk` fixture. Expect allow with `systemMessage` naming the missing JDK.
9. **Advise mode:** scenario 1 with `mode=advise`. Expect zero blocks and the report as `additionalContext`.
10. **Codex apply_patch:** payloads with multi-file patches. Expect correct test and production classification per file.
11. **Debounce and rerun:** two writes 500 ms apart. Expect one run, and `rerun_requested` honored once.

This layer is where most gate bugs will be caught. It runs in under three minutes with a warm jar cache.

### 11.8 L6 Live cross-harness E2E (nightly, release)

Purpose: prove the adapters and hook configs actually fire inside each real harness, and that a real model responds to the report by improving tests. Assertions are on the trace file and the final `mutagate check`, never on model wording.

Setup: a throwaway container per harness with the harness CLI pinned, the language toolchain, the fixture repo copied in, mutagate installed via `npx skills add ./mutagate` followed by `mutagate install --agent <x>`, and `MUTAGATE_TRACE=1`. Model credentials come from CI secrets. Permission prompts are bypassed only inside these containers.

Per-harness invocation (VERIFY flags against pinned versions):

| Harness | Headless command | Hook trust / permissions |
|---|---|---|
| Claude Code | `claude -p "<prompt>" --output-format stream-json` in the fixture repo | project settings hooks, container-only permission bypass flag |
| Codex | `codex exec "<prompt>"` | `--dangerously-bypass-hook-trust` (documented for vetted automation), sandbox flags per pinned docs |
| OpenCode | `opencode run "<prompt>"` | plugin from `.opencode/plugin/` |
| Pi | `pi -p "<prompt>"` or `--mode rpc` with a JSONL prompt | extension from `.pi/extensions/` |

Prompt (identical for all): "Add unit tests for `UserService` in this repo. Aim for thorough coverage of edge cases. When you believe you are done, say DONE."

Assertions from `trace.jsonl`:

1. `SessionStart` observed with the correct harness label.
2. At least one `PostToolUse` with a test file path and a resolved target.
3. At least one result file written for the target.
4. For Claude and Codex: at least one `Stop` with `decision: block`, followed by a later `Stop` with allow, within `maxRounds`. For OpenCode and Pi: at least one re-prompt recorded, followed by an allow.
5. Final `mutagate check` in the container exits 0, or exits 1 with the round cap reached (recorded as a soft failure with the report attached, not a red build, since model behavior varies).
6. OpenCode canary: `tool.execute.after` observed at least once, else hard failure (this catches the "declared but never triggered" class of harness bug).
7. No trace line has `error` set for mutagate-internal reasons.

Flake policy: each harness runs twice. Pass if either run satisfies assertions 1 to 4 and 6 to 7. Assertion 5 is reported, not gated.

Cost control: nightly runs use the smallest capable model each harness offers. Release runs use the default model.

### 11.9 L7 Drift detection

A `--record` flag on `mutagate hook` writes the raw stdin to `<root>/recorded/<harness>/<event>-<n>.json`. The nightly L6 job runs with recording on, then a script compares the set of top-level and `tool_input` keys per event and harness against `test/payloads/<harness>/schema-keys.json`. Any missing or renamed key fails the drift job and opens an issue with the diff. This is how the team learns that, for example, Codex renamed a field, before users do.

### 11.10 L8 Performance

Nightly, on a 4-core runner: measure sync hook latency (1,000 invocations of the invalidate path), cold and warm scoped pitest on `java-gradle` and `kotlin-gradle`, report formatting time. Fail if NFR-4 budgets are exceeded by more than 25 percent. Trend numbers are stored as CI artifacts.

### 11.11 CI matrix

| Job | Trigger | OS | Toolchain |
|---|---|---|---|
| unit + protocol + adapters + driver (L1, L2, L3, L5) | PR | ubuntu, macos | Node 22 |
| runner integration JVM (L4) | PR | ubuntu, macos | Node 22, Temurin JDK 21, Gradle wrapper, Maven 3.9 |
| runner integration Python + TS (L4) | nightly, PR when runner files change | ubuntu | Python 3.12, uv, mutmut 2 and 3, Node 22 |
| runner integration Go + .NET (L4) | PR | ubuntu | Go 1.26, .NET SDK 10, gomutants, dotnet-stryker |
| windows smoke | PR | windows | Node 22, JDK 21, `java-gradle` only |
| live E2E (L6) + drift (L7) | nightly, release tag | ubuntu | containers, secrets |
| performance (L8) | nightly | ubuntu 4-core | JDK 21 |

Harness and tool versions are read from `test/harness-versions.json` and installed by CI. Bumping a version is a PR that must pass L6 twice.

---

## 12. Acceptance criteria (release gate for v1.0)

1. All P0 requirements implemented with tests.
2. L1 to L5 green on Ubuntu and macOS, Windows smoke green.
3. L4: `java-gradle`, `java-maven`, `java-gradle-multimodule`, `kotlin-gradle`, `kotlin-java-mixed` produce scores within `expected.json` on every run for five consecutive nightly runs.
4. Junk filter precision at least 0.95 and real-mutant drop at most 2 percent on the labeled corpus.
5. L6 passes assertions 1 to 4 and 6 to 7 on all four harnesses in at least three of the last four nightly runs.
6. NFR-4 budgets met on the nightly performance job.
7. `doctor` passes on a fresh machine for each harness following only the README.
8. `npx skills add <repo>` installs the skill into all four harnesses and the SKILL.md passes the agentskills.io validator.
9. Adapters under 60 lines, `mutagate.mjs` under 1,400 lines, no dependencies.
10. README documents: supported versions, the Kotlin inline-function gap, Codex trust step, OpenCode and Pi soft-gate semantics, and how to file a junk-filter report.

---

## 13. Milestones

| Milestone | Scope | Exit criteria |
|---|---|---|
| M0 Skeleton (week 1 to 2) | CLI dispatch, protocol, config, state, trace, `java-gradle` runner, report format, Claude Code `hooks.json`, `install --agent claude`, L1 and L2 for Claude | driver scenario 1 passes on Claude payloads |
| M1 Gate (week 3) | full gate logic, loop safety, waivers, Codex payloads and apply_patch parsing, `install --agent codex`, L5 scenarios 1 to 11 | L5 green on Claude and Codex payloads |
| M2 Kotlin (week 4 to 5) | Tier B filter, labeled corpus, `kotlin-gradle` and mixed fixtures, Tier A detection, Maven and multi-module | FR-4.4 thresholds met |
| M3 Adapters (week 6) | OpenCode and Pi adapters, `install` for both, L3, first L6 live run for all four | L6 assertions 1 to 4, 6, 7 pass once per harness |
| M4 Tier 2 languages (week 7 to 8) | mutmut 2 and 3, Stryker Jest and Vitest, fixtures | L4 green for Tier 2 |
| M5 Release (week 9) | docs, drift job, performance job, skills validator, README, tag 1.0.0 | section 12 met |

Stretch after 1.0: cargo-mutants, Android/AGP classpath, Claude Code plugin marketplace packaging, Codex plugin packaging, per-team survivor severity overrides.

---

## 14. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Harness hook schemas change | adapters or payload parsing break silently | L7 drift job, pinned versions, `doctor` prints tested versions, protocol corpus replaced by recordings |
| Scoped pitest still slow on large classes | agents wait, users disable | history files, thread cap, `runBudgetSec` with partial results, `advise` mode fallback |
| Kotlin junk filter misses new compiler patterns | false blocks, user trust lost | labeled corpus, filter reports include rule ids, one-command junk report, Tier A path |
| Agent loops on the gate | wasted tokens | round cap, `stop_hook_active`, `systemMessage` to the human |
| Classpath resolution fails on exotic builds | fail open, feature silently off | `doctor` runs a dry mutation on a synthetic class, banner states runner status at SessionStart |
| Codex `apply_patch` payload shape changes | test files not detected on Codex | dedicated corpus payloads, drift job |
| OpenCode `tool.execute.after` not firing in some versions | silent no-op | L6 canary assertion 6, adapter falls back to `event` `file.edited` if available (VERIFY) |
| Prompt-injection heuristics reject hook text | report never reaches the model | FR-6.7 factual phrasing, L6 assertion that the model's next action references the target file |
| Users edit build files expecting the plugin to pick them up | confusion | README states standalone runner, `javaRunner: project` option |

---

## 15. Open questions for engineering

1. Should the OpenCode async report use a no-reply context injection (if the SDK supports one) or a normal prompt that triggers a turn? The former is cleaner, the latter is guaranteed to exist. Decide after checking the pinned SDK.
2. For Pi, is `before_agent_start` system-prompt injection or a hidden `sendMessage` the better SessionStart channel?
3. Should secondaries be gated by default in multi-module repos where the primary is thin and the logic is in an imported class? Proposed: no for v1, log how often secondaries hold the survivors, revisit.
4. Is Bun compatibility for the core (not just the adapter) worth testing given OpenCode may spawn with Bun on PATH but no Node? Proposed: `install --agent opencode` checks for `node` and warns if absent.
5. Should `TIMED_OUT` count as killed (pitest convention) or be reported? Proposed: killed, with a count in the JSON.

---

## 16. Prior art and references

Consulted for this document. Re-verify against pinned versions.

- Claude Code hooks reference: https://code.claude.com/docs/en/hooks
- Claude Code skills, plugins, sub-agents: linked from the hooks reference
- Codex hooks: https://developers.openai.com/codex/hooks
- Codex skills: https://developers.openai.com/codex/skills
- Agent Skills specification: https://agentskills.io
- skills CLI (multi-harness installer): https://github.com/vercel-labs/skills
- OpenCode plugin docs: https://opencode.ai/docs/plugins/ (VERIFY exact URL)
- OpenCode Claude-hook bridge (event-mapping reference only, not a dependency): https://github.com/monks1975/opencode-agent-hooks
- OpenCode issue on `tool.execute.after` not triggering: https://github.com/anomalyco/opencode/issues/25918
- Pi extensions: https://pi.dev/docs/latest/extensions and https://github.com/earendil-works/pi (docs/extensions.md)
- pitest: https://pitest.org, FAQ on language support https://pitest.org/faq/
- gradle-pitest-plugin (for `javaRunner: project`): https://github.com/szpak/gradle-pitest-plugin
- Arcmutate Kotlin plugin (Tier A, commercial): https://docs.arcmutate.com/docs/kotlin.html
- Unmaintained pitest-kotlin (do not use): https://github.com/pitest/pitest-kotlin
- mutmut and Stryker: official docs for the pinned versions (VERIFY URLs)
- Spotify shunt, the hooks-enforce / scripts-execute / skills-teach layering this design borrows: https://engineering.atspotify.com/2026/9/portal-by-spotify-cut-my-claude-code-token-usage-by-90

---

## Appendix A: shared `scripts/hooks.json` (Claude Code and Codex)

Shell form only, no `args`, no `if`, no `asyncRewake`. `install` adds the Claude overlay. `MUTAGATE_HOOK` is replaced at install time with the repo-relative wrapper command `f="$(git rev-parse --show-toplevel)/<rel>/hook" && [ -f "$f" ] && sh "$f"` when the skill is inside the Git top level, else with the absolute Node and runtime paths (ADR-0013).

```json
{
  "description": "mutagate: mutation-score gate for agent-written tests",
  "hooks": {
    "SessionStart": [
      { "hooks": [ { "type": "command", "command": "MUTAGATE_HOOK SessionStart", "timeout": 20 } ] }
    ],
    "PostToolUse": [
      { "matcher": "Edit|Write", "hooks": [
        { "type": "command", "command": "MUTAGATE_HOOK PostToolUse", "timeout": 30 },
        { "type": "command", "command": "MUTAGATE_HOOK PostToolUse --mutate", "async": true, "timeout": 900 }
      ] }
    ],
    "PreToolUse": [
      { "matcher": "Edit|Write", "hooks": [
        { "type": "command", "command": "MUTAGATE_HOOK PreToolUse", "timeout": 10 }
      ] }
    ],
    "Stop": [
      { "hooks": [ { "type": "command", "command": "MUTAGATE_HOOK Stop", "timeout": 600 } ] }
    ],
    "SubagentStop": [
      { "hooks": [ { "type": "command", "command": "MUTAGATE_HOOK SubagentStop", "timeout": 600 } ] }
    ]
  }
}
```

Claude overlay applied by `install --agent claude`: set `"asyncRewake": true` on the `--mutate` handler (replacing `async`), add `"if": "Write(**/.mutagate/waivers.json)"` and a sibling `Edit(...)` handler to the PreToolUse group so the hook only spawns for the waivers file, add a `TaskCompleted` group mirroring Stop, and use exec form with `args` and `${CLAUDE_PLUGIN_ROOT}` when installed as a plugin.

Codex note: `additionalContextLimit: 2500` on every handler, and the PreToolUse handler runs for every Edit/Write (no `if`), so the CLI's first line must be a fast path that exits 0 unless the path is the waivers file.

## Appendix B: golden payload examples

Claude Code, PostToolUse after writing a test:
```json
{
  "session_id": "sess_fixture", "cwd": "/abs/repo", "hook_event_name": "PostToolUse",
  "permission_mode": "default", "tool_name": "Write", "tool_use_id": "toolu_x",
  "tool_input": { "file_path": "/abs/repo/src/test/kotlin/com/acme/UserServiceTest.kt", "content": "..." },
  "tool_response": { "success": true }
}
```

Codex, PostToolUse after an apply_patch that adds a test and edits production code:
```json
{
  "session_id": "thr_fixture", "turn_id": "turn_1", "cwd": "/abs/repo", "hook_event_name": "PostToolUse",
  "permission_mode": "default", "tool_name": "apply_patch", "tool_use_id": "call_x",
  "tool_input": { "command": "*** Begin Patch\n*** Add File: src/test/kotlin/com/acme/UserServiceTest.kt\n+...\n*** Update File: src/main/kotlin/com/acme/UserService.kt\n@@\n-...\n+...\n*** End Patch" },
  "tool_response": { "output": "Done" }
}
```
Expected classification: one test write (triggers run), one production edit (invalidates the same target).

Stop with the loop flag:
```json
{ "session_id": "sess_fixture", "cwd": "/abs/repo", "hook_event_name": "Stop", "stop_hook_active": true, "last_assistant_message": "DONE" }
```

## Appendix C: report example

```
mutagate: com.acme.UserService score 0.62 (31/50), threshold 0.80. 10 survivors shown of 19.
src/main/kotlin/com/acme/UserService.kt:42 isEligible: >= became > and no test noticed [boundary] (changed in this diff)
src/main/kotlin/com/acme/UserService.kt:57 discountFor: return value replaced with 0 and no test noticed [return]
src/main/kotlin/com/acme/UserService.kt:63 notify: call to audit.log removed and no test noticed [void-call]
...
Details: mutagate status. Playbook: references/survivor-playbook.md.
```

## Appendix D: survivor playbook (shipped as `references/survivor-playbook.md`)

- **boundary** (`>=` to `>`, `<` to `<=`): add a test at the exact boundary value and one just past it.
- **negated conditional**: add a test for the false branch with an observable difference.
- **return value replaced**: assert on the returned value, not just that the call succeeded. For collections assert contents, for booleans assert both outcomes across two tests.
- **void call removed**: assert the side effect (state change, recorded interaction, emitted event). If the call has no observable effect, it may be dead code or a waiver candidate.
- **math / increments**: assert exact numeric results for at least two inputs.
- **no coverage**: the line never ran under this test file. Add a case that reaches it, or if it is unreachable, propose a waiver with the reason.
- **Kotlin**: if a survivor names `$default`, `$WhenMappings`, `invokeSuspend` or a `component`/`copy` method, it is likely junk that slipped the filter. Run `mutagate status --json`, copy the mutant, and file a junk-filter report instead of writing a test.
