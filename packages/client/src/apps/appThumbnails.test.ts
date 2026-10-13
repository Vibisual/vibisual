import { describe, expect, it, vi } from 'vitest';

import type { AppThumbnail, AppThumbnailRenderer } from './registry.js';
import {
  createThumbCache,
  formatMediaDuration,
  thumbBakeBox,
  thumbKey,
  thumbPixelSize,
  wavePath,
  type ThumbJob,
} from './appThumbnails.js';

/**
 * §5.4 #36 (F) — 앱 위성 화면의 미리보기 기억 장소. 앱이 굽고 코어가 기억한다 — 여기서 고정하는 것은
 * "몇 번·언제 굽는가"(같은 결과는 한 번, 동시 건수 상한, 못 구운 것도 기억, 밀려난 그림은 되돌림)다.
 * DOM 이 없는 시험 환경이라 순수 코어(`createThumbCache`)만 본다.
 */
function job(over: Partial<ThumbJob> = {}): ThumbJob {
  return { appId: 'app-a', projectId: 'C:/proj', file: 'out/a.png', version: 1, width: 416, height: 260, ...over };
}

function picture(url: string): AppThumbnail {
  return { kind: 'picture', url };
}

/** 마이크로태스크를 몇 바퀴 돌려 줄·정착이 끝나게 한다. */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

describe('§5.4 #36 (F) 미리보기 열쇠', () => {
  it('같은 결과면 같은 열쇠 — 결과 버전·크기가 바뀌면 다른 열쇠', () => {
    expect(thumbKey(job())).toBe(thumbKey(job()));
    expect(thumbKey(job({ version: 2 }))).not.toBe(thumbKey(job()));
    expect(thumbKey(job({ width: 208 }))).not.toBe(thumbKey(job()));
    expect(thumbKey(job({ file: 'out/b.png' }))).not.toBe(thumbKey(job()));
  });

  it('경로 구분자가 다른 같은 루트는 같은 열쇠(경로키) — 다른 파일과 섞이지 않는다', () => {
    expect(thumbKey(job({ projectId: 'C:\\proj' }))).toBe(thumbKey(job({ projectId: 'C:/proj' })));
  });
});

