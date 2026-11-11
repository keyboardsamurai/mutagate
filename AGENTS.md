# Repository context

Graft is optional. If graft is installed, build a local context graph with
`graft build` (the `graft/` directory is gitignored) and use it to orient
yourself before exploring code. Start with `graft map`, then use
`graft ask "<question>" --source` to locate relevant code spans. Use
`graft skeleton <file>` for signatures and `graft callers <symbol>` for callers.
Run `graft check` to check freshness and `graft build` after substantial code
changes. When the Graft MCP server is available, use its corresponding tools:
`graft_repo_map`, `graft_find_code`, `graft_file_api`, `graft_trace_calls`,
`graft_find_all`, and `graft_check_freshness`. Without graft, use `rg`.
Always verify relevant source before editing; use `rg` for exhaustive searches.

# mutagate development

mutagate is a Node 22+ CLI, shipped as an agent skill, that runs scoped mutation
tests when an agent writes a test and blocks task completion while the score is
below threshold. It uses only Node built-ins, with no npm dependencies and no
build step. `docs/prd.md` is the spec. Decisions are ADRs in `docs/adr/`; `test/review-fixes.md`
records the evidence per fix, the Go/C# runner design is in `docs/go_csharp_runners.md`, and
the live eval suite plan (language × harness agent runs) is in `docs/eval_suite.md`, and its spec
`docs/eval_suite_spec.md` is implemented in `test/eval/`.
The user-facing behavior (commands, config, exit codes, runner caveats) is in
`README.md`; the GitHub Copilot details (gate, reports, sessions, limits) are in `docs/copilot.md`.

## Decisions

Log architectural decisions as numbered ADRs in `docs/adr/`, ISO 42010, ASD-STE100 language, as short as the decision allows. `docs/adr/` is the **only** place that carries ADR text — `AGENTS.md` carries the boundaries, the invariants and the working rules and points here. A decision that dies is deleted and its number is listed under `## Withdrawn` in `docs/adr/README.md`, never reused and never renumbered. `CONTEXT.md` is the glossary; use its terms in ADRs, docs and messages.

## Commands

```sh
npm test                                          # deterministic suites (test/*.test.mjs, test/adapters/)
node --test test/core.test.mjs                    # one file
node --test --test-name-pattern '<regex>' test/core.test.mjs   # one test
npm run test:integration                          # real mutation runs on test/fixtures (needs toolchains)
MUTAGATE_FIXTURES=go-module,java-maven npm run test:integration   # select fixtures
MUTAGATE_TEST_ENTRY=mutagate-hook.cjs npm run test:integration    # run through the generated CJS runtime (CI does this)
npm run test:driver                               # scripted gate E2E for all five harness envelopes (Copilot: not on Windows)
npm run test:performance                          # hook p95 <= 80 ms; 15k-file Git repo: SessionStart, test edit <= 300 ms (MUTAGATE_PERF_COUNT sets samples, max 100 there)
npm run test:installer
npm run generate:runtime                          # regenerate scripts/mutagate-hook.cjs
npm run generate:hooks                            # regenerate scripts/hooks.json
node test/package.mjs /tmp/new-dir                # build skill package (fails at >= 350 KB)
npm run eval -- --harness claude --lang java --scenario forced   # live agent runs (Node 22, credentials)
```

The repo has no linter or formatter. Other scripts: `test:opencode-discovery`
needs `MUTAGATE_OPENCODE_BIN`. `eval` (alias `test:live`) needs the
pinned harness, the language toolchains, and `CLAUDE_CODE_OAUTH_TOKEN` or
`OPENROUTER_API_KEY` in the repo-root `.env` (Codex uses `~/.codex`, Copilot the
host `copilot` login or an optional `COPILOT_GITHUB_TOKEN` there, never a classic
`ghp_`); flags
`--harness --lang --scenario --task --repeat --jobs --model`, all optional;
`--repeat` below 2 writes no evidence record (ADR-0011);
`--report <sweepDir>` only re-renders that sweep's `report.md`.
`test:drift` needs payloads recorded earlier with `MUTAGATE_RECORD=1`, which
eval runs set (missing Copilot recordings are skipped, not failed). Integration toolchains follow CI (`.github/workflows/ci.yml`):
JDK 21 with Gradle 8.14.3, Go 1.26 with gomutants, .NET 10 with dotnet-stryker
5.0.0, and uv. Python fixtures use venvs under `test/.cache/py2` and
`test/.cache/py3`, and TS fixtures need `npm ci` in their fixture directory.

## Architecture

