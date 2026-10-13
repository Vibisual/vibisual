import { describe, expect, it, vi } from 'vitest';

import { boundedRangeFetch } from './rangeFetch.js';

/**
 * 끝이 열린 구간(`bytes=N-`)을 묶어 보내는가 — 응답을 통째로 싣는 호스트 fetch 에서 대표 프레임 하나에
 * 파일 전체가 건너오지 않게 하는 자리다(SCENARIO §5.4 #36 (F)).
 */
type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function makeBase(status: number): ReturnType<typeof vi.fn<FetchFn>> {
  return vi.fn<FetchFn>(async () => new Response(null, { status }));
}

function rangeOf(init: RequestInit | undefined): string | null {
  return new Headers(init?.headers ?? undefined).get('Range');
}

describe('boundedRangeFetch', () => {
  it('끝이 열린 구간을 chunk 만큼으로 닫는다', async () => {
    const base = makeBase(206);
    const f = boundedRangeFetch(1024, base as unknown as typeof fetch);
    await f('/media', { headers: { Range: 'bytes=4096-' } });
    expect(rangeOf(base.mock.calls[0]?.[1])).toBe('bytes=4096-5119');
  });

  it('Headers 객체로 와도 같다 — 넘길 때는 평범한 객체다', async () => {
    const base = makeBase(206);
    const f = boundedRangeFetch(10, base as unknown as typeof fetch);
    await f('/media', { headers: new Headers({ Range: 'bytes=0-', 'X-Test': '1' }) });
    const init = base.mock.calls[0]?.[1];
    expect(init?.headers).not.toBeInstanceOf(Headers);
    expect(rangeOf(init)).toBe('bytes=0-9');
    expect(new Headers(init?.headers ?? undefined).get('X-Test')).toBe('1');
  });

  it('끝이 닫힌 구간·구간 없는 요청은 그대로 보낸다', async () => {
    const base = makeBase(200);
    const f = boundedRangeFetch(10, base as unknown as typeof fetch);
    const closed: RequestInit = { headers: { Range: 'bytes=5-8' } };
    await f('/media', closed);
    expect(base.mock.calls[0]?.[1]).toBe(closed);
    await f('/media');
    expect(base.mock.calls[1]?.[1]).toBeUndefined();
  });
});
