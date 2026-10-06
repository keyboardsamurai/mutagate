# Ticket: one red test file errors every import-linked target

Status: fixed 2026-10-05 (candidates 1-3). Red-baseline errors name the pytest `FAILED <path>::<test>`
line, the previous runner log is kept as `<key>.prev.log`, and `report.md` lists recovered errors per run.
Candidate 4 (skip re-runs) not done. The live python sweep acceptance item is not run yet.
Found while reading the python eval sweeps `20261004-153754-ea96`
(baseline) and `20261004-155257-253d` (`--variant pbt`), see `docs/validation.md`
"Property-based prompt experiment". Not caused by property tests: all six runs show it.

## Symptom

Every python eval run carries a `recovered-error` warning: 4, 5, 10 (baseline) and 8, 21, 2
(variant) `Result` events with `decision: error` and the text
`mutmut failed (1): failed to collect stats. runner returned 1`, later superseded by a scored
result for the same target. No run blocked, no run crashed, final status passes 4/4 targets.

Worst run: `test/.cache/eval/20261004-155257-253d/claude-python-natural-pbt-2/trace.jsonl`,
21 errors on `matrix/service.py`, `matrix/api.py`, `matrix/main.py` between 15:55:02 and
15:57:23, one burst after every test write, about 1 s each.

## Root cause (established from the run dirs and the code)

1. The resolver adds a production module to a test file's targets when the test imports it
   (`scripts/mutagate.mjs:204`). `tests/test_api.py` imports `matrix.service`, so
   `matrix/service.py` lists it. In the worst run `status.json` shows service.py with five test
   files: `test_service.py, test_api.py, test_page.py, test_main.py, test_matrix_api.py`.
   Baseline run natural-3 shows four.
2. The python runner configures mutmut with `tests_dir = [all of t.tests]` and
   `pytest_add_cli_args = ['-x', '-q', ...t.tests]` (`scripts/mutmut-bridge.cjs:17`). mutmut 3
   runs those files once to collect stats and exits 1 when any test fails
   (`mutmut/__main__.py:333`, `failed to collect stats. runner returned 1`).
3. The runner then re-runs `pytest -x -q <t.tests>` in the repo (`scripts/mutagate.mjs:719`).
   It also fails, so the result is the agent-caused `mutmut failed (1): ...` error, not the
   scoped-copy fail-open.
4. The agent was in a legitimate red phase: it had written `test_api.py` against a planted bug
   in `api.py` and fixed `api.py`/`service.py` over the next two minutes (PostToolUse `Edit`
   events on `matrix/api.py` 15:56:03-15:56:29). While `test_api.py` was red, service.py and
   main.py errored too, although their own test files were green.
5. Every write to any test or production file changes the fingerprint of every target that
   lists that file, so each write re-ran all errored targets. Errors are retryable
   (`scripts/mutagate.mjs:894`, ADR-0003), so nothing short-circuits the burst.

Timeline, worst run (W = PostToolUse write, ERR = error Result):

```
15:54:55 W test_api.py        15:55:02 ERR service.py   15:55:03 ERR api.py
15:55:13 W test_page.py       15:55:21 ERR service.py   15:55:21 ERR api.py     (page.py passes 15:55:23)
15:55:33 W test_main.py       15:55:40 ERR service.py   15:55:41 ERR api.py     15:55:44 ERR main.py
15:55:49 Edit matrix/service.py ... 15:56:29 Edit matrix/api.py   (3 ERR after each edit)
15:57:12 Edit test_api.py     15:57:20 api.py passes 0.975; last ERR 15:57:23; none after
```

## Why it matters

- Cost scales with the project: here each failed run is 1 s (61 mutants, 4 tests). On a real
  project it is mutant generation plus a full stats pass over every linked test file, times the
  number of linked targets, after every write during a red phase. Workers compete with the
  agent's own pytest runs.
- The error names mutmut, not the red test. If the red phase lasts until Stop, the gate blocks
  once (ADR-0002) with `mutmut failed (1): failed to collect stats. runner returned 1`; the
  agent is not told which test in which file is red. The pytest short summary
  (`FAILED tests/test_api.py::test_x - AssertionError`) is in `baseline.output` at
  `scripts/mutagate.mjs:719` and is thrown away.
- Diagnosis after the fact is impossible from a run dir. The runner log is one file per target,
  truncated at the start of each run (`scripts/mutagate.mjs:839-841`), so the collected
  `runner-logs/*.log` hold only the last, successful run.