- `scripts/mutagate.mjs` holds the engine except the runners and exports its
  functions, which tests import directly:
  - `main` handles CLI dispatch and does only the process I/O of a hook call.
    `runHook(argv, stdin text, env)` runs one hook call and returns
    `{code, stdout, stderr}`, and `deadline` when the Copilot watchdog ended it;
    it is the test surface for hook calls (ADR-0022).
    `handleHook` handles hook events and returns harness-neutral intents
    (nothing, `context`, `notice`, `confirm`, `block`, `warn`, `survivors`;
    `error` for an `admit` refusal, traced with no output; `deadline` with `warn`).
  - `configFor` merges config in this order: flags, env, project, user, `DEFAULTS`.
  - `resolveTargets` maps a test file to the production target it covers, and
    `fingerprint` invalidates stale results.
  - Each language has a runner in `scripts/runners.cjs`: `pit` (Java and
    Kotlin), `stryker`, `python`, `goRunner`, and `dotnetRunner`. The
    `runners()` accessor loads it lazily and injects the engine helpers it
    needs; tests reach runner symbols through `m.runners().x`.
  - `normalize` converts runner output into the shared result shape, and
    `report` turns that result into survivor text.
  - `verdict` gives the Target verdict (pending, retry or the final Result
    status, its obligation and exit code) to `gate`, `run --sync`, `status`,
    the worker and the async hook; `exitCode` folds the codes for `gate` and
    `run --sync`.
  - `gate` implements the gate (options `wait`, `hook`, `budget`, `streak`,
    `schedulePending`, `blocksOnly`; ADR-0002, ADR-0003, ADR-0005, ADR-0018).
    `install` delegates to `install.cjs`; `doctor` assembles the checks and
    `doctor.cjs` renders them.
  - State: `cacheRoot`, `atomic`, `cacheJson`, `lock`, `abandoned`, `inFlight`,
    `updateState` (compute `fingerprint` before it), `loadResult`, `schedule` and
    `schedulePrune` (ADR-0023, ADR-0024). `handleHook` with `--mutate` is the
    async rerun branch (ADR-0005, ADR-0019).
- Hook path: on POSIX the harness runs the `scripts/hook` wrapper, which picks
  Node and runs `mutagate-hook.cjs hook <Event>` with the JSON payload on stdin;
  on Windows the command is the absolute Node and runtime (ADR-0013). `install`
  stamps `--installed <VERSION>:<scope>` into the SessionStart command and
  `__MUTAGATE_INSTALLED__` into the adapters (payload `installed`);
  `rerunNotice` and `installStamp` read it (ADR-0017). A payload `timestamp`
  without the `--harness` tag gives `pick` the `inherited` profile (ADR-0015,
  payloads in `test/payloads/copilot/cli/`). PostToolUse on a test file
  registers targets; `schedule` spawns a detached `worker` that calls
  `runTarget` under the target lock. The Copilot spawned handler puts each
  report in the session `outbox`; `deliver` writes the delivered report (state
  `reported`, ADR-0019). Stop, SubagentStop and TaskCompleted call `gate`; the
  native Copilot `hook Stop --timeout T` is `agentStop` (ADR-0018).
- Sessions: `context` picks the session id (ADR-0009). A native Copilot call
  takes payload `sessionId`; a subagent call (payload `agentId`) walks
  `parentAgentId` through the `<data>/agents/` records that
  `hook SubagentStart --harness copilot` writes (ADR-0020).
- Harnesses: Claude, Codex and Copilot use native hook config from `hookConfig`,
  merged in by `install` (Copilot hook file paths: ADR-0021). OpenCode
  (`scripts/adapters/opencode.js`) and Pi (`scripts/adapters/pi.ts`) are thin
  translators that forward only file-writing tools with a Claude-shaped payload
  and a `harness` field; `install` fills `__MUTAGATE_CLI__` and
  `__MUTAGATE_INSTALLED__` in them (ADR-0013, ADR-0017). Native Copilot hook
  commands carry `--harness copilot` (ADR-0020). `HARNESSES` lists the
  installable harnesses, `TOOLS` the write tools and `SESSION_CMDS` the commands
  that use the Git top of cwd in the Copilot root agent shell.
- Harness profiles (ADR-0022): `context` sets `c.profile` and `c.harness` (the
  harness name in traces). `harness.cjs` holds `pick`, `shell`, `base` and every
  profile except Copilot; `copilot.cjs` exports the Copilot `profile`. Method
  and field names: the ADR.
