package api

import (
	"fmt"
	"io"
	"net/http"
	"strings"

	"example.com/matrix/internal/matrix"
)

type Page struct {
	matrix *matrix.Service
}

func NewPage(m *matrix.Service) *Page {
	return &Page{matrix: m}
}

func (p *Page) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var html strings.Builder
	fmt.Fprintf(&html, "<!DOCTYPE html><html><head><title>Matrix</title></head><body><h1>Matrix %dx%d</h1><table>", p.matrix.Rows(), p.matrix.Cols())
	for i, row := range p.matrix.Snapshot() {
		fmt.Fprintf(&html, "<tr><th>%d</th>", i+1)
		for _, value := range row {
			fmt.Fprintf(&html, "<td class='%s'>%d</td>", kind(value), value)
		}
		html.WriteString("</tr>")
	}
	html.WriteString("</table></body></html>")
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	io.WriteString(w, html.String())
}

func kind(value int32) string {
	if value < 0 {
		return "negative"
	}
	if value == 0 {
		return "zero"
	}
	return "positive"
}
