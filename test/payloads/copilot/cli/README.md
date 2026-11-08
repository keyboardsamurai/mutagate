# Copilot CLI payloads for inherited Claude hooks

Recorded 2026-11-08 with GitHub Copilot CLI 1.0.104 (models claude-sonnet-5.5 and gpt-6-luna; the gpt run edits through `apply_patch`). The repo had only `.claude/settings.json` with the hook layout of the mutagate Claude install (`asyncRewake` and `TaskCompleted` included); each command saved its stdin. Paths are replaced with `/repo` and `~`.

Facts from the recordings:

- Copilot accepts the Claude settings file and runs every hook in it except `TaskCompleted` (not a Copilot event). The `--mutate` hook runs synchronously: the agent waited for it on each edit.
- Every event carries an ISO `timestamp`. Recorded Claude Code, Codex, OpenCode and Pi payloads (eval runs) never do.
- `tool_name` is the Claude name (`Write`, `Edit`). `tool_input` uses Copilot keys (`path`, `file_text`, `old_str`, `new_str`), or for `apply_patch` is the patch text as a string. PostToolUse has `tool_result`, not `tool_response`.
- A subagent fires `Stop` with its own `session_id` and `agent_id`, then `SubagentStop` in the parent session.
- Hook env set by Copilot: `COPILOT_CLI=1`, `COPILOT_CLI_BINARY_VERSION`, `COPILOT_CLI_RESOLVED_DIST_DIR`, `COPILOT_PROJECT_DIR` and `CLAUDE_PROJECT_DIR` (the repo). No `COPILOT_AGENT_SESSION_ID`.
- VS Code 1.145 (Copilot harness, models Auto and claude-sonnet-5.5) did not run these hooks: its session log has no command hook, and the agent host logged "Hook discovery: Explicit hook plugins could not be loaded".
