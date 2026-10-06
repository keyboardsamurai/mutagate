# mutagate

mutagate runs scoped mutation tests when an agent writes a test and gates task completion on the score. This file is the glossary for its ADRs, docs, messages and code.

## Language

### Targets and results

**Target**:
A production file that a registered test covers, named by its class, module or path. The gate scores one target at a time.
_Avoid_: production target, subject, mutated file, source under test

**Secondary target**:
A target that the test only imports, beside the primary target it names. The gate skips it by default.
_Avoid_: dependency target, imported target, extra target

**Registration**:
The session record that binds a test file to its targets. A PostToolUse on a test or `mutagate run <test>` creates it.
_Avoid_: tracking, scheduling, enrolment

**Result**:
The normalized outcome of one mutation run for a target: status `pass`, `below`, `unscored` or `error`, with score and survivors.
_Avoid_: report, score file, outcome

**Survivor**:
A mutant that no registered test killed. It appears in the report with a waiver id.
_Avoid_: surviving mutant, escaped mutant, live mutant

**Waiver**:
A human-approved entry in `.mutagate/waivers.json` that removes one survivor id from the score, with a reason.
_Avoid_: exemption, suppression, ignore rule

**Fingerprint**:
The digest of a target's registered tests, the config, the scoped project inputs and mutagate's own scoring code. A result is usable only while its fingerprint matches.
_Avoid_: hash, cache key, checksum

**Stale**:
The state of a target whose result's fingerprint no longer matches the repo. A stale target is pending until a new run publishes.
_Avoid_: outdated, invalidated, dirty

**Edited file**:
A production file the agent wrote in this session. An error that names one is agent-caused; the gate lists edited files that no target mutates.
_Avoid_: touched file, changed file, modified file

**Pending**:
The state of a target for which no usable result exists. A stale target is pending; a result whose registered tests were deleted counts as pending.
_Avoid_: in progress, waiting, unscored (for this state)

**Final unscored**:
A result without a score that does not change without action. Reasons: no mutants to test, every mutant errored, no coverage, run budget exceeded, tests deleted, no tests collected in the scoped copy.
_Avoid_: pending, empty result, null score

**No mutants to test**:
The final unscored reason for a target whose file yields no eligible mutant. It is no obligation: no block, counted as pass.
_Avoid_: zero mutants, empty run, nothing to mutate

### Runs

**Runner**:
The per-language adapter that drives a mutation engine (PIT, Stryker, mutmut, gomutants, Stryker.NET) and returns raw mutants.
_Avoid_: engine, backend, driver

**Worker**:
The detached process that runs one target under its lock and publishes the result.
_Avoid_: background job, runner process, daemon

**Scoped copy** (Python):
The per-run copy of the scoped project inputs that mutmut mutates. It is deleted after the result is normalized.
_Avoid_: scratch copy (for Python), work dir, sandbox

**Scratch copy** (C#):
The persistent copy of the scoped project inputs, one per test project under the mutagate data dir, in which Stryker.NET builds and runs.
_Avoid_: scoped copy (for C#), shadow copy, build cache

**Red baseline**:
A runner's report that the registered tests fail before any mutation.
_Avoid_: failing baseline, initial test run failure, dirty baseline

**Agent-caused**:
An error result whose cause lies in the agent's own work: a failing command names a session test, a test-glob match or an edited file, or the runner reports a red baseline, or no registered test exercises a Python target.
_Avoid_: user error, test error, agent fault

### Gate and budgets

**Hook**:
A harness event that mutagate handles: PreToolUse, PostToolUse, Stop, SubagentStop, TaskCompleted. Hooks fail open.
_Avoid_: callback, trigger, plugin event

**Gate**:
The check over every target in the session that decides block or allow and the exit code. Stop, SubagentStop, TaskCompleted and `check` run it.
_Avoid_: completion check, verdict, blocker

**Run budget** (`runBudgetSec`):
The longest time one mutation run may take. A run that reaches it is a final unscored result.
_Avoid_: run timeout, execution budget, target budget

**Gate deadline** (`gateBudgetSec`):
The time after the start of the gate past which it makes no new attempt. Hooks always use it; only `check --wait N` raises it, to N when N is larger.
_Avoid_: gate budget, hook budget, check budget

**In-flight wait** (`gateWaitSec`):
The longest time the gate waits for a worker that is already running a target. It never enlarges a budget.
_Avoid_: gate wait, poll timeout, in-flight budget

**Clipped run**:
A run killed under a budget below the run budget. It is never published; the target stays pending.
_Avoid_: budget kill, partial run, timed-out run

**Usage error**:
A CLI error caused by the command line itself: a bad file, argument or command. It exits 2.
_Avoid_: argument error, CLI error, invalid input

### Sessions and harnesses

**Session**:
The unit of state that groups registrations, results and blocks under one id from the harness. Hook calls and the agent's CLI calls share it.
_Avoid_: conversation, thread, run (for this)

**Harness**:
The agent CLI that hosts mutagate: Claude Code, Codex CLI, OpenCode or Pi.
_Avoid_: agent, host tool, IDE

**Portable install**:
A project install whose hook commands find the skill through the Git top level and whose adapters find the runtime relative to the adapter file, so the committed config works on each clone (ADR-0013).
_Avoid_: relative install, repo install

**Skill dir**:
The directory that holds `SKILL.md` and `scripts/`, for example `.agents/skills/mutagate`. A portable install needs it in each clone.
_Avoid_: skill folder, package dir, install dir

**Skill package**:
The files a user installs: `SKILL.md`, `README.md`, `LICENSE`, `scripts/` and `references/`. It excludes tests, evals and dev docs.
_Avoid_: bundle, dist, artifact

**Skill branch**:
The generated Git branch `skill` that holds only the skill package for one release; users install from it (ADR-0014).
_Avoid_: release branch, dist branch

**Machine-local**:
Config that holds absolute Node and skill paths of one machine. Do not commit it. Install warns when a project install is machine-local.
_Avoid_: absolute install, local config
