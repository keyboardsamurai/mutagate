# Contributing

Thanks for helping. Open an issue before a large change, so we agree on the approach first. Report vulnerabilities privately ([SECURITY.md](SECURITY.md)). Everyone follows the [code of conduct](CODE_OF_CONDUCT.md).

## Setup

mutagate is Node 22+ with only Node built-ins: no npm dependencies, no build step. Clone and run:

```sh
npm test                                   # deterministic suites, no toolchains needed
node --test test/core.test.mjs             # one file
node --test --test-name-pattern '<regex>' test/core.test.mjs
```

[AGENTS.md](AGENTS.md) has every command, the architecture and the rules below in full. Coding agents read it automatically.

## Rules that tests enforce

- Never edit `scripts/mutagate-hook.cjs` by hand. Edit `scripts/mutagate.mjs`, then run `npm run generate:runtime`. `mutagate.mjs` may use only top-level single-line `import x from '...'` and `export function` / `export const`.
- Regenerate `scripts/hooks.json` with `npm run generate:hooks` after hook wiring changes.
- `scripts/mutagate.mjs` stays under 1,400 lines. Put substantial new logic in a lazily required `.cjs` helper; add helpers that affect results to the `fingerprint` list.
- The packaged skill (`SKILL.md`, `README.md`, `LICENSE`, `scripts/`, `references/`) stays under 300 KB.
- Hooks fail open. Exit codes: see README "Commands".
- Every ✅ in the README matrix needs passing `natural` and `forced` records in `test/evidence/live/`.
- Hook latency: `npm run test:performance` p95 ≤ 80 ms.

## Decisions

Record architectural decisions as numbered ADRs in [docs/adr/](docs/adr/README.md): ISO 42010 fields, ASD-STE100 language, as short as the decision allows. A withdrawn ADR is deleted and its number listed under "Withdrawn"; numbers are never reused. Use the terms in [CONTEXT.md](CONTEXT.md). `docs/prd.md` is the spec.

## Toolchains for integration tests

`npm run test:integration` runs real mutation runs on `test/fixtures/`. Select fixtures with `MUTAGATE_FIXTURES=go-module,java-maven`. Versions follow CI (`.github/workflows/ci.yml`):

- JDK 21 with Gradle 8.14.3 (Java, Kotlin)
- Go 1.26 with `go install github.com/szhekpisov/gomutants@v0.6.1`
- .NET 10 with `dotnet tool install dotnet-stryker --version 5.0.0`
- uv; Python venvs in `test/.cache/py2` (mutmut 2.5.1) and `test/.cache/py3` (mutmut 3.8.0)
- `npm ci` in each `test/fixtures/ts-*` directory

## Build and install the package locally

```sh
node test/package.mjs /tmp/mg-skill                       # prints bytes; fails at >= 300 KB
cd /tmp/mg-skill && git init -q && git add -A && git commit -qm pkg && cd -
npx skills add /tmp/mg-skill -a claude-code --copy        # in a test project
.claude/skills/mutagate/scripts/mutagate install --agent claude
```

`npm run test:installer` tests this path for all four harnesses. Users install from the generated `skill` branch ([ADR-0014](docs/adr/0014-skill-branch-distribution.md)); releases are in [docs/releasing.md](docs/releasing.md).

## Live evals

`npm run eval` drives real agents (`test/eval/`, ADR-0011). It needs the pinned harnesses (`test/harness-versions.json`), all language toolchains, and **your own credentials**: `CLAUDE_CODE_OAUTH_TOKEN` or `OPENROUTER_API_KEY` in the repo-root `.env`, or an existing `~/.codex` login. Runs cost model tokens and take up to 30 min each. Pull requests do not need eval runs; a maintainer runs them before a matrix change. See [test/evidence/README.md](test/evidence/README.md).

## Pull requests

- Write the test first at an existing seam; keep the dense code style.
- Update `README.md` for user-facing behavior and add a line under "Unreleased" in `CHANGELOG.md`.
- Fill in the pull request checklist.
