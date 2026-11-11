---
name: verify-stop-gate
description: Model-check the mutagate Stop gate and result freshness (runTarget, loadResult, verdict, gate, claimBlock, register and the PostToolUse --mutate handler in scripts/mutagate.mjs; the Claude stop in scripts/harness.cjs; inputFiles in scripts/inputs.cjs) with TLA+/TLC, and replay its findings on the real code. Use before you commit a change to any of these functions, when you review such a change, or when you ask whether edits, background runs and Stop hooks can interleave into a silent stop on a weak test.
---

# Verify the Stop gate

Two promises, checked over every interleaving of edits, the background run and the Stop hook in a TLA+ model of one target:

- **P1 `SilentStopMeansPassOnTheseFiles`.** The agent never stops without a message unless the target has a passing result measured on the tests and the code as they were when the gate answered. Harm: the agent stops on a weak test, and mutagate says nothing.
- **P2 `UsableResultIsOfTheseFiles`.** A result that the gate can use (loadResult returns it) was measured on the tests and the code as they are now. Harm: `status`, `check` and the gate show a score that belongs to other file contents.

Two more checks ride along:

- **P3 `BelowBlocksBeforeStop`.** The agent never stops on a score below the threshold that the gate never blocked it for.
- **P4 `BlocksAreBounded`.** The gate blocks at most `maxRounds` times for one target on a low score, and at most `maxRounds` + 2 times in all: the pending block and the failing-tests block happen once each and use no round (ghost counts `belowBlocks`, `allBlocks`).

`GoalNeverStopsClean` is a goal, not a property: it must break, which shows that the model can reach a clean silent stop, so P1 does not pass only because no stop ever happens.

Tool: TLA+ with the TLC model checker, because the question is about the order of steps among three actors (agent, background run, Stop hook), not about one function's input. `repro.mjs` replays the model paths on the real `scripts/mutagate.mjs` with the runner seam, so each finding is also shown on the code.

## Run

From the repo root:

```sh
node .claude/skills/verify-stop-gate/check.mjs             # about 6 s
node .claude/skills/verify-stop-gate/check.mjs --mutants   # after you change Target.tla: each check must still catch its broken variant
BOUNDS='MaxEdits = 5 MaxStops = 5 MaxRounds = 3' node .claude/skills/verify-stop-gate/check.mjs   # other bounds
```

Needs Java 11+ and `tla2tools.jar` at `~/.cache/tla/tla2tools.jar` or in `TLA2TOOLS`. Pinned: TLC2 Version 2026.10.24.013619 (rev 2ef2af8), sha256 `d15655eeaff4b3f7b3d65c46b838bc0f35d131b2ef4b1e473689b62c98d4726f`; `check.mjs` warns on another jar. Exit 0: every outcome as expected. Exit 1: read the table. Exit 2: no TLC.

Baseline at the sync commit `7d3b733`, F1 and F2 fixed (exit 0):

```
revert   SilentStopMeansPassOnTheseFiles  holds   ok
revert   UsableResultIsOfTheseFiles       holds   ok
revert   BelowBlocksBeforeStop            holds   ok
revert   BlocksAreBounded                 holds   ok
revert   GoalNeverStopsClean              broken  ok, goal reached
noRevert SilentStopMeansPassOnTheseFiles  holds   ok
noRevert UsableResultIsOfTheseFiles       holds   ok
noRevert BelowBlocksBeforeStop            holds   ok
noRevert BlocksAreBounded                 holds   ok
noRevert GoalNeverStopsClean              broken  ok, goal reached
real-code replays: 5 "holds" tests pass
```

`revert` lets an edit restore bytes that an earlier fingerprint saw; `noRevert` makes each edit new bytes. Before the F1 fix, P1 and P2 broke under `revert`; mutant 6 puts that code back and must break them.

