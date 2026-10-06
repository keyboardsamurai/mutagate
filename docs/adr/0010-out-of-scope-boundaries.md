# ADR-0010: Out-of-scope boundaries
Status: accepted 2026-09-16
Concern: Some eval findings recur in every sweep. A fix pass must not re-open them.
Decision: mutagate does not resolve a Kotlin test named after a top-level function to a target. It does not change Go `api_test.go` resolution. It does not work around OpenCode and Pi dropping the Stop `systemMessage` on allow. It does not isolate the shared `~/.cache/mutagate` between runs.
Rationale: The M5 fix pass (Q14) and the M6 fix pass (D8) settled these. The first two are open design questions; the cost of all four exceeds their eval value.
Consequences: Unresolved Kotlin and Go tests stay hints, never obligations. OpenCode and Pi agents see no message on allow. An agent can read other runs' state in the shared cache.
