import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { addToCell, clearMatrix, getCell, setCell, snapshot } from './matrixService.ts';
import type { Matrix } from './matrixService.ts';

export function matrixRouter(matrix: Matrix): Router {
  const router = Router();
  router.get('/api/matrix', (_req, res) => {
    res.json({ rows: matrix.rows, cols: matrix.cols, cells: snapshot(matrix) });
  });
  router.get('/api/matrix/cells/:row/:col', (req, res) => {
    res.json(getCell(matrix, parseInteger(req.params.row, 'row'), parseInteger(req.params.col, 'col')));
  });
  router.put('/api/matrix/cells/:row/:col', (req, res) => {
    const value = parseInteger(req.query.value, 'value');
    setCell(matrix, parseInteger(req.params.row, 'row'), parseInteger(req.params.col, 'col'), value);
    res.json(value);
  });
  router.post('/api/matrix/cells/:row/:col/add', (req, res) => {
    const delta = parseInteger(req.query.delta, 'delta');
    res.json(addToCell(matrix, parseInteger(req.params.row, 'row'), parseInteger(req.params.col, 'col'), delta));
  });
  router.delete('/api/matrix', (_req, res) => {
    clearMatrix(matrix);
    res.status(204).end();
  });
  router.use(badRequest);
  return router;
}

export function parseInteger(text: unknown, name: string): number {
  if (typeof text !== 'string' || !/^-?\d+$/.test(text)) {
    throw new TypeError(`${name} must be an integer, got ${String(text)}`);
  }
  return Number(text);
}

export function badRequest(err: unknown, _req: Request, res: Response, next: NextFunction): void {
  if (err instanceof RangeError || err instanceof TypeError) {
    res.status(400).json({ error: err.message || err.name });
    return;
  }
  next(err);
}
