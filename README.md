<p align="center">
  <img src="https://github.com/keyboardsamurai/mutagate/raw/main/docs/img/mutagate_banner.png" alt="mutagate" width="440">
</p>

<p align="center"><strong>Mutation testing as a hook, not a hope.</strong></p>

mutagate is for individual developers who let Claude Code or Codex write tests (OpenCode and Pi work too). Every time your agent writes a test, mutagate mutates the code under test in the background and tells the agent which bugs slipped through ("`>=` became `>`; no test noticed"). If the tests catch fewer than 80%, the agent can’t finish yet, for up to two retry rounds by default. Team leads: commit the skill dir and `.mutagate/config.json`, and every clone gets the same gate.

Hooks run your build and tests outside the agent sandbox; see [SECURITY.md](https://github.com/keyboardsamurai/mutagate/blob/main/SECURITY.md).

**Status:** 0.9.0 is a beta; config keys and report text can change before 1.0. **Platforms:** macOS and Linux supported; Windows experimental.

<p align="center">
  <img src="https://github.com/keyboardsamurai/mutagate/raw/main/docs/img/mutagate.gif" alt="mutagate mutation-tests each test an agent writes and blocks completion until the score meets the threshold." width="960">
</p>

<p align="center"><a href="#quick-start">Get started</a></p>

## What's supported

✅ validated · 🟡 supported with caveats · ⏳ validation pending · ❌ unsupported

### Languages

| Language | Mutation engine | Build / test runner | You provide | Engine install | Validated |
|---|---|---|---|---|---|
| Java | [PIT](https://pitest.org) 1.21.0 | Gradle/Maven · JUnit 4/5 | JDK 11+ | auto, SHA-pinned | ✅ Gradle, Gradle multi-module, Maven |
| Kotlin | PIT + junk filter ([Tier B](#kotlin)), Arcmutate ([Tier A](#kotlin), licensed) | Gradle/Maven · JUnit 4/5 | JDK 11+ | auto, SHA-pinned | ✅ Gradle, Kotlin/Java mixed · ⏳ Tier A |
| Python | [mutmut](https://github.com/boxed/mutmut) 2.5.1 / 3.8.0 | pytest · pip or uv | mutmut + pytest in project env | project | ✅ pip, uv |
| TypeScript / JavaScript | [Stryker](https://stryker-mutator.io) 9.1.1 | Jest 29 or Vitest 3 | `@stryker-mutator/core` + runner in project | project | ✅ Jest, Vitest |
| Go | [gomutants](https://github.com/szhekpisov/gomutants) 0.6.1, gremlins 0.6.0 fallback | `go test` | Go 1.26+ | auto, cached | ✅ nested-package module · 🟡 [scoping caveats](#runners) |
| C# | Stryker.NET 5.0.0 | `dotnet test` · xUnit | .NET SDK 10 | auto, cached | ✅ xUnit · 🟡 [slow cold builds](#runners) |

Project-provided engines:

```sh
pip install mutmut pytest                                   # Python, pip: in the project venv
uv add --dev mutmut pytest && uv sync                       # Python, uv
npm i -D @stryker-mutator/core@9 @stryker-mutator/jest-runner@9    # TS/JS, Jest (Vitest: @stryker-mutator/vitest-runner@9)
```

### Harnesses

| Harness | Wired via | Completion | Agent waiver edits |
|---|---|---|---|
| [Claude Code](https://claude.com/claude-code) | hooks, `.claude/settings.json` | native block | asks you |
| [Codex CLI](https://developers.openai.com/codex) | hooks, `.codex/hooks.json` (trust in `/hooks`) | native block | denied |
| [OpenCode](https://opencode.ai) | plugin, `.opencode/plugins/mutagate.js` | continuation | denied |
| [Pi](https://pi.dev) | extension, `.pi/extensions/mutagate.ts` | continuation | denied |

Live eval (`npm run eval`), `natural` and `forced` scenarios:

| Harness | Java | Kotlin | Python | TypeScript | Go | C# |
|---|---|---|---|---|---|---|
| Claude Code | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Codex CLI | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| OpenCode | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Pi | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

✅ both scenarios passed · ⏳ missing scenario · ❌ mutagate/harness gap. Each scenario runs twice and passes when one run passes ([ADR-0011](https://github.com/keyboardsamurai/mutagate/blob/main/docs/adr/0011-live-eval-local-two-runs-per-cell.md)). Reliability: one of two runs failed for OpenCode C# `natural`, Pi C# `natural`, Pi Java `natural`, Pi Python `natural` and Pi Python `forced`. Records: [test/evidence](https://github.com/keyboardsamurai/mutagate/blob/main/test/evidence/README.md).

OpenCode forwards only write/edit/patch/apply_patch tools; Pi only write/edit.

**One-shot caveats:** OpenCode/Pi need persistent sessions (interactive, `opencode serve`, `pi --mode rpc`); `opencode run`/`pi -p` cannot reprompt. Without streaming input, `claude -p` waits for the async hook on each test write.

## Quick start

Needs Node 22+, Git and the language toolchain above; no npm dependencies or build step. Project build files/configs stay untouched. Older target frameworks need their runtime.
Gate mode is the default. For reports without blocks, set `MUTAGATE_MODE=advise` or `"mode": "advise"` in `.mutagate/config.json`.

Run one block in the project root (Git top level):

```sh
# Claude Code
npx skills add keyboardsamurai/mutagate#skill -a claude-code --copy
.claude/skills/mutagate/scripts/mutagate install --agent claude
.claude/skills/mutagate/scripts/mutagate doctor
```

```sh
# Codex CLI (then open /hooks in Codex and trust mutagate)
npx skills add keyboardsamurai/mutagate#skill -a codex --copy
.agents/skills/mutagate/scripts/mutagate install --agent codex
.agents/skills/mutagate/scripts/mutagate doctor
```

```sh
# OpenCode
npx skills add keyboardsamurai/mutagate#skill -a opencode --copy
.agents/skills/mutagate/scripts/mutagate install --agent opencode
.agents/skills/mutagate/scripts/mutagate doctor
```

```sh
# Pi
npx skills add keyboardsamurai/mutagate#skill -a pi --copy
.pi/skills/mutagate/scripts/mutagate install --agent pi
.pi/skills/mutagate/scripts/mutagate doctor
```

1. `doctor` checks config, toolchain, jars, adapter and one synthetic mutation. The first run can take 1–3 min (downloads, cold build). Its first line is `mutagate 0.9.0`; a full pass ends with `All checks passed. Restart your agent so it loads the hooks.`
2. Restart the agent. Codex: open `/hooks` and trust mutagate. The session starts with a `mutagate 0.9.0 active. runner=…` line.
3. Ask the agent to write a test for one production file. A weak test gets the first block, with the survivors.
4. Commit the skill dir and the harness config. Project installs inside Git use repo-relative hook commands ([ADR-0013](https://github.com/keyboardsamurai/mutagate/blob/main/docs/adr/0013-project-hooks-use-repo-relative-paths.md)), so clones get the gate.

A successful install ends with `Next: run <skill>/scripts/mutagate doctor, then restart your agent so it loads the hooks.` (Codex adds `In Codex, open /hooks and trust mutagate.`). Use an explicit `--agent`. `--agent auto` installs for the harness dirs it finds; if it finds none, it prints `no harness detected in <repo>; run one of:` and one `<skill>/scripts/mutagate install --agent <harness>` line per harness on stderr, and exits 2.

- **Pinned:** replace `#skill` with `#skill-v0.9.0`.
- **Upgrade:** run the same `npx skills add` line again, then `install --agent <harness>` again (Codex: trust again).
- **Uninstall:** `<skill dir>/scripts/mutagate uninstall --agent <harness>`, then `npx skills remove mutagate -y`.

All commands accept `--repo <directory>` (Windows: `scripts\mutagate.cmd`). Install keeps unrelated hooks. User scope (`--scope user`), a skill outside Git, and Windows write machine-local absolute paths: do not commit them. Claude started in a subdirectory may not load root settings.

After `maxRounds`, completion warns/allows; a large value keeps blocking until it passes. Infrastructure errors never block; agent-caused red/non-compiling tests block once.

## Troubleshooting

`<skill>` is the skill dir from the Quick start.

| Symptom | Cause | Command |
|---|---|---|
| No `mutagate … active` line at session start | Hooks not installed, or agent not restarted | `<skill>/scripts/mutagate doctor`, then restart the agent |
| Codex never runs the hooks | Codex does not trust new or changed hooks | Open `/hooks` in Codex, trust mutagate (after each install) |
| Claude ignores the hooks | Claude started in a subdirectory, root `.claude/settings.json` not loaded | Start `claude` in the Git top level |
| `mutagate inactive: hooks run Node …; need 22+` | Hooks found Node < 22 | `MUTAGATE_NODE=/path/to/node22`, or rerun `install` under Node 22+ |
| `jar download failed` / `offline: missing …` | No access to Maven Central (proxy, offline) | `node <skill>/scripts/cache-jars.mjs`, then `export MUTAGATE_OFFLINE=1` |
| C# result: run budget exceeded | Cold `dotnet` builds take 2–5 min | `.mutagate/config.json`: `"runBudgetSec": 600` |
| Python uv: mutmut missing or `uv run` fails | Project env not synced | `uv add --dev mutmut pytest && uv sync` |
| `WARN <harness> version: X differs from tested Y` | Installed harness is newer or older than the tested pin | None needed: doctor still passes. Pins: `<skill>/references/versions.json`; results: [Harnesses](#harnesses) |
| Need details on any of the above | — | `MUTAGATE_TRACE=1` writes `<data dir>/trace.jsonl`; runner log: `<data dir>/logs/<target>.log` (previous: `.prev.log`) |

The data dir is `~/.cache/mutagate/repos/<sha1 of repo path>/` ([State](#configuration)). For bug reports attach `doctor --json` and `status --json`.

## Commands

| Command | Behavior |
|---|---|
| `run <test> [--target <fqn>]` | Scoped background run; exit 0 = scheduled. |
| `run <test> --sync [--json]` | Foreground run/report. |
| `check [--wait <sec>] [--json]` | Gate all session targets; `--wait` also raises the gate deadline. |
| `status [--json]` | Scores, staleness, survivor/waiver ids, unresolved tests; JSON adds file/tests, block counts, Kotlin exclusions. |
| `detect` | Harness, language, build tool, runner, Kotlin tier (JSON). |
| `doctor [--json]` | First line `mutagate <version>`, then PASS/FAIL/WARN lines; `checking <x>…` progress on stderr. Config, toolchain, jars, adapter, synthetic mutation; failure `hint`, passing `note` fields. WARN (does not fail) when an installed claude/codex/opencode/pi differs from the tested pin. `--json`: `{version, checks, versions}`. |
| `waive <id> --reason <text>` | Propose; `--apply` is refused in agent sessions unless `allowAgentWaivers`. |
| `install` / `uninstall` | Manage hooks/adapters (`--agent`, `--scope project\|user`). |
| `--version` / `version` | Print `mutagate <version>`, exit 0. |

`run --sync`/`check` exits: 0 pass, 1 below threshold/unscored (no mutants to test passes), 2 usage error, 3 result/infrastructure error. Zero-target `check`: exit 1, explained. Usage errors (missing/outside tests, bad wait/waive arguments, absent survivor ids, unknown commands) are not traced as errors. `<command> --help`/`-h`: usage, exit 0. Hooks fail open on exceptions; exit 2: block or Claude async delivery.

**Errors:** Stop/`check`/`run --sync` retry once per fingerprint. Agent-caused errors name registered/glob-matched tests or edited production (Kotlin `e:` too) or report red baseline tests; reports ask for fixes, async delivery matches low scores. Stop blocks once/target within `maxRounds`, then warns/allows; other errors warn/allow. Python scoped-copy-only failures fail open; pytest exit 5 is no red baseline. Deleting every registered test: explained unscored target, blocked once like pending. Final unscored reports explain empty, errored, uncovered or budget-limited results. Gate-clipped kills stay pending.

**Sessions:** Workers/OpenCode/Pi use `MUTAGATE_HOOK_SESSION`; Codex/Claude supply `CODEX_THREAD_ID`/`CLAUDE_CODE_SESSION_ID`. Hookless, export one `MUTAGATE_SESSION` for `run`/`check` across shells. Hook/harness ids win.

## Configuration

Share `.mutagate/config.json`; keys/defaults exported as `DEFAULTS`:

```json
{"schema":1,"mode":"gate","threshold":0.8,"maxRounds":2,"countNoCoverage":true}
```

Precedence: flags > `MUTAGATE_*` env > project > user > defaults (`threshold` → `MUTAGATE_THRESHOLD`/`--threshold`). `mode: "advise"` never blocks. `countNoCoverage: false` scores only mutants the registered tests reach (test strength); uncovered mutants are reported, not counted. Budgets: run 300 s, gate deadline 120 s, in-flight wait 60 s; `check --wait N` raises the gate deadline (CLI only). Reports: ≤10 survivors, ≤1,800 characters. Nonempty `testGlobs` replaces conventions; `mainRoots` adds JVM roots. Invalid config warns once/session, uses defaults.

State: `CLAUDE_PLUGIN_DATA`, else `$XDG_CACHE_HOME/mutagate` or `~/.cache/mutagate` (Windows: `%LOCALAPPDATA%\mutagate`). Fingerprints: project inputs/dependencies/resources and ancestor build files, not unrelated modules/docs. Production edits invalidate targets; `check`/`status` list untested edits. After 6 s idle, async PostToolUse reruns stale targets, suppressing duplicate reports. Wait up to `gateWaitSec` for repo Maven/Gradle wrapper builds (`ps`; not Windows) to avoid overlapping compilation. Unresolved tests: announced once, then at completion until selected.

`install` saves its Node 22+ path in gitignored `scripts/.node-path`. `scripts/mutagate`/`hook`/adapters resolve Node from `MUTAGATE_NODE`, that file, then PATH; under Node <22 hooks stay inactive with a SessionStart notice. `MUTAGATE_TRACE=1`: JSONL events; logs: data-dir `logs/<target>.log` (named in infrastructure errors). `MUTAGATE_DEBUG=1` keeps report dirs/verbose PIT output. No uploads.

## Runners

Discovery ignores `dist/` for every language.

- Java/Kotlin: wrappers honored. Builds supply classpaths without edits; standalone PIT uses incremental history. Undeclared JUnit 5 `junit-platform-launcher` resolves via the project build/engine version. **Maven race:** PIT's `mvn -q test-compile` writes `target/`; overlapping agent builds may read half-written classes ("Extra bytes at the end of class file"). Rerun or use `mvn clean test`.
- Python: `uv.lock` or pyproject `[tool.uv]`, `[dependency-groups]` or `uv_build` selects `uv run --no-sync` (run `uv sync` first). Mutates a scoped copy, including src-layout packages. `conftest.py`/`__init__.py` are never registered.
- TS/JS: nothing installed into the project.
- Go: gomutants mutates only the target file; `-skip` excludes sibling-test `Test\w*` names, but sibling `Example`/`Fuzz` functions may run. History: data dir. Module-root `bin/`/`*.out`, `*.test`, `*.exe` and extensionless executables never invalidate results. Options: `goRunner: "auto" | "gomutants" | "gremlins"`, `goTags: "tag1,tag2"`, `MUTAGATE_GO_RUNNER`, `--go-tags`. Auto: cached/PATH gomutants → install → cached/PATH gremlins; forced gremlins may install. Gremlins mutates one file, runs broader package tests; subdirectory/package names must match or 0.6.0 counts build failures as kills. Excluded: `*.pb.go`, `*_gen.go`, `zz_generated*.go`, `mock_*.go`, `*_mock.go`.
- C#: nearest `.csproj` per source/test (one project/directory). `test-case-filter` joins `FullyQualifiedName~<namespace>.<class>` (first namespace/file; comments/strings ignored) per existing registered-test class; substring match: `PricingTests` also hits `PricingTestsExtra`. Persistent scratch copy reuses build outputs; source/test-project locks serialize Stryker builds. Test projects (Microsoft.NET.Test.Sdk, MSTest.Sdk, xunit, nunit, mstest references or `<IsTestProject>true`) yield no target candidates. Target-file mutation only: `Standard`, no `String`. Excluded: `*.Designer.cs`, `*.g.cs`, `*.g.i.cs`, `Migrations/*.cs`, `StrykerOutput/`, `TestResults/`. `bin/`/`obj/` skip discovery/fingerprints only beside `.csproj`, else stay inputs. Cold builds take 2–5 min: set `"runBudgetSec": 600`. Stryker `Ignored` mutants (some `Block removal`, configured exclusions) keep `ignored: true` in raw results; no score/error-count impact.

Property tests (Hypothesis, jqwik, fast-check, rapid, FsCheck) run unchanged. Pin the seed and cap examples in the test itself: results cache per fingerprint, mutants killed by timeout count as kills, the run budget spans every example per mutant. Name property files by module (`test_<module>_props.py`, `FooPropertyTest`) or pass `--target`; `status --json` shows `timed_out`.

Centralized .NET `UseArtifactsOutput` (`artifacts/obj` without sibling `.csproj`) needs exclusion: `"exclude": ["**/generated/**", "**/build/**", "artifacts/**"]`. Else generated inputs invalidate/retry publication. Ambiguous C# targets need `--target`; ProjectReferences never select.

Go/C# use scratch configs/reports; project mutation configs stay unmerged. Tools: `<cache-root>/tools/<name>@<version>/` → PATH → permitted install. `MUTAGATE_OFFLINE=1` disables downloads, not build-tool dependency resolution; .NET doctor skips/fails its NuGet smoke offline. Outside v1: .NET Framework, F#, VB.NET, go-mutesting v2, baseline/diff mutation, configurable C# ignored mutations.

PIT jars: pinned in `references/jars.json`, Maven Central only; Gradle/Maven resolve dependencies separately. Node `fetch` ignores `HTTP(S)_PROXY`: preseed `<cache-root>/jars/` via curl, then run offline:

```sh
node scripts/cache-jars.mjs # optional: --base-url https://repo.maven.apache.org/maven2 or --tier-a
export MUTAGATE_OFFLINE=1
```

## Kotlin

Tier B (default, unlicensed): source-aware checks, `references/kotlin-junk.yaml` and PIT's Kotlin filter. Data-class synthetics (`equals`, `hashCode`, `toString`, `componentN`, `copy`) are excluded only for proven top-level `data class` owners, including same-file empty marker interfaces. Explicit overrides, inherited/nested/uncertain cases stay scored. Inline-function call-site mutants stay unfiltered. [Corpus measurements](https://github.com/keyboardsamurai/mutagate/blob/main/docs/validation.md#kotlin-filter-corpus).

Tier A: `arcmutate-licence.txt`, `ARCMUTATE_LICENCE` or `kotlinTier: "A"` loads pinned Arcmutate instead of Tier B. Bring your license; plugin not bundled.

## Waivers

Agents propose (`waive <id> --reason <text>`); humans approve (`--apply` or `.mutagate/waivers.json`). Workflow control, not a sandbox; `allowAgentWaivers: true` opts out. IDs bind file, line, method, operator, mutation identity. Moving a line invalidates the waiver; the gate reports it.

## Links

[Evidence, platforms and limitations](https://github.com/keyboardsamurai/mutagate/blob/main/docs/validation.md) · [Security](https://github.com/keyboardsamurai/mutagate/blob/main/SECURITY.md) · [Third-party tools](https://github.com/keyboardsamurai/mutagate/blob/main/THIRD_PARTY.md) · [Changelog](https://github.com/keyboardsamurai/mutagate/blob/main/CHANGELOG.md) · [Contributing](https://github.com/keyboardsamurai/mutagate/blob/main/CONTRIBUTING.md)

<img src="https://github.com/keyboardsamurai/mutagate/raw/main/docs/img/mutie_mascot.png" alt="Mutie, the mutagate gatekeeper" width="80" align="center">
