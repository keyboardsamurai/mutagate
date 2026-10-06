import { once } from 'node:events';
import type { Express } from 'express';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { expect, onTestFinished, test } from 'vitest';
import { createApp, matrixFromEnv, start } from './app.ts';
import { createMatrix, snapshot } from './matrixService.ts';

// Bind loopback explicitly: request(app) listens on :: and dials 127.0.0.1, which can reach another local process on the same port.
async function client(app: Express) {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  onTestFinished(() => void server.close());
  return request(server);
}

test('builds a filled matrix from the environment', () => {
  expect(snapshot(matrixFromEnv({ MATRIX_SIZE: '2X3', MATRIX_FILL: '7' }))).toEqual([[7, 7, 7], [7, 7, 7]]);
  expect(snapshot(matrixFromEnv({}))).toEqual([[0, 0, 0], [0, 0, 0], [0, 0, 0]]);
});

test('rejects a malformed size', () => {
  expect(() => matrixFromEnv({ MATRIX_SIZE: '3' })).toThrow(new RangeError('MATRIX_SIZE must look like <rows>x<cols>, got 3'));
  expect(() => matrixFromEnv({ MATRIX_SIZE: '1x2x3' })).toThrow(RangeError);
});

test('wires the page and the api', async () => {
  const api = await client(createApp(createMatrix(1, 1)));
  expect((await api.get('/').expect(200)).text).toContain('<h1>Matrix 1x1</h1>');
  expect((await api.get('/api/matrix').expect(200)).body).toEqual({ rows: 1, cols: 1, cells: [[0]] });
});

test('starts listening and logs the port', async () => {
  const lines: string[] = [];
  const server = start({ PORT: '0', MATRIX_SIZE: '1x2', MATRIX_FILL: '3' }, (line) => lines.push(line));
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  const res = await fetch(`http://[::1]:${port}/api/matrix`);
  expect(await res.json()).toEqual({ rows: 1, cols: 2, cells: [[3, 3]] });
  expect(lines).toEqual(['matrix listening on port 0']);
  await new Promise((resolve) => server.close(resolve));
});
