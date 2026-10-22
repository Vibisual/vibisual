/**
 * §3.7 「훅 입구의 본문 상한은 문의 상한과 같다」 — 큰 파일을 고친 훅 신고가 413 으로 버려지지 않는다.
 *
 * 실측(2026-10-21): 지난 3주 우리 훅 오류 알림 2,807건 중 2,100건이 `HTTP 413 from …/api/hook-event` 였다.
 * 루프백 문은 16MB 까지 받는데, 그 뒤의 전역 `express.json()` 이 기본 100KB 에서 끊었다. 서버 본체와 같은 순서
 * (훅 입구 파서 → 전역 파서)로 앱을 세워 진짜 HTTP 로 보낸다.
 */
import { afterEach, describe, expect, it } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { LOOPBACK_REQUEST_MAX_BYTES } from '@vibisual/shared';
import { HOOK_INGRESS_JSON_PATHS, mountHookIngressBodyParser } from './hookIngressBody.js';

const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

/** 서버 본체와 같은 순서로 파서를 건 앱 — 받은 본문의 크기를 돌려준다. */
async function serve(withHookParser: boolean): Promise<string> {
  const app = express();
  if (withHookParser) mountHookIngressBodyParser(app);
  app.use(express.json());
  const echo = (req: express.Request, res: express.Response): void => {
    res.json({ bytes: JSON.stringify(req.body ?? null).length });
  };
  for (const route of HOOK_INGRESS_JSON_PATHS) app.post(route, echo);
  app.post('/api/other', echo);
  const server = app.listen(0, '127.0.0.1');
  servers.push(server);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** `PostToolUse:Edit` 처럼 원본 파일을 통째로 실은 본문. */
function hookBody(bytes: number): string {
  return JSON.stringify({
    hook_event_name: 'PostToolUse',
    tool_name: 'Edit',
    tool_response: { originalFile: 'x'.repeat(bytes) },
  });
}

async function post(base: string, route: string, body: string): Promise<number> {
  const res = await fetch(`${base}${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  await res.arrayBuffer();
  return res.status;
}

describe('훅 입구 — 큰 신고를 413 으로 버리지 않는다', () => {
  it('파서가 없으면 200KB 신고가 413 이다 — 고치기 전의 자리', async () => {
    const base = await serve(false);
    expect(await post(base, '/api/hook-event', hookBody(200 * 1024))).toBe(413);
  });

  it('네 경로 모두 200KB·2MB 신고를 받는다', async () => {
    const base = await serve(true);
    for (const route of HOOK_INGRESS_JSON_PATHS) {
      expect(await post(base, route, hookBody(200 * 1024)), route).toBe(200);
      expect(await post(base, route, hookBody(2 * 1024 * 1024)), route).toBe(200);
    }
  });

  it('상한은 루프백 문과 같다 — 넘으면 여전히 413', async () => {
    const base = await serve(true);
    expect(await post(base, '/api/hook-event', hookBody(LOOPBACK_REQUEST_MAX_BYTES + 1024))).toBe(413);
  });

  it('다른 경로의 상한은 그대로다(전역 100KB)', async () => {
    const base = await serve(true);
    expect(await post(base, '/api/other', hookBody(200 * 1024))).toBe(413);
  });
});
