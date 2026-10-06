package com.example.matrix;

import static org.junit.jupiter.api.Assertions.*;

import org.junit.jupiter.api.Test;

class MatrixServiceTest {

    @Test
    void startsWithZeroCells() {
        MatrixService m = new MatrixService(2, 3);
        assertEquals(2, m.rows());
        assertEquals(3, m.cols());
        assertArrayEquals(new int[][] {{0, 0, 0}, {0, 0, 0}}, m.snapshot());
    }

    @Test
    void rejectsInvalidDimensions() {
        assertThrows(IllegalArgumentException.class, () -> new MatrixService(0, 1));
        assertThrows(IllegalArgumentException.class, () -> new MatrixService(1, 0));
        assertThrows(IllegalArgumentException.class, () -> new MatrixService(1001, 1));
        assertThrows(IllegalArgumentException.class, () -> new MatrixService(1, 1001));
        assertEquals(1000, new MatrixService(1000, 1).rows());
        assertEquals(1000, new MatrixService(1, 1000).cols());
        assertEquals(1, new MatrixService(1, 1).rows());
    }

    @Test
    void setsGetsAndAddsDistinctCells() {
        MatrixService m = new MatrixService(2, 3);
        m.set(0, 1, 5);
        m.set(1, 0, -2);
        m.set(1, 2, 9);
        assertEquals(5, m.get(0, 1));
        assertEquals(-2, m.get(1, 0));
        assertEquals(9, m.get(1, 2));
        assertEquals(8, m.add(0, 1, 3));
        assertEquals(8, m.get(0, 1));
        assertArrayEquals(new int[][] {{0, 8, 0}, {-2, 0, 9}}, m.snapshot());
        m.clear();
        assertArrayEquals(new int[][] {{0, 0, 0}, {0, 0, 0}}, m.snapshot());
    }

    @Test
    void rejectsCellsOutsideBounds() {
        MatrixService m = new MatrixService(2, 3);
        assertThrows(IndexOutOfBoundsException.class, () -> m.get(-1, 0));
        assertThrows(IndexOutOfBoundsException.class, () -> m.get(0, -1));
        IndexOutOfBoundsException row = assertThrows(IndexOutOfBoundsException.class, () -> m.get(2, 0));
        assertEquals("cell (2, 0) is outside a 2x3 matrix", row.getMessage());
        IndexOutOfBoundsException col = assertThrows(IndexOutOfBoundsException.class, () -> m.set(0, 3, 1));
        assertEquals("cell (0, 3) is outside a 2x3 matrix", col.getMessage());
        assertThrows(IndexOutOfBoundsException.class, () -> m.add(1, 3, 1));
    }

    @Test
    void addDetectsOverflow() {
        MatrixService m = new MatrixService(1, 1);
        m.set(0, 0, Integer.MAX_VALUE);
        assertThrows(ArithmeticException.class, () -> m.add(0, 0, 1));
        assertEquals(Integer.MAX_VALUE, m.get(0, 0));
    }

    @Test
    void snapshotIsIndependentCopy() {
        MatrixService m = new MatrixService(1, 2);
        int[][] snapshot = m.snapshot();
        snapshot[0][0] = 42;
        assertEquals(0, m.get(0, 0));
    }
}
