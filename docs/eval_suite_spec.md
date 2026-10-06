# Spec: live language × harness eval suite

Status: spec derived from `eval_suite.md` (agreed 2026-09-14). The plan document
stays as the detailed design reference (exact harness launch flags, research
facts, milestones). This spec is the contract an implementer builds and tests
against. Triage: `ready-for-agent`. Amended 2026-09-14 by
the eval fix pass and 2026-09-15 by the M6 fix pass; amendments are logged
in `../test/review-fixes.md`.

## Problem Statement

mutagate claims to work inside four harnesses (Claude Code, Codex CLI, OpenCode,
Pi) across six languages (Java, Kotlin, Python, TypeScript, Go, C#). Today only
one cell of that matrix has real-model evidence: Codex on Java. Everything else
in the README compatibility table is ⏳ or an unqualified claim.

The maintainer has qualified cells by hand: ten Claude Code sessions on a
Spring Boot task in Java, Kotlin and Go, each one read line by line afterwards.
Those sessions found the bugs that matter (async results never delivered, the
multi-class integration test that resolves to nothing, Go handlers silently
unscored, a 9 s Stop hook) but the process does not scale to 24 cells, does not
repeat, and its findings live in chat transcripts rather than in the repo.

The existing `test:live` script is a CI-shaped one-shot that only knows the
Java Gradle fixture and three narrow scenarios, cannot drive OpenCode or Pi past
their first idle, and throws its repo away, so nothing can be triaged afterwards.

## Solution

A local, hand-triggered eval suite, run as `npm run eval`, that executes a real
agent on a realistic test-writing task for every harness × language × scenario
cell, twice, and records two things per cell:

1. **Compatibility.** Pass or fail from deterministic checks on mutagate's own
   trace, `status --json` and `check --json`: mutagate installed, its hooks
   fired, every expected target got scored, and the gate blocked and then
   released. Never a judgement on model wording.
2. **Bug discovery.** Every run keeps its repo, transcript, trace, runner logs,
   recorded payloads and diff, scrubbed of secrets. A checker extracts
   anomalies into a machine-readable file and a per-sweep report, and a
   checked-in triage prompt lets an agent read a sweep directory and file
   mutagate bugs.

Passing cells write evidence records into the repo. The README gains a hand-
edited harness × language matrix, and a deterministic test refuses a ✅ that
has no evidence record behind it.

## User Stories

1. As a mutagate maintainer, I want to run one command that qualifies every
   harness × language pair, so that the README compatibility matrix is backed
   by evidence instead of by hand-run sessions.
2. As a mutagate maintainer, I want to select a subset of cells with
   `--harness`, `--lang`, `--scenario` and `--task`, so that I can iterate on
   one driver or one task without paying for the full sweep.
3. As a mutagate maintainer, I want every run's repo, transcript, trace, runner
   logs, recorded payloads, status, check output and diff kept on disk, so that
   I or an agent can read them afterwards and file bugs.
4. As a mutagate maintainer, I want each cell run twice by default with
   `--repeat N` to change it, so that a flaky model run does not mark a working
   integration as broken, while both runs still contribute anomalies.
5. As a mutagate maintainer, I want a cell to pass when either of its runs
   passes, so that pass/fail reflects mutagate compatibility, not model
   variance.
6. As a mutagate maintainer, I want a hard 30 minute deadline per run, counted
   from run start and covering setup and the agent, plus a fixed 5 minute
   grace for collecting artifacts after the agent ends, so that a hung
   harness, a hung setup step or an agent stuck in a loop cannot stall the
   sweep and a killed run still leaves artifacts to triage.
7. As a mutagate maintainer, I want no spend cap, so that a run is never cut
   short by a budget guard and mislabelled as a mutagate failure.
8. As a mutagate maintainer, I want the models pinned in a config file and
   overridable with `--model <harness>=<id>`, so that results are comparable
   across sweeps and a model swap is a one-flag experiment.
9. As a mutagate maintainer, I want a missing harness binary, wrong harness
   version, missing credential or missing toolchain to mark a cell
   `skipped (<reason>)` rather than failed, so that a partially set-up host
   still gives a truthful matrix.
10. As a mutagate maintainer, I want the harness version checked against the
    repo's harness pins before a run, so that evidence is never recorded
    against an unpinned harness build.
11. As a mutagate maintainer, I want my subscription token and OpenRouter key
    read from the repo-root `.env` and never written into any artifact, so
    that I can commit evidence and share sweep directories safely.
12. As a mutagate maintainer, I want Codex to use my existing ChatGPT login,
    so that I need no extra API key for that harness.
13. As a mutagate maintainer, I want each run isolated in a fresh harness
    config directory, so that my personal settings, skills, and global
    instructions do not leak into the eval and one run cannot see another's
    state.
14. As a mutagate maintainer, I want mutagate's downloaded tool cache (PIT
    jars, gomutants, Stryker) shared across runs, so that a sweep does not
    re-download toolchains 96 times.
