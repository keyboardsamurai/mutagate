import threading

MAX_SIZE = 1000
INT_MIN = -(2**31)
INT_MAX = 2**31 - 1

_lock = threading.Lock()
_rows = 0
_cols = 0
_cells = []


def reset(rows, cols):
    global _rows, _cols, _cells
    if rows < 1 or cols < 1:
        raise ValueError(f"matrix dimensions must be positive, got {rows}x{cols}")
    if rows > MAX_SIZE or cols > MAX_SIZE:
        raise ValueError(f"matrix dimensions must not exceed {MAX_SIZE}, got {rows}x{cols}")
    with _lock:
        _rows, _cols, _cells = rows, cols, [0] * (rows * cols)


def size():
    return _rows, _cols


def get(row, col):
    with _lock:
        return _cells[_index(row, col)]


def put(row, col, value):
    with _lock:
        _cells[_index(row, col)] = _checked(value)


def add(row, col, delta):
    with _lock:
        index = _index(row, col)
        _cells[index] = _checked(_cells[index] + delta)
        return _cells[index]


def clear():
    with _lock:
        for index in range(len(_cells)):
            _cells[index] = 0


def snapshot():
    with _lock:
        grid = [[_cells[row * _cols + col] for col in range(_cols)] for row in range(_rows)]
    return [list(values) for values in grid]


def _checked(value):
    if value < INT_MIN or value > INT_MAX:
        raise OverflowError(f"integer overflow: {value} does not fit in 32 bits")
    return value


def _index(row, col):
    if row < 0 or row >= _rows or col < 0 or col >= _cols:
        raise IndexError(f"cell ({row}, {col}) is outside a {_rows}x{_cols} matrix")
    index = row * _cols + col
    if index >= len(_cells):
        raise IndexError(f"cell index {index} is out of range")
    return index
