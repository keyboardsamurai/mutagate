This repository is a small ASP.NET Core minimal API application (.NET 10, C#). It keeps an in-memory matrix of integers with atomic cells, exposes it through REST endpoints under /api/matrix, and renders it as an HTML page at /. The production code is in the Matrix project; the xUnit test project Matrix.Tests is set up but has no tests yet.

Write comprehensive unit tests for every production source file and comprehensive integration tests, using xUnit. Put the HTTP-level integration tests that exercise the REST API and the HTML page together, against the running application via WebApplicationFactory, in a single class named MatrixApiIntegrationTests. Cover edge cases such as invalid cells, overflow and size limits. Make sure `dotnet test` passes.

After the tests exist, also add a GET /api/matrix/sum endpoint that returns the sum of all cells, and add tests for it. Keep `dotnet test` green, then finish.
