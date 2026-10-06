package com.example.matrix

import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.ExceptionHandler
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController

@RestController
@RequestMapping("/api/matrix")
class MatrixController(private val matrix: MatrixService) {

    @GetMapping
    fun matrix(): Map<String, Any> = mapOf("rows" to matrix.rows, "cols" to matrix.cols, "cells" to matrix.snapshot())

    @GetMapping("/cells/{row}/{col}")
    fun get(@PathVariable row: Int, @PathVariable col: Int): Int = matrix.get(row, col)

    @PutMapping("/cells/{row}/{col}")
    fun set(@PathVariable row: Int, @PathVariable col: Int, @RequestParam value: Int): Int {
        matrix.set(row, col, value)
        return value
    }

    @PostMapping("/cells/{row}/{col}/add")
    fun add(@PathVariable row: Int, @PathVariable col: Int, @RequestParam delta: Int): Int = matrix.add(row, col, delta)

    @DeleteMapping
    fun clear(): ResponseEntity<Void> {
        matrix.clear()
        return ResponseEntity.noContent().build()
    }

    @ExceptionHandler(IllegalArgumentException::class, IndexOutOfBoundsException::class, ArithmeticException::class)
    fun badRequest(e: RuntimeException): ResponseEntity<Map<String, String>> =
        ResponseEntity.badRequest().body(mapOf("error" to (e.message ?: e.javaClass.simpleName)))
}
