# GitHub Copilot

mutagate gates GitHub Copilot CLI on macOS and Linux: local, in a trusted folder, with the Copilot sandbox off. Tested version: Copilot CLI 1.0.107. The live eval passed for all six languages (README matrix). Decisions: [ADR-0015](adr/0015-inherited-claude-hooks-are-inert-under-copilot.md), [ADR-0018](adr/0018-copilot-completion-gate.md) (gate), [ADR-0019](adr/0019-copilot-outbox-delivery.md) (reports), [ADR-0020](adr/0020-copilot-payloads-and-sessions.md) (payloads and sessions), [ADR-0021](adr/0021-copilot-boundaries.md) (boundaries).

## Install

```sh
npx skills add keyboardsamurai/mutagate#skill -a github-copilot --copy
.agents/skills/mutagate/scripts/mutagate install --agent copilot
.agents/skills/mutagate/scripts/mutagate doctor
```

`install` writes `.github/hooks/mutagate.json`; with `--scope user`, `$COPILOT_HOME/hooks/mutagate.json`, else `~/.copilot/hooks/mutagate.json`. It refuses the second scope. Scope, upgrade, uninstall and Windows: [install.md](install.md). Keep one skill copy: Copilot loads skills from `.github/skills`, `.agents/skills` and `.claude/skills`, and `doctor` warns when the copy that Copilot loads has another version than the copy that the hooks run.

## Hooks

| Copilot event | mutagate event | What it does |
|---|---|---|
| `sessionStart` | `SessionStart` | Sends the `mutagate … active` banner, or a rerun notice after a skill update, as `additionalContext`. |
| `preToolUse` (`create`, `edit`, `str_replace_editor`, `apply_patch`) | `PreToolUse` | Denies an edit of `.mutagate/waivers.json`. |
| `postToolUse` (the same tools, `bash`, `powershell`, `read_bash`) | `PostToolUse` | Registers a written test and starts the background run. It is also a delivery point for reports. |
| `subagentStart` | `SubagentStart` | Records the subagent and its parent, so subagent edits join the root session. |
| `agentStop` (`timeoutSec` 600) | `Stop --timeout 600` | The gate. |

Each command has `--harness copilot` and exits 0, also without the skill dir, Git or Node: Copilot denies the tool call when a `preToolUse` hook fails. mutagate writes no stderr; only a missing Git, Git repo or Node gives one stderr line from the shell, Git or the `hook` wrapper. Copilot has no async hooks, so a test edit starts a spawned handler: a detached `hook PostToolUse --mutate --harness copilot` process that runs the stale targets after 6 s without edits.

## The gate

With the `agentStop` timeout T = 600 s, the margin M is 30 s. The gate stops new work at G = min(`gateBudgetSec`, T − 2M), 120 s by default. It waits for a run in flight and runs a stale target only when its last run fits before G. A block is one `{"decision":"block","reason":…}` object, and the reason reaches the model as the next prompt. Blocks per target follow `maxRounds`, as for Claude Code.

- A target still pending at G blocks once with `results pending; run … check --wait N (set bash initial_wait >= N+30)`. The bash tool puts a command in the background after `initial_wait` (default 30 s). When no run is in flight, the gate also starts a worker, because a `-p` session can end with no more tool calls.
- After 8 blocks in a row, Copilot ends the turn. At that point mutagate allows with `Copilot block limit (8 in a row)` and does not use a round.
- At W = T − M (570 s), a watchdog allows, writes the trace decision `deadline` and stops the runs. Copilot kills the hook at T, but that kill does not reach the runner processes.
- The `agentStop` of a subagent does not gate. The root `agentStop` gates the subagent's edits.
- When the gate allows, its messages (round cap, warnings, the `advise` report) are `{"type":"progress"}` lines. The model does not see them, and `-p` shows them nowhere. `status` and `MUTAGATE_TRACE=1` show what happened.
- During the wait, `-p` and text mode print nothing.

## Reports during the session

The spawned handler puts the report of each run that is not a pass into the session outbox, one entry for each target. The next `postToolUse` of the root agent for a write or shell tool (`read_bash` included) is a delivery point: it sends the entries that still give the current result and that the agent has not seen, as `additionalContext` of 1,800 characters or less. A stale entry, for example after a later edit, goes away without delivery. A subagent call is not a delivery point. A block, `check` or `run --sync` that shows a result removes its entry. When the session ends before a delivery point, only the gate decision gets to the agent.

