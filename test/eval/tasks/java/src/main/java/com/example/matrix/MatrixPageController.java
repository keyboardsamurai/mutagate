package com.example.matrix;

import org.springframework.http.MediaType;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.ResponseBody;

@Controller
public class MatrixPageController {

    private final MatrixService matrix;

    public MatrixPageController(MatrixService matrix) {
        this.matrix = matrix;
    }

    @GetMapping(value = "/", produces = MediaType.TEXT_HTML_VALUE)
    @ResponseBody
    public String page() {
        int[][] grid = matrix.snapshot();
        StringBuilder html = new StringBuilder("<!DOCTYPE html><html><head><title>Matrix</title></head><body>");
        html.append("<h1>Matrix ").append(matrix.rows()).append("x").append(matrix.cols()).append("</h1><table>");
        for (int r = 0; r < grid.length; r++) {
            html.append("<tr><th>").append(r + 1).append("</th>");
            for (int value : grid[r]) {
                String kind = value < 0 ? "negative" : value == 0 ? "zero" : "positive";
                html.append("<td class='").append(kind).append("'>").append(value).append("</td>");
            }
            html.append("</tr>");
        }
        return html.append("</table></body></html>").toString();
    }
}
