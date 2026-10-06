This repository is a small Go web service (Go 1.26 module, standard library net/http only). It keeps an in-memory matrix of integers with atomic cells in internal/matrix, exposes it through REST handlers under /api/matrix and an HTML page at / in internal/api, and wires everything together in cmd/matrixd/main.go. There are no tests yet.

Write comprehensive unit tests for every production file and comprehensive integration tests, using the standard testing package. Put the HTTP-level integration tests that exercise the REST API and the HTML page together, against the application as cmd/matrixd wires it, in a single file cmd/matrixd/matrix_api_test.go. Cover edge cases such as invalid cells, overflow and size limits. Make sure `go test ./...` passes.

After the tests exist, also add a GET /api/matrix/sum endpoint that returns the sum of all cells, and add tests for it. Keep `go test ./...` green, then finish.
