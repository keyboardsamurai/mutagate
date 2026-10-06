# Validation status

Existing local evidence (Linux ARM64, JDK 21; details in `test/validation.json`):

- 61 deterministic tests and 11 integration checks pass, covering the original nine runner fixtures, gate/round-cap/waiver behavior at the executable boundary for all four harnesses, and the doctor smoke run.
- Hook latency passes: 76.68 ms p95 over 1,000 isolated samples against the 80 ms budget, measured on the installed hook entry point.
- Live Codex 0.154.0 passed Stop-continuation and async feedback delivery with a real model (existing ChatGPT login) through the retired `test/live.mjs`; transcripts and hashes in `test/evidence/`.
- OpenCode 1.18.30 plugin discovery verified against the actual binary; skills-installer E2E passes for all four agents; Kotlin corpus reproduces from pinned toolchain.

Go/C# additions bring the runner fixture count to eleven. All 82 deterministic tests pass on macOS with Node 22 and the stock, unresolved TMPDIR; hook latency is 26.89 ms p95 over 100 samples. The Go fixture now puts the package below the module root to exercise nested report paths. On that machine, weak/strong scores are 0/1 for both new fixtures through ESM and generated CommonJS, with sibling strong tests present. Pins: Go 1.26, gomutants 0.6.1, gremlins 0.6.0, .NET SDK 10, Stryker.NET 5.0.0, xUnit 2.9.3, Microsoft.NET.Test.Sdk 17.14.1, xunit.runner.visualstudio 3.1.5. Toolchain spike details are in `docs/go_csharp_runners.md`.

Live eval suite (macOS, `test/eval/`, spec `docs/eval_suite_spec.md`): Claude Code 2.1.270 (`claude-sonnet-5`), Codex 0.154.0 (`gpt-5.6-sol`), OpenCode 1.18.30 (DeepSeek V4.1 Flash via OpenRouter) and Pi 0.73.1 (DeepSeek V4 Flash). The first full sweep (M5, `20260914-133532-8be2`, 2026-09-14: 96 runs, 48 cells, 35 passed, 13 failed) passed 16 of 24 harness × language pairs. After its fixes, the second (M6, 2026-09-15: `20260914-222213-610b` plus the Claude Code re-run `20260915-015123-44c9`; 96 runs, 88 passed, 8 failed; 48 cells, 46 passed, 2 failed) passes 23 of 24 pairs in both `natural` and `forced` (`forced` with Stop block → repair → allow); see the README matrix. The greenfield task, where the agent builds the app from an empty repo (`--task greenfield --repeat 1`, `20260915-030858-218f`), passed 29 of 48 cells (Claude Code 7, Codex 10, OpenCode 8, Pi 4 of 12): 8 failures are mutagate bugs, mostly a finished `unscored` result (no mutants, or every mutant errored) reported as "results pending"; 5 are the model's broken setup (no `npm install` or `uv sync`, a project that does not compile), which fails open by design; 3 are eval-suite bugs; 3 hit the deadline. Every task's targets are first validated without a model (`MUTAGATE_FIXTURES=eval-<lang> npm run test:integration`). Records are in `test/evidence/live/`; issues found are triaged with `test/eval/TRIAGE.md`.

M7 (2026-09-15–16), after the M6 fix pass (`test/review-fixes.md`): small sweep `20260915-165619-cef8` passed 91/96 runs and 47/48 cells; Claude, Codex and OpenCode each passed 24/24 runs, Pi 19/24. At that stage, Pi C# natural was the only failing small cell (23/24 validated pairs). Pi C# forced later passed 2/2 (`20260916-134059-7e96`); a natural rerun (`20260916-143522-7602`) failed 0/2 on the model's omitted `Program` target, so Pi × C# was marked ⏳, not ❌. The C# candidate-hint fix then passed 1/2 natural repeats (`20260916-155402-b5c2`): run 1 explicitly selected Program and scored 1.00; run 2 still omitted it. With both scenarios evidenced, the README now has 24/24 validated pairs; this does not imply every repeat passed. Greenfield `20260915-202750-ef7f` passed 34/48 runs: Claude 8/12, Codex 10/12, OpenCode 9/12, Pi 7/12. These are original checker verdicts, including diagnosed false failures; they have not been relabelled after triage. One passing OpenCode TypeScript greenfield run has a red ordinary test-command warning. See `test/eval/TRIAGE.md`, "Found by M7", for engine and checker findings, upstream limitations and deadline/model failures. An earlier small sweep was superseded after concurrent README growth crossed the package-size limit during setup; all eight runs that launched passed, and the remaining 88 never launched.

Still open before v1: remaining M7 findings (`test/eval/TRIAGE.md`), Ubuntu/macOS/Windows CI evidence, broader Kotlin compiler coverage, and licensed Tier A validation.

```sh
npm test                    # deterministic suites
npm run test:integration    # real runners (set MUTAGATE_FIXTURES to select)
npm run test:driver         # scripted gate E2E, all four harness envelopes
npm run test:performance    # hook latency budget
npm run eval -- --harness claude --lang java --scenario forced   # live agent runs (credentials in .env; all flags optional)
npm run eval -- --report test/.cache/eval/<sweepId>   # re-render a sweep's report.md, no agent runs
```

## Architecture notes

The maintained implementation is `scripts/mutagate.mjs` (core, under 1,400 lines) plus small CommonJS helpers for input scoping, Kotlin source analysis, globs, the mutmut version bridge, agent-caused error classification and Stryker.NET projects. Installed hooks run `scripts/mutagate-hook.cjs`, a CommonJS build of the core generated by `node test/generate-hook-runtime.mjs` to avoid ESM startup overhead. Regenerate it after core changes; tests enforce generation equality and protocol parity. `scripts/hooks.json` is likewise generated (`node test/generate-hooks.mjs --write`) with a drift test. Everything runs on Node built-ins; the exported skill package stays under 300 KB.

