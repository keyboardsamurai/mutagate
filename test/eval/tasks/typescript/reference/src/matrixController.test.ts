import { once } from 'node:events';
import express from 'express';
import type { Express } from 'express';
import request from 'supertest';
import { describe, expect, onTestFinished, test, vi } from 'vitest';
import { badRequest, matrixRouter, parseInteger } from './matrixController.ts';
import { createMatrix, getCell, INT_MAX, setCell } from './matrixService.ts';

// Bind loopback explicitly: request(app) listens on :: and dials 127.0.0.1, which can reach another local process on the same port.
async function client(app: Express) {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  onTestFinished(() => void server.close());
  return request(server);
}

async function setup() {
  const matrix = createMatrix(2, 3);
  return { matrix, api: await client(express().use(matrixRouter(matrix))) };
}

describe('matrixController', () => {
  test('returns the whole matrix', async () => {
    const { matrix, api } = await setup();
    setCell(matrix, 1, 2, 4);
    const res = await api.get('/api/matrix').expect(200);
    expect(res.body).toEqual({ rows: 2, cols: 3, cells: [[0, 0, 0], [0, 0, 4]] });
  });

  test('gets, sets and adds cells', async () => {
    const { matrix, api } = await setup();
    expect((await api.put('/api/matrix/cells/1/2?value=-7').expect(200)).body).toBe(-7);
    expect(getCell(matrix, 1, 2)).toBe(-7);
    expect((await api.get('/api/matrix/cells/1/2').expect(200)).body).toBe(-7);
    expect((await api.post('/api/matrix/cells/1/2/add?delta=10').expect(200)).body).toBe(3);
    expect(getCell(matrix, 1, 2)).toBe(3);
  });

  test('clears the matrix', async () => {
    const { matrix, api } = await setup();
    setCell(matrix, 0, 0, 1);
    const res = await api.delete('/api/matrix').expect(204);
    expect(res.text).toBe('');
    expect(getCell(matrix, 0, 0)).toBe(0);
  });

  test('maps invalid input to 400', async () => {
    const { api } = await setup();
    expect((await api.get('/api/matrix/cells/2/0').expect(400)).body).toEqual({ error: 'cell (2, 0) is outside a 2x3 matrix' });
    expect((await api.get('/api/matrix/cells/x/0').expect(400)).body).toEqual({ error: 'row must be an integer, got x' });
    expect((await api.get('/api/matrix/cells/0/y').expect(400)).body).toEqual({ error: 'col must be an integer, got y' });
    expect((await api.put('/api/matrix/cells/0/0').expect(400)).body).toEqual({ error: 'value must be an integer, got undefined' });
    expect((await api.put('/api/matrix/cells/0/x?value=1').expect(400)).body).toEqual({ error: 'col must be an integer, got x' });
    expect((await api.put('/api/matrix/cells/x/0?value=1').expect(400)).body).toEqual({ error: 'row must be an integer, got x' });
    expect((await api.post('/api/matrix/cells/0/0/add?delta=1.5').expect(400)).body).toEqual({ error: 'delta must be an integer, got 1.5' });
    expect((await api.post('/api/matrix/cells/x/0/add?delta=1').expect(400)).body).toEqual({ error: 'row must be an integer, got x' });
    expect((await api.post('/api/matrix/cells/0/x/add?delta=1').expect(400)).body).toEqual({ error: 'col must be an integer, got x' });
    await api.put(`/api/matrix/cells/0/0?value=${INT_MAX}`).expect(200);
    expect((await api.post('/api/matrix/cells/0/0/add?delta=1').expect(400)).body).toEqual({ error: 'integer overflow adding 1 to cell (0, 0)' });
  });

  test('parses only whole integers', () => {
    expect(parseInteger('42', 'n')).toBe(42);
    expect(parseInteger('-42', 'n')).toBe(-42);
    for (const bad of ['', '-', '+1', '1.0', 'a1', '1a', ' 1', '--1', undefined, ['1']]) {
      expect(() => parseInteger(bad, 'n')).toThrow(TypeError);
    }
  });

  test('falls back to the error name and forwards other errors', () => {
    const res = { status: vi.fn(), json: vi.fn() };
    res.status.mockReturnValue(res);
    const next = vi.fn();
    badRequest(new RangeError(), {} as never, res as never, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'RangeError' });
    const other = new Error('boom');
    badRequest(other, {} as never, res as never, next);
    expect(next).toHaveBeenCalledWith(other);
    expect(res.status).toHaveBeenCalledTimes(1);
  });
});