15. As a mutagate maintainer, I want runs executed with a configurable number
    of parallel jobs, so that a 96-run sweep finishes in hours, not days.
16. As a mutagate maintainer, I want a `natural` scenario whose prompt only
    asks for comprehensive unit and integration tests and never mentions
    mutagate, so that I see how the agent behaves when nothing steers it
    toward the tool.
17. As a mutagate maintainer, I want a `forced` scenario whose prompt makes
    the agent write an assertion-free smoke test first and then try to finish,
    so that every cell proves the block → fix → allow path at least once.
18. As a mutagate maintainer, I want the default task to be a small existing
    codebase the agent writes tests for, so that runs are short and the
    interactions with mutagate are the point, not the code generation.
19. As a mutagate maintainer, I want an opt-in `greenfield` task that
    reproduces the springtest plan per language, so that the long-form
    behaviour I saw by hand can be repeated on demand.
20. As a mutagate maintainer, I want the same domain (matrix service, REST
    controller, HTML page handler, entrypoint) in every language, so that a
    difference between cells is a runner or harness difference, not a task
    difference.
21. As a mutagate maintainer, I want every task to contain the seven known
    traps (multi-class integration test name, boundary logic, equivalent-mutant
    bait, low-coverage entrypoint, language idioms, forced weak test,
    staleness via a late production change), so that each sweep re-checks the
    failure modes the hand runs discovered.
22. As a mutagate maintainer, I want each task's expected targets validated by
    a scripted, model-free run before the task is used in a sweep, so that an
    unscored target in a sweep is a mutagate bug and not a task authoring
    error.
23. As a mutagate maintainer, I want a run to fail when the harness was killed
    at the timeout or the driver's done-detection never fired, so that a hang
    is visible as a failure.
24. As a mutagate maintainer, I want a run to fail when the trace has no
    SessionStart with the correct harness label, so that broken hook wiring
    or wrong harness detection is caught first.
25. As a mutagate maintainer, I want a run to fail when a test file in the
    final diff has assertions but no PostToolUse registration in the trace.
    Assertion-free scaffolds warn; missing files still fail.
26. As a mutagate maintainer, I want a run to fail when any expected target
    ends unresolved or unscored in `status --json`, so that the springtest
    "integration test resolves to nothing" and "Go handlers unscored" bugs
    become red rather than invisible.
