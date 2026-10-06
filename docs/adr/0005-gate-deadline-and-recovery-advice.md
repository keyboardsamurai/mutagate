# ADR-0005: Gate deadline and recovery advice
Status: accepted 2026-09-16
Concern: A harness Stop hook must end in bounded time whatever the config. A target clipped by the gate looped on the same advice for 30 minutes (TRIAGE M7-11).
Decision: Hooks always run under the gate deadline (`gateBudgetSec`, default 120 s). Only an explicit CLI `check --wait N` extends the deadline, to max(`gateBudgetSec`, N). The in-flight wait (`gateWaitSec`) only bounds the wait for a running worker. It never enlarges a budget. The gate skips an attempt whose budget is below the target's last duration. An attempt with the full run budget (`runBudgetSec`) always runs. After a clipped run, the advice names a wait of elapsed + `runBudgetSec` + 1 s. The extra second covers the gate setup, which rounds the run budget down. The next attempt then has the full run budget and is final. When the last duration exceeds `runBudgetSec`, the advice is to raise `runBudgetSec` or split the test.
Rationale: `--wait` is a deadline, not a sleep, so over-advising costs nothing. The previous "+5 s" advice re-clipped a long C# run many times.
Alternatives: Let `gateWaitSec` raise the hook budget; hooks become unbounded by config. Double the advised wait; still several wasted attempts. Both rejected.
Consequences: `check --wait N` can hold the CLI for N seconds. The advised wait can exceed what the run needs.
Related: ADR-0003, ADR-0004
