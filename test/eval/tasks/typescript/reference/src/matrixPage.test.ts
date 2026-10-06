import { once } from 'node:events';
import express from 'express';
import type { Express } from 'express';
import request from 'supertest';
import { expect, onTestFinished, test } from 'vitest';
import { cellClass, matrixPage, renderPage } from './matrixPage.ts';
import { createMatrix, setCell } from './matrixService.ts';

// Bind loopback explicitly: request(app) listens on :: and dials 127.0.0.1, which can reach another local process on the same port.
async function client(app: Express) {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  onTestFinished(() => void server.close());
  return request(server);
}

test('renders numbered rows with sign classes', () => {
  const m = createMatrix(2, 2);
  setCell(m, 0, 0, -1);
  setCell(m, 1, 1, 5);
  expect(renderPage(m)).toBe(
    "<!DOCTYPE html><html><head><title>Matrix</title></head><body><h1>Matrix 2x2</h1><table>" +
      "<tr><th>1</th><td class='negative'>-1</td><td class='zero'>0</td></tr>" +
      "<tr><th>2</th><td class='zero'>0</td><td class='positive'>5</td></tr></table></body></html>",
  );
});

test('classifies signs at the boundaries', () => {
  expect(cellClass(-1)).toBe('negative');
  expect(cellClass(0)).toBe('zero');
  expect(cellClass(1)).toBe('positive');
});

test('serves the page as html', async () => {
  const m = createMatrix(1, 1);
  const res = await (await client(express().get('/', matrixPage(m)))).get('/').expect(200);
  expect(res.headers['content-type']).toMatch(/^text\/html/);
  expect(res.text).toBe(renderPage(m));
});
