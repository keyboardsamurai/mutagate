This is the root folder of a Python FastAPI application that we want to build. Nothing is initialized yet.

Build a FastAPI application with uv (Python 3.12) and pytest, in a `matrix` package, that keeps an in-memory matrix of integers with atomic cells (32-bit range). Declare pytest, httpx and mutmut==3.8.0 as dev dependencies; mutmut is the project's mutation tester.

1. `matrix/service.py`: rows and columns from 1 to 1000 (reject anything else), get, set, add a delta (reject 32-bit overflow instead of wrapping), clear, and a snapshot copy of all cells, all thread-safe. Reject cells outside the matrix.
2. `matrix/api.py`: REST endpoints under /api/matrix: GET the matrix (rows, cols, cells), GET and PUT `/cells/{row}/{col}` (`?value=`), POST `/cells/{row}/{col}/add` (`?delta=`), and DELETE to clear. Invalid cells, overflow and bad input return 400 with a JSON error message.
3. `matrix/page.py`: an HTML page at / that renders the matrix as a table.
4. `matrix/main.py`: the entrypoint, which assembles the app with a matrix sized from the `MATRIX_SIZE` environment variable (`<rows>x<cols>`, default 10x10) and runs it with uvicorn.

Then write comprehensive unit tests for every production module and comprehensive integration tests, using pytest, under tests/. Put the HTTP-level integration tests that exercise the REST API and the HTML page together, against the running application, in a single file named tests/test_matrix_api.py. Cover edge cases such as invalid cells, overflow and size limits. Make sure `uv run pytest -q` passes.

After the tests exist, also add a GET /api/matrix/sum endpoint that returns the sum of all cells, and add tests for it. Keep `uv run pytest -q` green, then finish.