describe('§5.4 #36 (F) 미리보기 기억 장소', () => {
  it('같은 일감은 한 번만 굽고, 구워지면 구독자에게 알린다', async () => {
    const render = vi.fn<AppThumbnailRenderer>(async () => picture('blob:a'));
    const cache = createThumbCache({ resolve: async () => render, release: vi.fn(), cacheMax: 10, concurrency: 2, timeoutMs: 1000 });
    const key = cache.ensure(job());
    cache.ensure(job());
    const listener = vi.fn();
    cache.subscribe(key, listener);
    expect(cache.peek(key).status).toBe('loading');
    await flush();
    expect(render).toHaveBeenCalledTimes(1);
    expect(cache.peek(key)).toEqual({ status: 'ready', thumb: picture('blob:a') });
    expect(listener).toHaveBeenCalled();
  });

  it('못 구운 것(null·예외·선언 없음)도 기억한다 — 다시 조르지 않는다', async () => {
    const render = vi.fn<AppThumbnailRenderer>(async () => {
      throw new Error('codec');
    });
    const cache = createThumbCache({ resolve: async () => render, release: vi.fn(), cacheMax: 10, concurrency: 2, timeoutMs: 1000 });
    const key = cache.ensure(job());
    await flush();
    expect(cache.peek(key).status).toBe('none');
    cache.ensure(job());
    await flush();
    expect(render).toHaveBeenCalledTimes(1);

    const noApp = createThumbCache({ resolve: async () => null, release: vi.fn(), cacheMax: 10, concurrency: 2, timeoutMs: 1000 });
    const k2 = noApp.ensure(job());
    await flush();
    expect(noApp.peek(k2).status).toBe('none');
  });

  it('동시에 굽는 수는 상한까지 — 나머지는 줄을 선다', async () => {
    let running = 0;
    let peak = 0;
    const gates: Array<() => void> = [];
    const render: AppThumbnailRenderer = () => new Promise((resolve) => {
      running += 1;
      peak = Math.max(peak, running);
      gates.push(() => {
        running -= 1;
        resolve(picture('blob:x'));
      });
    });
    const cache = createThumbCache({ resolve: async () => render, release: vi.fn(), cacheMax: 10, concurrency: 2, timeoutMs: 10_000 });
    for (let i = 0; i < 5; i += 1) cache.ensure(job({ file: `f${i}.png` }));
    await flush();
    expect(peak).toBe(2);
    while (gates.length > 0) {
      gates.shift()!();
      await flush();
    }
    expect(peak).toBe(2);
  });

  it('상한을 넘으면 오래 안 본 것부터 버리고 그 그림을 되돌린다 — 그려지는 중인 것은 남긴다', async () => {
    const release = vi.fn();
    let n = 0;
    const render: AppThumbnailRenderer = async () => picture(`blob:${(n += 1)}`);
    const cache = createThumbCache({ resolve: async () => render, release, cacheMax: 2, concurrency: 2, timeoutMs: 1000 });
    const k0 = cache.ensure(job({ file: 'a.png' }));
    const unsubscribe = cache.subscribe(k0, () => undefined); // 화면에 떠 있다
    await flush();
    cache.ensure(job({ file: 'b.png' }));
    await flush();
    cache.ensure(job({ file: 'c.png' }));
    await flush();
    expect(cache.size()).toBe(2);
    expect(cache.peek(k0).status).toBe('ready'); // 구독 중이라 남았다
    expect(release).toHaveBeenCalledTimes(1); // b 가 밀려났다
    unsubscribe();
  });

  it('시간 상한을 넘기면 못 구운 것으로 치고, 늦게 끝난 결과는 되돌린다', async () => {
    vi.useFakeTimers();
    try {
      const release = vi.fn();
      let finish: (t: AppThumbnail) => void = () => undefined;
      const render: AppThumbnailRenderer = () => new Promise((resolve) => { finish = resolve; });
      const cache = createThumbCache({ resolve: async () => render, release, cacheMax: 10, concurrency: 1, timeoutMs: 50 });
      const key = cache.ensure(job());
      await vi.advanceTimersByTimeAsync(60);
      expect(cache.peek(key).status).toBe('none');
      finish(picture('blob:late'));
      await vi.advanceTimersByTimeAsync(0);
      await flush();
      expect(release).toHaveBeenCalledWith(picture('blob:late'));
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('§5.4 #36 (F) 화면 표시 도우미', () => {
  it('길이 — 0:01 부터, 시간이 넘으면 시:분:초', () => {
    expect(formatMediaDuration(0)).toBe('');
    expect(formatMediaDuration(Number.NaN)).toBe('');
    expect(formatMediaDuration(0.4)).toBe('0:01');
    expect(formatMediaDuration(12.4)).toBe('0:12');
    expect(formatMediaDuration(65)).toBe('1:05');
    expect(formatMediaDuration(3903)).toBe('1:05:03');
  });

  it('파형은 path 하나 — 막대 수만큼 M·V 쌍, 0 인 막대도 보이는 최소 길이', () => {
    const { d, strokeWidth } = wavePath([0, 0.5, 1], 120, 60, 8);
    expect(d.match(/M/g)).toHaveLength(3);
    expect(d.match(/V/g)).toHaveLength(3);
    expect(strokeWidth).toBeGreaterThan(0);
    expect(wavePath([], 120, 60, 8).d).toBe('');
  });

  it('구울 크기 — 화면 배율을 곱하되 상한까지', () => {
    expect(thumbPixelSize(208, 130, 1)).toEqual({ width: 208, height: 130 });
    expect(thumbPixelSize(208, 130, 1.5)).toEqual({ width: 312, height: 195 });
    expect(thumbPixelSize(208, 130, 3)).toEqual({ width: 416, height: 260 });
    expect(thumbPixelSize(208, 130, Number.NaN)).toEqual({ width: 208, height: 130 });
  });
});

/**
 * §5.4 #36 (G) — 노드 크기를 바꿀 수 있게 되면서 굽는 크기가 1px 단위로 흔들리면 안 된다. 같은 칸 안의 크기는 같은 열쇠다.
 */
describe('§5.4 #36 (G) 굽는 크기·파형 구간', () => {
  it('굽는 자리는 단위로 올려 잡는다 — 같은 칸 안이면 같은 크기', () => {
    const a = thumbBakeBox(206, 106);
    const b = thumbBakeBox(240, 120);
    expect(a).toEqual(b);
    expect(a.width).toBeGreaterThanOrEqual(240); // 올려 잡으므로 흐려지지 않는다
    expect(a.height).toBeGreaterThanOrEqual(120);
    expect(thumbBakeBox(0, Number.NaN).width).toBeGreaterThan(0); // 이상한 값에도 0 크기를 내지 않는다
  });

  it('파형 구간 두 개를 겹치면 전체 파형과 같은 막대가 된다', () => {
    const peaks = [0.1, 0.4, 0.8, 0.3];
    const all = wavePath(peaks, 120, 60, 8);
    const heard = wavePath(peaks, 120, 60, 8, { from: 0, to: 2 });
    const rest = wavePath(peaks, 120, 60, 8, { from: 2, to: 4 });
    expect(heard.d + rest.d).toBe(all.d);
    expect(heard.strokeWidth).toBe(all.strokeWidth);
    expect(wavePath(peaks, 120, 60, 8, { from: 3, to: 3 }).d).toBe('');
  });
});
