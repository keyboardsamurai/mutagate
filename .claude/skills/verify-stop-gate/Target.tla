------------------------------- MODULE Target -------------------------------
\* One target of one Claude Code session in mutagate, mode gate, default maxRounds.
\* Code: scripts/mutagate.mjs and scripts/harness.cjs. Line numbers are at the sync commit in SKILL.md.
\* Each action is one step that the code does without a gap that matters here; SKILL.md lists the merged gaps.
EXTENDS Integers

CONSTANTS MaxEdits, MaxStops, MaxRounds,
          Revert  \* TRUE: an edit can restore bytes that an earlier fingerprint saw. FALSE: each edit makes new bytes.

VARIABLES
  content,  \* the bytes of the target's input files now, as one value; fingerprint() hashes them (mutagate.mjs:252-256)
  target,   \* s.targets[key] of the session state (mutagate.mjs:310-314); blocks counts below blocks (mutagate.mjs:578-579);
            \* belowBlocks and allBlocks are ghost counts of the below blocks and of every block
  result,   \* the result file (mutagate.mjs:516-517); ranOn is a ghost: the bytes that the runner measured
  lock,     \* the holder of the target lock (mutagate.mjs:466)
  run,      \* the runTarget call that holds the lock (mutagate.mjs:465-534)
  queued,   \* a newer async PostToolUse --mutate handler waits for quiet (mutagate.mjs:710-720)
  gate,     \* the gate call of the Stop hook (mutagate.mjs:587-639)
  stop,     \* what the last Stop hook told the agent (harness.cjs:32)
  judged,   \* ghost: what the gate judged when it answered
  edits,    \* every write to the input files so far; runTarget's stat keys (inputs.cjs stamp) change with each one
  stops

vars == <<content, target, result, lock, run, queued, gate, stop, judged, edits, stops>>

None == -1  \* no bytes, no fingerprint
NextContent(c) == IF Revert THEN 1 - c ELSE c + 1
NoRun == [by |-> "none", phase |-> "idle", generation |-> 0, fp |-> None, stamp |-> 0, ranOn |-> None,
          attempt |-> 0, cachedAttempts |-> 0, cachedFp |-> None]
NoResult == [status |-> "none", attempts |-> 0, agentCaused |-> FALSE, ranOn |-> None]
IdleGate == [phase |-> "idle", retry |-> 0, had |-> FALSE]

Init ==
  /\ content = 0
  /\ target = [registered |-> FALSE, generation |-> 0, resultGeneration |-> 0, fingerprint |-> None,
               blocks |-> 0, pendingBlocked |-> FALSE, errorBlocked |-> FALSE, belowBlocks |-> 0, allBlocks |-> 0]
  /\ result = NoResult
  /\ lock = "free"
  /\ run = NoRun
  /\ queued = FALSE
  /\ gate = IdleGate
  /\ stop = "working"
  /\ judged = [kind |-> "none", ranOn |-> None, content |-> None]
  /\ edits = 0
  /\ stops = 0

\* loadResult, mutagate.mjs:538-546. resultGeneration 0 is null.
Usable == /\ target.registered
          /\ result.status # "none"
          /\ target.resultGeneration = target.generation
          /\ target.fingerprint = content
\* retryable, mutagate.mjs:536
Retryable == result.status = "error" /\ result.attempts < 2
\* verdict, mutagate.mjs:549-553
Kind == IF ~Usable THEN "pending" ELSE IF Retryable THEN "retry" ELSE result.status
Open == Kind \in {"pending", "retry"}  \* mutagate.mjs:599
\* The agent can act: no Stop hook runs, and the last Stop did not let it stop.
Working == gate.phase = "idle" /\ stop \in {"working", "blocked"}

----------------------------------------------------------------------------
\* The agent

\* PostToolUse on the test file. register keeps the generation when the tests are the same (mutagate.mjs:304-313).
WriteTest ==
  /\ Working
  /\ edits < MaxEdits
  /\ content' = NextContent(content)
  /\ target' = IF target.registered THEN target ELSE [target EXCEPT !.registered = TRUE, !.generation = 1]
  /\ queued' = TRUE
  /\ stop' = "working"
  /\ edits' = edits + 1
  /\ UNCHANGED <<result, lock, run, gate, judged, stops>>

\* PostToolUse on the target file (mutagate.mjs:677-682).
EditTarget ==
  /\ Working
  /\ target.registered  \* mutagate.mjs:678
  /\ edits < MaxEdits
  /\ content' = NextContent(content)
  /\ target' = [target EXCEPT !.generation = @ + 1]
  /\ queued' = TRUE
  /\ stop' = "working"
  /\ edits' = edits + 1
  /\ UNCHANGED <<result, lock, run, gate, judged, stops>>

