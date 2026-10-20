import express, { type NextFunction, type Request, type Response } from 'express';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sessionMemoBodyParser } from './sessionMemoBodyParser.js';

let server: Server;
let base: string;

beforeEach(async () => {
  const app = express();
  app.use('/api/session-memos', sessionMemoBodyParser);
  app.use(express.json());
  const echo = (req: Request, res: Response): void => { res.json({ length: req.body.memos.length }); };
  app.put('/api/session-memos', echo);
  app.put('/api/unrelated', echo);
  app.use((error: { status?: number }, _req: Request, res: Response, _next: NextFunction): void => {
    res.status(error.status ?? 500).json({ ok: false });
  });
  await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => resolve()); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('port');
  base = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

describe('session memo history JSON transport', () => {
  const body = JSON.stringify({ memos: Array.from({ length: 40 }, (_, i) => ({ id: `closed-${i}`, text: '메'.repeat(4000), closedAt: 2000 + i })) });

  it('accepts a full-session memo history larger than the default JSON limit', async () => {
    const response = await fetch(`${base}/api/session-memos`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ length: 40 });
  });

  it('keeps the default body limit on unrelated routes', async () => {
    const response = await fetch(`${base}/api/unrelated`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body });
    expect(response.status).toBe(413);
  });
});
