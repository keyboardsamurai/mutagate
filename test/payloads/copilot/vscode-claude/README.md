# VS Code Claude session target payloads

Recorded 2026-11-08 with VS Code 1.145 (Agents window, Session Target Claude, Claude Agent SDK), same repo and hook layout as `../cli`. These are Claude hook calls, not Copilot ones: no `timestamp`, `tool_response` and `file_path`/`old_string` keys, env `CLAUDE_CODE_ENTRYPOINT=sdk-ts` and no `COPILOT_*`. The `--mutate` hook ran async. mutagate must treat them as `claude` (ADR-0015). Paths are replaced with `/repo` and `~`.
