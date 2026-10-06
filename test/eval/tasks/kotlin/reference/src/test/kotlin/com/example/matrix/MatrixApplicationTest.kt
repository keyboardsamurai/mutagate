package com.example.matrix

import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

class MatrixApplicationTest {

    @Test
    fun buildsFilledServiceFromProperties() {
        val service = MatrixApplication().matrixService(" 2X3 ", 7)
        assertArrayEquals(arrayOf(intArrayOf(7, 7, 7), intArrayOf(7, 7, 7)), service.snapshot())
    }

    @Test
    fun parsesAndRejectsSizes() {
        assertEquals(4 to 5, parseSize("4x5"))
        assertThrows<IllegalArgumentException> { parseSize("3") }
        assertThrows<IllegalArgumentException> { MatrixApplication().matrixService("3x3x3", 0) }
    }
}
