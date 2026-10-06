This is the root folder of a Java Spring Boot application that we want to build. Nothing is initialized yet.

Build a Spring Boot 4.1 application with Maven (plain `mvn`, no wrapper), Java 21 and JUnit 5, in the package com.example.matrix, that keeps an in-memory matrix of integers with atomic cells:

1. MatrixService: rows and columns from 1 to 1000 (reject anything else), get, set, add a delta (reject int overflow instead of wrapping), clear, and a snapshot copy of all cells. Reject cells outside the matrix.
2. MatrixController: REST endpoints under /api/matrix: GET the matrix (rows, cols, cells), GET and PUT `/cells/{row}/{col}` (`?value=`), POST `/cells/{row}/{col}/add` (`?delta=`), and DELETE to clear. Invalid cells, overflow and bad input return 400 with a JSON error message.
3. MatrixPageController: an HTML page at / that renders the matrix as a table.
4. MatrixApplication: the entrypoint, which creates the MatrixService bean from a `matrix.size` property (`<rows>x<cols>`, default 10x10).

Then write comprehensive unit tests for every production class and comprehensive integration tests. Put the HTTP-level integration tests that exercise the REST API and the HTML page together, against the running application, in a single class named MatrixApiIntegrationTest. Cover edge cases such as invalid cells, overflow and size limits. Make sure `mvn -q test` passes.

After the tests exist, also add a GET /api/matrix/sum endpoint that returns the sum of all cells, and add tests for it. Keep `mvn -q test` green, then finish.
