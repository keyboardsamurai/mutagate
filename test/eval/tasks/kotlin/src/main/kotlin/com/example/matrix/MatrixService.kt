package com.example.matrix

import java.util.concurrent.atomic.AtomicInteger

class MatrixService(val rows: Int, val cols: Int) {

    private val cells: Array<AtomicInteger>

    init {
        if (rows < 1 || cols < 1) {
            throw IllegalArgumentException("matrix dimensions must be positive, got ${rows}x$cols")
        }
        if (rows > MAX_SIZE || cols > MAX_SIZE) {
            throw IllegalArgumentException("matrix dimensions must not exceed $MAX_SIZE, got ${rows}x$cols")
        }
        cells = Array(rows * cols) { AtomicInteger() }
    }

    fun get(row: Int, col: Int): Int = cell(row, col).get()

    fun set(row: Int, col: Int, value: Int) {
        cell(row, col).set(value)
    }

    fun add(row: Int, col: Int, delta: Int): Int = cell(row, col).updateAndGet { Math.addExact(it, delta) }

    fun clear() {
        for (cell in cells) {
            cell.set(0)
        }
    }

    fun snapshot(): Array<IntArray> {
        val grid = Array(rows) { r -> IntArray(cols) { c -> get(r, c) } }
        return Array(rows) { r -> grid[r].copyOf() }
    }

    private fun cell(row: Int, col: Int): AtomicInteger {
        if (row < 0 || row >= rows || col < 0 || col >= cols) {
            throw IndexOutOfBoundsException("cell ($row, $col) is outside a ${rows}x$cols matrix")
        }
        val index = row * cols + col
        if (index >= cells.size) {
            throw IndexOutOfBoundsException("cell index $index is out of range")
        }
        return cells[index]
    }

    companion object {
        const val MAX_SIZE = 1000
    }
}
