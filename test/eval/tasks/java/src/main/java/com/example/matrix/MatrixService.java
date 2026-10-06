package com.example.matrix;

import java.util.concurrent.atomic.AtomicInteger;

public class MatrixService {

    public static final int MAX_SIZE = 1000;

    private final int rows;
    private final int cols;
    private final AtomicInteger[] cells;

    public MatrixService(int rows, int cols) {
        if (rows < 1 || cols < 1) {
            throw new IllegalArgumentException("matrix dimensions must be positive, got " + rows + "x" + cols);
        }
        if (rows > MAX_SIZE || cols > MAX_SIZE) {
            throw new IllegalArgumentException("matrix dimensions must not exceed " + MAX_SIZE + ", got " + rows + "x" + cols);
        }
        this.rows = rows;
        this.cols = cols;
        this.cells = new AtomicInteger[rows * cols];
        for (int i = 0; i < cells.length; i++) {
            cells[i] = new AtomicInteger();
        }
    }

    public int rows() {
        return rows;
    }

    public int cols() {
        return cols;
    }

    public int get(int row, int col) {
        return cell(row, col).get();
    }

    public void set(int row, int col, int value) {
        cell(row, col).set(value);
    }

    public int add(int row, int col, int delta) {
        return cell(row, col).updateAndGet(current -> Math.addExact(current, delta));
    }

    public void clear() {
        for (AtomicInteger cell : cells) {
            cell.set(0);
        }
    }

    public int[][] snapshot() {
        int[][] grid = new int[rows][cols];
        for (int r = 0; r < rows; r++) {
            for (int c = 0; c < cols; c++) {
                grid[r][c] = get(r, c);
            }
        }
        int[][] copy = new int[rows][];
        for (int r = 0; r < rows; r++) {
            copy[r] = grid[r].clone();
        }
        return copy;
    }

    private AtomicInteger cell(int row, int col) {
        if (row < 0 || row >= rows || col < 0 || col >= cols) {
            throw new IndexOutOfBoundsException("cell (" + row + ", " + col + ") is outside a " + rows + "x" + cols + " matrix");
        }
        int index = row * cols + col;
        if (index >= cells.length) {
            throw new IndexOutOfBoundsException("cell index " + index + " is out of range");
        }
        return cells[index];
    }
}