27. As a mutagate maintainer, I want a run to fail on any internal error or
    infrastructure error in the trace or runner logs that no later scored
    or no-mutants result for the same target supersedes, so that a runner crash that
    mutagate hides behind fail-open is still surfaced, while an error the run
    recovered from (typically the agent's own compile error) is a warning.
28. As a mutagate maintainer, I want a run to fail when the final check is
    below threshold and a below target was not blocked up to the retry cap,
    so that a gate that let a weak test through is treated as a gate bug.
29. As a mutagate maintainer, I want a run to pass when the final check is
    below threshold but `status --json` shows every below target blocked up
    to the per-target retry cap, so that model stubbornness is not counted
    against mutagate.
30. As a mutagate maintainer, I want a `forced` run to fail unless the trace
    shows a Stop block, then a later passing Result, then a Stop allow, in
    that order, so that the continuation path is proven end to end.
31. As a mutagate maintainer, I want production-file edits, waivers proposed or
    applied, manual `run --target` or `--sync` calls, reads of mutagate's own
    source, hooks slower than one second, stale or unresolved messages about
    deleted files, agent claims that `check` does not confirm, a red task test
    command, tiny mutant counts, an async result that never arrived, and
    errors superseded by a later scored result all reported as warnings, so
    that bug hunting starts from a list rather than from raw logs.
32. As a mutagate maintainer, I want warnings to never fail a run, so that
    compatibility stays a wiring question and behaviour stays a triage
    question.
33. As a mutagate maintainer, I want a per-sweep report with the harness ×
    language × scenario matrix, per-run pass counts (2/2, 1/2, 0/2), wall time
    per cell, warnings grouped by type and the top anomalies linked to their
    run directories, so that I can read one file and decide what to file.
34. As a triage agent, I want a checked-in triage prompt that tells me how a
    sweep directory is laid out and what counts as a mutagate bug, so that I
    can be pointed at a sweep and produce issues without a human walkthrough.
35. As a triage agent, I want `anomalies.json` to carry the run directory,
    check or warning id, and the evidence lines behind each entry, so that I
    can cite trace lines in the issues I file.
36. As a mutagate maintainer, I want each passing cell to write an evidence
    record under the repo's evidence directory named by harness, language and
    scenario, so that the README can point at it.
37. As a mutagate maintainer, I want the evidence record to hold the harness
    version, model, task, timestamp, both runs' check results, the scrubbed
    normalized trace and the transcript hash, so that it is the same kind of
    artifact as the existing Codex evidence.
38. As a mutagate maintainer, I want a deterministic test that fails when the
    README matrix shows a ✅ without passing evidence records for both the
    `natural` and the `forced` scenario, so that the README cannot drift ahead
    of the evidence.
39. As a mutagate user reading the README, I want a harness × language matrix
    with ✅, ⏳ and ❌ per cell, so that I know whether my combination has been
    exercised with a real model before I install the skill.
40. As an implementing agent, I want the checks module to consume only a run
    directory and the task's expected file, so that I can unit test it on
    canned traces without a harness, a model or a toolchain.
41. As an implementing agent, I want the sweep planner (cell expansion,
    repeats, filters, skip reasons) to be a pure exported function, so that I
    can test it directly as the engine's tests do with the engine's exports.
42. As an implementing agent, I want OpenCode driven through its long-lived
    server and Pi through its RPC mode, so that the continuation gate has a
    live session to re-prompt instead of a process that already exited.
43. As an implementing agent, I want done-detection for OpenCode and Pi
    defined as "session idle for a settle period and no mutagate worker
    holding a target lock", so that a run ends only after background mutation
    runs and their re-prompts are finished.
44. As an implementing agent, I want the first milestone to be a single
    Claude × Java × forced smoke run with explicit exit criteria, so that the
    unverified assumption about `claude -p` delivering async results and
    honouring Stop blocks is settled before drivers and tasks are built on it.
45. As a mutagate maintainer, I want the old live script deleted and its npm
    alias repointed at the new runner, so that there is one way to run live
    checks.
46. As a mutagate maintainer, I want the eval directory excluded from the
    packaged skill, so that the 300 KB package budget is unaffected.
47. As a mutagate maintainer, I want the suite to add no npm dependencies, so
    that the repo's zero-dependency rule holds.
48. As a mutagate maintainer, I want the deviations from the PRD's nightly-CI
    design recorded in the review-fixes log, so that the spec-versus-PRD gap
    is documented where the other deviations are.
49. As a mutagate maintainer, I want the known mutagate issues the hand runs
    found listed alongside the suite so that each one maps to a failing check
    or an anomaly, and I can confirm the suite would have caught them.
50. As a mutagate maintainer, I want a sweep to exit non-zero when any
    executed cell failed and to exit non-zero with a clear message when no
    cell executed at all, so that "everything skipped" is never mistaken for
    "everything passed".

## Implementation Decisions

**Scope and placement.** A new eval directory under the test tree, absorbing and
deleting the existing live script. The old live-auth and install-harness
helpers, and the review test that imported live-auth, are deleted: nothing
else used them. Node 22 built-ins only, no build step, not part of the skill
package.
`npm run eval` is the entry point and the old `test:live` alias points at it.

**Cells and runs.** A cell is harness × language × scenario (× task). A run is
one execution of a cell, numbered from 1. Default repeat is 2, every run
executes even when the first passes, and a cell passes if any run passes.
Anomalies from all runs are reported. Runs are scheduled with a configurable
job count, default 4, each in its own copied repo so mutagate's per-repo trace
and per-target locks never collide.

**Sweep planner.** Cell expansion, filter flags (`--harness`, `--lang`,
`--scenario`, `--task`, `--repeat`, `--jobs`, `--model`), and preflight
outcomes are computed by a pure exported function that returns the list of
planned runs with their skip reasons. The CLI only executes that list.
`--report <sweepDir>` is the one exception: it only re-renders that sweep's
report and runs nothing.

**Preflight.** Per cell: harness binary present and its version equal to the
pin in the harness-versions file; credential present (Claude: subscription
token env var; Codex: cached login reported by the CLI; OpenCode and Pi:
OpenRouter key); language toolchain present. Any miss marks the cell
`skipped (<reason>)`. Skips do not affect exit status. A sweep in which no cell
executed exits 1 and says so, mirroring `check` on an empty session.

**Secrets.** The subscription token and OpenRouter key are loaded from the
repo-root `.env` (gitignored) with Node's built-in env-file loader. Before any
artifact is checked, every occurrence of either value in the run directory and
the repo is replaced: with a fixed placeholder in text files, and with the
same number of `x` bytes in binary files so their length and structure stay
valid (`.git`, `node_modules` and files over 5 MB are skipped). The OpenCode
session database is deleted after the transcript export. The diff is taken
with intent-to-add, so agent-written file content never reaches the git object
store. Ctrl-C kills the harness processes, deletes `opencode.db` and scrubs every run directory and repo
started so far, and exits 130. Codex authenticates through the user's real
Codex home; that directory is never copied.

**Run lifecycle.** Each run has a run directory under the test cache
(`test/.cache/eval/<sweep>/<run>`) and a repo at
`~/.cache/mutagate-eval/<sweep>/<run>-<16 random hex>`, a real directory
outside the mutagate tree (so the agent does not load mutagate's own `AGENTS.md`/`CLAUDE.md` from an
ancestor directory) that survives reboots; the run directory's `repo/` is a
symlink to it. The sweep parent has mode `0311` (traversable, not listable),
and each random-suffixed repo has mode `0700`. This limits sibling discovery;
it is not a sandbox between processes running as the same user. Copy the task
into the repo. Stage the skill with the existing package builder, install it with the pinned skills installer for the harness,
then run mutagate's own `install --agent`. Initialise git and commit a
baseline. Launch with the harness driver. Collect artifacts. Scrub. Check.
The repo is kept.

One deadline, 30 minutes from run start (`timeoutMs` in the eval config),
covers the copy, skill install, setup commands, git baseline and the agent;
each step gets the remaining time. After the agent returns, `check`,
`status`, the diff and the task's test command share a fixed 5 minute grace
counted from agent end, so a run killed at the deadline still has artifacts.
A run lasts at most the deadline plus the grace plus driver teardown.

**Environment for the agent process.** `MUTAGATE_TRACE=1`, `MUTAGATE_DEBUG=1`,
`MUTAGATE_RECORD=1`, `MUTAGATE_NODE` pointing at a Node 22 binary (the host's
PATH node is 21), `JAVA_HOME` at JDK 21, plus the harness-specific isolation
below. `MUTAGATE_HARNESS` is deliberately **not** set: the SessionStart label
check must exercise real harness detection, otherwise the known "harness
unknown inside Claude Code" bug is masked. `CODEX_HOME` is exported only for
Codex because detection keys on it.

**Harness drivers.** One module, one entry per harness, each exposing
preflight, environment, launch, and done-detection:

- Claude: headless print mode with streamed JSON output, verbose, hook events
  included, permissions bypassed, model from config, fresh config directory
  per run, subscription token in env. Bare mode is never used because it
  skips hooks and OAuth. Preflight first probes the executable
  `~/.local/share/claude/versions/<pin>` and uses it if its version matches;
  otherwise it checks PATH. The pin is 2.1.289 (bumped from 2.1.270 on 2026-10-04 after the old binary was pruned) and the driver disables
  auto-update with `DISABLE_AUTOUPDATER=1`. Done on process exit.
- Codex: `exec` with JSON output, hook trust and approvals bypassed, user
  config and rules ignored, ephemeral session, model and medium reasoning
  effort from config. Real Codex home for auth. The repo is marked trusted
  with a `-c projects=...` override, because Codex loads project hooks only
  for trusted projects and trust lives in the ignored user config; every user
  skill in `~/.codex/skills` and `~/.agents/skills` is disabled by path with
  `-c skills.config=...`, because Codex loads those whatever the config says.
  Done on process exit.
- OpenCode: a long-lived `serve` on a free port in the repo, then `run`
  attached to it with JSON output, auto mode, and the OpenRouter model.
  Per-run `opencode.json` sets the model and
  `permission: { external_directory: "allow" }`, so external-path prompts
  remain approved after the attached client exits. Per-run config, data and
  state directories; the cache directory is left alone so mutagate's tool cache stays shared (if OpenCode's cache turns out
  to leak state between runs, switch to symlinking mutagate's tool cache into
  a per-run cache). Claude Code compatibility reading is disabled so the
  user's global instructions and skills are not picked up. `SHELL` is
  `/bin/bash`, since the bash tool runs `$SHELL` and the user's zsh broke
  bash idioms. Done when the
  session has been idle for the settle period and no mutagate worker holds a
  target lock; then the server is killed.
