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
`README.md`.

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
npm run test:driver                               # scripted gate E2E for all four harness envelopes
npm run test:performance                          # hook p95 <= 80 ms; 15k-file Git repo: SessionStart, test edit <= 300 ms (MUTAGATE_PERF_COUNT sets samples, max 100 there)
npm run test:installer
npm run generate:runtime                          # regenerate scripts/mutagate-hook.cjs
npm run generate:hooks                            # regenerate scripts/hooks.json
node test/package.mjs /tmp/new-dir                # build skill package (fails at >= 300 KB)
npm run eval -- --harness claude --lang java --scenario forced   # live agent runs (Node 22, credentials)
```

The repo has no linter or formatter. Other scripts: `test:opencode-discovery`
needs `MUTAGATE_OPENCODE_BIN`. `eval` (alias `test:live`) needs the
pinned harness, the language toolchains, and `CLAUDE_CODE_OAUTH_TOKEN` or
`OPENROUTER_API_KEY` in the repo-root `.env` (Codex uses `~/.codex`); flags
`--harness --lang --scenario --task --repeat --jobs --model`, all optional;
`--repeat` below 2 writes no evidence record (ADR-0011);
`--report <sweepDir>` only re-renders that sweep's `report.md`.
`test:drift` needs payloads recorded earlier with `MUTAGATE_RECORD=1`, which
eval runs set. Integration toolchains follow CI (`.github/workflows/ci.yml`):
JDK 21 with Gradle 8.14.3, Go 1.26 with gomutants, .NET 10 with dotnet-stryker
5.0.0, and uv. Python fixtures use venvs under `test/.cache/py2` and
`test/.cache/py3`, and TS fixtures need `npm ci` in their fixture directory.

## Architecture

- `scripts/mutagate.mjs` holds the engine except the runners and exports its
  functions, which tests import directly:
  - `main` handles CLI dispatch and `handleHook` handles hook events.
  - `configFor` merges config in this order: flags, env, project, user, `DEFAULTS`.
  - `resolveTargets` maps a test file to the production target it covers, and
    `fingerprint` invalidates stale results.
  - Each language has a runner in `scripts/runners.cjs`: `pit` (Java and
    Kotlin), `stryker`, `python`, `goRunner`, and `dotnetRunner`. The
    `runners()` accessor loads it lazily and injects the engine helpers it
    needs; tests reach runner symbols through `m.runners().x`.
  - `normalize` converts runner output into the shared result shape, and
    `report` turns that result into survivor text.
  - `gate`, `install`, and `doctor` implement the matching commands.
- Hook path: on POSIX the harness runs the `scripts/hook` wrapper, through a
  Git-top-level command for a portable project install (skill inside the Git
  top level) and at its absolute path otherwise (ADR-0013); on Windows the
  command is the absolute Node and `mutagate-hook.cjs`. `scripts/hook` is a sh wrapper that picks Node from `MUTAGATE_NODE`, then
  `scripts/.node-path` (machine-local, untracked through `scripts/.gitignore`),
  then PATH, and exits 0 without Node. The wrapper runs
  `mutagate-hook.cjs hook <Event>`, which reads the JSON payload on stdin. On
  POSIX the Claude SessionStart, PreToolUse and sync PostToolUse commands end
  in `|| true`, because Copilot also runs them (ADR-0013). Under Node < 22 hooks exit 0 and SessionStart says so.
  `install` stamps its `VERSION` into the SessionStart command
  (`--installed <VERSION>`) and replaces `__MUTAGATE_VERSION__` in the
  adapters, which send it as payload `installed`; a missing or other stamp adds
  a rerun-install notice to SessionStart and a doctor WARN (`installed`,
  ADR-0017). `scripts/hooks.json` carries `MUTAGATE_VERSION` instead.
  PostToolUse on a test file registers targets. `schedule` then spawns a detached
  `worker` process that calls `runTarget` while holding a per-target lock.
  The async `PostToolUse --mutate` hook reruns stale targets itself after 6 s
  quiet and ends by 850 s after its start (hook timeout 900 s): like `gate`, it
  passes `deadline` and a clipped `budgetSec` to `runTarget` and starts a
  target only when `gateAdvice` says its `lastRunMs` fits.
  Stop, SubagentStop, and TaskCompleted call `gate`, which re-runs an `error`
  result once (`attempts`) and blocks once on an `agent_caused` one. An
  exception in one target skips only that target, with a warning (`check`
  exit 3). Session state is JSON under `cacheRoot()`, written through
  `updateState` with a lock and atomic writes; compute `fingerprint` before
  `updateState`, as other hooks wait at most 5 s for the lock. `loadResult`
  keeps normalized results per process while the result file, the fingerprint
  and `waivers.json` are unchanged. Writes do not fsync, so state,
  result and classpath files are read through `cacheJson`: torn JSON reads as
  missing (a result reruns, state starts blank with a stderr note). Every lock
  (state, target, tool install, .NET project, JVM compile) is a `wx` file from `lock` with
  the pid and a random token. The holder touches it
  every 10 s; `abandoned` (also used by `inFlight`) is true when the mtime is
  over 60 s old or the pid is dead. One waiter takes it over under
  `<lock>.break`, a live pid's lock only after that waiter saw its mtime unchanged
  for 15 s of monotonic time, or half its wait budget if shorter (2.5 s for the
  state lock; timers stop during system sleep); release deletes the file only
  while it holds the holder's token.
- Sessions: `context` takes the id from payload `agent_id`, then `session_id`,
  then env `MUTAGATE_HOOK_SESSION` (set by `schedule` for workers, by the OpenCode
  `shell.env` hook and by Pi at `session_start`), `CODEX_THREAD_ID`,
  `CLAUDE_CODE_SESSION_ID`, `MUTAGATE_SESSION` (bare CLI use only), then a
  `ppid-…` fallback, so the agent's CLI calls join the hook session.
- Harnesses: Claude and Codex use native hook config generated by `hookConfig`
  and merged in by `install`. OpenCode (`scripts/adapters/opencode.js`) and Pi
  (`scripts/adapters/pi.ts`) are thin translators that forward only file-writing
  tools, spawning the CLI with a Claude-shaped payload containing a `harness` field. `install` replaces
  `__MUTAGATE_CLI__` in these adapters with the runtime path, relative to the
  adapter file when portable, else absolute; adapters pick Node like `scripts/hook`.
- `mutagate.mjs` loads its CommonJS helpers lazily through `runtimeRequire` to
  keep hook latency low. `inputs.cjs` lists repo files (`files`, for detect and
  resolution: the Git file list in a Git repo, else a walk, with the same name
  rules; ADR-0016), scopes project inputs and computes digests
  for fingerprints; its `dirEntries` reads a directory for both repo walks
  (`files` and `inputFiles`) and skips unreadable directories, venvs and noise
  names; its `read` and `fileDigest` treat a file it cannot read as empty. `kotlin-source.cjs` provides the source-aware part of the
  Kotlin Tier B filter, and `references/kotlin-junk.yaml` holds its pattern
  rules. `glob.cjs` compiles globs, cached per process. `mutmut-bridge.cjs` writes the mutmut
  config and result bridge per mutmut version (2, 3.0–3.5, 3.6+). `errors.cjs`
  (`agentCause`) finds the line that makes an error agent-caused (a failing
  command naming any session test, a glob-matched test or edited production file,
  or a runner's red-baseline message; Python scoped-copy-only failures fail open).
  `dotnet.cjs` finds a file's `.csproj` and builds the Stryker.NET test filter,
  the per-project lock list, the test-project check and the persistent scoped
  scratch copy. `runners.cjs` drives the mutation tools (runners, `command`,
  `tool`, `TOOLS`, `jars`) and returns raw mutants. `command` starts each tool in
  its own process group (Windows: a `taskkill /T` tree) and kills it at its deadline; on the first spawn it
  installs handlers that kill all live groups on `exit` and exit 128+signo on
  SIGINT, SIGTERM and SIGHUP. `install.cjs` holds `hookConfig` and `install`; it is not on the
  hook path and not hashed into `fingerprint`. `doctor.cjs` renders the doctor
  text, writes `checking <name>…` progress to stderr and adds a WARN check when an
  installed harness differs from its pin; it is lazy, not on the hook path and not
  hashed into `fingerprint`. `prune.cjs` is the cache prune: `register`, and
  SessionStart in an existing data dir, write a `repo-path` marker into it, and `schedulePrune`
  spawns the internal `prune` command detached when the mtime of
  `repos/.pruned` is a day old. It deletes `reports/*` after 24 h, session state
  after 14 days and its results with it, and data dirs whose marked repo path is gone
  (unmarked: 14 days idle), rotates `trace.jsonl` at 10 MB, skips a data dir with
  a held lock and never touches `jars/`, `tools/` or `recorded/`. It is not hashed
  into `fingerprint`. Helpers that affect results are hashed into `fingerprint`; add new ones to its list.
- `references/` ships with the skill:
  - `jars.json` has SHA-256-pinned PIT jars.
  - `versions.json` mirrors `test/harness-versions.json` for `doctor`.
  - `result-schema.json` defines the result format.
  - `survivor-playbook.md` is written for agents.
- Each runner fixture `test/fixtures/<name>/` has an `expected.json` with the
  test path, weak and strong score ranges, and required survivor methods. Its
  `variants/<Stem>.weak|strong.<ext>` files are swapped in over the test. The
  integration test copies the fixture to a temp dir and asserts that build files
  are unchanged.
- `test/eval/` is the live eval suite, not part of the skill package:
  - `run.mjs` plans the sweep (`parseArgs`, `planSweep`, `aggregate` are pure
    exports) and runs each cell: copy `tasks/<lang>` to a repo at
    `~/.cache/mutagate-eval/<sweepId>/<run>-<random16hex>` (outside this tree,
    so the agent does not load this `AGENTS.md`), install the skill, launch the agent, then
    collect into `test/.cache/eval/<sweepId>/<run>/` (`repo/` links the repo).
    That run dir is the seam: drivers write it, the checker reads it, and tests
    use canned run dirs.
  - `harnesses.mjs` has one self-contained driver per harness: preflight
    against the pins, isolated config env, launch and done-detection.
  - `checks.mjs` turns a run dir into `result.json` (hard checks) and
    `anomalies.json` (warnings with file:line evidence), renders the sweep
    `report.md`, scrubs secrets, and builds `test/evidence/live/` records.
  - `tasks/<lang>/` hold production code, `expected.json` (targets, traps,
    globs, test command), `prompt.natural.md`, and `reference/` tests that
    `test/integration/eval-tasks.test.mjs` validates without a model
    (`MUTAGATE_FIXTURES=eval-<lang>`). `tasks/greenfield/` holds the opt-in
    from-scratch prompts.
  - `TRIAGE.md` is the prompt for an agent reading a sweep dir.

## Invariants enforced by tests

- Never edit `scripts/mutagate-hook.cjs` by hand. Edit `mutagate.mjs`, then run
  `npm run generate:runtime`; `test/review.test.mjs` asserts byte equality. The
  generator converts ESM to CJS with regexes, so `mutagate.mjs` can use only
  top-level single-line `import x from '...'` statements and
  `export function`/`export const`. Any other module syntax makes the generator
  throw.
- Every `scripts/*.cjs` that affects results is in the `fingerprint` helper list;
  helpers that do not (`install.cjs`, `doctor.cjs`, `prune.cjs`) are listed as exceptions in
  `test/protocol.test.mjs`.
- `scripts/hooks.json` is generated from `hookConfig('codex')`. Regenerate it
  after changing hook wiring.
- `scripts/mutagate.mjs` must stay under 1,400 lines
  (`test/protocol.test.mjs`). The dense style is intentional. Put substantial
  new logic in a lazily required `.cjs` helper.
- The packaged skill (`SKILL.md`, `README.md`, `LICENSE`, `scripts/`,
  `references/`) must stay under 300 KB.
- Every ✅ in the README harness × language matrix needs passing `natural`
  and `forced` records in `test/evidence/live/` (`test/eval.test.mjs`).
- Hooks fail open: exceptions and malformed payloads exit 0. Hook exit 2 is only
  for deliberate blocks and Claude async survivor delivery. CLI `run --sync` and
  `check` exit 0 on pass (including final unscored with no mutants to test),
  1 when below threshold or otherwise unscored, 2 on usage errors,
  3 on error results and infrastructure errors, and 128+signo after a signal
  once a tool was started. Usage errors (errors with
  `usage: true`) exit 2 and are not traced as errors, except under `hook` (traced, exit 0);
  `--help`/`-h` exits 0.