- `mutagate.mjs` loads its CommonJS helpers lazily through `runtimeRequire` to
  keep hook latency low. One line per helper: what it owns, its symbols, its ADR.
  `inputs.cjs`: the repo file list and project inputs for detect, resolution and
  fingerprints (`files`, `inputFiles`, `dirEntries`, `read`, `fileDigest`;
  ADR-0016). `kotlin-source.cjs`: the source-aware part of the Kotlin Tier B
  filter, rules in `references/kotlin-junk.yaml`. `glob.cjs`: globs, compiled
  once per process. `mutmut-bridge.cjs`: the mutmut config and result bridge per
  mutmut version (2, 3.0 to 3.5, 3.6+). `errors.cjs`: `agentCause` and
  `gateAdvice` (ADR-0002, ADR-0005, ADR-0012). `dotnet.cjs`: the `.csproj` of a
  file, the Stryker.NET test filter, the per-project lock list, the test-project
  check and the scoped scratch copy (ADR-0001). `runners.cjs`: the mutation tools
  (the runners, `command`, `tool`, `TOOLS`, `jars`); `command` runs each tool in
  its own process group, kills it at its deadline and exits 128+signo on a
  signal. `install.cjs`: `hookConfig`, `install`, `configFile`, `installStamp`,
  `agents` (ADR-0013, ADR-0017, ADR-0021). `harness.cjs`: `pick`, `shell`, `base`
  and the profiles except Copilot (ADR-0022). `doctor.cjs`: `render`, `progress`,
  `harnessChecks`, `copilotChecks`. `copilot.cjs`: the Copilot profile; `origin`,
  `normalize`, `link`, `session`, `top`, `agentStop`, `stop`, `clamp`,
  `watchdog`, `queue`, `drain`, `probe` (ADR-0018 to ADR-0021); loaded only for
  `--harness copilot` hook calls, session commands in the Copilot root agent
  shell, an inherited SessionStart without a native hook file, `doctor` and
  `install`. `prune.cjs`: the cache prune that the internal `prune` command runs
  (ADR-0024). `install.cjs`, `doctor.cjs`, `prune.cjs`, `copilot.cjs` and
  `harness.cjs` are not hashed into `fingerprint`; every other helper affects
  results and is in its list. Add new ones there.
- `references/` ships with the skill:
  - `jars.json` has SHA-256-pinned PIT jars.
  - `versions.json` mirrors `test/harness-versions.json` for `doctor`.
  - `result-schema.json` defines the result format.
  - `survivor-playbook.md` is written for agents.
- Each runner fixture `test/fixtures/<name>/` has an `expected.json` with the
  test path, weak and strong score ranges, and required survivor methods. Its
  `variants/<Stem>.weak|strong.<ext>` files are swapped in over the test. The
  integration test copies the fixture to a scratch repo and asserts that build
  files are unchanged.
- `test/scratch.mjs` makes the scratch repo for the integration, driver,
  clipped and performance scripts: `copyRepo` (the live eval copy), the variant
  swap, a temp cache root whose `jars/` and `tools/` link to the real cache
  root, one CLI call, and `scrubEnv`, which removes the inherited harness,
  `MUTAGATE_*` and token vars. `test/installer.mjs` and the eval `agentEnv` use
  `scrubEnv` too; `test/corpus/generate.mjs` uses `copyRepo`.
- `test/eval/` is the live eval suite, not part of the skill package. Spec:
  `docs/eval_suite_spec.md` (Implementation Decisions, Run lifecycle); the run
  dir is the seam between drivers, checker and tests. `run.mjs` (`parseArgs`,
  `planSweep`, `aggregate` are pure exports), `harnesses.mjs` (one driver per
  harness; `read` is the transcript reader, canned transcripts in
  `transcripts/<harness>/`), `checks.mjs` (`result.json`, `anomalies.json`,
  `report.md`, evidence records), `tasks/<lang>/` and `tasks/greenfield/`,
  `TRIAGE.md` (the prompt for an agent reading a sweep dir).

## Invariants enforced by tests

- Never edit `scripts/mutagate-hook.cjs` by hand. Edit `mutagate.mjs`, then run
  `npm run generate:runtime`; `test/review.test.mjs` asserts byte equality. The
  generator converts ESM to CJS with regexes and blanks comment-only lines (line numbers stay aligned), so `mutagate.mjs` can use only
  top-level single-line `import x from '...'` statements and
  `export function`/`export const`. Any other module syntax makes the generator
  throw.
- Every `scripts/*.cjs` that affects results is in the `fingerprint` helper list;
  helpers that do not (`install.cjs`, `doctor.cjs`, `prune.cjs`, `copilot.cjs`, `harness.cjs`) are listed as exceptions in
  `test/protocol.test.mjs`.
- `scripts/hooks.json` is generated from `hookConfig('codex')`. Regenerate it
  after changing hook wiring.
- `scripts/mutagate.mjs` must stay under 1,400 lines
  (`test/protocol.test.mjs`). The dense style is intentional. Put substantial
  new logic in a lazily required `.cjs` helper.
- The `## Architecture` section of this file stays under 1,100 words
  (`test/protocol.test.mjs`): a code map with ADR pointers, no ADR text.
- The packaged skill (`SKILL.md`, `README.md`, `LICENSE`, `scripts/`,
  `references/`) must stay under 350 KB.
- Every ✅ in the README harness × language matrix needs passing `natural`
  and `forced` records in `test/evidence/live/` (`test/eval.test.mjs`).
- Hooks fail open: exceptions and malformed payloads exit 0. Hook exit 2 is only
  for deliberate blocks and Claude async survivor delivery; a native Copilot hook
  call exits 0 always. CLI `run --sync` and
  `check` exit 0 on pass (including final unscored with no mutants to test),
  1 when below threshold or otherwise unscored, 2 on usage errors,
  3 on error results and infrastructure errors, and 128+signo after a signal
  once a tool was started. Usage errors (errors with
  `usage: true`) exit 2 and are not traced as errors, except under `hook` (traced, exit 0);
  `--help`/`-h` exits 0.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for keyboardsamurai/mutagate (`gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.
