/** §5.1 #2-1 (C) — `FileMentionScanner` 고정 시험(가짜 읽기 함수): 다 읽으면 알림 · 같은 도장은 재읽기 ❌ · 도장이 바뀌면 앞 결과를 쥔 채 재읽기 · 못 읽으면 언급 없음 · 동시 상한 · 읽는 사이 바뀌면 한 번 더. */
import { describe, it, expect, vi } from 'vitest';
import { CONSTELLATION } from '@vibisual/shared';
import { FileMentionScanner } from './fileMentionScanner.js';

/** 줄 선 비동기 일을 다 흘려보낸다(읽기 → 결과 기록 → 다음 일감). */
async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe('FileMentionScanner', () => {
  it('처음엔 모르고, 다 읽으면 알리고, 같은 도장은 다시 읽지 않는다', async () => {
    const onChange = vi.fn();
    const reads: string[] = [];
    const scanner = new FileMentionScanner(onChange, async (p) => {
      reads.push(p);
      return '{"bg": "assets/logo.png", "music": "bgm.wav"}';
    });
    expect(scanner.tokensFor('/p/comp.json', 10, 1)).toBeUndefined();
    await flush();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(scanner.tokensFor('/p/comp.json', 10, 1)).toEqual(['assets/logo.png', 'bgm.wav']);
    expect(scanner.tokensFor('/p/comp.json', 10, 1)).toEqual(['assets/logo.png', 'bgm.wav']);
    await flush();
    expect(reads).toEqual(['/p/comp.json']);
  });

  it('도장이 바뀌면 앞 결과를 쥔 채 다시 읽고, 결과가 같으면 알리지 않는다', async () => {
    const onChange = vi.fn();
    let reads = 0;
    const scanner = new FileMentionScanner(onChange, async () => {
      reads += 1;
      return 'uses intro.mp4';
    });
    scanner.tokensFor('/p/render.mjs', 5, 1);
    await flush();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(scanner.tokensFor('/p/render.mjs', 6, 2)).toEqual(['intro.mp4']); // 다시 읽는 동안 앞 결과
    await flush();
    expect(reads).toBe(2);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('못 읽으면 언급 없음으로 기억하고 알리지 않는다', async () => {
    const onChange = vi.fn();
    const onSettled = vi.fn();
    const scanner = new FileMentionScanner(onChange, async () => {
      throw new Error('EBUSY');
    }, onSettled);
    scanner.tokensFor('/p/locked.json', 1, 1);
    await flush();
    expect(onChange).not.toHaveBeenCalled();
    expect(scanner.tokensFor('/p/locked.json', 1, 1)).toEqual([]);
    expect(scanner.pendingCount()).toBe(0);
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it('빈 결과도 완료를 알리고, 첫 읽기를 기다리는 폴더가 계속 보류되지 않는다', async () => {
    const onChange = vi.fn();
    const onSettled = vi.fn();
    const scanner = new FileMentionScanner(onChange, async () => '', onSettled);
    scanner.tokensFor('/p/empty.ts', 0, 1);
    expect(scanner.isPending('/p/empty.ts')).toBe(true);
    await flush();
    expect(scanner.isPending('/p/empty.ts')).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it('읽기가 밀려도 대기열은 캐시 상한 안이며 빠진 파일은 다음 조회에서 다시 시도한다', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const scanner = new FileMentionScanner(() => undefined, async () => { await gate; return ''; });
    for (let i = 0; i <= CONSTELLATION.scanCacheMax; i += 1) scanner.tokensFor(`/p/${i}.ts`, 1, 1);
    expect(scanner.pendingCount()).toBe(CONSTELLATION.scanCacheMax);
    const overflow = `/p/${CONSTELLATION.scanCacheMax}.ts`;
    expect(scanner.isPending(overflow)).toBe(false);
    release?.();
    await flush();
    expect(scanner.pendingCount()).toBe(0);
    scanner.tokensFor(overflow, 1, 1);
    expect(scanner.isPending(overflow)).toBe(true);
    await flush();
    expect(scanner.tokensFor(overflow, 1, 1)).toEqual([]);
  });

  it('동시에 읽는 수는 상한을 넘지 않는다', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const scanner = new FileMentionScanner(() => undefined, async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise<void>((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return 'a.png';
    });
    for (let i = 0; i < 7; i += 1) scanner.tokensFor(`/p/f${i}.json`, 1, 1);
    for (let i = 0; i < 6; i += 1) await new Promise<void>((resolve) => setTimeout(resolve, 3));
    await flush();
    expect(maxInFlight).toBeLessThanOrEqual(CONSTELLATION.scanConcurrency);
    expect(scanner.pendingCount()).toBe(0);
  });

  it('읽는 사이 도장이 바뀌면 새 도장으로 한 번 더 읽는다', async () => {
    let call = 0;
    let releaseFirst: (() => void) | null = null;
    const scanner = new FileMentionScanner(() => undefined, async () => {
      call += 1;
      if (call === 1) {
        await new Promise<void>((resolve) => { releaseFirst = resolve; });
        return 'old.png';
      }
      return 'new.png';
    });
    scanner.tokensFor('/p/a.json', 1, 1);
    await flush();
    scanner.tokensFor('/p/a.json', 2, 2); // 읽는 중에 바뀌었다
    (releaseFirst as (() => void) | null)?.();
    await flush();
    expect(call).toBe(2);
    expect(scanner.tokensFor('/p/a.json', 2, 2)).toEqual(['new.png']);
  });
});
