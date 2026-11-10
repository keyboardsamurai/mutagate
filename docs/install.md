# Install, upgrade and uninstall

The short path is in the [README Quick start](https://github.com/keyboardsamurai/mutagate#quick-start). This page has the details.

Needs Node 22+, Git and the language toolchain ([languages](https://github.com/keyboardsamurai/mutagate#languages)). No npm dependencies or build step. Project build files and configs stay untouched. Older target frameworks need their runtime.

## Install

Run one block in the project root (Git top level). `<skill>` below is the skill dir that block installs: `.claude/skills/mutagate` for Claude Code, `.agents/skills/mutagate` for Codex, OpenCode and GitHub Copilot, `.pi/skills/mutagate` for Pi.

```sh
# Claude Code
npx skills add keyboardsamurai/mutagate#skill -a claude-code --copy
.claude/skills/mutagate/scripts/mutagate install --agent claude
.claude/skills/mutagate/scripts/mutagate doctor
```

```sh
# Codex CLI (then open /hooks in Codex and trust mutagate)
npx skills add keyboardsamurai/mutagate#skill -a codex --copy
.agents/skills/mutagate/scripts/mutagate install --agent codex
.agents/skills/mutagate/scripts/mutagate doctor
```

```sh
# OpenCode
npx skills add keyboardsamurai/mutagate#skill -a opencode --copy
.agents/skills/mutagate/scripts/mutagate install --agent opencode
.agents/skills/mutagate/scripts/mutagate doctor
```

```sh
# Pi
npx skills add keyboardsamurai/mutagate#skill -a pi --copy
.pi/skills/mutagate/scripts/mutagate install --agent pi
.pi/skills/mutagate/scripts/mutagate doctor
```

```sh
# GitHub Copilot CLI (repo hooks load only in a trusted folder)
npx skills add keyboardsamurai/mutagate#skill -a github-copilot --copy
.agents/skills/mutagate/scripts/mutagate install --agent copilot
.agents/skills/mutagate/scripts/mutagate doctor
```

The Copilot install writes `.github/hooks/mutagate.json`, a file of its own; with `--scope user`, `$COPILOT_HOME/hooks/mutagate.json`, else `~/.copilot/hooks/mutagate.json` (Windows: `%USERPROFILE%\.copilot\hooks\mutagate.json`). It never writes a Copilot `settings.json`. Copilot runs every hook file it finds, so `install` refuses the second scope: it exits 2 and names the file of the first. Run `uninstall --agent copilot` (with `--scope user` for the user file) first to change scope. Every Copilot hook command exits 0, also without the skill dir, Git or Node, because Copilot denies the edit when a `preToolUse` hook fails. Windows is experimental: only an install made on Windows writes a real PowerShell command, and a project file committed from macOS or Linux does nothing there ([ADR-0021](https://github.com/keyboardsamurai/mutagate/blob/main/docs/adr/0021-copilot-boundaries.md)). `doctor` warns when Copilot runs more than one mutagate hook file, and when the skill copy that Copilot loads (`.github/skills`, else `.agents/skills`, else `.claude/skills`) has another version than the copy that its hooks run: keep one copy. How the Copilot gate works and its limits: [copilot.md](copilot.md).

`npx skills` sends its own install telemetry; set `DISABLE_TELEMETRY=1` to turn it off. mutagate sends none.

A successful install ends with `Next: run <skill>/scripts/mutagate doctor, then restart your agent so it loads the hooks.` Codex adds `In Codex, open /hooks and trust mutagate.` Trust again after each install.

`doctor` checks config, toolchain, jars, adapter and one synthetic mutation. Its first line is `mutagate 0.9.1`; a full pass ends with `All checks passed. Restart your agent so it loads the hooks.` The first run downloads tools and does a cold build. Expect a few minutes the first time; C# cold builds take longer (see [Runners](https://github.com/keyboardsamurai/mutagate#runners)).

## `--agent auto`

Use an explicit `--agent`. Without one, or with `--agent auto`, `install` installs for the harness dirs it finds. It selects Copilot when the shell has `COPILOT_CLI` or `COPILOT_AGENT_SESSION_ID` (a Copilot agent shell), or the repo has `.github/hooks/` or `.github/copilot/`; with `--scope user`, also when `COPILOT_HOME` is set or `~/.copilot` exists. `.github/workflows`, `.agents/skills` and `copilot-instructions.md` do not count. A `.claude/` dir that holds only `skills/` (Copilot reads skills there too) selects Claude only when there is no Copilot signal. If it finds none, it prints `no harness detected in <repo>; run one of:` and one `<skill>/scripts/mutagate install --agent <harness>` line per harness on stderr, and exits 2.

## Scope, paths and Windows

All commands accept `--repo <directory>` (Windows: `scripts\mutagate.cmd`). Install keeps unrelated hooks.

A project install inside Git uses repo-relative hook commands ([ADR-0013](https://github.com/keyboardsamurai/mutagate/blob/main/docs/adr/0013-project-hooks-use-repo-relative-paths.md)), so commit the skill dir, the harness config (`.claude/settings.json`, `.codex/hooks.json`, `.opencode/plugins/mutagate.js`, `.pi/extensions/mutagate.ts` or `.github/hooks/mutagate.json`) and `.mutagate/config.json`, and every clone gets the same gate. Each teammate needs Node 22+ and the toolchain; without them the hooks fail open and do not block.

User scope (`--scope user`), a skill outside Git, and Windows write machine-local absolute paths: do not commit them. On macOS and Linux these commands run the absolute `scripts/hook`, so the hooks keep working after a Node upgrade (nvm, Homebrew) removes the Node that ran `install`. Claude started in a subdirectory may not load root settings; start `claude` in the Git top level.

`install` saves its Node 22+ path in the gitignored `scripts/.node-path`. The hook wrapper and adapters pick Node from `MUTAGATE_NODE`, then that file, then PATH.

## Pinned version

Replace `#skill` with `#skill-v0.9.1` in the `npx skills add` line.

## Upgrade

Run the same `npx skills add` line again, then `<skill>/scripts/mutagate install --agent <harness>` again. Codex: trust mutagate in `/hooks` again. Copilot: `install` again in the same scope. `install` writes its version and scope into the SessionStart hook command (OpenCode and Pi: into the adapter); until you run it again, each session starts with `Hooks are from mutagate X, skill is Y: rerun … install` and the command to run, and `doctor` warns for each such project or user install ([ADR-0017](https://github.com/keyboardsamurai/mutagate/blob/main/docs/adr/0017-install-stamp-in-the-hook-config.md)).

## Uninstall

```sh
<skill>/scripts/mutagate uninstall --agent <harness>
npx skills remove mutagate -y
```

Run `uninstall` before `npx skills remove`: it needs the skill dir. `uninstall --agent copilot` deletes the Copilot hook file when it holds only mutagate entries (and then an empty `.github/hooks/`, which `--agent auto` reads as Copilot); it never changes `.claude/settings.json`, and `uninstall --agent claude` leaves the Copilot file unchanged. Copilot hooks left after the skill dir is gone still exit 0.
