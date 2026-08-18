/**
 * §3.2.4 ② — 병렬 팬아웃이 **순차와 같은 결과**인지 고정한다.
 * 바꾼 것은 왕복을 겹치는 것뿐이고, 호출부의 병합은 순서에 의존하므로 순서 보존이 핵심이다.
 */
import { describe, it, expect } from 'vitest';
import { mapWithConcurrency } from './tokenFanout';

describe('mapWithConcurrency', () => {
  it('결과를 입력 순서 그대로 돌려준다(완료 순서와 무관)', async () => {
    const items = [5, 1, 4, 2, 3];
    // 늦게 끝나는 것이 앞에 오도록 지연을 역순으로 준다.
    const out = await mapWithConcurrency(items, 3, async (n) => {
      await new Promise((r) => setTimeout(r, n * 5));
      return n * 10;
    });
    expect(out).toEqual([50, 10, 40, 20, 30]);
  });

  it('동시 실행 수가 상한을 넘지 않는다', async () => {
    let inflight = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 12 }, (_, i) => i), 4, async (i) => {
      inflight += 1;
      peak = Math.max(peak, inflight);
      await new Promise((r) => setTimeout(r, 3));
      inflight -= 1;
      return i;
    });
    expect(peak).toBeLessThanOrEqual(4);
  });

  it('빈 배열은 빈 결과', async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
  });

  it('상한이 항목 수보다 커도 안전하다', async () => {
    expect(await mapWithConcurrency([1, 2], 99, async (n) => n + 1)).toEqual([2, 3]);
  });
});
