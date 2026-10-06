export const MAX_SIZE = 1000;
export const INT_MIN = -2147483648;
export const INT_MAX = 2147483647;

export interface Matrix {
  readonly rows: number;
  readonly cols: number;
  readonly cells: Int32Array;
}

export function createMatrix(rows: number, cols: number): Matrix {
  if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 1 || cols < 1) {
    throw new RangeError(`matrix dimensions must be positive integers, got ${rows}x${cols}`);
  }
  if (rows > MAX_SIZE || cols > MAX_SIZE) {
    throw new RangeError(`matrix dimensions must not exceed ${MAX_SIZE}, got ${rows}x${cols}`);
  }
  const buffer = new SharedArrayBuffer(rows * cols * Int32Array.BYTES_PER_ELEMENT);
  return { rows, cols, cells: new Int32Array(buffer) };
}

export function getCell(matrix: Matrix, row: number, col: number): number {
  return Atomics.load(matrix.cells, cellIndex(matrix, row, col));
}

export function setCell(matrix: Matrix, row: number, col: number, value: number): void {
  Atomics.store(matrix.cells, cellIndex(matrix, row, col), requireInt(value, 'value'));
}

export function addToCell(matrix: Matrix, row: number, col: number, delta: number): number {
  const index = cellIndex(matrix, row, col);
  const next = Atomics.load(matrix.cells, index) + requireInt(delta, 'delta');
  if (next < INT_MIN || next > INT_MAX) {
    throw new RangeError(`integer overflow adding ${delta} to cell (${row}, ${col})`);
  }
  Atomics.store(matrix.cells, index, next);
  return next;
}

export function clearMatrix(matrix: Matrix): void {
  for (let i = 0; i < matrix.cells.length; i++) {
    Atomics.store(matrix.cells, i, 0);
  }
}

export function snapshot(matrix: Matrix): number[][] {
  const grid: number[][] = [];
  for (let r = 0; r < matrix.rows; r++) {
    const row: number[] = [];
    for (let c = 0; c < matrix.cols; c++) {
      row.push(getCell(matrix, r, c));
    }
    grid.push(row);
  }
  return grid.map((row) => row.slice());
}

function requireInt(value: number, name: string): number {
  if (!Number.isInteger(value) || value < INT_MIN || value > INT_MAX) {
    throw new RangeError(`${name} must be a 32-bit integer, got ${value}`);
  }
  return value;
}

function cellIndex(matrix: Matrix, row: number, col: number): number {
  if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || row >= matrix.rows || col < 0 || col >= matrix.cols) {
    throw new RangeError(`cell (${row}, ${col}) is outside a ${matrix.rows}x${matrix.cols} matrix`);
  }
  const index = row * matrix.cols + col;
  if (index >= matrix.cells.length) {
    throw new RangeError(`cell index ${index} is out of range`);
  }
  return index;
}
