---
name: mutagate
description: Use mutation testing for test quality, inspect surviving mutants after writing tests, and check mutation scores before finishing tests.
---

# mutagate

Paths below are relative to this skill directory. Run commands with the project as the working directory, or pass `--repo <project>`.

If hooks are not installed (no `mutagate ... active` line at session start), ask the user, then run `scripts/mutagate install --agent <harness>` for the harness you run in.

After writing or changing a test file:

1. With hooks installed (a `mutagate ... active` line at session start), edits already register targets and start mutation runs in the background; skip to step 2. Without hooks, run `scripts/mutagate run <test-file>` to schedule a scoped mutation run.
2. Read the result with `scripts/mutagate check --wait 120`. It reuses finished background results, waits for running ones, and runs anything still stale, so don't start another run with `run --sync`. If it names a longer `--wait`, run exactly that command. `unscored: no mutants to test` means the target has nothing to mutate; nothing more is needed for it.
3. Improve assertions and edge cases for the surviving mutants; never weaken or delete production code to kill them. Read [the survivor playbook](references/survivor-playbook.md) for mutation-specific examples.
4. Run `scripts/mutagate check --wait 120` again after changing the tests (without hooks, repeat step 1 first).

Before reporting the task complete, run `scripts/mutagate check`. A nonzero exit means quality is below threshold, results are pending, tests are red or do not compile, or infrastructure needs attention; report the actual state rather than claiming a passing score.

If target resolution is ambiguous, select a listed target with `scripts/mutagate run <test-file> --target <target>`. The choice lasts for this session.

For equivalent mutants, use `scripts/mutagate waive <id> --reason "<reason>"` to propose a waiver. Never edit the waiver file or pass `--apply`; a human owns approval.

Run `scripts/mutagate status` to list survivors with the ids `waive` takes. Use `status --json` only for full results and filtered Kotlin mutants, and `scripts/mutagate doctor` to diagnose setup problems.

With hooks installed, the CLI joins the hook session automatically. Without hooks, these commands are advisory, and `MUTAGATE_SESSION` shares one session across shells. `<command> --help` prints its usage.
