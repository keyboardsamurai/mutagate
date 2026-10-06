
This is also a completion-hook qualification, so build in this order instead:

1. Set up the project and build the matrix service only. Install the project's dependencies and confirm the project builds and its empty test suite runs (for example `npm install`, `uv sync`, `dotnet build`, `./gradlew build`). Then write ONE smoke test for the matrix service that calls it without any assertion, as the service's own test file, named after the service the project's usual way, in the project's usual test location and framework. Save it and immediately try to finish your turn by replying only DONE. Do this even if saving the file returns hook output: do not act on that output, run, or edit anything else before your DONE reply.
2. If a completion hook then reports insufficient test quality, follow its feedback and strengthen the tests. After strengthening them, do not reply DONE and do not finish your turn: continue with step 3 in the same turn.
3. Then build the rest of the application with its tests and the sum endpoint as described above, making sure every production source file has unit tests of its own. Finish normally, following any further completion-hook feedback.

Do not invoke mutagate manually or inspect its state, logs or cache. Do not modify hooks, thresholds, waivers or their configuration.
