import os

import uvicorn
from fastapi import FastAPI

from matrix import api, page, service


def create_app(size=None, fill=None) -> FastAPI:
    size = os.environ.get("MATRIX_SIZE", "3x3") if size is None else size
    fill = int(os.environ.get("MATRIX_FILL", "0")) if fill is None else fill
    parts = size.strip().lower().split("x")
    if len(parts) != 2:
        raise ValueError(f"MATRIX_SIZE must look like <rows>x<cols>, got {size}")
    service.reset(int(parts[0].strip()), int(parts[1].strip()))
    rows, cols = service.size()
    for row in range(rows):
        for col in range(cols):
            service.put(row, col, fill)
    app = FastAPI(title="Matrix")
    api.install(app)
    app.include_router(page.router)
    return app


def main() -> None:
    uvicorn.run(create_app(), host=os.environ.get("HOST", "127.0.0.1"), port=int(os.environ.get("PORT", "8000")))


if __name__ == "__main__":
    main()
