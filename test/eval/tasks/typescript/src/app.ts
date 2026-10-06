import express from 'express';
import type { Express } from 'express';
import type { Server } from 'node:http';
import { matrixRouter } from './matrixController.ts';
import { matrixPage } from './matrixPage.ts';
import { createMatrix, setCell } from './matrixService.ts';
import type { Matrix } from './matrixService.ts';

export type Env = Record<string, string | undefined>;

export function createApp(matrix: Matrix): Express {
  const app = express();
  app.get('/', matrixPage(matrix));
  app.use(matrixRouter(matrix));
  return app;
}

export function matrixFromEnv(env: Env): Matrix {
  const size = env.MATRIX_SIZE ?? '3x3';
  const parts = size.toLowerCase().split('x');
  if (parts.length !== 2) {
    throw new RangeError(`MATRIX_SIZE must look like <rows>x<cols>, got ${size}`);
  }
  const matrix = createMatrix(Number(parts[0]), Number(parts[1]));
  const fill = Number(env.MATRIX_FILL ?? 0);
  for (let r = 0; r < matrix.rows; r++) {
    for (let c = 0; c < matrix.cols; c++) {
      setCell(matrix, r, c, fill);
    }
  }
  return matrix;
}

export function start(env: Env, log: (line: string) => void = console.log): Server {
  const port = Number(env.PORT ?? 8080);
  return createApp(matrixFromEnv(env)).listen(port, () => log(`matrix listening on port ${port}`));
}
