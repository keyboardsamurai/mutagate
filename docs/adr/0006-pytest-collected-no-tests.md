# ADR-0006: Pytest collected no tests
Status: accepted 2026-09-16
Concern: mutmut reports "runner returned 5" when pytest collects no test in the scoped copy. The cause is either the agent's test or mutagate's scoping.
Decision: On "runner returned 5", mutagate runs the registered tests in the repo itself. When the repo also collects no test, the result is an agent-caused error and blocks once. The agent's test file or function names are wrong. Otherwise the result is final unscored; an input is missing from the scoped copy. That result fails open and is not retried.
Rationale: The scoped copy can collect nothing through mutagate's own scoping. An agent's test that pytest never collects must not pass silently.
Alternatives: Always final unscored; fails open on an agent mistake. Always error; blames the agent for scoping bugs. Both rejected.
Consequences: The pytest exit-5 exclusion in D2 (ADR-0002) is superseded. "runner returned 5" is neither a red baseline nor no mutants to test.
Related: ADR-0002, ADR-0004
