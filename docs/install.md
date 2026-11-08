# Install, upgrade and uninstall

The short path is in the [README Quick start](https://github.com/keyboardsamurai/mutagate#quick-start). This page has the details.

Needs Node 22+, Git and the language toolchain ([languages](https://github.com/keyboardsamurai/mutagate#languages)). No npm dependencies or build step. Project build files and configs stay untouched. Older target frameworks need their runtime.

## Install

Run one block in the project root (Git top level). `<skill>` below is the skill dir that block installs: `.claude/skills/mutagate` for Claude Code, `.agents/skills/mutagate` for Codex and OpenCode, `.pi/skills/mutagate` for Pi.

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

`npx skills` sends its own install telemetry; set `DISABLE_TELEMETRY=1` to turn it off. mutagate sends none.

A successful install ends with `Next: run <skill>/scripts/mutagate doctor, then restart your agent so it loads the hooks.` Codex adds `In Codex, open /hooks and trust mutagate.` Trust again after each install.

`doctor` checks config, toolchain, jars, adapter and one synthetic mutation. Its first line is `mutagate 0.9.1`; a full pass ends with `All checks passed. Restart your agent so it loads the hooks.` The first run downloads tools and does a cold build. Expect a few minutes the first time; C# cold builds take longer (see [Runners](https://github.com/keyboardsamurai/mutagate#runners)).

## `--agent auto`

Use an explicit `--agent`. Without one, or with `--agent auto`, `install` installs for the harness dirs it finds. If it finds none, it prints `no harness detected in <repo>; run one of:` and one `<skill>/scripts/mutagate install --agent <harness>` line per harness on stderr, and exits 2.

## Scope, paths and Windows

All commands accept `--repo <directory>` (Windows: `scripts\mutagate.cmd`). Install keeps unrelated hooks.

A project install inside Git uses repo-relative hook commands ([ADR-0013](https://github.com/keyboardsamurai/mutagate/blob/main/docs/adr/0013-project-hooks-use-repo-relative-paths.md)), so commit the skill dir, the harness config (`.claude/settings.json`, `.codex/hooks.json`, `.opencode/plugins/mutagate.js` or `.pi/extensions/mutagate.ts`) and `.mutagate/config.json`, and every clone gets the same gate. Each teammate needs Node 22+ and the toolchain; without them the hooks fail open and do not block.

User scope (`--scope user`), a skill outside Git, and Windows write machine-local absolute paths: do not commit them. On macOS and Linux these commands run the absolute `scripts/hook`, so the hooks keep working after a Node upgrade (nvm, Homebrew) removes the Node that ran `install`. Claude started in a subdirectory may not load root settings; start `claude` in the Git top level.

`install` saves its Node 22+ path in the gitignored `scripts/.node-path`. The hook wrapper and adapters pick Node from `MUTAGATE_NODE`, then that file, then PATH.

## Pinned version

Replace `#skill` with `#skill-v0.9.1` in the `npx skills add` line.

## Upgrade

Run the same `npx skills add` line again, then `<skill>/scripts/mutagate install --agent <harness>` again. Codex: trust mutagate in `/hooks` again. `install` writes its version and scope into the SessionStart hook command (OpenCode and Pi: into the adapter); until you run it again, each session starts with `Hooks are from mutagate X, skill is Y: rerun … install` and the command to run, and `doctor` warns for each such project or user install ([ADR-0017](https://github.com/keyboardsamurai/mutagate/blob/main/docs/adr/0017-install-stamp-in-the-hook-config.md)).

## Uninstall

```sh
<skill>/scripts/mutagate uninstall --agent <harness>
npx skills remove mutagate -y
```
