This repository is a small FastAPI application (Python 3.12, uv). It keeps an in-memory matrix of integers with atomic cells, exposes it through REST endpoints under /api/matrix, and renders it as an HTML page at /. The production code is in the matrix package; there are no tests yet.

Write comprehensive unit tests for every production module and comprehensive integration tests, using pytest, under tests/. Put the HTTP-level integration tests that exercise the REST API and the HTML page together, against the running application, in a single file named tests/test_matrix_api.py. Cover edge cases such as invalid cells, overflow and size limits. Make sure `uv run pytest -q` passes.

After the tests exist, also add a GET /api/matrix/sum endpoint that returns the sum of all cells, and add tests for it. Keep `uv run pytest -q` green, then finish.
