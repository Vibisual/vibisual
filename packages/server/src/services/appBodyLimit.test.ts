import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { Server } from 'node:http';

import { mountAppBodyParsers } from './appHost.js';

vi.mock('./projectGraphManager.js', () => ({ graphManager: {} }));

/**
 * §5.13 (Y) 40-7 ⑥ — R18 재현: 일꾼이 장면 대표 프레임을 보고하는 본문(data URL 이 든 JSON)은 서버 기본 JSON 상한(100KB)을 장면
 * 9개 안팎부터 넘는다(413 — 굽기가 조용히 실패했다). 앱이 자기 상한을 **등록 칸에 선언**하고(코어 분기 ❌), 코어는 그 선언대로 기본
 * 파서보다 앞에 붙인다. 상한을 선언하지 않은 앱 앞머리에서 같은 본문이 413 인 것이 곧 종전 상태의 재현이다.
 */

let server: Server;
let base: string;

beforeEach(async () => {
  const app = express();
  mountAppBodyParsers(app);
  app.use(express.json());
  const echo = (req: Request, res: Response): void => {
    const frames = (req.body as { frames?: unknown } | undefined)?.frames;
    res.json({ ok: true, frames: Array.isArray(frames) ? frames.length : 0 });
  };
  // 상한을 선언한 앱(스튜디오)의 보고 자리와, 선언하지 않은 앱 앞머리(기본 상한 그대로).
  app.post('/api/app/vibistudio/job/:jobId/report', echo);
  app.post('/api/app/vibisound/echo', echo);
  app.use((error: { status?: number }, _req: Request, res: Response, _next: NextFunction): void => {
    res.status(error.status ?? 500).json({ ok: false, status: error.status ?? 500 });
  });
  await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => resolve()); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('port');
  base = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

/** 장면 n 개의 대표 프레임 보고(장면마다 webp data URL 약 14KB — 실제 굽기 크기 안팎). */
function report(chapters: number): string {
  return JSON.stringify({
    frames: Array.from({ length: chapters }, (_, i) => ({ chapterId: `ch-${i}`, image: `data:image/webp;base64,${'A'.repeat(14_000)}` })),
  });
}

const post = (path: string, body: string): Promise<globalThis.Response> => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });

describe('§5.13 (Y) 40-7 ⑥ — R18 대표 프레임 보고와 JSON 상한', () => {
  it('reproduces the 413: nine chapter frames exceed the default 100KB JSON limit', async () => {
    const body = report(9);
    expect(body.length).toBeGreaterThan(100 * 1024);
    const res = await post('/api/app/vibisound/echo', body);
    expect(res.status).toBe(413);
  });

  it('accepts the same report — and a long video worth of chapters — under the studio prefix (the app declares 16MB)', async () => {
    const nine = await post('/api/app/vibistudio/job/j1/report', report(9));
    expect(nine.status).toBe(200);
    expect(await nine.json()).toEqual({ ok: true, frames: 9 });
    const many = await post('/api/app/vibistudio/job/j2/report', report(120));
    expect(many.status).toBe(200);
    expect(await many.json()).toEqual({ ok: true, frames: 120 });
  });
});
