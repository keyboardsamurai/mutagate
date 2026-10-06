This is the root folder of a C# ASP.NET Core application that we want to build. Nothing is initialized yet.

Build an ASP.NET Core minimal API application on .NET 10, with a solution at the root so that `dotnet test` runs from there: a `Matrix` web project and a `Matrix.Tests` xUnit project (xunit 2.9.3, Microsoft.NET.Test.Sdk 17.14.1, xunit.runner.visualstudio 3.1.5, Microsoft.AspNetCore.Mvc.Testing). The app keeps an in-memory matrix of integers with atomic cells:

1. `Matrix/MatrixService.cs`: rows and columns from 1 to 1000 (reject anything else), get, set, add a delta (reject int overflow instead of wrapping), clear, and a snapshot copy of all cells. Reject cells outside the matrix.
2. `Matrix/MatrixEndpoints.cs`: REST endpoints under /api/matrix: GET the matrix (rows, cols, cells), GET and PUT `/cells/{row}/{col}` (`?value=`), POST `/cells/{row}/{col}/add` (`?delta=`), and DELETE to clear. Invalid cells, overflow and bad input return 400 with a JSON error message.
3. `Matrix/MatrixPage.cs`: an HTML page at / that renders the matrix as a table.
4. `Matrix/Program.cs`: the minimal API entrypoint, which registers the service with a size from the `Matrix:Size` configuration value (`<rows>x<cols>`, default 10x10) and maps the endpoints and the page. Program.cs uses top-level statements (a `Main` entry point must exist).

Then write comprehensive unit tests for every production source file and comprehensive integration tests, using xUnit. Put the HTTP-level integration tests that exercise the REST API and the HTML page together, against the running application via WebApplicationFactory, in a single class named MatrixApiIntegrationTests. Cover edge cases such as invalid cells, overflow and size limits. Make sure `dotnet test` passes.

After the tests exist, also add a GET /api/matrix/sum endpoint that returns the sum of all cells, and add tests for it. Keep `dotnet test` green, then finish.
