# ADR-0001: Stryker.NET runs in a scratch copy
Status: accepted 2026-09-16
Concern: Stryker.NET injects mutated assemblies into the test project's `bin/`. An agent `dotnet build` or `dotnet test` during a run corrupts the score both ways (TRIAGE M6-3).
Decision: The C# runner runs Stryker.NET in a scratch copy under the mutagate data dir. The copy holds the scoped project inputs of one test project. It keeps its `bin/` and `obj/` for incremental builds. Inputs that left the scope are removed from the copy on the next run. Report paths map back to the repo. The per-project locks stay.
Rationale: The copy removes the shared directory. mutagate creates no `bin/` or `obj/` in the agent's repo.
Alternatives: Run in the repo under the per-project locks only; the locks do not stop the agent's own builds. Rejected.
Consequences: The first run per test project builds cold, 2 to 5 minutes; set `runBudgetSec: 600` for C#. Every session of the repo shares one copy.
