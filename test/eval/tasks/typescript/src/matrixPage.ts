import type { RequestHandler } from 'express';
import { snapshot } from './matrixService.ts';
import type { Matrix } from './matrixService.ts';

export function matrixPage(matrix: Matrix): RequestHandler {
  return (_req, res) => {
    res.type('html').send(renderPage(matrix));
  };
}

export function renderPage(matrix: Matrix): string {
  const grid = snapshot(matrix);
  let html = `<!DOCTYPE html><html><head><title>Matrix</title></head><body><h1>Matrix ${matrix.rows}x${matrix.cols}</h1><table>`;
  for (let r = 0; r < grid.length; r++) {
    html += `<tr><th>${r + 1}</th>`;
    for (const value of grid[r]) {
      html += `<td class='${cellClass(value)}'>${value}</td>`;
    }
    html += '</tr>';
  }
  return html + '</table></body></html>';
}

export function cellClass(value: number): string {
  return value < 0 ? 'negative' : value === 0 ? 'zero' : 'positive';
}
