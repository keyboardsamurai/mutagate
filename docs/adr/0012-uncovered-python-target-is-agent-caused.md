# ADR-0012: Uncovered Python target is agent-caused
Status: accepted 2026-09-16
Concern: mutmut can exit 1 with no results because no test exercises a mutant. M7-12 treated this as an infrastructure error.
Decision: The error names the registered tests and is agent-caused. Stop blocks once, then allows with a warning. This is not a scoped-copy error.
Rationale: The agent chose the target or wrote a test that never calls it.
Alternatives: Final unscored would allow a mis-targeted test. An infrastructure error hides the actionable cause.
Consequences: Check exits 3. Mutmut 3 cannot score a module containing only re-exports. The error retry still applies.
Related: ADR-0002, ADR-0003, ADR-0006
