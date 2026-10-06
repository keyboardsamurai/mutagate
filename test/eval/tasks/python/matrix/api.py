from fastapi import APIRouter, FastAPI, Request, Response
from fastapi.responses import JSONResponse

from matrix import service

router = APIRouter(prefix="/api/matrix")


def matrix():
    rows, cols = service.size()
    return {"rows": rows, "cols": cols, "cells": service.snapshot()}


def get_cell(row: int, col: int) -> int:
    return service.get(row, col)


def put_cell(row: int, col: int, value: int) -> int:
    service.put(row, col, value)
    return value


def add_to_cell(row: int, col: int, delta: int) -> int:
    return service.add(row, col, delta)


def clear() -> Response:
    service.clear()
    return Response(status_code=204)


def bad_request(request: Request, error: Exception) -> JSONResponse:
    return JSONResponse({"error": str(error) or type(error).__name__}, status_code=400)


def install(app: FastAPI) -> None:
    app.include_router(router)
    for error in (ValueError, IndexError, OverflowError):
        app.add_exception_handler(error, bad_request)


router.add_api_route("", matrix, methods=["GET"])
router.add_api_route("", clear, methods=["DELETE"], status_code=204)
router.add_api_route("/cells/{row}/{col}", get_cell, methods=["GET"])
router.add_api_route("/cells/{row}/{col}", put_cell, methods=["PUT"])
router.add_api_route("/cells/{row}/{col}/add", add_to_cell, methods=["POST"])
