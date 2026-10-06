# ADR-0008: Usage errors exit 2
Status: accepted 2026-09-16
Concern: The PRD (FR-1.2) has no usage exit code. `run --help` exited 3 and failed `no-errors` in 11 otherwise passing eval runs.
Decision: A usage error exits 2 and is not traced as an error. Usage errors: a missing, outside-repo or non-test test file; a bad `--wait`; bad `waive` arguments. Also: a survivor id not in the session's fresh results; an unknown command. `<command> --help` and `-h` print the usage line and exit 0. Under `hook`, a usage error is traced and exits 0.
Rationale: A wrong command line is neither a result nor an infrastructure failure. The eval checker and agents must tell them apart.
Alternatives: Keep exit 3; usage mistakes count as infrastructure errors. Exit 1; collides with below threshold. Both rejected.
Consequences: `run --sync` and `check` exit 0 pass, 1 below or unscored, 2 usage, 3 error.
Related: ADR-0007
