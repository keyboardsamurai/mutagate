package api

import (
	"cmp"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"

	"example.com/matrix/internal/matrix"
)

type Controller struct {
	matrix *matrix.Service
}

func NewController(m *matrix.Service) *Controller {
	return &Controller{matrix: m}
}

func (c *Controller) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/matrix", c.show)
	mux.HandleFunc("DELETE /api/matrix", c.clear)
	mux.HandleFunc("GET /api/matrix/cells/{row}/{col}", c.get)
	mux.HandleFunc("PUT /api/matrix/cells/{row}/{col}", c.set)
	mux.HandleFunc("POST /api/matrix/cells/{row}/{col}/add", c.add)
}

func (c *Controller) show(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"rows": c.matrix.Rows(), "cols": c.matrix.Cols(), "cells": c.matrix.Snapshot()})
}

func (c *Controller) clear(w http.ResponseWriter, r *http.Request) {
	c.matrix.Clear()
	w.WriteHeader(http.StatusNoContent)
}

func (c *Controller) get(w http.ResponseWriter, r *http.Request) {
	row, col, err := position(r)
	var value int32
	if err == nil {
		value, err = c.matrix.Get(row, col)
	}
	respond(w, value, err)
}

func (c *Controller) set(w http.ResponseWriter, r *http.Request) {
	row, col, err := position(r)
	value, valueErr := parse(r.URL.Query().Get("value"), "value")
	if err = cmp.Or(err, valueErr); err == nil {
		err = c.matrix.Set(row, col, value)
	}
	respond(w, value, err)
}

func (c *Controller) add(w http.ResponseWriter, r *http.Request) {
	row, col, err := position(r)
	delta, deltaErr := parse(r.URL.Query().Get("delta"), "delta")
	var value int32
	if err = cmp.Or(err, deltaErr); err == nil {
		value, err = c.matrix.Add(row, col, delta)
	}
	respond(w, value, err)
}

func position(r *http.Request) (int, int, error) {
	row, rowErr := parse(r.PathValue("row"), "row")
	col, colErr := parse(r.PathValue("col"), "col")
	return int(row), int(col), cmp.Or(rowErr, colErr)
}

func parse(raw, name string) (int32, error) {
	value, err := strconv.ParseInt(raw, 10, 32)
	if err != nil {
		err = fmt.Errorf("invalid %s %q", name, raw)
	}
	return int32(value), err
}

func respond(w http.ResponseWriter, value int32, err error) {
	if err != nil {
		badRequest(w, err)
		return
	}
	writeJSON(w, http.StatusOK, value)
}

func badRequest(w http.ResponseWriter, err error) {
	message := err.Error()
	if message == "" {
		message = fmt.Sprintf("%T", err)
	}
	writeJSON(w, http.StatusBadRequest, map[string]string{"error": message})
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(body)
}
