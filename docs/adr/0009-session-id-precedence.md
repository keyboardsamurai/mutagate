# ADR-0009: Session id precedence
Status: accepted 2026-09-16
Concern: The agent's CLI calls must join the session its hooks use. The PRD order (§8.5: payload `session_id`, `MUTAGATE_SESSION`, ppid) left Codex, OpenCode and Pi CLI calls in other sessions.
Decision: The session id is the first present of: payload `agent_id`, payload `session_id`, env `MUTAGATE_HOOK_SESSION`, `CODEX_THREAD_ID`, `CLAUDE_CODE_SESSION_ID`, `MUTAGATE_SESSION`. Without any of them, the id is a `ppid-` fallback. Workers, the OpenCode adapter and the Pi adapter set `MUTAGATE_HOOK_SESSION`. `MUTAGATE_SESSION` is for bare CLI use without hooks and never overrides a harness id.
Rationale: A subagent's `agent_id` keeps its own gate. Harness ids reach the CLI through the environment, so the CLI joins without agent cooperation.
Alternatives: Let `MUTAGATE_SESSION` win; agents chose their own session and escaped the gate. Rejected.
Consequences: A `ppid-` session is shared by every process under one parent for 12 hours. Any id from a hook or harness marks an agent session (ADR-0007).
Related: ADR-0007
