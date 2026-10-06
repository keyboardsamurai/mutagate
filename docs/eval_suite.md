# Live eval suite: design and handoff plan

Status: implemented 2026-09-14 (`test/eval/`, `npm run eval`), first full
sweep pending; amended by the eval fix pass the same day (`test/review-fixes.md`). It replaced the deleted `test/live.mjs` and realizes PRD §11.8
(L6) as a **local** suite. The deviations from the PRD are listed under "PRD
deviations" and recorded in `test/review-fixes.md`.

## Goal

Automate what was done by hand in the springtest runs
(`~/.claude/projects/-Users-tag-Documents-workspace-ai-lab-springtest/`: 10
Claude Code runs across Java, Kotlin and Go). The suite runs a real agent on a
realistic task for every language × harness pair and records two things:

1. **Compatibility (pass/fail).** mutagate installs, its hooks fire, every
   target gets scored, and the gate blocks and then releases.
2. **Bug discovery.** Every artifact is kept, and anomalies are extracted so a
   human or an agent can read the logs and file mutagate bugs.

Out of scope for v1: effectiveness (comparing against a run without mutagate),
an LLM judge, CI, and spend caps. Scores are recorded anyway, so a baseline
flag can be added later.

## Decisions

| # | Topic | Decision |
|---|---|---|
| 1 | Scenarios | `natural` (realistic prompt, observe) and `forced` (the prompt makes the agent write an assertion-free smoke test first, which must produce block → fix → allow). Both scenarios are also used for bug hunting from the logs. |
| 2 | Task | Default `small`: the production code already exists and the agent writes unit and integration tests. It must provoke real mutagate interactions (see Traps). `--task greenfield` (springtest plan per language) is opt-in. |
| 3 | Where | Local only, triggered by hand. |
| 4 | Budget | No spend cap. One 30 min deadline per run, from run start, covers setup and the agent to catch hangs; collection after the agent gets a fixed 5 min grace so a killed run still has artifacts. |
| 5 | Judging | Deterministic checks only. Wiring checks are hard failures; behaviour checks are warnings. No LLM judge. |
| 6 | Isolation | Runs on the host, with isolated config per harness (see Harness drivers). |
| 7 | Models | Pinned in `test/eval/config.json` and overridable with `--model <harness>=<id>`. Claude `claude-sonnet-5`. Codex `gpt-5.6-sol` with medium reasoning effort. OpenCode uses `deepseek/deepseek-v4.1-flash` and Pi `deepseek/deepseek-v4-flash` (in Pi's model registry) via OpenRouter. |
| 8 | Code | New `test/eval/`, which absorbs and deletes `test/live.mjs`. `live-auth.mjs` and `install-harness.mjs` are deleted (no remaining users). No npm dependencies. Not part of the skill package. |
| 9 | Evidence | Each passing cell writes `test/evidence/live/<harness>-<lang>-<scenario>.json`. The README gains a harness × language table that is edited by hand. A deterministic test fails when a ✅ lacks passing `natural` and `forced` evidence files. |
| 10 | Logs | A folder per run plus `anomalies.json`, a sweep `report.md`, and a checked-in `TRIAGE.md` prompt. |
| 11 | Traps | All 7 (see Traps). |
| 12 | Stacks | One combination per language (see Tasks). Build-tool variants stay covered by `test/integration`. |
| 13 | Repeats | 2 runs per cell every time. A cell passes if either run passes. Anomalies from both runs are reported. `--repeat N`. |
| 14 | Secrets | `CLAUDE_CODE_OAUTH_TOKEN` (Claude subscription, from `claude setup-token`) and `OPENROUTER_API_KEY` live in the repo-root `.env`, which is gitignored. Load it with `process.loadEnvFile`. Every artifact is scrubbed of those values before it is written. Codex uses the existing ChatGPT login in `~/.codex`. |
| 15 | Pass rule | See Checks. |
| 16 | OpenCode/Pi | Long-lived drivers (`opencode serve`, `pi --mode rpc`), not one-shot runs. The gap in one-shot headless mode is filed as a mutagate issue. |

## Layout

```
test/eval/
  run.mjs          CLI + sweep scheduler (--harness --lang --scenario --task --repeat --jobs --model; --report <sweepDir> re-renders a report)
  config.json      models, timeoutMs (1800000), jobs (4), idle settle ms
  harnesses.mjs    per harness: preflight, env, launch, done-detection
  checks.mjs       hard checks, warnings, anomalies.json, report.md
  TRIAGE.md        prompt for an agent reading a sweep dir
  tasks/<lang>/    production code, expected.json, prompt.natural.md
  tasks/prompt.forced.md
  tasks/greenfield/<lang>.md
test/eval.test.mjs checks.mjs on canned traces; README ✅ ↔ evidence file
```

Add `"eval": "node test/eval/run.mjs"` to package.json. `.env` is gitignored.

## Run lifecycle

1. **Preflight.** Check that the harness binary matches its pin in
   `test/harness-versions.json`, that the auth env var or login is present,
   and that the language toolchain exists. A missing item marks the cell
   `skipped (<reason>)`, not failed.
2. **Copy.** Copy `tasks/<lang>` to the repo
   `~/.cache/mutagate-eval/<sweep>/<harness>-<lang>-<scenario>-<n>`, where
   `<sweep>` is a timestamp. The run dir
   `test/.cache/eval/<sweep>/<harness>-<lang>-<scenario>-<n>` links it as
   `repo/`. The repo stays outside this tree because Claude and Pi load
   `AGENTS.md`/`CLAUDE.md` from every ancestor dir, and outside the OS temp
   dir because that does not survive a reboot.
3. **Install.** Reuse `packageSkill` (test/package.mjs), then
   `npx --yes skills@1.5.26 add <stage> --skill mutagate --agent <a> --yes --copy`,
   then `mutagate.mjs install --agent <h> --repo <repo>`. This is the same flow
   as live.mjs:27-30.
4. **Baseline.** `git init` and commit a baseline (live.mjs:46-47).
5. **Env.** Set:
   - `MUTAGATE_TRACE=1`, `MUTAGATE_DEBUG=1`, `MUTAGATE_RECORD=1`
   - `MUTAGATE_NODE` = node 22+. PATH node on this machine is v21.
   - `JAVA_HOME` = JDK 21 (sdkman `21.0.2-open`)
   - the harness-specific isolation below

   Only export `CODEX_HOME` for Codex, because `detectHarness` keys on it.
6. **Launch.** Start the harness with whatever remains of the 30 min run
   deadline (it started before step 2 and also bounds steps 3 and 4). Stream
   stdout and stderr to files.
7. **Collect.** Save:
   - the raw transcript
   - `cacheRoot()/repos/<hash>/trace.jsonl` and the runner logs
   - recorded payloads
   - `status --json`
   - `check --json` with its exit code
   - `git diff` against the baseline (`git add -N -A`, then
     `git diff <baseline>`: new files show up, their content never enters
     `.git/objects`)
   - wall time

   `check`, `status`, the diff and `testCommand` share a fixed 5 min grace
   from agent end. Keep the repo.
8. **Scrub** secret values from every file in the run dir and the repo:
   `<redacted>` in text, same-length `x` bytes in binaries. The OpenCode
   driver deletes `opencode.db` after its message export. Ctrl-C deletes every started run's `opencode.db` and scrubs the run before exiting.
9. **Checks** write `result.json` and `anomalies.json`.

Cache caveat: OpenCode's `XDG_CACHE_HOME` relocation also moves mutagate's
`cacheRoot()` (scripts/mutagate.mjs:59). That would re-download PIT jars and
gomutants on every run. Either symlink the tool cache into the per-run cache
dir, or set only `XDG_CONFIG_HOME`, `XDG_DATA_HOME` and `XDG_STATE_HOME` for
OpenCode. Per-run state isolation is still required so traces don't mix.

## Harness drivers

| Harness | Launch | Isolation | Done |
|---|---|---|---|
| Claude 2.1.270 | `claude -p <prompt> --output-format stream-json --verbose --include-hook-events --dangerously-skip-permissions --model claude-sonnet-5` | Fresh `CLAUDE_CONFIG_DIR` per run and `CLAUDE_CODE_OAUTH_TOKEN`. Never use `--bare`: it skips hooks and never reads OAuth. | process exit |
| Codex 0.154.0 | `codex exec --json --dangerously-bypass-hook-trust --dangerously-bypass-approvals-and-sandbox --ignore-user-config --ignore-rules --ephemeral -m gpt-5.6-sol -c model_reasoning_effort=medium -c 'projects={"<repo>"={trust_level="trusted"}}' -c 'skills.config=[{path="<user SKILL.md>",enabled=false},...]' -C <repo> <prompt>` | Real `~/.codex` for auth, user config ignored. Project trust is passed with `-c` because Codex loads the project `.codex/hooks.json` only for trusted projects, and trust lives in the ignored `config.toml`. Every skill in `~/.codex/skills` and `~/.agents/skills` is disabled by path, since Codex loads those whatever the config says. | process exit |
| OpenCode 1.18.30 | `opencode serve --port <free>` in the repo, then `opencode run --attach <url> --format json --auto -m openrouter/deepseek/deepseek-v4.1-flash <prompt>` | Per-run `XDG_*` (see Cache caveat), `OPENCODE_DISABLE_CLAUDE_CODE=1` (otherwise it reads `~/.claude/CLAUDE.md` and skills), `OPENROUTER_API_KEY`, `SHELL=/bin/bash` (the bash tool runs `$SHELL`) | The session stays idle for a settle period and no mutagate worker holds a lock. Then kill serve. |
| Pi 0.73.1 | `pi --mode rpc --provider openrouter --model deepseek/deepseek-v4-flash`, send `{"type":"prompt",...}` | Per-run `PI_CODING_AGENT_DIR`, `PI_TELEMETRY=0`, `OPENROUTER_API_KEY`. stdin must be piped: Pi reads a non-TTY stdin until EOF. | Poll `get_state` until `isStreaming:false` and `pendingMessageCount:0` hold for the settle period and no worker lock is held |

Facts behind these choices (research 2026-09-14; items marked src come from
reading harness source, not observed runs):
- `opencode run` calls `process.exit()` on the first `session.status` idle,
  before the adapter's idle handler can re-prompt (src). `pi -p` disposes the
  runtime after the prompt, so the adapter's `sendUserMessage` hits "ctx is
  stale" (src). One-shot mode can never exercise the continuation gate.
- OpenCode without `--auto` auto-rejects "ask" permissions, so it does not
  hang. On first run it npm-installs `@opencode-ai/plugin` into `.opencode/`,
  which needs network.
- OpenCode's `anthropic` auth entry is OAuth and doesn't work in 1.18.
  OpenRouter via env is fine.
- Verified by the M1 smoke run and the Java gate runs: `claude -p` without
  streaming input runs the `asyncRewake` PostToolUse hook as a blocking hook
  (each test write waits for its mutation run), and it continues after a Stop
  block (Claude × Java `forced` passed `forced-order`).
- Pi 0.73.1 does not know `deepseek/deepseek-v4.1-flash` and guesses its
  metadata, so Pi uses `deepseek/deepseek-v4-flash`. Its `_isRetryableError`
  does not retry OpenRouter mid-stream errors (a harness bug); if runs keep
  ending on them, try `--model pi=google/gemini-3-flash-preview`.
- Claude has `--max-budget-usd`. `--max-turns` is documented but missing from
  `--help`. Neither is used (no cap).

## Tasks

The same domain in every language is a small version of the springtest plan:
an atomic integer matrix service, a REST controller, an HTML page handler,
and an entrypoint.

| Lang | Stack | Runner |
|---|---|---|
| Java | Spring Boot 4 + Maven, JUnit 5 | PIT |
| Kotlin | Spring Boot 4 + Gradle, JUnit 5 | PIT + Tier B filter |
| Python | FastAPI + pytest, uv | mutmut 3.8.0 |
| TypeScript | Express + Vitest | Stryker 9.1.1 |
| Go | `net/http` | gomutants 0.6.1 |
| C# | ASP.NET Core minimal API + xUnit + `WebApplicationFactory` | Stryker.NET 5.0.0 |

Each task has an `expected.json`:
- `targets`: production files and classes that must end up scored
- `traps`: trap ids present in the task
- `prodFiles`: globs that count as production code for the diff warning
  (files matching `testFiles` are subtracted)
- `testCommand`: the command that must be green at the end

The `natural` prompt is one fixed prompt, modelled on the springtest prompt:
"write comprehensive unit and integration tests". It says nothing about
production edits or mutagate. The `forced` prompt uses the scripted
weak-first flow from live.mjs:20.

### Traps (all in every task unless noted)

1. **Multi-class HTTP integration test named `MatrixApi…`.** The name matches
   no class, so it exercises multi-target resolution. Springtest: unresolved
   in every JVM run.
2. **Boundary logic** (bounds checks, overflow, size cap 1000). First-pass
   tests leave survivors here.
3. **Equivalent-mutant bait** (redundant check, defensive copy). Exercises
   the waiver path and the urge to delete production code.
4. **Entrypoint and wiring file.** Low coverage. In Go springtest runs
   `main.go` started at 0.00–0.22.
5. **Language idioms:**
   - Kotlin: top-level functions (the `<File>Kt` facade) and an Elvis
     fallback in the exception handler
   - Go: integration tests in `cmd/` with handlers in another package
     (silently unscored in a springtest run)
   - C#: `Program.cs` minimal API
   - Python and TS: module-level functions
6. **`forced` only:** an assertion-free smoke test comes first, and the gate
   must block.
7. **Staleness.** The prompt includes a small production change (e.g. "also
   add a `/api/matrix/sum` endpoint") after tests exist, so a scored target
   must go stale and get re-run.

## Checks

A run **passes** when every hard check passes.

**Hard checks:**
- The harness finished within the timeout, and the driver's done-detection
  fired (no kill).
- The trace has a SessionStart with the correct harness label.
- Every test-file write has a PostToolUse registration in the trace.
- Every `expected.json` target has a score in the final `status --json`: none
  unresolved or unscored.
- No internal errors and no infra errors in the trace or runner logs, except
  errors superseded by a later scored Result for the same target (reported
  as warning `recovered-error`) and target-less errors of the agent's own
  CLI calls (usage mistakes).
- The final `check` exits 0, or `status --json` shows every below target
  blocked up to the per-target retry cap. Below threshold without that is a
  gate bug and fails the run.
- `forced` only: the trace shows Stop block, then a later Result pass, then
  Stop allow, in that order.

**Warnings** (report only, all go to `anomalies.json`):
- Production files changed (from the diff against `prodFiles`)
- Waivers proposed or applied
- Manual `mutagate run --target` or `--sync` calls in the transcript
- mutagate source read (`mutagate.mjs`, `mutagate-hook.cjs`, adapters)
- A hook took longer than 1 s (the async `--mutate` PostToolUse handler, traced
  with `mutate: true`, is exempt)
- Stale or unresolved messages for files that no longer exist
- The agent's final text claims pass or scores that `check` doesn't confirm
- The task's `testCommand` is not green
- Tiny mutant counts (fewer than 5) on a target
- The async result never arrived and the agent ran `run`/`check` after a test
  write instead (not when every Result before the first CLI session event
  passed)
- An error superseded by a later scored result (`recovered-error`)

`report.md` per sweep contains:
- a matrix of harness × language × scenario with pass/fail/skip and 2/2, 1/2,
  0/2 run counts
- wall time per cell
- warnings grouped by type
- the top anomalies with links to run dirs

## Milestones

**M0 (agent, host setup).** The user has already done: `.env` with both keys,
Pi 0.73.1, OpenCode 1.18.30. The agent does the rest, following
`.github/workflows/ci.yml`:
- `go install github.com/szhekpisov/gomutants@v0.6.1`
- .NET SDK 10 plus `dotnet tool install dotnet-stryker --version 5.0.0`
- a uv venv with `mutmut` and `pytest`, and update the old uv 0.5.26 (M0
  used 3.3.1, which segfaults on macOS; the pin is now 3.8.0)

The broken Linux-built `test/.cache/py2`, `py3` and `jdk21` also need
rebuilding.

**M1.**
- `run.mjs` skeleton, `checks.mjs` and the Claude driver
- `tasks/java` with its traps
- smoke run: `npm run eval -- --harness claude --lang java --scenario forced --repeat 1`

Exit criteria: async rewake is delivered and Stop blocks then allows under
`-p`. If not, stop and decide before going further.

**M2.** Codex, OpenCode (serve) and Pi (rpc) drivers, all on Java, both
scenarios.

**M3.** Tasks for Kotlin, Python, TypeScript, Go and C#. The `expected.json`
targets must first be validated by a scripted run with no model: write known
tests, run `mutagate run --sync`, confirm every target is scored.

**M4.**
- `report.md`, `anomalies.json` and `TRIAGE.md`
- evidence files, `test/eval.test.mjs`, the README harness × language table
- delete `test/live.mjs` and repoint `package.json` `test:live`
- update AGENTS.md and the README "Validation status"
- `test/review-fixes.md` entries

**M5.** `--task greenfield`, then the first full sweep: 6 × 4 × 2 × 2 = 96
runs.

Done 2026-09-14 for the full sweep: `20260914-133532-8be2`, 96 runs with
`--jobs 4` in about 4h45m, 35 of 48 cells passed, 13 failed, 0 skipped;
README matrix 16 ✅, 5 ❌ (C# on every harness, Pi × Kotlin), 3 ⏳. Findings
are in `test/eval/TRIAGE.md` ("Found by M5"). `--task greenfield` has not
been run yet.

**M6.** The M5 fix pass (`test/review-fixes.md`), then the full sweep again and
`--task greenfield --repeat 1`.

Done 2026-09-15:
- Full sweep `20260914-222213-610b` (`--jobs 4`): 34 cells passed, 2 failed
  (Pi × C#, both scenarios), 12 skipped. The runs were 64 passed, 8 failed,
  24 skipped. The Claude Code CLI had auto-updated to 2.1.271, so preflight
  skipped every Claude run.
- Claude re-run `20260915-015123-44c9` (`--harness claude`, with a PATH shim to
  the pinned 2.1.270): 12 of 12 cells and 24 of 24 runs passed.
- Greenfield `20260915-030858-218f`: 29 of 48 cells passed, 19 failed.

The README matrix now has 23 ✅ and 1 ❌ (Pi × C#), up from 16 ✅ after M5. The
findings, per-fix confirmation and fix-next order are in `test/eval/TRIAGE.md`
("Found by M6").

### M6 sweep detail

State after the second full sweep (M6, 2026-09-15, after the M5 fixes: `20260914-222213-610b`, plus `20260915-015123-44c9` for Claude Code; findings in `test/eval/TRIAGE.md` "Found by M6"): 23 of 24 pairs pass, up from 16 in the first sweep (`20260914-133532-8be2`).
- ❌ Pi × C#: 0/2 in both scenarios. Stryker.NET mutates and builds in the project while the agent runs its own `dotnet build`/`dotnet test`; mutagate locks out only its own concurrent runs, so one `forced` run got a wrong below score, Stop blocked on it and the run hit the deadline. The other three runs failed on the model (no `Program.cs` test, looping). Later: ADR-0001 (Stryker.NET scratch copy) fixed the race; M7 `forced` passed, while the first natural rerun still omitted Program (⏳). After the C# candidate-hint fix, `20260916-155402-b5c2` passed 1/2 natural repeats, supplying the missing evidence for ✅. The failed repeat remains recorded (`test/eval/TRIAGE.md`, "C# candidate-hint follow-up").
- Some ✅ cells passed 1 of 2 runs: OpenCode × Go `forced` (a gate-budget kill was stored as a final unscored result), OpenCode × C# `forced` (the eval driver left a harness permission prompt unanswered), Pi × Python and TypeScript `natural` (model, checker).
- Claude Code ran on the pinned 2.1.270 through a PATH shim: the host CLI had auto-updated to 2.1.271, and the eval driver skips a version that is not the pin.

## Known mutagate issues to reproduce

These are file-as-issue items, not eval work. The eval should surface each one
as a failed check or an anomaly. `test/eval/TRIAGE.md` ("Already known") maps
each item to the check or warning id that flags it.

- The gate doesn't work in one-shot `opencode run` or `pi -p` (see facts
  above). Add a README caveat.
- Pi adapter: an async `--mutate` result that arrives after idle is sent
  without `triggerTurn`, so it's appended and no turn starts (src).
- OpenCode adapter: `apply_patch` isn't mapped. GPT models in OpenCode use it.
- Java springtest: the async PostToolUse `--mutate` result was never
  delivered, so agents ran `run --sync` by hand.
- JVM integration tests: target unresolved (the stem matches no class). A
  multi-class test can only be mapped to one target.
- Go: tests outside the handler package leave the controllers unscored with
  no warning.
- Stop repeats "target unresolved" for test files that were deleted.
- SessionStart in an empty repo shows `runner=unavailable` and is not
  refreshed. `doctor` FAILs before a build file exists.
- `detect` reports `harness: unknown` inside Claude Code.
- A gomutants coverage run failed while `go test` passed (a test with panic
  recovery output). One Stop hook took 9.2 s.
- Controller mutant counts are tiny in Kotlin, where array-returning endpoints
  produce no mutants.

## PRD deviations

- L6 runs locally and by hand, not nightly in CI containers (PRD §11.8, §11.10).
- The flake policy is 2 runs, and a cell passes if either passes. That matches
  PRD §11.8, but both runs always execute, for bug discovery.
- OpenCode and Pi are driven through `serve`/`rpc` instead of one-shot
  headless mode.
