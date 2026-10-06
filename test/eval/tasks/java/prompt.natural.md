This repository is a small Spring Boot 4 application (Maven, Java 21). It keeps an in-memory matrix of integers with atomic cells, exposes it through REST endpoints under /api/matrix, and renders it as an HTML page at /. The production code is in src/main/java; there are no tests yet.

Write comprehensive unit tests for every production class and comprehensive integration tests, using JUnit 5. Put the HTTP-level integration tests that exercise the REST API and the HTML page together, against the running application, in a single class named MatrixApiIntegrationTest. Cover edge cases such as invalid cells, overflow and size limits. Make sure `mvn -q test` passes.

After the tests exist, also add a GET /api/matrix/sum endpoint that returns the sum of all cells, and add tests for it. Keep `mvn -q test` green, then finish.
