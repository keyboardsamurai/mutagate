import pytest

from matrix import service


def test_starts_with_zero_cells():
    service.reset(2, 3)
    assert service.size() == (2, 3)
    assert service.snapshot() == [[0, 0, 0], [0, 0, 0]]


def test_rejects_invalid_dimensions():
    with pytest.raises(ValueError, match="must be positive, got 0x1"):
        service.reset(0, 1)
    with pytest.raises(ValueError, match="must be positive"):
        service.reset(1, 0)
    with pytest.raises(ValueError, match="must not exceed 1000, got 1001x1"):
        service.reset(1001, 1)
    with pytest.raises(ValueError, match="must not exceed"):
        service.reset(1, 1001)
    service.reset(1000, 1)
    assert service.size() == (1000, 1)
    service.reset(1, 1000)
    assert service.size() == (1, 1000)
    service.reset(1, 1)
    assert service.size() == (1, 1)


def test_sets_gets_and_adds_distinct_cells():
    service.reset(2, 3)
    service.put(0, 1, 5)
    service.put(1, 0, -2)
    service.put(1, 2, 9)
    assert service.get(0, 1) == 5
    assert service.get(1, 0) == -2
    assert service.get(1, 2) == 9
    assert service.add(0, 1, 3) == 8
    assert service.get(0, 1) == 8
    assert service.snapshot() == [[0, 8, 0], [-2, 0, 9]]
    service.clear()
    assert service.snapshot() == [[0, 0, 0], [0, 0, 0]]


def test_rejects_cells_outside_bounds():
    service.reset(2, 3)
    with pytest.raises(IndexError):
        service.get(-1, 0)
    with pytest.raises(IndexError):
        service.get(0, -1)
    with pytest.raises(IndexError, match=r"^cell \(2, 0\) is outside a 2x3 matrix$"):
        service.get(2, 0)
    with pytest.raises(IndexError, match=r"^cell \(0, 3\) is outside a 2x3 matrix$"):
        service.put(0, 3, 1)
    with pytest.raises(IndexError):
        service.add(1, 3, 1)


def test_detects_overflow():
    service.reset(1, 2)
    service.put(0, 0, service.INT_MAX)
    service.put(0, 1, service.INT_MIN)
    with pytest.raises(OverflowError, match="2147483648 does not fit in 32 bits"):
        service.add(0, 0, 1)
    with pytest.raises(OverflowError):
        service.add(0, 1, -1)
    with pytest.raises(OverflowError):
        service.put(0, 0, service.INT_MAX + 1)
    with pytest.raises(OverflowError):
        service.put(0, 0, service.INT_MIN - 1)
    assert service.snapshot() == [[service.INT_MAX, service.INT_MIN]]


def test_snapshot_is_independent_copy():
    service.reset(1, 2)
    snapshot = service.snapshot()
    snapshot[0][0] = 42
    assert service.get(0, 0) == 0
