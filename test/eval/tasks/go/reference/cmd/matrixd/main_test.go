package main

import (
	"errors"
	"net/http/httptest"
	"reflect"
	"strconv"
	"strings"
	"testing"

	"example.com/matrix/internal/matrix"
)

func TestNewServiceDefaults(t *testing.T) {
	s, err := newService("", "")
	if err != nil {
		t.Fatal(err)
	}
	if want := [][]int32{{0, 0, 0}, {0, 0, 0}, {0, 0, 0}}; !reflect.DeepEqual(s.Snapshot(), want) {
		t.Errorf("default snapshot = %v", s.Snapshot())
	}
}

func TestNewServiceParsesSizeAndFill(t *testing.T) {
	s, err := newService(" 2X3 ", " -4 ")
	if err != nil {
		t.Fatal(err)
	}
	if want := [][]int32{{-4, -4, -4}, {-4, -4, -4}}; !reflect.DeepEqual(s.Snapshot(), want) {
		t.Errorf("snapshot = %v", s.Snapshot())
	}
	for fill, want := range map[string]int32{"7": 7, "19": 19, "2147483647": 2147483647} {
		s, err = newService("1 x 2", fill)
		if err != nil || !reflect.DeepEqual(s.Snapshot(), [][]int32{{want, want}}) {
			t.Errorf("fill %s: got %v, %v", fill, s, err)
		}
	}
}

func TestNewServiceRejectsBadInput(t *testing.T) {
	for _, c := range []struct{ size, fill, message string }{
		{"3", "", `MATRIX_SIZE must look like <rows>x<cols>, got "3"`},
		{"1x2x3", "", `MATRIX_SIZE must look like <rows>x<cols>, got "1x2x3"`},
		{"ax2", "", `MATRIX_SIZE rows: strconv.Atoi: parsing "a": invalid syntax`},
		{"2xb", "", `MATRIX_SIZE cols: strconv.Atoi: parsing "b": invalid syntax`},
		{"2x2", "z", `MATRIX_FILL: strconv.ParseInt: parsing "z": invalid syntax`},
		{"2x2", "2147483648", `MATRIX_FILL: strconv.ParseInt: parsing "2147483648": value out of range`},
		{"0x2", "", `invalid matrix size: dimensions must be positive, got 0x2`},
	} {
		s, err := newService(c.size, c.fill)
		if err == nil || err.Error() != c.message || s != nil {
			t.Errorf("newService(%q, %q) = %v, %v", c.size, c.fill, s, err)
		}
	}
	if _, err := newService("2x2", "z"); !errors.Is(err, strconv.ErrSyntax) {
		t.Errorf("fill error not wrapped: %v", err)
	}
	if _, err := newService("ax2", ""); !errors.Is(err, strconv.ErrSyntax) {
		t.Errorf("rows error not wrapped: %v", err)
	}
	if _, err := newService("2xb", ""); !errors.Is(err, strconv.ErrSyntax) {
		t.Errorf("cols error not wrapped: %v", err)
	}
	if _, err := newService("2000x1", ""); !errors.Is(err, matrix.ErrInvalidSize) {
		t.Errorf("size error = %v", err)
	}
}

func TestNewHandlerRoutes(t *testing.T) {
	h, err := newHandler("1x2", "3")
	if err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/api/matrix", nil))
	if w.Code != 200 || strings.TrimSpace(w.Body.String()) != `{"cells":[[3,3]],"cols":2,"rows":1}` {
		t.Errorf("api = %d %s", w.Code, w.Body.String())
	}
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/", nil))
	if w.Code != 200 || !strings.Contains(w.Body.String(), "<td class='positive'>3</td>") {
		t.Errorf("page = %d %s", w.Code, w.Body.String())
	}
	if h, err := newHandler("bad", ""); h != nil || err == nil {
		t.Errorf("newHandler(bad) = %v, %v", h, err)
	}
}
