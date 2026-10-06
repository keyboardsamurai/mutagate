# ADR-0003: Error results are retried once
Status: accepted 2026-09-16
Concern: The PRD (FR-5.2) says errors are final. Transient Stryker.NET build races became final errors, and Stop allowed in under 100 ms.
Decision: An error result records its attempts. The gate and `run --sync` run the target again once while the error has one attempt and the same fingerprint. The gate first waits for an in-flight run up to the in-flight wait, then re-runs within the gate deadline. When the re-run returns nothing because another run holds the target, the cached error stands. A clipped re-run clears the cached error, and the target is pending (ADR-0005).
Rationale: One retry absorbs a transient failure at low cost. A second identical failure is real.
Alternatives: Retry until the deadline; masks real errors and burns budget. No retry; the M5 evidence rejects it.
Consequences: A Stop hook may run a mutation run inside the hook, within the gate deadline (ADR-0005). The retry runs before the agent-caused block (ADR-0002).
Related: ADR-0002, ADR-0005