A delivery point with entries computes the fingerprint of each target: about 40 ms in a small repo, about 470 ms in a module of 15,000 files.

## Sessions

The hooks use the payload `sessionId`. A subagent call follows `parentAgentId` through the `subagentStart` records to the root session. CLI calls in the root agent's shell join the session through `COPILOT_AGENT_SESSION_ID`. A subagent's shell has another id, so its CLI calls do not join the root session: `check` there finds no targets, but the root `agentStop` still gates the subagent's edits. The repo is the Git top level of the payload `cwd`, also for `run`, `check`, `status` and `waive` in the root agent's shell. `waive --apply` is refused when `COPILOT_CLI` is set.

## Next to other installs

Copilot also runs the hooks in `.claude/settings.json`. mutagate keeps those calls inert (no state, no runs, no gate) when the payload has a top-level `timestamp`, as each recorded Copilot CLI call has, so a repo with both installs gets one effect per event. A call without `timestamp` runs as Claude Code ([ADR-0015](adr/0015-inherited-claude-hooks-are-inert-under-copilot.md)). Without a Copilot hook file, such a session starts with `mutagate inactive under Copilot`, except in a cloud agent job without `copilotCloud: true`. Copilot runs every hook file that it finds: with two mutagate files, each `agentStop` runs the gate two times. A blocking `agentStop` hook of another tool that runs after mutagate's replaces mutagate's reason and uses its block.

## Boundaries

| Case | Status |
|---|---|
| Copilot CLI, macOS and Linux | Supported. Live eval passed on macOS. |
| VS Code, Copilot harness | Same hook file. Not claimed until a passing smoke record `test/evidence/vscode/copilot-<os>.json` exists for the release (#48). |
| Copilot cloud coding agent | Inert by default. Experimental opt-in: `"copilotCloud": true` in `.mutagate/config.json`; two cloud sessions passed with it ([validation](validation.md)). mutagate detects it by `COPILOT_AGENT_JOB_ID` or `COPILOT_AGENT_CALLBACK_URL` in the hook environment (seen in a cloud job, spike S16). The cloud agent also runs the hooks in `.github/copilot/settings.json` and `.claude/settings.json`. Its hook environment holds tokens (`COPILOT_SDK_AUTH_TOKEN`, `GITHUB_VERIFICATION_TOKEN`) that a run would inherit. |
| Copilot sandbox (CLI `--sandbox`, VS Code `chat.agent.sandbox.enabled`) | Not supported. When the cache root is not writable, SessionStart and each `agentStop` say `mutagate inactive: cannot write <path>`. |
| Windows | Experimental, no claim. Only an install made on Windows writes a real PowerShell command; a project file from macOS or Linux does nothing there. |
| Remote hosts, dev containers, Codespaces | Not tested. Install and run `doctor` where the agent runtime runs. |
| Tests written by a shell command | Not seen. The agent registers them with `mutagate run <test>`. |

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| The hooks never run | The folder is not trusted, or a policy allows only managed hooks | Trust the folder. `copilot -p`: `--trust-folder`; with `--resume`, set `GITHUB_COPILOT_PROMPT_MODE_REPO_HOOKS=true`. Ask your admin to allow repo hooks. |
| `mutagate inactive under Copilot` | Only the Claude Code install exists | `<skill>/scripts/mutagate install --agent copilot` |
| `mutagate inactive: cannot write <path>` | The Copilot sandbox | Run Copilot without its sandbox |
| The session waits silently at the end | The gate, up to 570 s | Wait; `MUTAGATE_TRACE=1` records each decision |
| `check --wait` goes to the background | The bash `initial_wait` is shorter than the wait | Set `initial_wait` to N + 30 or more, as the message says |
| With a Claude Code install, the agent waits for a mutation run after each test edit | A `.claude/settings.json` hook call without a top-level `timestamp` runs as Claude Code: `MUTAGATE_TRACE=1` shows harness `claude`, not decision `inherited` | Open an issue with the payload (`MUTAGATE_RECORD=1` records it) |
| `WARN copilot hook files: Copilot runs each of …` in `doctor` | Two mutagate hook files | `uninstall --agent copilot` in one scope |