Deliberate deviations from the PRD, with rationale in `test/review-fixes.md`: source-aware Kotlin filtering instead of blanket method-name exclusions; PIT XML parsing instead of CSV; async `run` acknowledges scheduling instead of printing a report; survivor IDs carry extra identity to prevent same-line collisions; OpenCode uses the plural `.opencode/plugins/` directory (verified against the binary); Claude `if` filters are unnecessary because the waiver check fast-paths in the CLI; agent-caused errors block Stop once instead of always allowing (FR-5.2); the CLI session id chain adds `MUTAGATE_HOOK_SESSION` and harness session ids ahead of `MUTAGATE_SESSION`.

Harness and tool pins: `test/harness-versions.json` (mirrored in `references/versions.json` for `doctor`). Pins are selected versions, not blanket claims of live validation. `MUTAGATE_RECORD=1` records hook payloads for drift analysis; `npm run test:drift` checks them against `test/payloads/<harness>/schema-keys.json`.

## Kotlin filter corpus

The adversarial `test/corpus/` contains 121 real PIT mutants. Tier B measured precision 1.0, recall 0.61, and zero real mutants dropped. Report missed junk: minimal source, compiler/PIT versions, `status --json` mutant.

## Engine context

gomutants also ships a Claude Code plugin that proposes Go tests for survivors; mutagate supplies the cross-language, cross-harness gate over the same engine.

## Platforms

| Platform | Status |
|---|---|
| Linux | ✅ full suite + Java/Kotlin/Python/TS runners (ARM64, JDK 21) |
| macOS | ✅ deterministic suite + Go/C# runners (Node 22) |
| Windows | 🟡 `scripts\mutagate.cmd`, no CI evidence · ❌ Go and C# unqualified |

Go: verified with a `go 1.22` module under Go 1.26.

## Post-M7 review validation

The listed review fixes pass 269 deterministic tests. Real `java-maven`, `dotnet-xunit`, and `python-uv-src` weak/strong fixtures pass; the Python src fixture also runs through the generated CommonJS runtime. Gate regressions use a controlled clock to cover explicit waits, four sequential targets, and concurrent deletion without minute-long tests. They now also cover the full-budget recovery advice after a clipped run and the pytest no-tests repo probe. The scratch regression interrupts manifest publication and verifies later deletion cleanup. Original M7 verdicts remain unchanged.

`npm run test:clipped` exercised real Stryker.NET through the generated CommonJS runtime: clipped kill, exact advised retry, score 1.00. The quoted trace is in `test/eval/TRIAGE.md`.

C# candidate-hint follow-up: 269 deterministic tests pass; the actual working-tree package (including the new README design) is 249,454 bytes, engine 1,394 lines, and installed-hook p95 27.98 ms over 100 samples. Runtime regeneration is byte-identical. Read-only resolver checks on both prior failed Pi repos and the OpenCode ProgramCreateMatrixTests case now offer Program. The live passing run retains a `prod-changed` warning for extracting Program startup into `CreateWebApplication`; the failed repeat and all historical verdicts are preserved in TRIAGE.

## Property-based prompt experiment

On 2026-10-04, Claude Code 2.1.289 with model `claude-sonnet-5` ran the python task, natural scenario, three times with the baseline prompt (sweep `20261004-153754-ea96`, runs `claude-python-natural-1..3`) and three times with `test/eval/tasks/python/prompt.pbt.md` (sweep `20261004-155257-253d`, runs `claude-python-natural-pbt-1..3`), which adds one sentence asking for Hypothesis `@given` tests alongside example tests. Run dirs are under `test/.cache/eval/<sweepId>/`; the `@given` column counts occurrences in each run's `diff.patch`.

| run | passed | max blocks | mean score | mutants killed by timeout | killed | @given | wall min |
|---|---|---|---|---|---|---|---|
| baseline-1 | yes | 0 | 0.989 | 0 | 206 | 0 | 7.7 |
| baseline-2 | yes | 0 | 0.989 | 0 | 206 | 0 | 10.6 |
| baseline-3 | yes | 0 | 0.989 | 0 | 206 | 0 | 6.9 |
| pbt-1 | yes | 0 | 0.989 | 0 | 206 | 8 | 13.6 |
| pbt-2 | yes | 0 | 0.989 | 0 | 206 | 6 | 12.5 |
| pbt-3 | yes | 0 | 0.997 | 0 | 208 | 9 | 13.8 |

Mean score is over the four targets of each run; every target has a numeric score (no null scores). In the variant diffs `max_examples` appears 2, 6 and 9 times; `@example`, `derandomize` and `deadline=` never appear in any diff. The only `timeout` text in `runner-logs/*.log` is the bridge's status map (`'timeout':'TIMED_OUT'`), not a mutmut timeout line.

- Uptake: taken. `@given` appears in 3 of 3 variant runs (8, 6, 9) and in 0 of 3 baseline runs.
- Timeout signal: false. No run, baseline or variant, has mutants killed by timeout.
- Mean score: baseline 0.989, pbt 0.991. Mean max-blocks: baseline 0, pbt 0.
- Recommendation: no engine change.

All six runs carry one `recovered-error` warning in `anomalies.json` (`mutmut failed (1): failed to collect stats`, superseded by a later scored result for the same target): 4, 5 and 10 such errors in the baseline runs, 8, 21 and 2 in the variant runs. No run crashed and no target is pending. Variant runs took about 1.6x the wall time of baseline runs.
