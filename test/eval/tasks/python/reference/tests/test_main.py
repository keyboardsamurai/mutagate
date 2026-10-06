import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from matrix import main, service


def test_creates_app_from_environment(monkeypatch):
    monkeypatch.setenv("MATRIX_SIZE", " 2X3 ")
    monkeypatch.setenv("MATRIX_FILL", "4")
    app = main.create_app()
    assert app.title == "Matrix"
    client = TestClient(app)
    assert client.get("/api/matrix").json() == {"rows": 2, "cols": 3, "cells": [[4, 4, 4], [4, 4, 4]]}
    assert client.get("/api/matrix/cells/5/0").status_code == 400
    assert "Matrix 2x3" in client.get("/").text


def test_defaults_and_arguments(monkeypatch):
    monkeypatch.delenv("MATRIX_SIZE", raising=False)
    monkeypatch.delenv("MATRIX_FILL", raising=False)
    main.create_app()
    assert service.snapshot() == [[0, 0, 0]] * 3
    main.create_app("1x2", -1)
    assert service.snapshot() == [[-1, -1]]


def test_rejects_malformed_size():
    with pytest.raises(ValueError, match="MATRIX_SIZE must look like <rows>x<cols>, got 3"):
        main.create_app("3")


def test_main_runs_uvicorn(monkeypatch):
    calls = []
    monkeypatch.setattr(main.uvicorn, "run", lambda app, **options: calls.append((app, options)))
    monkeypatch.setenv("HOST", "0.0.0.0")
    monkeypatch.setenv("PORT", "9000")
    main.main()
    assert isinstance(calls[0][0], FastAPI)
    assert calls[0][1] == {"host": "0.0.0.0", "port": 9000}
    monkeypatch.delenv("HOST")
    monkeypatch.delenv("PORT")
    main.main()
    assert calls[1][1] == {"host": "127.0.0.1", "port": 8000}
