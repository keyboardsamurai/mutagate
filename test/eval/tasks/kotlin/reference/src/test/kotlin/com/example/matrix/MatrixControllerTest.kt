package com.example.matrix

import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.springframework.http.HttpStatus

class MatrixControllerTest {

    private val service = MatrixService(2, 2)
    private val controller = MatrixController(service)

    @Test
    fun readsAndWritesCells() {
        assertEquals(7, controller.set(1, 0, 7))
        assertEquals(7, service.get(1, 0))
        assertEquals(7, controller.get(1, 0))
        assertEquals(10, controller.add(1, 0, 3))
        val body = controller.matrix()
        assertEquals(2, body["rows"])
        assertEquals(2, body["cols"])
        assertArrayEquals(arrayOf(intArrayOf(0, 0), intArrayOf(10, 0)), body["cells"] as Array<*>)
        assertEquals(HttpStatus.NO_CONTENT, controller.clear().statusCode)
        assertEquals(0, service.get(1, 0))
    }

    @Test
    fun mapsErrorsToBadRequest() {
        val withMessage = controller.badRequest(ArithmeticException("integer overflow"))
        assertEquals(HttpStatus.BAD_REQUEST, withMessage.statusCode)
        assertEquals(mapOf("error" to "integer overflow"), withMessage.body)
        assertEquals(mapOf("error" to "IndexOutOfBoundsException"), controller.badRequest(IndexOutOfBoundsException()).body)
    }
}