\* The files change with no hook call in this session: a shell command, another agent or a person.
OutsideEdit ==
  /\ stop \in {"working", "blocked"}
  /\ target.registered
  /\ edits < MaxEdits
  /\ content' = NextContent(content)
  /\ edits' = edits + 1
  /\ UNCHANGED <<target, result, lock, run, queued, gate, stop, judged, stops>>

\* The Stop hook starts the gate (harness.cjs:32).
AskStop ==
  /\ Working
  /\ target.registered
  /\ stops < MaxStops
  /\ gate' = [phase |-> "wait", retry |-> 0, had |-> FALSE]
  /\ stops' = stops + 1
  /\ UNCHANGED <<content, target, result, lock, run, queued, stop, judged, edits>>

----------------------------------------------------------------------------
\* runTarget

\* The lock is taken, then the stat keys and the fingerprint (mutagate.mjs:466-478).
StartRun(by) ==
  /\ lock' = by
  /\ run' = [by |-> by, phase |-> "started", generation |-> target.generation, fp |-> content, stamp |-> edits,
             ranOn |-> None, attempt |-> 1,
             cachedAttempts |-> IF Usable /\ result.status = "error" THEN result.attempts ELSE 0,
             cachedFp |-> target.fingerprint]

\* The runner reads the files some time after runTarget took the fingerprint (mutagate.mjs:478, 491-492).
RunnerMeasures ==
  /\ run.phase = "started"
  /\ run' = [run EXCEPT !.phase = "measured", !.ranOn = content]
  /\ UNCHANGED <<content, target, result, lock, queued, gate, stop, judged, edits, stops>>

\* The publish check: the generation, the fingerprint and the stat keys are the same as at the start (mutagate.mjs:512-515).
\* A write that restores the bytes still changes the stat keys.
Fresh == target.generation = run.generation /\ content = run.fp /\ edits = run.stamp

Outcomes == {"pass", "below", "errorAgent", "errorInfra"}
NewResult(o) ==
  [status |-> IF o \in {"pass", "below"} THEN o ELSE "error",
   attempts |-> IF o \in {"pass", "below"} THEN 0
                ELSE IF run.cachedAttempts > 0 /\ run.cachedFp = run.fp THEN run.cachedAttempts + 1 ELSE 1,  \* mutagate.mjs:508
   agentCaused |-> o = "errorAgent",
   ranOn |-> run.ranOn]
Published == [target EXCEPT !.fingerprint = run.fp, !.resultGeneration = run.generation]  \* mutagate.mjs:519-520

\* The files changed during attempt 1: the result is not published, and runTarget runs again (mutagate.mjs:472-478).
RunStartsOver ==
  /\ run.phase = "measured"
  /\ ~Fresh  \* mutagate.mjs:515
  /\ run.attempt = 1  \* mutagate.mjs:472
  /\ run.by = "handler" => ~queued  \* settle, mutagate.mjs:474, 714
  /\ run' = [run EXCEPT !.phase = "started", !.generation = target.generation, !.fp = content, !.stamp = edits,
                        !.ranOn = None, !.attempt = 2]
  /\ UNCHANGED <<content, target, result, lock, queued, gate, stop, judged, edits, stops>>

----------------------------------------------------------------------------
\* The async PostToolUse --mutate handler

HandlerStarts ==
  /\ queued
  /\ Kind = "pending"  \* mutagate.mjs:722
  /\ lock = "free"  \* mutagate.mjs:466
  /\ StartRun("handler")
  /\ queued' = FALSE
  /\ UNCHANGED <<content, target, result, gate, stop, judged, edits, stops>>

HandlerSkips ==
  /\ queued
  /\ Kind # "pending"  \* mutagate.mjs:722
  /\ queued' = FALSE
  /\ UNCHANGED <<content, target, result, lock, run, gate, stop, judged, edits, stops>>

HandlerPublishes(o) ==
  /\ run.by = "handler"
  /\ run.phase = "measured"
  /\ Fresh  \* mutagate.mjs:515
  /\ result' = NewResult(o)
  /\ target' = Published
  /\ lock' = "free"
  /\ run' = NoRun
  /\ UNCHANGED <<content, queued, gate, stop, judged, edits, stops>>

