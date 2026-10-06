package matrix

import (
	"errors"
	"fmt"
	"math"
	"slices"
	"sync/atomic"
)

const MaxSize = 1000

var (
	ErrInvalidSize = errors.New("invalid matrix size")
	ErrOutOfBounds = errors.New("cell out of bounds")
	ErrOverflow    = errors.New("integer overflow")
)

type Service struct {
	rows  int
	cols  int
	cells []atomic.Int32
}

func New(rows, cols int) (*Service, error) {
	if rows < 1 || cols < 1 {
		return nil, fmt.Errorf("%w: dimensions must be positive, got %dx%d", ErrInvalidSize, rows, cols)
	}
	if rows > MaxSize || cols > MaxSize {
		return nil, fmt.Errorf("%w: dimensions must not exceed %d, got %dx%d", ErrInvalidSize, MaxSize, rows, cols)
	}
	return &Service{rows: rows, cols: cols, cells: make([]atomic.Int32, rows*cols)}, nil
}

func (s *Service) Rows() int {
	return s.rows
}

func (s *Service) Cols() int {
	return s.cols
}

func (s *Service) Get(row, col int) (int32, error) {
	cell, err := s.cell(row, col)
	if err != nil {
		return 0, err
	}
	return cell.Load(), nil
}

func (s *Service) Set(row, col int, value int32) error {
	cell, err := s.cell(row, col)
	if err != nil {
		return err
	}
	cell.Store(value)
	return nil
}

func (s *Service) Add(row, col int, delta int32) (int32, error) {
	cell, err := s.cell(row, col)
	if err != nil {
		return 0, err
	}
	for {
		current := cell.Load()
		next := int64(current) + int64(delta)
		if next > math.MaxInt32 || next < math.MinInt32 {
			return 0, fmt.Errorf("%w: %d + %d", ErrOverflow, current, delta)
		}
		if cell.CompareAndSwap(current, int32(next)) {
			return int32(next), nil
		}
	}
}

func (s *Service) Clear() {
	for i := range s.cells {
		s.cells[i].Store(0)
	}
}

func (s *Service) Snapshot() [][]int32 {
	grid := make([][]int32, s.rows)
	for r := range grid {
		grid[r] = make([]int32, s.cols)
		for c := range grid[r] {
			grid[r][c], _ = s.Get(r, c)
		}
	}
	copied := make([][]int32, len(grid))
	for r, row := range grid {
		copied[r] = slices.Clone(row)
	}
	return copied
}

func (s *Service) cell(row, col int) (*atomic.Int32, error) {
	if row < 0 || row >= s.rows || col < 0 || col >= s.cols {
		return nil, fmt.Errorf("%w: cell (%d, %d) is outside a %dx%d matrix", ErrOutOfBounds, row, col, s.rows, s.cols)
	}
	index := row*s.cols + col
	if index >= len(s.cells) {
		return nil, fmt.Errorf("%w: cell index %d is out of range", ErrOutOfBounds, index)
	}
	return &s.cells[index], nil
}
