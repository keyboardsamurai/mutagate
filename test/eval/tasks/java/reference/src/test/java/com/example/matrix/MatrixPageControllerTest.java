package com.example.matrix;

import static org.junit.jupiter.api.Assertions.*;

import org.junit.jupiter.api.Test;

class MatrixPageControllerTest {

    @Test
    void rendersNumberedRowsWithSignClasses() {
        MatrixService service = new MatrixService(2, 3);
        service.set(0, 0, -1);
        service.set(0, 2, 1);
        service.set(1, 1, 4);
        String html = new MatrixPageController(service).page();
        assertTrue(html.startsWith("<!DOCTYPE html>"), html);
        assertTrue(html.contains("<h1>Matrix 2x3</h1><table>"
                + "<tr><th>1</th><td class='negative'>-1</td><td class='zero'>0</td><td class='positive'>1</td></tr>"
                + "<tr><th>2</th><td class='zero'>0</td><td class='positive'>4</td><td class='zero'>0</td></tr>"
                + "</table></body></html>"), html);
    }
}
