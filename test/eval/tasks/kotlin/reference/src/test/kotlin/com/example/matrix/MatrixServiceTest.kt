package com.example.matrix

import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

class MatrixServiceTest {

    @Test
    fun startsWithZeroCells() {
        val m = MatrixService(2, 3)
        assertEquals(2, m.rows)
        assertEquals(3, m.cols)
        assertArrayEquals(arrayOf(intArrayOf(0, 0, 0), intArrayOf(0, 0, 0)), m.snapshot())
    }

    @Test
    fun rejectsInvalidDimensions() {
        assertThrows<IllegalArgumentException> { MatrixService(0, 1) }
        assertThrows<IllegalArgumentException> { MatrixService(1, 0) }
        assertThrows<IllegalArgumentException> { MatrixService(1001, 1) }
        assertThrows<IllegalArgumentException> { MatrixService(1, 1001) }
        assertEquals(1000, MatrixService(1000, 1).rows)
        assertEquals(1000, MatrixService(1, 1000).cols)
        assertEquals(1, MatrixService(1, 1).rows)
    }

    @Test
    fun setsGetsAndAddsDistinctCells() {
        val m = MatrixService(2, 3)
        m.set(0, 1, 5)
        m.set(1, 0, -2)
        m.set(1, 2, 9)
        assertEquals(5, m.get(0, 1))
        assertEquals(-2, m.get(1, 0))
        assertEquals(9, m.get(1, 2))
        assertEquals(8, m.add(0, 1, 3))
        assertEquals(8, m.get(0, 1))
        assertArrayEquals(arrayOf(intArrayOf(0, 8, 0), intArrayOf(-2, 0, 9)), m.snapshot())
        m.clear()
        assertArrayEquals(arrayOf(intArrayOf(0, 0, 0), intArrayOf(0, 0, 0)), m.snapshot())
    }

    @Test
    fun rejectsCellsOutsideBounds() {
        val m = MatrixService(2, 3)
        assertThrows<IndexOutOfBoundsException> { m.get(-1, 0) }
        assertThrows<IndexOutOfBoundsException> { m.get(0, -1) }
        assertEquals("cell (2, 0) is outside a 2x3 matrix", assertThrows<IndexOutOfBoundsException> { m.get(2, 0) }.message)
        assertEquals("cell (0, 3) is outside a 2x3 matrix", assertThrows<IndexOutOfBoundsException> { m.set(0, 3, 1) }.message)
        assertThrows<IndexOutOfBoundsException> { m.add(1, 3, 1) }
    }

    @Test
    fun addDetectsOverflow() {
        val m = MatrixService(1, 1)
        m.set(0, 0, Int.MAX_VALUE)
        assertThrows<ArithmeticException> { m.add(0, 0, 1) }
        assertEquals(Int.MAX_VALUE, m.get(0, 0))
    }

    @Test
    fun snapshotIsIndependentCopy() {
        val m = MatrixService(1, 2)
        m.snapshot()[0][0] = 42
        assertEquals(0, m.get(0, 0))
    }
}
