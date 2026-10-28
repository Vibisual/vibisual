/** §7.11 / §3.5 — Stop(200)·Restart(409)의 `refused: 'foreign'` 거절을 화면이 읽는다. */
import { describe, expect, it } from 'vitest';
import { isRefusedForOtherProject, refusedForOtherProject } from './serverControlRefusal.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('isRefusedForOtherProject', () => {
  it('서버의 거절 표식만 거절로 읽는다', () => {
    expect(isRefusedForOtherProject({ killed: false, refused: 'foreign', servers: [] })).toBe(true);
    expect(isRefusedForOtherProject({ error: 'port held by another project', refused: 'foreign' })).toBe(true);
  });

  it('정상 응답·인계 실패·빈 값은 거절이 아니다(인계 실패는 스냅샷 표식이 따로 알린다)', () => {
    expect(isRefusedForOtherProject({ killed: true, servers: [] })).toBe(false);
    expect(isRefusedForOtherProject({ error: 'command unknown (takeover failed)', takeoverFailed: true })).toBe(false);
    expect(isRefusedForOtherProject(null)).toBe(false);
    expect(isRefusedForOtherProject('foreign')).toBe(false);
  });
});

describe('refusedForOtherProject — 응답 본문을 읽는다', () => {
  it('Stop(200)·Restart(409) 거절을 둘 다 읽는다', async () => {
    expect(await refusedForOtherProject(jsonResponse(200, { killed: false, refused: 'foreign' }))).toBe(true);
    expect(await refusedForOtherProject(jsonResponse(409, { error: 'port held by another project', refused: 'foreign' }))).toBe(true);
  });

  it('본문이 JSON 이 아니면 거절 아님 — 던지지 않는다', async () => {
    expect(await refusedForOtherProject(new Response('Internal error', { status: 500 }))).toBe(false);
  });
});
