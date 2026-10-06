# ADR-0007: `waive --apply` is refused in agent sessions
Status: accepted 2026-09-16
Concern: Waivers need human approval. The harness file-edit guards do not cover the CLI, so an agent could apply its own waiver.
Decision: `waive --apply` is refused when the session id came from a hook payload or a harness environment id. The refusal is a usage error, exit 2, and the usage text says `--apply` is human-only. `allowAgentWaivers: true` lifts it. An agent proposes with `waive <id> --reason <reason>`; a human applies.
Rationale: The session id shows whether an agent runs the command. Bare CLI use by a human keeps `--apply`.
Alternatives: Refuse `--apply` everywhere; humans lose the command. Trust the file-edit guards alone; the CLI bypasses them. Both rejected.
Consequences: A human in an agent's shell edits `.mutagate/waivers.json` or sets `allowAgentWaivers`.
Related: ADR-0008, ADR-0009
