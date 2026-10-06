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
npm run test:performance                          # hook p95 must be <= 80 ms (MUTAGATE_PERF_COUNT sets samples)
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

- `scripts/mutagate.mjs` holds the entire engine and exports its functions, which
  tests import directly:
  - `main` handles CLI dispatch and `handleHook` handles hook events.
  - `configFor` merges config in this order: flags, env, project, user, `DEFAULTS`.
  - `resolveTargets` maps a test file to the production target it covers, and
    `fingerprint` invalidates stale results.
  - Each language has a runner: `pit` (Java and Kotlin), `stryker`, `python`,
    `goRunner`, and `dotnetRunner`.
  - `normalize` converts runner output into the shared result shape, and
    `report` turns that result into survivor text.
  - `gate`, `install`, and `doctor` implement the matching commands.
- Hook path: a portable project install (skill inside the Git top level, not
  Windows) makes the harness run the `scripts/hook` wrapper through a
  Git-top-level command (ADR-0013); otherwise the command is the absolute Node
  and `mutagate-hook.cjs`. `scripts/hook` is a sh wrapper that picks Node from `MUTAGATE_NODE`, then
  `scripts/.node-path` (machine-local, untracked through `scripts/.gitignore`),
  then PATH. The wrapper runs `mutagate-hook.cjs hook <Event>`, which reads the
  JSON payload on stdin. Under Node < 22 hooks exit 0 and SessionStart says so.
  PostToolUse on a test file registers targets. `schedule` then spawns a detached
  `worker` process that calls `runTarget` while holding a per-target lock.
  Stop, SubagentStop, and TaskCompleted call `gate`, which re-runs an `error`
  result once (`attempts`) and blocks once on an `agent_caused` one. Session
  state is JSON under `cacheRoot()`, written through `updateState` with a lock
  and atomic writes.
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
  keep hook latency low. `inputs.cjs` scopes project inputs and computes digests
  for fingerprints. `kotlin-source.cjs` provides the source-aware part of the
  Kotlin Tier B filter, and `references/kotlin-junk.yaml` holds its pattern
  rules. `glob.cjs` does glob matching. `mutmut-bridge.cjs` writes the mutmut
  config and result bridge per mutmut version (2, 3.0–3.5, 3.6+). `errors.cjs`
  (`agentCause`) finds the line that makes an error agent-caused (a failing
  command naming any session test, a glob-matched test or edited production file,
  or a runner's red-baseline message; Python scoped-copy-only failures fail open).
  `dotnet.cjs` finds a file's `.csproj` and builds the Stryker.NET test filter,
  the per-project lock list, the test-project check and the persistent scoped
  scratch copy. `install.cjs` holds `hookConfig` and `install`; it is not on the
  hook path and not hashed into `fingerprint`. `doctor.cjs` renders the doctor
  text, writes `checking <name>…` progress to stderr and adds a WARN check when an
  installed harness differs from its pin; it is lazy, not on the hook path and not
  hashed into `fingerprint`. Helpers that affect results are hashed into `fingerprint`; add new ones to its list.
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
  and 3 on error results and infrastructure errors. Usage errors (errors with
  `usage: true`) exit 2 and are not traced as errors, except under `hook` (traced, exit 0);
  `--help`/`-h` exits 0.
