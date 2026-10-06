package com.example.matrix

import org.springframework.http.MediaType
import org.springframework.stereotype.Controller
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.ResponseBody

@Controller
class MatrixPageController(private val matrix: MatrixService) {

    @GetMapping("/", produces = [MediaType.TEXT_HTML_VALUE])
    @ResponseBody
    fun page(): String {
        val html = StringBuilder("<!DOCTYPE html><html><head><title>Matrix</title></head><body>")
        html.append("<h1>Matrix ").append(matrix.rows).append("x").append(matrix.cols).append("</h1><table>")
        for ((r, row) in matrix.snapshot().withIndex()) {
            html.append("<tr><th>").append(r + 1).append("</th>")
            for (value in row) {
                html.append("<td class='").append(cellClass(value)).append("'>").append(value).append("</td>")
            }
            html.append("</tr>")
        }
        return html.append("</table></body></html>").toString()
    }
}

fun cellClass(value: Int): String = when {
    value < 0 -> "negative"
    value == 0 -> "zero"
    else -> "positive"
}
