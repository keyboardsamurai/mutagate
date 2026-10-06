package matrix

import (
	"errors"
	"math"
	"reflect"
	"testing"
)

func mustNew(t *testing.T, rows, cols int) *Service {
	t.Helper()
	s, err := New(rows, cols)
	if err != nil {
		t.Fatalf("New(%d, %d): %v", rows, cols, err)
	}
	return s
}

func TestNewValidatesDimensions(t *testing.T) {
	for _, d := range [][2]int{{0, 1}, {1, 0}, {-1, 5}, {1001, 1}, {1, 1001}} {
		if s, err := New(d[0], d[1]); !errors.Is(err, ErrInvalidSize) || s != nil {
			t.Errorf("New(%d, %d) = %v, %v; want ErrInvalidSize", d[0], d[1], s, err)
		}
	}
	for _, d := range [][2]int{{1, 1}, {MaxSize, MaxSize}, {2, 3}} {
		s := mustNew(t, d[0], d[1])
		if s.Rows() != d[0] || s.Cols() != d[1] || len(s.cells) != d[0]*d[1] {
			t.Errorf("New(%d, %d) has %dx%d with %d cells", d[0], d[1], s.Rows(), s.Cols(), len(s.cells))
		}
	}
	if MaxSize != 1000 {
		t.Errorf("MaxSize = %d", MaxSize)
	}
}

func TestErrorMessages(t *testing.T) {
	_, err := New(0, 2)
	if err.Error() != "invalid matrix size: dimensions must be positive, got 0x2" {
		t.Errorf("got %q", err)
	}
	_, err = New(2, 1001)
	if err.Error() != "invalid matrix size: dimensions must not exceed 1000, got 2x1001" {
		t.Errorf("got %q", err)
	}
	_, err = mustNew(t, 2, 3).Get(2, 0)
	if err.Error() != "cell out of bounds: cell (2, 0) is outside a 2x3 matrix" {
		t.Errorf("got %q", err)
	}
}

func TestGetSetAndBounds(t *testing.T) {
	s := mustNew(t, 2, 3)
	for r := 0; r < 2; r++ {
		for c := 0; c < 3; c++ {
			if err := s.Set(r, c, int32(r*10+c)); err != nil {
				t.Fatal(err)
			}
		}
	}
	for r := 0; r < 2; r++ {
		for c := 0; c < 3; c++ {
			if v, err := s.Get(r, c); err != nil || v != int32(r*10+c) {
				t.Errorf("Get(%d, %d) = %d, %v", r, c, v, err)
			}
		}
	}
	for _, p := range [][2]int{{-1, 0}, {0, -1}, {2, 0}, {0, 3}} {
		if v, err := s.Get(p[0], p[1]); !errors.Is(err, ErrOutOfBounds) || v != 0 {
			t.Errorf("Get(%d, %d) = %d, %v", p[0], p[1], v, err)
		}
		if err := s.Set(p[0], p[1], 9); !errors.Is(err, ErrOutOfBounds) {
			t.Errorf("Set(%d, %d) = %v", p[0], p[1], err)
		}
		if v, err := s.Add(p[0], p[1], 9); !errors.Is(err, ErrOutOfBounds) || v != 0 {
			t.Errorf("Add(%d, %d) = %d, %v", p[0], p[1], v, err)
		}
	}
}

func TestAdd(t *testing.T) {
	s := mustNew(t, 1, 2)
	if v, err := s.Add(0, 1, 5); err != nil || v != 5 {
		t.Fatalf("Add = %d, %v", v, err)
	}
	if v, err := s.Add(0, 1, -7); err != nil || v != -2 {
		t.Fatalf("Add = %d, %v", v, err)
	}
	if v, _ := s.Get(0, 0); v != 0 {
		t.Errorf("neighbour changed to %d", v)
	}
}

func TestAddOverflow(t *testing.T) {
	s := mustNew(t, 1, 1)
	s.Set(0, 0, math.MaxInt32-1)
	if v, err := s.Add(0, 0, 1); err != nil || v != math.MaxInt32 {
		t.Fatalf("Add to max = %d, %v", v, err)
	}
	if v, err := s.Add(0, 0, 1); !errors.Is(err, ErrOverflow) || v != 0 || err.Error() != "integer overflow: 2147483647 + 1" {
		t.Fatalf("Add past max = %d, %v", v, err)
	}
	s.Set(0, 0, math.MinInt32+1)
	if v, err := s.Add(0, 0, -1); err != nil || v != math.MinInt32 {
		t.Fatalf("Add to min = %d, %v", v, err)
	}
	if _, err := s.Add(0, 0, -1); !errors.Is(err, ErrOverflow) {
		t.Fatalf("Add past min = %v", err)
	}
	if v, _ := s.Get(0, 0); v != math.MinInt32 {
		t.Errorf("overflow changed cell to %d", v)
	}
}

func TestClearAndSnapshot(t *testing.T) {
	s := mustNew(t, 2, 3)
	s.Set(0, 2, 7)
	s.Set(1, 0, -4)
	snap := s.Snapshot()
	if want := [][]int32{{0, 0, 7}, {-4, 0, 0}}; !reflect.DeepEqual(snap, want) {
		t.Fatalf("Snapshot = %v", snap)
	}
	snap[0][2] = 99
	if v, _ := s.Get(0, 2); v != 7 {
		t.Errorf("snapshot aliases cells: %d", v)
	}
	s.Clear()
	if want := [][]int32{{0, 0, 0}, {0, 0, 0}}; !reflect.DeepEqual(s.Snapshot(), want) {
		t.Errorf("after Clear = %v", s.Snapshot())
	}
}