- Pi: RPC mode with the OpenRouter provider and model, prompt sent as a JSON
  message on stdin, which must be a pipe. Per-run agent directory and
  telemetry off. Done when polled state reports not streaming and zero
  pending messages for the settle period and no worker lock is held.

One-shot `opencode run` and `pi -p` are not used: both tear down the session
before the continuation gate can re-prompt. That gap is filed as a mutagate
issue and noted in the README, not worked around in the suite.

**Run directory contract (the seam).** Every driver writes the same layout, and
the checker reads nothing else except the task's expected file:

- `meta.json`: harness, harness version, model, language, scenario, task, run
  number, start and end timestamps, wall time, process exit code, how the run
  ended (`exit`, `idle`, `killed`).
- `stdout.log`, `stderr.log`: the raw harness transcript streams.
- `trace.jsonl`: mutagate's trace, copied from the data directory for the
  run's repo.
- `runner-logs/`: mutagate's per-target runner logs.
- `recorded/`: raw hook payloads recorded by mutagate.
- `status.json`: `status --json` output after the run, including each target
  production `file` and registered `tests`.
- `check.json` and `check.exit`: `check --json` output and its exit code, run
  with the session id taken from the trace.
- `diff.patch`: the working tree against the baseline commit, new files
  included (`git add -N -A`, then `git diff <baseline>`).