HandlerGivesUp ==
  /\ run.by = "handler"
  /\ run.phase = "measured"
  /\ ~Fresh  \* mutagate.mjs:515
  /\ run.attempt = 2 \/ queued  \* mutagate.mjs:472, 474
  /\ lock' = "free"
  /\ run' = NoRun
  /\ UNCHANGED <<content, target, result, queued, gate, stop, judged, edits, stops>>

----------------------------------------------------------------------------
\* The gate

\* verdict's obligation that can block, and its one-time flag (mutagate.mjs:550-551)
Obligation(k, r) == IF k = "pending" THEN "pending"
                    ELSE IF k \in {"error", "retry"} /\ r.agentCaused THEN "error"
                    ELSE IF k = "below" THEN "below" ELSE "none"
\* claimBlock, mutagate.mjs:577: a one-time block only checks its flag; only a below block checks the rounds.
Claims(t, o) == /\ o # "none"
                /\ o = "below" => t.blocks < MaxRounds
                /\ o = "pending" => ~t.pendingBlocked
                /\ o = "error" => ~t.errorBlocked
\* The gate answers on target record t, result r and verdict kind k (mutagate.mjs:627-632).
\* A pass has obligation none: no block and no warning, so the Stop hook writes nothing (harness.cjs:32).
Decide(t, r, k) ==
  LET o == Obligation(k, r) IN
  /\ target' = IF Claims(t, o)
               THEN [t EXCEPT !.blocks = @ + (IF o = "below" THEN 1 ELSE 0),  \* mutagate.mjs:578-579
                              !.pendingBlocked = @ \/ o = "pending",
                              !.errorBlocked = @ \/ o = "error",
                              !.belowBlocks = @ + (IF o = "below" THEN 1 ELSE 0),
                              !.allBlocks = @ + 1]
               ELSE t
  /\ stop' = IF Claims(t, o) THEN "blocked" ELSE IF k = "pass" THEN "allowed" ELSE "warned"
  /\ judged' = [kind |-> k, ranOn |-> r.ranOn, content |-> content]
  /\ gate' = IdleGate

\* A run still holds the target when the in-flight wait ends (mutagate.mjs:602-603, 609).
GateWaitEnds ==
  /\ gate.phase = "wait"
  /\ Open  \* mutagate.mjs:603
  /\ lock # "free"  \* mutagate.mjs:603
  /\ Decide(target, result, Kind)
  /\ UNCHANGED <<content, result, lock, run, queued, edits, stops>>

\* A final result is there (mutagate.mjs:600, 608; in the retry loop runTarget returns it, mutagate.mjs:470-471).
GateSeesResult ==
  /\ gate.phase \in {"wait", "again"}
  /\ ~Open  \* mutagate.mjs:603, 609
  /\ gate.phase = "again" => lock = "free"  \* mutagate.mjs:466
  /\ Decide(target, result, Kind)
  /\ UNCHANGED <<content, result, lock, run, queued, edits, stops>>

\* The gate runs the target in the hook (mutagate.mjs:609-615).
GateStartsRun ==
  /\ gate.phase \in {"wait", "again"}
  /\ Open  \* mutagate.mjs:609
  /\ lock = "free"  \* mutagate.mjs:609, 466
  /\ gate.retry < 2  \* mutagate.mjs:609
  /\ StartRun("gate")
  /\ gate' = [phase |-> "run", retry |-> gate.retry + 1, had |-> Kind = "retry"]
  /\ UNCHANGED <<content, target, result, queued, stop, judged, edits, stops>>

\* No time is left for a run, or the last run does not fit in it (mutagate.mjs:609, 613-614).
GateOutOfTime ==
  /\ gate.phase \in {"wait", "again"}
  /\ Open  \* mutagate.mjs:609
  /\ lock = "free"  \* mutagate.mjs:609
  /\ gate.retry < 2  \* mutagate.mjs:609
  /\ Decide(target, result, Kind)
  /\ UNCHANGED <<content, result, lock, run, queued, edits, stops>>

\* Two runs are done and the result is still open (mutagate.mjs:609).
GateStopsTrying ==
  /\ gate.phase = "again"
  /\ Open  \* mutagate.mjs:609
  /\ lock = "free"
  /\ gate.retry = 2  \* mutagate.mjs:609
  /\ Decide(target, result, Kind)
  /\ UNCHANGED <<content, result, lock, run, queued, edits, stops>>

\* Another run took the target after the gate's run (mutagate.mjs:609).
GateFindsBusy ==
  /\ gate.phase = "again"
  /\ Open  \* mutagate.mjs:609
  /\ lock # "free"  \* mutagate.mjs:609
  /\ Decide(target, result, Kind)
  /\ UNCHANGED <<content, result, lock, run, queued, edits, stops>>

