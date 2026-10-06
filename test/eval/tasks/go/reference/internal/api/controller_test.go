package api

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"example.com/matrix/internal/matrix"
)

func serve(t *testing.T, s *matrix.Service, method, target string) *httptest.ResponseRecorder {
	t.Helper()
	mux := http.NewServeMux()
	NewController(s).Register(mux)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, httptest.NewRequest(method, target, nil))
	return w
}

func expect(t *testing.T, w *httptest.ResponseRecorder, status int, body string) {
	t.Helper()
	if w.Code != status || w.Body.String() != body+"\n" {
		t.Errorf("got %d %q, want %d %q", w.Code, w.Body.String(), status, body)
	}
	if ct := w.Header().Get("Content-Type"); status != http.StatusNoContent && ct != "application/json" {
		t.Errorf("Content-Type = %q", ct)
	}
}

func service(t *testing.T) *matrix.Service {
	t.Helper()
	s, err := matrix.New(2, 3)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestShow(t *testing.T) {
	s := service(t)
	s.Set(1, 2, 5)
	expect(t, serve(t, s, "GET", "/api/matrix"), 200, `{"cells":[[0,0,0],[0,0,5]],"cols":3,"rows":2}`)
}

func TestGetSetAdd(t *testing.T) {
	s := service(t)
	expect(t, serve(t, s, "PUT", "/api/matrix/cells/1/2?value=-8"), 200, `-8`)
	if v, _ := s.Get(1, 2); v != -8 {
		t.Errorf("stored %d", v)
	}
	expect(t, serve(t, s, "GET", "/api/matrix/cells/1/2"), 200, `-8`)
	expect(t, serve(t, s, "PUT", "/api/matrix/cells/0/1?value=2147483647"), 200, `2147483647`)
	expect(t, serve(t, s, "PUT", "/api/matrix/cells/0/0?value=19"), 200, `19`)
	expect(t, serve(t, s, "POST", "/api/matrix/cells/1/2/add?delta=10"), 200, `2`)
	if v, _ := s.Get(1, 2); v != 2 {
		t.Errorf("stored %d", v)
	}
}

func TestClear(t *testing.T) {
	s := service(t)
	s.Set(0, 0, 3)
	w := serve(t, s, "DELETE", "/api/matrix")
	if w.Code != http.StatusNoContent || w.Body.Len() != 0 {
		t.Errorf("got %d %q", w.Code, w.Body.String())
	}
	if v, _ := s.Get(0, 0); v != 0 {
		t.Errorf("not cleared: %d", v)
	}
}

func TestBadRequests(t *testing.T) {
	s := service(t)
	s.Set(0, 0, 2147483647)
	for _, c := range []struct{ method, target, body string }{
		{"GET", "/api/matrix/cells/x/0", `{"error":"invalid row \"x\""}`},
		{"GET", "/api/matrix/cells/0/y", `{"error":"invalid col \"y\""}`},
		{"GET", "/api/matrix/cells/2147483648/0", `{"error":"invalid row \"2147483648\""}`},
		{"GET", "/api/matrix/cells/2/0", `{"error":"cell out of bounds: cell (2, 0) is outside a 2x3 matrix"}`},
		{"PUT", "/api/matrix/cells/x/0?value=1", `{"error":"invalid row \"x\""}`},
		{"PUT", "/api/matrix/cells/0/0", `{"error":"invalid value \"\""}`},
		{"PUT", "/api/matrix/cells/0/0?value=2147483648", `{"error":"invalid value \"2147483648\""}`},
		{"PUT", "/api/matrix/cells/0/3?value=1", `{"error":"cell out of bounds: cell (0, 3) is outside a 2x3 matrix"}`},
		{"POST", "/api/matrix/cells/x/0/add?delta=1", `{"error":"invalid row \"x\""}`},
		{"POST", "/api/matrix/cells/0/0/add?delta=z", `{"error":"invalid delta \"z\""}`},
		{"POST", "/api/matrix/cells/0/0/add?delta=1", `{"error":"integer overflow: 2147483647 + 1"}`},
	} {
		expect(t, serve(t, s, c.method, c.target), 400, c.body)
	}
	if v, _ := s.Get(0, 0); v != 2147483647 {
		t.Errorf("failed requests changed cell to %d", v)
	}
}

func TestBadRequestFallsBackToType(t *testing.T) {
	w := httptest.NewRecorder()
	badRequest(w, errors.New(""))
	expect(t, w, 400, `{"error":"*errors.errorString"}`)
	if !strings.Contains(w.Header().Get("Content-Type"), "json") {
		t.Error("missing content type")
	}
}
