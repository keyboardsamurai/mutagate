# ADR-0002: Agent-caused runner errors block once
Status: accepted 2026-09-16
Concern: The PRD (FR-5.2) says an error result allows with a warning. In M5, 6 of 8 C# forced runs wrote a non-compiling test, and Stop allowed at once.
Decision: An error result is agent-caused when a failing runner command names a registered test of the session. A test-glob match or an edited file in that output counts the same. It is also agent-caused when the runner reports a red baseline. Kotlin `e:` compiler lines count. The gate blocks once per target on an agent-caused error. The next gate allows with the error as a warning. Every other error allows with a warning. `check` and `run --sync` exit 3 on any error.
Rationale: The agent can fix its own tests. An infrastructure error is not the agent's fault and must not stop it.
Alternatives: Block on every error; agents get stuck on build races. Never block; agents finish with red tests. Both rejected.
Consequences: The report ends with a request for green tests, not the infrastructure hint. A production file the agent never edited still fails open. Python tests that pass in the repo but fail in the scoped copy mark a scoping error. That error fails open. The block counts against the round cap and is never reset in the session.
Related: ADR-0003 (the retry runs first). ADR-0006 supersedes the pytest exit-5 exclusion of D2: "runner returned 5" now triggers a repo probe.