- The eval checker's `recovered-error` warning (`test/eval/checks.mjs:76`) fires on 6/6 python
  runs and carries no count threshold, so it no longer signals anything.

## Candidate changes, ranked by value per byte

Constraints: `scripts/mutagate.mjs` < 1,400 lines, package < 250,000 bytes (now 249,842;
`mutagate.mjs` ships twice, mjs + generated cjs), never hand-edit `scripts/mutagate-hook.cjs`,
`npm run generate:runtime` after engine edits, substantial logic goes in a lazily required
`.cjs`. Do not change scoring, retry-once (ADR-0003), agent-caused block-once (ADR-0002) or the
import-based python resolution without an ADR.

1. Name the red test in the error. Append the `FAILED ...` lines (first two, trimmed) from the
   baseline pytest output to the thrown error at `scripts/mutagate.mjs:722`. One line, biggest
   win for the agent at Stop. Check `agentCause` and `gateAdvice` (`scripts/errors.cjs`) still
   classify it as red baseline (`BASELINE_RED` matches on the first line).
2. Keep the failed run's log. Cheapest: before truncating, rename the previous log to
   `<key>.prev.log` when the previous result was an error; the eval collector copies
   `runner-logs/` as a directory so it comes along. Alternative: skip the truncate when the
   last result for the key was an error and append instead.
3. Checker signal. In `test/eval/checks.mjs` make `recovered-error` carry the count in the
   matrix line and warn only above a threshold (for example > 3 per run), or add the count to
   the per-run `report.md` row so sweeps can be compared.
4. Only if 1-3 are not enough: skip the re-run of a red-baseline error target when the write
   that triggered it touched none of the target's own tests nor its file. This touches
   fingerprinting and ADR-0003; write an ADR first and measure with
   `npm run eval -- --harness claude --lang python --scenario natural --repeat 3`.

Not recommended: dropping import-linked tests from `t.tests` (changes what counts as
coverage, ADR-0012), or treating stats failure as fail-open (hides a red suite at Stop).

## Reproduce without a model (expected, not yet run)

```sh
cp -r test/eval/tasks/python /tmp/redcascade && cd /tmp/redcascade && uv sync && git init -q && git add -A && git commit -qm init
mkdir -p tests && cp reference/tests/*.py tests/   # test_api.py imports matrix.service, so service.py lists it
printf '\nfrom matrix import service\ndef test_red():\n    assert service and False\n' >> tests/test_api.py
node <mutagate>/scripts/mutagate.mjs run tests/test_api.py --sync; node <mutagate>/scripts/mutagate.mjs status --json
```

Before the fix: `matrix/api.py` and `matrix/service.py` both errored with
`mutmut failed (1): failed to collect stats. runner returned 1`; neither message named
`test_red`; `~/.cache/mutagate/repos/<hash>/logs/<key>.log` was overwritten by the next run.
Verified 2026-10-05 after the fix: both messages end in `; FAILED tests/test_api.py::test_red - assert (service and False)`,
and after removing `test_red` the green run leaves the failed run in `<key>.prev.log`.

## Acceptance

- A red test in `test_api.py` produces an error on every target that lists it (unchanged), and
  the error text names the failing test id(s).
- After a failed run followed by a passing run of the same target, the failed run's mutmut and
  pytest output is still on disk and lands in the eval run dir.
- `npm test` green, `npm run generate:runtime` applied, package < 250,000 bytes,
  `MUTAGATE_FIXTURES=eval-python npm run test:integration` green.
- One python eval sweep (3 runs) shows the `recovered-error` count per run in `report.md`.

## Pointers

- Resolver import parsing: `scripts/mutagate.mjs:204`
- Python runner, stats failure branch and baseline re-run: `scripts/mutagate.mjs:715-722`
- Log naming and truncation: `scripts/mutagate.mjs:839-841`
- Retryable errors: `scripts/mutagate.mjs:894`, ADR-0003, ADR-0002, ADR-0012
- mutmut config seam: `scripts/mutmut-bridge.cjs:9-17`
- Red-baseline patterns: `scripts/errors.cjs:7-11`
- Eval checker warning: `test/eval/checks.mjs:70-76`
- Run dirs: `test/.cache/eval/20261004-155257-253d/claude-python-natural-pbt-2/` (worst),
  `test/.cache/eval/20261004-153754-ea96/claude-python-natural-3/` (baseline, 10 errors)
