from fastapi import APIRouter
from fastapi.responses import HTMLResponse

from matrix import service

router = APIRouter()


def page() -> HTMLResponse:
    rows, cols = service.size()
    html = [f"<!DOCTYPE html><html><head><title>Matrix</title></head><body><h1>Matrix {rows}x{cols}</h1><table>"]
    for row, values in enumerate(service.snapshot()):
        html.append(f"<tr><th>{row + 1}</th>")
        for value in values:
            kind = "negative" if value < 0 else "zero" if value == 0 else "positive"
            html.append(f"<td class='{kind}'>{value}</td>")
        html.append("</tr>")
    html.append("</table></body></html>")
    return HTMLResponse("".join(html))


router.add_api_route("/", page, methods=["GET"], response_class=HTMLResponse)