Read every TLC result with the pstack `/statechart` skill: it tells each violation as its shortest path in plain words and shows which violations a change fixes; on a pass it draws how the target moves between states. Its inputs are here: `Target.tla`, `Target.cfg` (the `revert` configuration, smaller bounds) and `Target.map.mjs` (the labels in this repo's words). Expected broken there: `GoalNeverStopsClean` only.

## Known findings (not fixed at the sync commit)

None.

## Fixed

- **F1.** Fixed in `7d3b733`. A run whose files changed and changed back before it ended published a result of the other bytes as current (P1, P2; the agent alone could do it by undoing an edit during the background run). Now `runTarget` also takes the stat keys of every fingerprinted file before the first fingerprint and after the second (mutagate.mjs:477, 512; `stamp` inputs.cjs:22) and publishes only when they are the same (mutagate.mjs:515); model: `edits` copied to `run.stamp` in `StartRun` and `RunStartsOver`, checked in `Fresh`; repro "holds (P1, P2, F1 fixed)", both variants.
- **F2.** Fixed in `4b9a140`. The one-time pending and failing-tests blocks used the rounds, so a low score never blocked (P3). Now `claimBlock` checks only the flag for a one-time block and counts only below blocks in `t.blocks` (mutagate.mjs:577-579); repro "holds (P3, F2 fixed)".

## Coverage at sync commit `7d3b733`

Move this commit forward (here and `SYNC` in `check.mjs`) only after you confirmed that the model describes the code at the new commit.

| Code at `7d3b733` | Model |
| --- | --- |
| `fingerprint` mutagate.mjs:252-254, `inputFiles` inputs.cjs:100 | `content`: one value for every byte that the fingerprint hashes |
| `stamp` mutagate.mjs:256, inputs.cjs:22 (stat keys of the same files) | `edits`: raised by every write (`WriteTest`, `EditTarget`, `OutsideEdit`), also one that restores the bytes |
| `register` mutagate.mjs:293-318 | `WriteTest` (same tests keep the generation) |
| `handleHook` PostToolUse mutagate.mjs:662-736: generation bump 677-682, `--mutate` settle and loop 703-731 | `EditTarget`, `WriteTest`, `queued`, `HandlerStarts`, `HandlerSkips`, `HandlerGivesUp`, `HandlerPublishes` |
| `runTarget` mutagate.mjs:465-534: lock 466, cached 469-471, attempts 472-478 (stat keys, then fingerprint 477-478), runner 491-492, clipped kill 498-499, attempts count 508, publish check 512-525 (fingerprint, then stat keys 512; generation, fingerprint and stat keys 515) | `StartRun`, `RunnerMeasures`, `Fresh`, `RunStartsOver`, `NewResult`, `Published`, `GateRunClipped` (`run.stamp`) |
| `retryable` 536, `loadResult` 538-546, `verdict` 549-553 | `Retryable`, `Usable`, `Kind`, `Obligation` |
| `claimBlock` mutagate.mjs:573-583: one-time flag or round guard 577, flag or round count 578-579 | `Claims`, `Decide`'s `blocks` |
| `gate` mutagate.mjs:587-639: wait loop 599-608, retry loop 609-619, decision 621-632 | `AskStop`, `GateWaitEnds`, `GateSeesResult`, `GateStartsRun`, `GateOutOfTime`, `GateStopsTrying`, `GateFindsBusy`, `GateRunPublishes`, `GateRunGivesUp`, `Decide` |
| Claude `stop` and `write`, harness.cjs:32-35 | `Decide`'s `stop`: block, warning, or nothing |
| `DEFAULTS.maxRounds` mutagate.mjs:17 | `MaxRounds = 2` |

`check.mjs` prints each hunk of `scripts/mutagate.mjs`, `scripts/harness.cjs` and `scripts/inputs.cjs` that changed since the sync commit. A hunk inside a row above needs a model review; a hunk elsewhere does not. The comments in `Target.tla` cite these lines.

## Scope

Verified: every interleaving of the actions in `Target.tla` with at most 5 file edits and 5 Stop calls, `maxRounds` 2, one primary target, mode `gate`, a Claude Code session. About 670,000 distinct states under `noRevert` and 500,000 under `revert`. A wait may end at any time and the gate deadline may kill any run, so time is free choice.

Assumptions; the result says nothing when one is false:

- The fingerprint covers every byte the runner reads (`inputFiles`). A runner that reads a file outside it is not modeled.
- Every write to a fingerprinted file changes its stat key (size, mtime, ctime, inode). Ceiling: a filesystem whose timestamps are too coarse to see an edit and its undo, and a tool that restores the timestamps; there an edit and its undo during a run can again publish the result of the other bytes (F1).
- No runner writes a fingerprinted file during a normal run; one that does would never publish (the target stays pending).
- The newest `--mutate` handler is the only one that matters (`queued` is one flag; older handlers yield in `settle`).
- These code spans are one step each: the gate's final verdict and its answer (mutagate.mjs:608 to 627; an edit in between counts as after the answer); the second fingerprint, the stat keys and the state write (512 to 525); the lock, the stat keys and the first fingerprint (466 to 478). The runner reads all files at one instant (`RunnerMeasures`); a split read changes nothing, because any write between the two stat keys stops the publish.
- When the gate waits in `lock()` for a background run and then takes its cached result (469-471), the model shows it as the gate staying in its wait until `HandlerPublishes`, then `GateSeesResult`.
- After the gate's second run, the code decides on the verdict of the returned result; the model re-reads it. Only the one-time flag of a non-pass block can differ; a silent stop cannot.

Not modeled: `unscored` results (a final "no mutants to test" lets the agent stop with no message by design, README exit codes), deleted tests, waivers, secondary targets (the gate skips them by design), gone targets, `advise` mode, the Copilot `agentStop` streak and outbox, the Codex, OpenCode and Pi profiles, and more than one target or session.

## Tell a real bug from a modeling error

1. Read the counterexample with `/statechart`, or open `tlc.out` from the path that `check.mjs` prints.
2. For each step, open the code line that the action's comment cites at the current commit. When the code cannot take the step (a guard, a lock or an order that the model lacks), the model is wrong: fix the action, cite the line, rerun with `--mutants`.
3. When the code can take every step, replay the path in `repro.mjs` with the fixture, `write` (PostToolUse) and a runner seam that changes files between reads, like the F1 tests. When the replay shows the bad stop, it is a real bug: report it with the steps in the code's words, add a `finding` test and a `CHECKS` entry with a new id (`F3`), and add it to Known findings. Never weaken a property or the model to make it pass, and change product code only when the user asks.

## When a change is intended

1. Read the hunks that `check.mjs` prints and find their rows in Coverage.
2. Change the model actions in those rows to match the new code. Update the line citations in `Target.tla` and in this file.
3. Run `check.mjs --mutants`. When a mutant no longer applies, rewrite its model text in `MUTANTS` so it breaks the same guard.
4. When a finding is fixed, the table shows `NOT BROKEN` and its `finding` test in `repro.mjs` fails. Set its `CHECKS` entries to `holds`, turn the test into a `holds` test with the fixed outcome, and move the finding from Known findings to a one-line "Fixed in <commit>" note.
5. When the code adds a state that a property depends on (a new result status, a new block reason, a new actor), add it to the model before you trust a pass.
6. Move the sync commit (this file and `SYNC` in `check.mjs`) to the new commit.