- `stage/`: the original skill package, kept for comparison.
- `skill-diff.txt`: one path per missing or SHA-256-changed installed file
  under staged `SKILL.md`, `README.md`, `scripts/` and `references/`, excluding
  `scripts/adapters/*` and `scripts/.node-path` (rewritten by install). Empty
  means unchanged; missing is accepted for older run directories.
- `repo/`: symlink to the kept working copy under `~/.cache/mutagate-eval/`.

The checker writes `result.json` (hard checks with pass/fail and evidence,
overall pass, skip reason if any) and `anomalies.json` (warnings, each with
id, message, and the trace or transcript lines behind it) into the same
directory.

**Hard checks** (all must pass):

1. Ended by `exit` or `idle`, not `killed`.
2. A SessionStart trace event whose harness label equals the cell's harness.
3. Every nonempty test file present in the final diff has a PostToolUse trace
   event naming it or appears in `status.json` registered `tests`. Python
   `conftest.py` and `__init__.py` are excluded. The diff is the
   harness-independent source of truth. An existing unregistered assertion-free
   scaffold warns as `scaffold-unregistered`; a missing file still fails.
4. Every target in the task's expected file appears in `status.json` with a
   result: none unresolved, none unscored.
5. No error that is not superseded: no trace event has `error` set and no
   runner log or result reports an infrastructure error, except errors
   superseded by a later scored or no-mutants `Result` for the same target
   (for a runner-log kill: the target's final `status.json` result qualifies).
   No-mutants means status `unscored` and an error starting with `NO_MUTANTS`;
   other unscored reasons never supersede an error. Superseded errors
   are reported as warning `recovered-error`. `status.json` error results,
   `check` exit 3 and hook or `Result` trace errors without a target always
   fail. CLI trace errors that are the old usage-error messages (the agent's
   own mistakes, traced before usage errors exited 2) never count; `worker`
   and other CLI errors do. Only `status.json` results with status `error`
   count as errors; an `error` string on an `unscored` result is a reason,
   reported as `unscored-final`. Likewise, `Result` trace reasons with decision
   `unscored` or `stale` are excluded from `no-errors`; ordinary errors still count.
6. `check.exit` is 0, or at least one target in `status.json` is below
   threshold and every below target has `blocks` up to the per-target retry
   cap (`maxRounds`). Below threshold with a target short of the cap fails.
7. `forced` only: a Stop `block`, then a later Result `pass`, then a Stop
   `allow`, in that order.
8. `skill-modified`: `skill-diff.txt` is empty or absent; each listed changed
   or missing path is failure evidence.

**Warnings** (reported, never failing): production files changed (diff paths
matching the task's production globs), waivers proposed or applied, manual
`run --target` or `--sync` in the transcript, mutagate source read, a hook
slower than one second (except the async `--mutate` PostToolUse handler,
marked `mutate: true` in the trace), stale or unresolved messages about files
no longer in the repo (message templates in dumped mutagate source skipped),
agent text claiming a pass or scores that `check.json` does not confirm (a
number equal to the threshold is not a score), the task's test command not green, fewer than five mutants
on a scored target (excluding `unscored`), async result never delivered and the agent ran `run` or `check`
after writing a test instead (not when the latest non-stale `Result` per target before the
first agent `run` or `check` CLI call passed: a `decision: "cli"` trace event,
or in older run dirs a non-hook session event), errors superseded by a later
scored or no-mutants result (`recovered-error`), and final `unscored` results carrying an
`error` reason (`unscored-final`, evidence `<target>: <reason>`). Source-read
detection includes `errors.cjs`, `dotnet.cjs` and `mutmut-bridge.cjs`; escaped
newlines end shell matches and reads redirected to `/dev/null` do not warn.

Executed CLI commands come from Claude Bash tool uses, Codex command-execution
items, OpenCode bash parts, Pi tool-execution starts, or top-level command fields.
Command IDs deduplicate repeated events; suggestions and nested Pi toolCall replays
do not count. A PostToolUse with `delivered: true` before the CLI boundary counts
as async delivery; older trace/transcript heuristics remain fallbacks.

For `stale-deleted`, executed `rm`/`mv` commands establish deletion chronology.
Messages before deletion and later replays of their identical fragments are history.
Previously unseen fragments after deletion and messages in `check.json` still warn.
Matching fragments are treated as replays; a fresh identical message is also suppressed.
Without a matching deletion command, the original final-tree check applies.

`scaffold-unregistered` names existing unregistered tests with no assertion marker.
This warning covers shell-generated scaffolding outside Write/Edit observation.

**Sweep outputs.** A sweep directory holds all run directories plus
`report.md` (matrix with pass/fail/skip and run counts, wall time per cell,
warnings by type, top anomalies with run links) and a merged `anomalies.json`.
The report is rendered from the per-run `result.json` and `anomalies.json`
files only, so it can be regenerated from a sweep directory:
`npm run eval -- --report <sweepDir>` does that without launching agents.

**Triage prompt.** A checked-in markdown prompt describing the sweep and run
layouts, the meaning of each check and warning id, what does and does not
count as a mutagate bug (model laziness is not), and the issue format to
produce.

**Tasks.** One directory per language, each with production code, an
expected file, and the natural prompt. One shared forced prompt. One
greenfield prompt per language. The expected file declares `targets` (files
and classes that must be scored), `traps` (ids present), `prodFiles` (globs
that count as production code; files matching the test globs are subtracted),
and `testCommand`. Stacks: Java Spring Boot 4
with Maven and JUnit 5; Kotlin Spring Boot 4 with Gradle and JUnit 5; Python
FastAPI with pytest, uv and mutmut 3.8.0; TypeScript Express with Vitest; Go `net/http`;
C# ASP.NET Core minimal API with xUnit and `WebApplicationFactory`. Build-tool
variants are not repeated here; the integration suite covers them.

**Traps.** Every task contains: the multi-class HTTP integration test whose
name matches no class; boundary logic (bounds, overflow, a 1000 size cap);
equivalent-mutant bait (redundant check, defensive copy); an entrypoint and
wiring file with low coverage; the language idiom (Kotlin top-level functions
and an Elvis fallback in the exception handler; Go integration tests under
`cmd` with handlers in another package; C# minimal-API `Program`; Python and
TypeScript module-level functions); the forced-only assertion-free smoke test;
and staleness, where the prompt asks for a small production change (a sum
endpoint) after tests exist so a scored target must go stale and re-run.

**Task validation.** Before a task is used in a sweep, a model-free script
installs the task's reference tests, runs `mutagate run --sync` per test file,
and asserts every declared target is scored. This runs under the integration
suite, gated by the same fixture selection env var, so an unscored target in a
live run is attributable to mutagate.

**Evidence and README.** A passing cell writes an evidence record named
harness-language-scenario under a `live` subdirectory of the existing evidence
directory, overwriting the previous record for that cell. Its shape follows the
existing Codex records: harness, version, model, task, scenario, passed,
attempts with checks and durations, scrubbed normalized trace, final response,
transcript hash. The README's Harnesses section replaces its single "Live
model run" column with a harness × language matrix that is edited by hand. A
✅ in that matrix needs passing records for both the `natural` and the
`forced` scenario of the pair.

**Models.** Claude `claude-sonnet-5` on the subscription token. Codex
`gpt-5.6-sol` with medium reasoning effort on the ChatGPT login. OpenCode
`deepseek/deepseek-v4.1-flash` and Pi `deepseek/deepseek-v4-flash` (the model
in Pi's registry) through OpenRouter. Pinned in the eval config, overridable
per harness by flag.

**Milestones.** M0 host setup (gomutants, .NET 10 with Stryker.NET, mutmut
venv, rebuild the Linux-built cached venvs and JDK). M1 runner skeleton,
checker, Claude driver, Java task, and the Claude × Java × forced smoke run
with the exit criterion that async results are delivered and Stop blocks then
allows under print mode; stop and decide if not. M2 the other three drivers on
Java, both scenarios. M3 the remaining five tasks, each validated model-free.
M4 report, anomalies, triage prompt, evidence, README matrix, the evidence
test, deletion of the old live script, docs updates and the review-fixes
entries. M5 greenfield task and the first full 96-run sweep.

**PRD deviations** (to be recorded in the review-fixes log): L6 runs locally
by hand, not nightly in CI containers; both flake runs always execute for bug
discovery; OpenCode and Pi are driven through server and RPC modes instead of
one-shot headless mode.

## Testing Decisions

A good test here asserts on what the suite produces from a given input, not on
how it produced it: given a run directory, these checks pass and these
warnings appear; given these flags and this host state, these runs are
planned; given this README and this evidence directory, the consistency test
passes or fails. No test should spawn a harness, a model, or a mutation
runner, except the model-free task validation that lives in the integration
suite.

Modules under test and how:

- **Checker** on canned run directories. Fixtures are built from the existing
  Codex evidence records (which already hold normalized traces) plus hand-
  written variants: a killed run, a missing SessionStart, a test file with no
  registration, an unscored target, an infra error, below-threshold-without-
  block, a forced run with block → pass → allow and one with the wrong order,
  and one fixture per warning type. Each fixture asserts the exact set of
  failed check ids and warning ids. Prior art: the deterministic suites that
  import engine functions directly, and the payload corpus used by drift
  detection.
- **Sweep planner** as a pure function: filter flags, repeat expansion, run
  naming, skip reasons from a stubbed preflight, pass-if-any-run aggregation,
  and the "nothing executed" exit rule. Prior art: engine unit tests on
  `configFor` and `resolveTargets`.
- **Report rendering** from canned `result.json` and `anomalies.json` sets:
  matrix cells, run counts, warning grouping. Prior art: the review test that
  asserts generated artifacts byte-for-byte.
- **Secret scrubbing**: every artifact writer is exercised with a token
  planted in stdout, trace, diff and status, asserting none survives; a token
  in a binary file and in a new repo file is absent from the files and from
  the git object store after the diff and scrub.
- **README ↔ evidence**: parse the README matrix, assert each ✅ cell has an
  evidence record. Prior art: the review test tying generated hooks to the
  installer config.
- **Task validation** (integration, opt-in): per task, reference tests in,
  `run --sync` out, every declared target scored. Prior art: the runner
  fixtures with weak/strong variants and `expected.json`.
- **Live drivers** are validated only by the smoke run in M1 and the sweeps
  themselves. The scripted driver suite already proves the hook envelopes for
  all four harnesses without a model and stays as is.

Seams, from highest to lowest:

1. The run directory. Drivers write it, the checker reads it. Every
   deterministic test of judging goes through this seam with canned
   directories.
2. Exported pure functions of the runner for planning and reporting, in the
   same style as the engine's exported functions.
3. The evidence directory and README, checked by a deterministic test.

No new seams inside mutagate itself. The suite observes mutagate only through
its existing trace, `status --json`, `check --json`, and the recorded payload
files. The one addition is a field on the existing trace: hook events carry
`mutate` (true for the async `--mutate` PostToolUse handler), which
`slow-hook` needs to tell that handler from a slow synchronous hook. Hook
events also carry `delivered`, true when the handler printed output.

## Out of Scope

- Effectiveness measurement (a baseline run without mutagate for
  comparison). Scores are recorded so a baseline flag can be added later.
- An LLM judge of any kind.
- Running in CI, containers, or on a schedule. Spend caps and budget flags.
- Windows. Kotlin Tier A with an Arcmutate licence.
- Fixing the known mutagate issues listed in the plan document. Each is a
  separate issue; the suite's job is to surface them as a failed check or an
  anomaly.
- Build-tool variants per language (Maven vs Gradle, Jest vs Vitest, pip vs
  uv). The integration suite covers those.
- Any change to the packaged skill, hook wiring, or adapters made to suit the
  suite. Mutagate bugs the suite found are fixed as mutagate changes of their
  own (the 2026-09-14 fix pass: JVM target guess, error report wording,
  OpenCode adapter model, mutmut 3.6+; see `../test/review-fixes.md`).

## Further Notes

- **The one unverified assumption** is whether Claude's print mode waits for
  asynchronous PostToolUse output and continues after a Stop block. M1's smoke
  run exists to settle it before anything else is built; if it fails, the
  Claude driver design changes and this spec is revised.
- **Pin mismatch to resolve first.** The plan lists Claude 2.1.270; the
  harness-versions file pins 2.1.269. Preflight compares against the file, so
  the file must be bumped (and the README) before a Claude run can execute.
- The host is macOS with Node 21 on PATH; `MUTAGATE_NODE` must point at a
  Node 22 binary or every hook fails open silently and check 2 fails.
- OpenCode needs network on its first run in a fresh config directory to
  install its plugin package; a cold sweep should expect that.
- The known-issues list in the plan document doubles as an acceptance list:
  after M4, each item should be traceable to the check or warning id that
  would have flagged it.
- The staleness trap and the async-delivery warning together are what turn
  the Java springtest finding ("async result never delivered, agent ran
  `run --sync` by hand") into a repeatable signal.
