# Evidence records

These files are the proof behind the README harness × language matrix. Each is a real model-driven qualification record: a pinned harness and model did a task in a throwaway repo with mutagate installed, and a checker judged the run. The records contain normalized hook traces, final model responses and checks, with hashes of the full local transcripts. Secret values are scrubbed before anything is written; authentication tokens are never copied.

## `live/`: eval suite records

`live/<harness>-<lang>-<scenario>.json` is written by the live eval suite (`test/eval/`, spec `docs/eval_suite_spec.md`) for every passing `small`-task cell and overwritten by the next passing sweep of that cell. Fields: `harness`, `version` (the pinned harness version), `model`, `mutagate` (the engine `VERSION`, records written from 0.9.0 on), `package` (sha256 of the installed skill package tree, from 0.9.0 on), `lang`, `task`, `scenario` (`natural` or `forced`), `passed` (true if any attempt passed; [ADR-0011](../../docs/adr/0011-live-eval-local-two-runs-per-cell.md): each cell runs twice and passes when either run passes), `checked_at`, and `attempts[]` with `n`, `ok`, `checks` (hard check id → passed), `exit` (harness exit code), `finalCheck` (`check` exit code), `duration_ms`, `finalResponse`, `transcript_sha256` (of the run's `stdout.log`) and the scrubbed `trace` with the work repo path replaced by `<repo>`.

A ✅ in the README harness × language matrix needs both the `natural` and the `forced` record for that pair with `passed: true`; `test/eval.test.mjs` enforces it, and checks that every record holds both runs. An attempt with `ok: false` is a failed repeat; the README names the cells that have one. Records from before 0.9.0 have no `mutagate` or `package` field. Before 1.0 the test will also fail a release whose ✅ cells have a stale package digest or harness pin (`docs/releasing.md`).

The records are public on purpose. Transcripts are not committed, only their hashes; home paths and the work repo path are replaced (`~`, `<repo>`).

Reproduce a cell with the pinned harness on PATH (`test/harness-versions.json`), Node 22, the language toolchain, and credentials: `CLAUDE_CODE_OAUTH_TOKEN` (Claude) and `OPENROUTER_API_KEY` (OpenCode, Pi) in the repo-root `.env`, or the existing `~/.codex` login (Codex):

```sh
npm run eval -- --harness opencode --lang java                 # both scenarios, 2 runs each
npm run eval -- --harness claude --lang java --scenario forced --repeat 1
```

The sweep directory `test/.cache/eval/<sweepId>/` keeps every run (transcript, trace, status, check, diff, repo) and a `report.md`; `test/eval/TRIAGE.md` is the prompt for reading it.

## Codex records from the retired live script

These predate the eval suite. They were produced by `test/live.mjs`, since deleted, against the `java-gradle` fixture with Codex CLI 0.154.0 and its existing ChatGPT login.

- `codex-continuation.json`: the model wrote a weak smoke test, attempted completion, received a native Stop block, repaired the test and completed successfully. Async PostToolUse was disabled in this test configuration to isolate Stop continuation.
- `codex-async.json`: native async PostToolUse delivered actual PIT feedback. A transparent test wrapper appended a random receipt request; the model echoed the receipt and repaired the tests. The final CLI check passed. The wrapper only decorates actual feedback and preserves exit status; it does not create mutants or invoke completion events.

They are single passes, not multi-night qualification, and they do not back a README matrix cell. The eval's `forced` scenario covers the continuation flow; the async flow is covered by the `async-missing` warning and the trace.
