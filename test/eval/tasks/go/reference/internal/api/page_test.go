package api

import (
	"net/http/httptest"
	"testing"

	"example.com/matrix/internal/matrix"
)

func TestPage(t *testing.T) {
	s, err := matrix.New(2, 3)
	if err != nil {
		t.Fatal(err)
	}
	s.Set(0, 0, -1)
	s.Set(1, 2, 4)
	w := httptest.NewRecorder()
	NewPage(s).ServeHTTP(w, httptest.NewRequest("GET", "/", nil))
	want := "<!DOCTYPE html><html><head><title>Matrix</title></head><body><h1>Matrix 2x3</h1><table>" +
		"<tr><th>1</th><td class='negative'>-1</td><td class='zero'>0</td><td class='zero'>0</td></tr>" +
		"<tr><th>2</th><td class='zero'>0</td><td class='zero'>0</td><td class='positive'>4</td></tr>" +
		"</table></body></html>"
	if w.Body.String() != want {
		t.Errorf("body = %s", w.Body.String())
	}
	if ct := w.Header().Get("Content-Type"); ct != "text/html; charset=utf-8" {
		t.Errorf("Content-Type = %q", ct)
	}
}

func TestKind(t *testing.T) {
	for value, want := range map[int32]string{-2: "negative", -1: "negative", 0: "zero", 1: "positive", 7: "positive"} {
		if got := kind(value); got != want {
			t.Errorf("kind(%d) = %q, want %q", value, got, want)
		}
	}
}
