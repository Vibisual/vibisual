import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetchPoster: vi.fn() }));
vi.mock('./videoApi.js', () => ({ fetchDocPoster: mocks.fetchPoster }));

import {
  BAKE_CONCURRENCY, POSTER_FAILED, PROBE_CONCURRENCY, __posterQueueForTest, __resetPostersForTest, forgetFailedPosters, posterKey, recallPoster, requestPoster, subscribePoster,
} from './docPosters.js';
import { __resetStudioIdleForTest, setStudioBusy } from './studioIdle.js';

const P = '/project';
const doc = (id: string, version = 1, updatedAt = 10) => ({ id, version, updatedAt });
const IMG = 'data:image/webp;base64,AAAA';

function deferred<T>() { let resolve!: (v: T) => void; let reject!: (e: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
const tick = async (n = 3): Promise<void> => { for (let i = 0; i < n; i += 1) await new Promise((r) => setTimeout(r, 0)); };

beforeEach(() => { __resetPostersForTest(); __resetStudioIdleForTest(); mocks.fetchPoster.mockReset(); });
afterEach(() => { __resetStudioIdleForTest(); });

describe('문서 갤러리 포스터 줄', () => {
  it('디스크 묻기는 동시 수를 넘지 않고, 끝나는 대로 다음이 나간다', async () => {
    const gates = Array.from({ length: 7 }, () => deferred<{ state: string; image: string | null }>());
    let n = 0;
    mocks.fetchPoster.mockImplementation(() => gates[n++]?.promise);
    for (let i = 0; i < 7; i += 1) requestPoster(P, doc(`d${i}`));
    expect(mocks.fetchPoster).toHaveBeenCalledTimes(PROBE_CONCURRENCY);
    expect(__posterQueueForTest()).toMatchObject({ probing: PROBE_CONCURRENCY, probeWaiting: 3 });
    gates[0]?.resolve({ state: 'hit', image: IMG });
    await tick();
    expect(mocks.fetchPoster).toHaveBeenCalledTimes(PROBE_CONCURRENCY + 1);
    expect(recallPoster(posterKey(P, doc('d0')))).toBe(IMG);
  });

  it('디스크에 있으면 굽지 않는다 · 같은 판본은 다시 묻지 않는다', async () => {
    mocks.fetchPoster.mockResolvedValue({ state: 'hit', image: IMG });
    requestPoster(P, doc('a'));
    await tick();
    expect(mocks.fetchPoster).toHaveBeenCalledTimes(1);
    expect(mocks.fetchPoster).toHaveBeenCalledWith(P, 'a', false);
    requestPoster(P, doc('a'));
    await tick();
    expect(mocks.fetchPoster).toHaveBeenCalledTimes(1);
    // 판본이 바뀌면 열쇠가 바뀌어 다시 묻는다(서버 열쇠가 같으면 디스크에서 바로 온다).
    requestPoster(P, doc('a', 2, 20));
    await tick();
    expect(mocks.fetchPoster).toHaveBeenCalledTimes(2);
  });

  it('디스크에 없으면 굽기 줄로 — 동시 1, 스튜디오가 바쁘면 쉰다', async () => {
    const bakes: Array<ReturnType<typeof deferred<{ state: string; image: string | null }>>> = [];
    mocks.fetchPoster.mockImplementation((_p: string, _id: string, render: boolean) => {
      if (!render) return Promise.resolve({ state: 'missing', image: null });
      const d = deferred<{ state: string; image: string | null }>(); bakes.push(d); return d.promise;
    });
    setStudioBusy('playing', true);
    requestPoster(P, doc('a'));
    requestPoster(P, doc('b'));
    await tick(6);
    expect(bakes).toHaveLength(0); // 바쁜 동안은 굽지 않는다
    expect(__posterQueueForTest().baking).toBe(BAKE_CONCURRENCY);
    setStudioBusy('playing', false);
    await tick(6);
    expect(bakes).toHaveLength(1);
    expect(__posterQueueForTest()).toMatchObject({ baking: 1, bakeWaiting: 1 });
    bakes[0]?.resolve({ state: 'baked', image: IMG });
    await tick(6);
    expect(recallPoster(posterKey(P, doc('a')))).toBe(IMG);
    expect(bakes).toHaveLength(2);
  });

  it('줄에서 기다리던 요청은 취소하면 걷힌다(판을 닫으면 대기 중인 것이 남지 않는다)', async () => {
    const gate = deferred<{ state: string; image: string | null }>();
    mocks.fetchPoster.mockImplementation(() => gate.promise);
    const cancels = Array.from({ length: 8 }, (_, i) => requestPoster(P, doc(`d${i}`)));
    expect(__posterQueueForTest().probeWaiting).toBe(8 - PROBE_CONCURRENCY);
    for (const cancel of cancels) cancel();
    expect(__posterQueueForTest().probeWaiting).toBe(0);
    gate.resolve({ state: 'hit', image: IMG });
    await tick();
    expect(mocks.fetchPoster).toHaveBeenCalledTimes(PROBE_CONCURRENCY);
    // 이미 나간 요청의 결과는 버리지 않고 기억한다.
    expect(recallPoster(posterKey(P, doc('d0')))).toBe(IMG);
    expect(recallPoster(posterKey(P, doc('d7')))).toBeUndefined();
  });

  it('굽기 줄에서 기다리다 취소되면 굽지 않는다', async () => {
    mocks.fetchPoster.mockResolvedValue({ state: 'missing', image: null });
    setStudioBusy('typing', true);
    const cancel = requestPoster(P, doc('a'));
    await tick(6);
    cancel();
    setStudioBusy('typing', false);
    await tick(6);
    expect(mocks.fetchPoster.mock.calls.filter((c) => c[2] === true)).toHaveLength(0);
    expect(recallPoster(posterKey(P, doc('a')))).toBeUndefined();
    expect(__posterQueueForTest()).toMatchObject({ baking: 0, bakeWaiting: 0 });
  });

  it('그릴 것이 없는 문서는 빈 값으로 기억하고, 실패는 판을 다시 열 때 한 번 더 청한다', async () => {
    mocks.fetchPoster.mockResolvedValueOnce({ state: 'empty', image: null });
    mocks.fetchPoster.mockRejectedValueOnce(new Error('offline'));
    requestPoster(P, doc('empty'));
    requestPoster(P, doc('bad'));
    await tick();
    expect(recallPoster(posterKey(P, doc('empty')))).toBe('');
    expect(recallPoster(posterKey(P, doc('bad')))).toBe(POSTER_FAILED);
    mocks.fetchPoster.mockResolvedValue({ state: 'hit', image: IMG });
    requestPoster(P, doc('bad'));
    await tick();
    expect(mocks.fetchPoster).toHaveBeenCalledTimes(2); // 실패는 그대로 기억 — 조르지 않는다
    forgetFailedPosters();
    requestPoster(P, doc('bad'));
    await tick();
    expect(recallPoster(posterKey(P, doc('bad')))).toBe(IMG);
    expect(recallPoster(posterKey(P, doc('empty')))).toBe('');
  });

  it('기억이 차면 구독자에게 알린다', async () => {
    mocks.fetchPoster.mockResolvedValue({ state: 'hit', image: IMG });
    const seen = vi.fn();
    const off = subscribePoster(posterKey(P, doc('a')), seen);
    requestPoster(P, doc('a'));
    await tick();
    expect(seen).toHaveBeenCalled();
    off();
  });
});
