# ADR-0004: Pending and final unscored results
Status: accepted 2026-09-16
Concern: Agents read "unscored (0/0)" as "no mutants" and stopped (TRIAGE M6-1, M6-2). A run killed by the gate was published as final. The gate blocked on results that needed no action.
Decision: Pending means no usable result exists: none, or its registered tests were deleted. A final unscored result carries its reason in `error`; `report`, `status`, `check` and Stop print it. Reasons: no mutants to test, every mutant errored, no coverage, run budget exceeded. Also: tests deleted, no tests collected in the scoped copy. No mutants to test is no obligation: no block, not counted in the exit code. Every other final unscored result warns with exit 1; tests deleted blocks once, like pending. A clipped run is never published; the target stays pending. The gate skips an attempt whose budget is below the target's last duration. An attempt with the full run budget always runs (ADR-0005).
Rationale: A reason lets the agent act. A result that cannot change without action must not block. A killed run is not a result.
Alternatives: Treat every unscored result as pending; blocks forever on no mutants. Publish clipped runs; agents concluded there were no mutants (M6-2). Both rejected.
Consequences: Session state keeps each target's last duration. A pending target blocks once, then warns.
Related: ADR-0005, ADR-0006
