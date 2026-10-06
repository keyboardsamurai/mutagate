package com.example.matrix;

import static org.junit.jupiter.api.Assertions.*;

import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

class MatrixControllerTest {

    private final MatrixService service = new MatrixService(2, 2);
    private final MatrixController controller = new MatrixController(service);

    @Test
    void readsAndWritesCells() {
        assertEquals(7, controller.set(1, 0, 7));
        assertEquals(7, service.get(1, 0));
        assertEquals(7, controller.get(1, 0));
        assertEquals(10, controller.add(1, 0, 3));
        Map<String, Object> body = controller.matrix();
        assertEquals(2, body.get("rows"));
        assertEquals(2, body.get("cols"));
        assertArrayEquals(new int[][] {{0, 0}, {10, 0}}, (int[][]) body.get("cells"));
        assertEquals(HttpStatus.NO_CONTENT, controller.clear().getStatusCode());
        assertEquals(0, service.get(1, 0));
    }

    @Test
    void mapsErrorsToBadRequest() {
        var withMessage = controller.badRequest(new ArithmeticException("integer overflow"));
        assertEquals(HttpStatus.BAD_REQUEST, withMessage.getStatusCode());
        assertEquals(Map.of("error", "integer overflow"), withMessage.getBody());
        assertEquals(Map.of("error", "IndexOutOfBoundsException"), controller.badRequest(new IndexOutOfBoundsException()).getBody());
    }
}
