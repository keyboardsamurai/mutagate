package com.example.matrix;

import static org.junit.jupiter.api.Assertions.*;

import org.junit.jupiter.api.Test;

class MatrixApplicationTest {

    @Test
    void buildsFilledServiceFromProperties() {
        MatrixService service = new MatrixApplication().matrixService(" 2X3 ", 7);
        assertArrayEquals(new int[][] {{7, 7, 7}, {7, 7, 7}}, service.snapshot());
    }

    @Test
    void rejectsMalformedSize() {
        assertThrows(IllegalArgumentException.class, () -> new MatrixApplication().matrixService("3", 0));
    }
}
