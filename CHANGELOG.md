# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/). Before 1.0, a minor version can break config or output.

## [Unreleased]

## [0.9.0] - 2026-10-06

First public release (beta).

### Added

- Scoped mutation runs when an agent writes a test: PostToolUse registers the test's targets and a detached worker runs the runner in the background.
- Gate at Stop, SubagentStop and TaskCompleted, and in `mutagate check`: blocks while a target scores below `threshold` (default 0.8), for up to `maxRounds` (default 2); `mode: "advise"` never blocks.
- Runners: PIT 1.21.0 for Java and Kotlin (SHA-256-pinned jars, Kotlin Tier B junk filter, optional licensed Arcmutate Tier A), mutmut 2.5.1 / 3.8.0 for Python (pip or uv), Stryker 9.1.1 for TypeScript/JavaScript (Jest, Vitest), gomutants 0.6.1 with gremlins 0.6.0 fallback for Go, Stryker.NET 5.0.0 for C# (xUnit).
- Harnesses: Claude Code and Codex CLI (native hooks), OpenCode (plugin) and Pi (extension).
- Commands: `run`, `check`, `status`, `detect`, `doctor`, `waive`, `install`, `uninstall`, `--version` / `version`.
- Fingerprints that make results stale after test, production, config or build-input edits.
- Agent-caused errors (red or non-compiling tests, red baseline) block once; infrastructure errors fail open; error results retry once.
- Waivers: agents propose, humans approve.
- Portable project installs: hooks run through a Git-top-level command, so a committed skill dir works in each clone (ADR-0013).
- Install from the generated `skill` branch with `npx skills add keyboardsamurai/mutagate#skill -a <harness> --copy` (ADR-0014); each release attaches the package tarball, `SHA256SUMS` and a build provenance attestation.
- `doctor` prints the version first, hides the tested-versions JSON unless `--json`, and ends a full pass with the restart instruction.
- `install --agent auto` without a detected harness prints the install command per harness and exits 2.
- Live eval suite (`npm run eval`): every harness × language pair passed the `natural` and `forced` scenarios; records in `test/evidence/live/`.
- `SECURITY.md`, `THIRD_PARTY.md`, `CONTRIBUTING.md`, issue templates.

### Known limitations

- Windows is experimental.
- Tool binaries from `go install` and NuGet are not hash-pinned by mutagate.
- Five matrix cells passed one of two runs (see the README).

[Unreleased]: https://github.com/keyboardsamurai/mutagate/compare/v0.9.0...HEAD
[0.9.0]: https://github.com/keyboardsamurai/mutagate/releases/tag/v0.9.0
