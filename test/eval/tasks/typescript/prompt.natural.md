This repository is a small Express 5 application written in TypeScript (Node 22, npm). It keeps an in-memory matrix of 32-bit integers with atomic cells, exposes it through REST endpoints under /api/matrix, and renders it as an HTML page at /. The production code is in src/; there are no tests yet. Dependencies are already installed.

Write comprehensive unit tests for every production module and comprehensive integration tests, using Vitest (supertest is available). Put the HTTP-level integration tests that exercise the REST API and the HTML page together, against the assembled application, in a single file named matrixApi.test.ts. Cover edge cases such as invalid cells, overflow and size limits. Make sure `npm test` passes.

After the tests exist, also add a GET /api/matrix/sum endpoint that returns the sum of all cells, and add tests for it. Keep `npm test` green, then finish.
