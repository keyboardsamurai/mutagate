# Third-party tools

mutagate bundles no third-party code. It drives the mutation engines below. Some it downloads to the cache root on first use; others you install in the project. Each tool keeps its own license.

| Tool | Version | Used for | Comes from | License |
|---|---|---|---|---|
| [PIT](https://pitest.org) (`pitest`, `pitest-entry`, `pitest-command-line`) | 1.21.0 | Java, Kotlin | Maven Central, downloaded, SHA-256 pinned (`references/jars.json`) | Apache-2.0 |
| `pitest-junit5-plugin` | 1.2.3 | JUnit 5 projects | Maven Central, downloaded, SHA-256 pinned | Apache-2.0 |
| JUnit (`junit:junit`) | 4.13.2 | PIT classpath | Maven Central, downloaded, SHA-256 pinned | EPL-1.0 |
| Hamcrest (`hamcrest-core`) | 1.3 | PIT classpath | Maven Central, downloaded, SHA-256 pinned | BSD-3-Clause |
| Apache Commons Text, Commons Lang 3 | 1.14.0, 3.18.0 | PIT classpath | Maven Central, downloaded, SHA-256 pinned | Apache-2.0 |
| Arcmutate `pitest-kotlin-plugin` | 1.4.0 | Kotlin Tier A | Maven Central, SHA-256 pinned; downloaded only with an Arcmutate licence (`arcmutate-licence.txt`, `ARCMUTATE_LICENCE`) or `kotlinTier: "A"` | Commercial ([Arcmutate](https://www.arcmutate.com)); bring your own licence |
| [gomutants](https://github.com/szhekpisov/gomutants) | 0.6.1 | Go | `go install`, cached | MIT |
| [gremlins](https://github.com/go-gremlins/gremlins) | 0.6.0 | Go fallback | `go install`, cached | Apache-2.0 |
| [Stryker.NET](https://stryker-mutator.io) (`dotnet-stryker`) | 5.0.0 | C# | `dotnet tool install` from NuGet, cached | Apache-2.0 |
| [StrykerJS](https://stryker-mutator.io) (`@stryker-mutator/*`) | 9.1.1 tested | TypeScript, JavaScript | your project (npm) | Apache-2.0 |
| [mutmut](https://github.com/boxed/mutmut) | 2.5.1, 3.8.0 tested | Python | your project (pip, uv) | BSD-3-Clause |

The skills CLI (`npx skills`) and the harnesses are separate products under their own terms. See [SECURITY.md](SECURITY.md) for network endpoints and integrity checks.
