This is the root folder of a Go web service that we want to build. Nothing is initialized yet.

Build a Go 1.26 module `example.com/matrix` using only the standard library (`net/http`, `testing`), that keeps an in-memory matrix of integers with atomic cells:

1. `internal/matrix`: the matrix service. Rows and columns from 1 to 1000 (reject anything else), get, set, add a delta (reject int32 overflow instead of wrapping), clear, and a snapshot copy of all cells. Reject cells outside the matrix.
2. `internal/api`: REST handlers under /api/matrix: GET the matrix (rows, cols, cells), GET and PUT `/cells/{row}/{col}` (`?value=`), POST `/cells/{row}/{col}/add` (`?delta=`), and DELETE to clear. Invalid cells, overflow and bad input return 400 with a JSON error message. Also in `internal/api`: an HTML page at / that renders the matrix as a table.
3. `cmd/matrixd/main.go`: the entrypoint, which wires the service and handlers with a matrix sized from the `MATRIX_SIZE` environment variable (`<rows>x<cols>`, default 10x10) and serves them.

Then write comprehensive unit tests for every production file and comprehensive integration tests, using the standard testing package. Put the HTTP-level integration tests that exercise the REST API and the HTML page together, against the application as cmd/matrixd wires it, in a single file cmd/matrixd/matrix_api_test.go. Cover edge cases such as invalid cells, overflow and size limits. Make sure `go test ./...` passes.

After the tests exist, also add a GET /api/matrix/sum endpoint that returns the sum of all cells, and add tests for it. Keep `go test ./...` green, then finish.
