# Security

## Report a vulnerability

Report privately through GitHub Security Advisories: <https://github.com/keyboardsamurai/mutagate/security/advisories/new>. Do not open a public issue for a vulnerability. Only the latest release gets fixes.

## Threat model

- **Hooks run your code.** A mutation run builds the project and runs its tests (Gradle, Maven, `go test`, `dotnet test`, pytest, Jest, Vitest) as your user, **outside the agent sandbox**. Build scripts, test code and dependencies that the agent wrote or changed run with your permissions. Do not install mutagate in a repo whose build you would not run yourself.
- **The gate is workflow control, not enforcement.** It keeps an agent honest; it does not stop a hostile agent or user. Agents can edit config; waiver approval (`waive --apply`) is refused in agent sessions unless `allowAgentWaivers: true`.
- **Fail open.** Hook exceptions, malformed payloads and infrastructure errors (missing toolchain, download failure) never block. Only a deliberate gate decision blocks.
- **Bounded blocking.** After `maxRounds` (default 2) blocks per target, completion warns and allows.
- **Kill switch.** `MUTAGATE_MODE=advise` (env) or `"mode": "advise"` (`.mutagate/config.json`) reports without blocking. `uninstall --agent <harness>` removes the hooks.

## Files that `install` changes

`install` merges its hooks into the harness config and keeps unrelated entries. `uninstall` removes only mutagate entries.

| Harness | `--scope project` (default) | `--scope user` |
|---|---|---|
| Claude Code | `.claude/settings.json` | `~/.claude/settings.json` |
| Codex CLI | `.codex/hooks.json` | `$CODEX_HOME/hooks.json` or `~/.codex/hooks.json` |
| OpenCode | `.opencode/plugins/mutagate.js` | `$XDG_CONFIG_HOME/opencode/plugins/mutagate.js` or `~/.config/opencode/plugins/mutagate.js` |
| Pi | `.pi/extensions/mutagate.ts` | `~/.pi/agent/extensions/mutagate.ts` |

`install` also writes `scripts/.node-path` (the absolute Node path, gitignored) in the skill dir. `waive --apply` writes `.mutagate/waivers.json`. mutagate never changes project build files or mutation-engine configs; runners use scratch configs.

## Network

mutagate itself sends no telemetry and uploads nothing. It downloads only when a tool is missing; `MUTAGATE_OFFLINE=1` disables these downloads.

| What | Endpoint | Integrity |
|---|---|---|
| PIT jars (Java, Kotlin) | Maven Central, `https://repo1.maven.org/maven2/` (`scripts/cache-jars.mjs` also allows `repo.maven.apache.org`) | SHA-256 pinned in `references/jars.json` |
| gomutants 0.6.1, gremlins 0.6.0 (Go) | `go install`: Go module proxy and checksum database (your `GOPROXY`/`GOSUMDB`, default `proxy.golang.org`, `sum.golang.org`) | Go checksum database; not pinned by mutagate |
| Stryker.NET 5.0.0 (C#) | `dotnet tool install`: NuGet (default `api.nuget.org`, or your NuGet config) | **not hash-pinned yet** |
| Arcmutate Kotlin plugin | Maven Central, only with an Arcmutate licence or `kotlinTier: "A"` | SHA-256 pinned |

Builds and tests resolve their own dependencies through your build tool (Gradle, Maven, npm, uv, NuGet); mutagate does not change that. Tool binaries from `go install` and NuGet are not hash-pinned by mutagate yet; this is planned.

The `skills` CLI (`npx skills add`) sends its own install telemetry. Set `DISABLE_TELEMETRY=1` to turn it off.

## Disk and state

| Path | Contents |
|---|---|
| `~/.cache/mutagate/` (or `$XDG_CACHE_HOME/mutagate`, `CLAUDE_PLUGIN_DATA`; Windows `%LOCALAPPDATA%\mutagate`) | cache root |
| `<root>/jars/` | PIT jars |
| `<root>/tools/<name>@<version>/` | gomutants, gremlins, Stryker.NET |
| `<root>/repos/<sha1 of repo path>/` | per-repo data: session `state/`, `history/`, `logs/`, `reports/`, `classpath/`, `locks/`, C# `dotnet/` scratch copies, `trace.jsonl` with `MUTAGATE_TRACE=1` |
| `<root>/recorded/` | hook payloads, only with `MUTAGATE_RECORD=1` |
| `<root>/config.json` | optional user config |

State files are written with mode 0600. Logs and scratch copies hold project source and test output. Purge everything: `rm -rf ~/.cache/mutagate` (or the root above). Purge one repo: remove its `repos/<sha1>` dir.

## Third-party tools

See [THIRD_PARTY.md](THIRD_PARTY.md) for the mutation engines and jars, their licenses and where they come from.
