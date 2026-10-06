# ADR-0011: Live eval runs locally by hand, two runs per cell
Status: accepted 2026-09-16
Concern: The PRD (§11.8, §11.10) wants nightly live agent runs in CI containers. Real agents need subscription or OpenRouter credentials and a host with all six toolchains.
Decision: The live eval suite (`npm run eval`, `test/eval/`) runs locally and by hand. There is no spend cap; each run is killed after 30 min. Each cell runs twice. A cell passes when either run passes, and both runs always execute. A passing cell writes `test/evidence/live/<harness>-<lang>-<scenario>.json`. A deterministic test ties every README ✅ to those records. The drift job (`npm run test:drift`) runs locally against payloads the eval recorded with `MUTAGATE_RECORD=1`.
Rationale: CI has neither the credentials nor the toolchains. The second run's anomalies feed bug discovery even when the first run passes.
Alternatives: A nightly CI live job; removed with the old `test/live.mjs`. Stop after the first pass; loses half the anomalies. Both rejected.
Consequences: README ✅ marks depend on hand-run sweeps. The drift job has no CI input.
