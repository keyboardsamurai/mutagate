package main

import (
	"cmp"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"

	"example.com/matrix/internal/api"
	"example.com/matrix/internal/matrix"
)

func main() {
	handler, err := newHandler(os.Getenv("MATRIX_SIZE"), os.Getenv("MATRIX_FILL"))
	if err != nil {
		log.Fatal(err)
	}
	log.Fatal(http.ListenAndServe(cmp.Or(os.Getenv("MATRIX_ADDR"), ":8080"), handler))
}

func newHandler(size, fill string) (http.Handler, error) {
	service, err := newService(size, fill)
	if err != nil {
		return nil, err
	}
	mux := http.NewServeMux()
	api.NewController(service).Register(mux)
	mux.Handle("GET /{$}", api.NewPage(service))
	return mux, nil
}

func newService(size, fill string) (*matrix.Service, error) {
	parts := strings.Split(strings.ToLower(strings.TrimSpace(cmp.Or(size, "3x3"))), "x")
	if len(parts) != 2 {
		return nil, fmt.Errorf("MATRIX_SIZE must look like <rows>x<cols>, got %q", size)
	}
	rows, err := strconv.Atoi(strings.TrimSpace(parts[0]))
	if err != nil {
		return nil, fmt.Errorf("MATRIX_SIZE rows: %w", err)
	}
	cols, err := strconv.Atoi(strings.TrimSpace(parts[1]))
	if err != nil {
		return nil, fmt.Errorf("MATRIX_SIZE cols: %w", err)
	}
	value, err := strconv.ParseInt(strings.TrimSpace(cmp.Or(fill, "0")), 10, 32)
	if err != nil {
		return nil, fmt.Errorf("MATRIX_FILL: %w", err)
	}
	service, err := matrix.New(rows, cols)
	if err != nil {
		return nil, err
	}
	for r := range service.Rows() {
		for c := range service.Cols() {
			service.Set(r, c, int32(value))
		}
	}
	return service, nil
}