\* The gate's run publishes, and the gate judges the returned result with no new fingerprint (mutagate.mjs:615-617).
\* An error with one attempt goes round the retry loop.
GateRunPublishes(o) ==
  /\ run.by = "gate"
  /\ run.phase = "measured"
  /\ Fresh  \* mutagate.mjs:515
  /\ result' = NewResult(o)
  /\ lock' = "free"
  /\ run' = NoRun
  /\ IF NewResult(o).status = "error" /\ NewResult(o).attempts < 2
     THEN /\ target' = Published
          /\ gate' = [gate EXCEPT !.phase = "again"]
          /\ UNCHANGED <<stop, judged>>
     ELSE Decide(Published, NewResult(o), NewResult(o).status)
  /\ UNCHANGED <<content, queued, edits, stops>>

\* The files changed in both attempts: runTarget returns null (mutagate.mjs:532, 617-618).
GateRunGivesUp ==
  /\ run.by = "gate"
  /\ run.phase = "measured"
  /\ ~Fresh  \* mutagate.mjs:515
  /\ run.attempt = 2  \* mutagate.mjs:472
  /\ lock' = "free"
  /\ run' = NoRun
  /\ IF gate.had /\ Usable  \* mutagate.mjs:617
     THEN gate' = [gate EXCEPT !.phase = "again"] /\ UNCHANGED <<target, stop, judged>>
     ELSE Decide(target, NoResult, "pending")
  /\ UNCHANGED <<content, result, queued, edits, stops>>

\* The gate deadline kills the run: nothing is published, and the target is pending (mutagate.mjs:498-499, 618).
GateRunClipped ==
  /\ run.by = "gate"
  /\ run.phase \in {"started", "measured"}
  /\ lock' = "free"
  /\ run' = NoRun
  /\ Decide([target EXCEPT !.resultGeneration = 0], NoResult, "pending")
  /\ UNCHANGED <<content, result, queued, edits, stops>>

----------------------------------------------------------------------------
Agent == WriteTest \/ EditTarget \/ OutsideEdit \/ AskStop
System == \/ RunnerMeasures \/ RunStartsOver
          \/ HandlerStarts \/ HandlerSkips \/ HandlerGivesUp
          \/ \E o \in Outcomes : HandlerPublishes(o)
          \/ GateWaitEnds \/ GateSeesResult \/ GateStartsRun \/ GateOutOfTime
          \/ GateStopsTrying \/ GateFindsBusy \/ GateRunGivesUp \/ GateRunClipped
          \/ \E o \in Outcomes : GateRunPublishes(o)
Next == Agent \/ System
Spec == Init /\ [][Next]_vars

----------------------------------------------------------------------------
\* P1. The agent never stops without a message unless the target has a passing result that was measured on the tests and the code as they were when the gate answered.
\* Harm: the agent stops on a weak test with no word from mutagate. Code: gate (mutagate.mjs:587-639) and the publish check of runTarget (mutagate.mjs:477-478, 512-515).
SilentStopMeansPassOnTheseFiles ==
  stop = "allowed" => judged.kind = "pass" /\ judged.ranOn = judged.content

\* P2. A result that the gate can use was measured on the tests and the code as they are now.
\* Harm: status, check and the gate show a score that belongs to other file contents. Code: runTarget (mutagate.mjs:478, 512-515) and loadResult (mutagate.mjs:538-546).
UsableResultIsOfTheseFiles ==
  Usable => result.ranOn = content

\* P3. The agent never stops on a score below the threshold that the gate never blocked it for. Code: claimBlock (mutagate.mjs:573-583).
BelowBlocksBeforeStop ==
  (stop = "warned" /\ judged.kind = "below") => target.belowBlocks > 0

\* P4. The gate blocks the agent at most maxRounds times for one target on a low score, and at most maxRounds + 2 times in all
\* (the pending and the failing-tests block, once each). Code: claimBlock (mutagate.mjs:577-579).
BlocksAreBounded ==
  /\ target.belowBlocks <= MaxRounds
  /\ target.allBlocks <= MaxRounds + 2

\* Goal, expected to break: the agent can stop without a message on a pass of the files as they are.
\* Its counterexample shows that the model reaches a clean stop, so P1 is not true only because no stop happens.
GoalNeverStopsClean ==
  ~(stop = "allowed" /\ judged.kind = "pass" /\ judged.ranOn = judged.content)
=============================================================================
