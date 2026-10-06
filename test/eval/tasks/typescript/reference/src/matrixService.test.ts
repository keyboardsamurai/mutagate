import { describe, expect, test } from 'vitest';
import { addToCell, clearMatrix, createMatrix, getCell, INT_MAX, INT_MIN, MAX_SIZE, setCell, snapshot } from './matrixService.ts';

describe('matrixService', () => {
  test('starts with zero cells', () => {
    const m = createMatrix(2, 3);
    expect(m.rows).toBe(2);
    expect(m.cols).toBe(3);
    expect(m.cells.length).toBe(6);
    expect(snapshot(m)).toEqual([[0, 0, 0], [0, 0, 0]]);
  });

  test('rejects invalid dimensions', () => {
    expect(MAX_SIZE).toBe(1000);
    expect(() => createMatrix(0, 1)).toThrow(new RangeError('matrix dimensions must be positive integers, got 0x1'));
    expect(() => createMatrix(1, 0)).toThrow(RangeError);
    expect(() => createMatrix(2.5, 2)).toThrow('matrix dimensions must be positive integers, got 2.5x2');
    expect(() => createMatrix(2, 2.5)).toThrow('matrix dimensions must be positive integers, got 2x2.5');
    expect(() => createMatrix(1001, 1)).toThrow(new RangeError('matrix dimensions must not exceed 1000, got 1001x1'));
    expect(() => createMatrix(1, 1001)).toThrow(RangeError);
    expect(createMatrix(1000, 1).rows).toBe(1000);
    expect(createMatrix(1, 1000).cols).toBe(1000);
    expect(createMatrix(1, 1).rows).toBe(1);
  });

  test('sets, gets and adds distinct cells', () => {
    const m = createMatrix(2, 3);
    setCell(m, 0, 1, 5);
    setCell(m, 1, 0, -2);
    setCell(m, 1, 2, 9);
    expect(getCell(m, 0, 1)).toBe(5);
    expect(getCell(m, 1, 0)).toBe(-2);
    expect(getCell(m, 1, 2)).toBe(9);
    expect(addToCell(m, 0, 1, 3)).toBe(8);
    expect(getCell(m, 0, 1)).toBe(8);
    expect(snapshot(m)).toEqual([[0, 8, 0], [-2, 0, 9]]);
    clearMatrix(m);
    expect(snapshot(m)).toEqual([[0, 0, 0], [0, 0, 0]]);
  });

  test('rejects cells outside bounds', () => {
    const m = createMatrix(2, 3);
    expect(() => getCell(m, -1, 0)).toThrow('cell (-1, 0) is outside a 2x3 matrix');
    expect(() => getCell(m, 0, -1)).toThrow('cell (0, -1) is outside a 2x3 matrix');
    expect(() => getCell(m, 0.5, 0)).toThrow('cell (0.5, 0) is outside a 2x3 matrix');
    expect(() => getCell(m, 0, 0.5)).toThrow('cell (0, 0.5) is outside a 2x3 matrix');
    expect(() => getCell(m, 2, 0)).toThrow(new RangeError('cell (2, 0) is outside a 2x3 matrix'));
    expect(() => setCell(m, 0, 3, 1)).toThrow(new RangeError('cell (0, 3) is outside a 2x3 matrix'));
    expect(() => addToCell(m, 1, 3, 1)).toThrow(RangeError);
    expect(getCell(m, 1, 2)).toBe(0);
  });

  test('accepts only 32-bit integer values', () => {
    const m = createMatrix(1, 1);
    setCell(m, 0, 0, INT_MAX);
    expect(getCell(m, 0, 0)).toBe(2147483647);
    setCell(m, 0, 0, INT_MIN);
    expect(getCell(m, 0, 0)).toBe(-2147483648);
    expect(() => setCell(m, 0, 0, INT_MAX + 1)).toThrow(new RangeError('value must be a 32-bit integer, got 2147483648'));
    expect(() => setCell(m, 0, 0, INT_MIN - 1)).toThrow(RangeError);
    expect(() => setCell(m, 0, 0, 1.5)).toThrow(RangeError);
    expect(() => addToCell(m, 0, 0, 0.5)).toThrow(new RangeError('delta must be a 32-bit integer, got 0.5'));
  });

  test('add detects overflow in both directions', () => {
    const m = createMatrix(1, 1);
    setCell(m, 0, 0, INT_MAX);
    expect(() => addToCell(m, 0, 0, 1)).toThrow(new RangeError('integer overflow adding 1 to cell (0, 0)'));
    expect(getCell(m, 0, 0)).toBe(INT_MAX);
    expect(addToCell(m, 0, 0, 0)).toBe(INT_MAX);
    setCell(m, 0, 0, INT_MIN);
    expect(() => addToCell(m, 0, 0, -1)).toThrow(RangeError);
    expect(addToCell(m, 0, 0, 0)).toBe(INT_MIN);
    expect(addToCell(m, 0, 0, INT_MAX)).toBe(-1);
  });

  test('snapshot is an independent copy', () => {
    const m = createMatrix(1, 2);
    const grid = snapshot(m);
    grid[0][0] = 42;
    expect(getCell(m, 0, 0)).toBe(0);
  });
});
