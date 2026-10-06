package com.example.matrix

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class MatrixPageControllerTest {

    @Test
    fun rendersNumberedRowsWithSignClasses() {
        val service = MatrixService(2, 3)
        service.set(0, 0, -1)
        service.set(0, 2, 1)
        service.set(1, 1, 4)
        val html = MatrixPageController(service).page()
        assertTrue(html.startsWith("<!DOCTYPE html>"), html)
        assertTrue(
            html.contains(
                "<h1>Matrix 2x3</h1><table>" +
                    "<tr><th>1</th><td class='negative'>-1</td><td class='zero'>0</td><td class='positive'>1</td></tr>" +
                    "<tr><th>2</th><td class='zero'>0</td><td class='positive'>4</td><td class='zero'>0</td></tr>" +
                    "</table></body></html>"
            ),
            html
        )
    }

    @Test
    fun classifiesCellSigns() {
        assertEquals("negative", cellClass(-1))
        assertEquals("zero", cellClass(0))
        assertEquals("positive", cellClass(1))
    }
}
