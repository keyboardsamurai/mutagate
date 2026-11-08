# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/). Before 1.0, a minor version can break config or output.

## [Unreleased]

## [0.9.1] - 2026-11-07

### Added

- After the skill is updated and `install` is not run again, SessionStart says `Hooks are from mutagate X, skill is Y: rerun mutagate install --agent <harness>`, with `--scope user` for a user install, and `doctor` warns for each such project or user install (`WARN <harness> <scope> install`). `install` now writes its version and scope into the SessionStart hook command, and the OpenCode and Pi adapters send them in their payload; hooks from earlier versions have none, so run `install` again once after this upgrade (ADR-0017).

### Changed

- The runners moved from `mutagate.mjs` to the lazily loaded `scripts/runners.cjs`, which is hashed into fingerprints.
- In a Git repo, detection and target resolution use the files Git lists (`git ls-files -co --exclude-standard`) instead of a repo walk, so a file that Git ignores no longer counts for detection and is no longer a target, and files in submodules or nested repositories are no longer targets (ADR-0016). Fingerprints and Python and .NET copies still include ignored files.

### Fixed

- `doctor` no longer fails `project adapter installed` when the harness has only a user install: the check is now `adapter installed` and counts project and user installs.
- Mutation tool process trees (PIT, Stryker, mutmut, Stryker.NET, Go tools, Maven/Gradle builds) no longer outlive mutagate: it kills them when it exits, and after SIGINT, SIGTERM or SIGHUP (Ctrl-C on `run --sync`, a harness killing a hook at its timeout) it kills them and exits with 128+signal number.
- A lock whose pid was reused by an unrelated process (after a reboot or crash) no longer keeps a target in flight: lock holders renew their lock every 10 s, and a lock whose holder is dead or has not renewed it for 60 s is abandoned. Only one waiter takes over an abandoned lock, and a process deletes only a lock it still holds.
- The async PostToolUse hook (`--mutate`) no longer runs past its 900 s timeout, where the harness killed it mid-run and lost the results: it ends within 850 s, starts a stale target only when its last run fits in the time left, and leaves skipped or cut targets pending for the gate.
- A run cut at the gate deadline or the rerun deadline is no longer reported as exceeding `runBudgetSec` when it started with the full run budget (after a wait for the target lock or a rerun after edits).
- A run killed at its deadline is no longer published as an `error` result when the tool closes with an exit code instead of a signal (on Windows, or when the tool exited but a child process kept its output open).
- An invalid `.mutagate/waivers.json` no longer turns the gate off: it adds no waivers and the report warns about it. Corrupt cached JSON (a torn write after a crash) no longer does either: a corrupt result or classpath file counts as missing and reruns, and a corrupt session state file starts blank with a note on stderr. An unexpected error in one target skips only that target, with a warning, and `check` exits 3, as for an error result.
- `status --json` and `run --sync --json` no longer report a gremlins result as `gomutants` after it is loaded back from the cache.
- A directory that mutagate cannot read (such as a Docker volume owned by another user) no longer disables mutagate for the whole repo: detection, test registration and fingerprints skip it, and `run` no longer exits 3. A file that mutagate cannot read no longer does this either: it counts as empty, and Python and .NET runs do not copy it. Repo scans also skip virtual environments of any name (a subdirectory with `pyvenv.cfg`), `htmlcov/`, `test-results/`, and `.coverage` data, `.DS_Store`, `Thumbs.db` and editor swap and backup files, so these no longer make results stale or get copied for Python runs.
- Concurrent runs of different Java or Kotlin targets in one repo (gate, async hook, workers) no longer compile at the same time and write the same `target/` or `build/` outputs: the Maven or Gradle compile step holds one lock per repo.
- An absolute path through a symlinked alias of the repo (macOS `/tmp` → `/private/tmp`, a symlinked projects dir) is no longer treated as outside the repo, so a test written through it is registered.
- TypeScript runs no longer end as `error` results ("No tests were executed") when the path of the cache root (`CLAUDE_PLUGIN_DATA`, `XDG_CACHE_HOME` or `~/.cache`) contains a symlink, such as a symlinked home dir or the macOS temp dir: mutagate uses the real path of the cache root, so Jest and Vitest get real paths for the Stryker sandbox and config.
- A deleted hook cwd (the agent ran `cd build/x`, then a clean) no longer makes every hook fail, Stop included, for the rest of the session: the hook uses `CLAUDE_PROJECT_DIR`, else its own working directory.
- mutmut 2 runs no longer fail when the `VIRTUAL_ENV` path contains a space.
- A backward clock jump no longer stretches the async hook's 6 s quiet wait or a worker's 3 s start delay.
- Hooks on large repos are faster: test edits and SessionStart no longer compile each glob again for every repo file (target resolution on a 15,000-file repo took 300 ms), a finished run no longer hashes the project inputs while it holds the session state lock (other hooks waited up to 5 s, then dropped their update with "session state busy"), and a result loaded again in one process is not normalized again (per-mutant source reads and a `git diff`). `npm run test:performance` also measures a 15,000-file Git repo.
- The cache no longer grows without limit (it reached 3.5 GB in weeks on an eval machine): once a day SessionStart starts a background prune that deletes report dirs older than 24 h (left by killed runs or `MUTAGATE_DEBUG=1`), session state and results unused for 14 days, and the data dir of a repo path that no longer exists, including its .NET scratch copies. A data dir from before this version, which does not record its repo path, is deleted after 14 days unused. A data dir with a held lock is skipped. A `trace.jsonl` over 10 MB moves to `trace.jsonl.1`. `jars/`, `tools/` and `recorded/` stay.
- A failed background spawn (worker or cache prune) no longer crashes the hook, and on Windows these spawns no longer open a console window.
- Hooks installed with absolute paths (user scope, a skill outside the Git top level, no Git) no longer fail with exit 127 after a Node upgrade (nvm, Homebrew) removes the Node that ran `install`: on macOS and Linux the command runs the skill's `scripts/hook`, which picks Node from `MUTAGATE_NODE`, `scripts/.node-path`, then PATH. Run `install` again to get the new command.
- GitHub Copilot, which also runs the hooks in `.claude/settings.json`, no longer denies every file edit when a clone has no skill dir, `git` or Node: on macOS and Linux the Claude SessionStart, PreToolUse and sync PostToolUse commands end in `|| true` and exit 0 in these cases, and `scripts/hook` exits 0 when it finds no Node (before: exit 127). The Stop, SubagentStop, TaskCompleted and `--mutate` commands and the Codex commands do not change. Run `install --agent claude` again to get the new commands.

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

[Unreleased]: https://github.com/keyboardsamurai/mutagate/compare/v0.9.1...HEAD
[0.9.1]: https://github.com/keyboardsamurai/mutagate/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/keyboardsamurai/mutagate/releases/tag/v0.9.0
