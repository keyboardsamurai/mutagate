import json

from fastapi import FastAPI
from fastapi.testclient import TestClient

from matrix import api, service


def test_reads_and_writes_cells():
    service.reset(2, 2)
    assert api.put_cell(1, 0, 7) == 7
    assert service.get(1, 0) == 7
    assert api.get_cell(1, 0) == 7
    assert api.add_to_cell(1, 0, 3) == 10
    assert api.matrix() == {"rows": 2, "cols": 2, "cells": [[0, 0], [10, 0]]}
    assert api.clear().status_code == 204
    assert service.get(1, 0) == 0


def test_maps_errors_to_bad_request():
    response = api.bad_request(None, OverflowError("integer overflow"))
    assert response.status_code == 400
    assert json.loads(response.body) == {"error": "integer overflow"}
    assert json.loads(api.bad_request(None, IndexError()).body) == {"error": "IndexError"}


def test_install_registers_routes_and_error_handlers():
    service.reset(1, 1)
    app = FastAPI()
    api.install(app)
    client = TestClient(app)
    assert client.put("/api/matrix/cells/0/0", params={"value": 2}).json() == 2
    assert client.post("/api/matrix/cells/0/0/add", params={"delta": 3}).json() == 5
    assert client.get("/api/matrix/cells/0/0").json() == 5
    assert client.get("/api/matrix").json() == {"rows": 1, "cols": 1, "cells": [[5]]}
    assert client.delete("/api/matrix").status_code == 204
    assert client.get("/api/matrix/cells/1/0").json() == {"error": "cell (1, 0) is outside a 1x1 matrix"}
    assert all(app.exception_handlers[error] is api.bad_request for error in (ValueError, IndexError, OverflowError))
