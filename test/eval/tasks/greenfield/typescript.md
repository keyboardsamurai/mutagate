This is the root folder of a TypeScript Express application that we want to build. Nothing is initialized yet.

Build an Express 5 application in TypeScript (Node 22, npm, ESM) with Vitest 3.2.4 and supertest, that keeps an in-memory matrix of 32-bit integers with atomic cells. `npm test` must run `vitest run`. Add @stryker-mutator/core and @stryker-mutator/vitest-runner 9.1.1 as dev dependencies; Stryker is the project's mutation tester.

1. `src/matrixService.ts`: rows and columns from 1 to 1000 (reject anything else), get, set, add a delta (reject 32-bit overflow instead of wrapping), clear, and a snapshot copy of all cells. Reject cells outside the matrix.
2. `src/matrixController.ts`: REST endpoints under /api/matrix: GET the matrix (rows, cols, cells), GET and PUT `/cells/:row/:col` (`?value=`), POST `/cells/:row/:col/add` (`?delta=`), and DELETE to clear. Invalid cells, overflow and bad input return 400 with a JSON error message.
3. `src/matrixPage.ts`: an HTML page at / that renders the matrix as a table.
4. `src/app.ts`: the entrypoint, which assembles the app with a matrix sized from the `MATRIX_SIZE` environment variable (`<rows>x<cols>`, default 10x10) and starts listening.

Then write comprehensive unit tests for every production module and comprehensive integration tests, using Vitest and supertest. Put the HTTP-level integration tests that exercise the REST API and the HTML page together, against the assembled application, in a single file named matrixApi.test.ts. Cover edge cases such as invalid cells, overflow and size limits. Make sure `npm test` passes.

After the tests exist, also add a GET /api/matrix/sum endpoint that returns the sum of all cells, and add tests for it. Keep `npm test` green, then finish.
