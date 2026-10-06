# Survivor playbook

Kill survivors with tests. Do not weaken or delete production code to kill survivors; report equivalent or dead-code mutants instead. Code is dead only when it provably cannot run: types or every caller you can see rule out each path into it. Otherwise write a test that reaches it; `e.message ?: fallback` is reachable because `message` is nullable. Tell the user about any production change made only to satisfy the gate.

- **Boundary:** exercise the exact comparison boundary and values on either side. For `age >= 18`, assert outcomes at 17, 18, and 19.
- **Conditional:** reach both branches and assert their observable differences.
- **Return:** assert the exact value or collection contents. Calling the function without inspecting its result does not catch a replacement return.
- **Void call or block:** verify the resulting state, emitted event, or recorded interaction.
- **Math, increment, negation:** assert exact numeric results for at least two inputs, including zero or negative values where meaningful.
- **Property:** three or more survivors on math, boundary or return in one function: one property with explicit boundary examples beats several examples. Use only a property library the project has; never add a dependency or edit build files. Pin the seed, cap examples near 25, keep each property well under the per-mutant timeout.
- **No coverage:** the scoped test did not reach this code. Add a test that does, or propose a reasoned waiver for unreachable code.
- **Defensive fallback:** checked type assertions, buffered writes, and error branches for "impossible" cases are not dead code. Keep them and propose a waiver instead of deleting them.
- **Equivalent:** explain why the mutation cannot change observable behavior, then propose a waiver for human review. Test cost (such as a slow timeout) is not equivalence; say so in the waiver reason.
- **Kotlin:** inspect `status --json` before assuming compiler-looking code is junk. Suspend bodies, default implementations, and overridden `equals`/`toString` can contain real business logic. Report suspected junk with the mutant JSON, compiler/tool versions, and a minimal source example. Tier B cannot map inline copies to their defining source.

**Go:** assert returned `error` values; `RETURN_ERROR_NIL` and `ERRORF_WRAP` survive when tests ignore `err`.

**C#:** `Conditional (true|false)` survivors mean a branch was never observed; assert both outcomes of each ternary or `if`.
