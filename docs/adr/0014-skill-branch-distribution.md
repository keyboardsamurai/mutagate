# ADR-0014: Users install the skill from a generated `skill` branch
Status: accepted 2026-10-06
Concern: `npx skills add keyboardsamurai/mutagate` on `main` copies the whole dev repo (about 16.8 MB, 417 files) into each user project, with `AGENTS.md`, `CLAUDE.md`, `.claude/` and `test/`. The `skills` CLI 1.5.26 does not read `.skillignore`.
Decision: The release workflow builds the skill package with `test/package.mjs` and force-pushes it as the orphan branch `skill`, tagged `skill-vX.Y.Z`. Users install with `npx skills add keyboardsamurai/mutagate#skill -a <harness> --copy`; a pinned install uses `#skill-vX.Y.Z`. Each release also attaches the package tarball and `SHA256SUMS` to the GitHub Release. `main` stays the dev repo.
Rationale: One install source serves all four harnesses, holds only the packaged files, and stays under the 300 KB package limit. No test path on `main` changes.
Alternatives: Move the skill to `skills/mutagate/` on `main`; changes about 129 test path references and still ships dev files next to it. Release tarball only; the `skills` CLI cannot install it and skills.sh does not list it. Both rejected.
Consequences: The `skill` branch is generated: never commit to it by hand. The install URL is public; renaming the branch breaks each documented command. A release test installs from `#skill` and compares the tree with the package.
