package com.example.matrix;

import java.util.Map;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/matrix")
public class MatrixController {

    private final MatrixService matrix;

    public MatrixController(MatrixService matrix) {
        this.matrix = matrix;
    }

    @GetMapping
    public Map<String, Object> matrix() {
        return Map.of("rows", matrix.rows(), "cols", matrix.cols(), "cells", matrix.snapshot());
    }

    @GetMapping("/cells/{row}/{col}")
    public int get(@PathVariable int row, @PathVariable int col) {
        return matrix.get(row, col);
    }

    @PutMapping("/cells/{row}/{col}")
    public int set(@PathVariable int row, @PathVariable int col, @RequestParam int value) {
        matrix.set(row, col, value);
        return value;
    }

    @PostMapping("/cells/{row}/{col}/add")
    public int add(@PathVariable int row, @PathVariable int col, @RequestParam int delta) {
        return matrix.add(row, col, delta);
    }

    @DeleteMapping
    public ResponseEntity<Void> clear() {
        matrix.clear();
        return ResponseEntity.noContent().build();
    }

    @ExceptionHandler({IllegalArgumentException.class, IndexOutOfBoundsException.class, ArithmeticException.class})
    public ResponseEntity<Map<String, String>> badRequest(RuntimeException e) {
        String message = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
        return ResponseEntity.badRequest().body(Map.of("error", message));
    }
}
