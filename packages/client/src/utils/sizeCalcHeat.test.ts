/**
 * §5.24 — 히트맵이 켜졌을 때 `calcBubbleSize` 가 무엇을 갈아끼우고 무엇을 그대로 두는지,
 * 그리고 상대 척도가 프로젝트 경계를 넘지 않는지를 고정한다.
 */
import { describe, it, expect } from 'vitest';
import { FILE_MIN_SIZE, HEAT_MAX_SIZE, HEAT_MIN_SIZE, IFRAME_BUBBLE_HEIGHT } from '@vibisual/shared';
import type { BubbleData, BubbleType } from '@vibisual/shared';
import { calcBubbleSize, calcReadCountRange } from './sizeCalc.js';

function bubble(over: Partial<BubbleData> & { id: string; bubbleType: BubbleType }): BubbleData {
  return {
    label: over.id,
    path: over.id,
    status: 'idle',
    activity: 0,
    ...over,
  } as BubbleData;
}

describe('calcBubbleSize — 히트맵 모드', () => {
  it('히트 대상은 읽기 횟수 상대값으로 지름이 정해진다', () => {
    const hot = bubble({ id: 'a', bubbleType: 'file', readCount: 10, fileSize: 1 });
    const cold = bubble({ id: 'b', bubbleType: 'file', readCount: 0, fileSize: 999_999 });
    expect(calcBubbleSize(hot, undefined, { max: 10 })).toBe(HEAT_MAX_SIZE);
    expect(calcBubbleSize(cold, undefined, { max: 10 })).toBe(HEAT_MIN_SIZE);
  });

  it('용량이 큰 파일이라도 안 읽었으면 작다 — 축이 갈아끼워진다', () => {
    const big = bubble({ id: 'big', bubbleType: 'file', fileSize: 1_000_000, readCount: 0 });
    const heatOff = calcBubbleSize(big, { min: 0, max: 1_000_000 });
    const heatOn = calcBubbleSize(big, { min: 0, max: 1_000_000 }, { max: 5 });
    expect(heatOff).toBeGreaterThan(heatOn);
  });

  it('폴더·도메인도 같은 자를 쓴다 — 뜨거운 파일이 차가운 폴더보다 크다', () => {
    const hotFile = bubble({ id: 'f', bubbleType: 'file', readCount: 20 });
    const coldFolder = bubble({ id: 'd', bubbleType: 'internal_folder', readCount: 1, childCount: 30 });
    const domain = bubble({ id: 'w', bubbleType: 'domain', readCount: 20 });
    const scale = { max: 20 };
    expect(calcBubbleSize(hotFile, undefined, scale)).toBeGreaterThan(
      calcBubbleSize(coldFolder, undefined, scale),
    );
    expect(calcBubbleSize(domain, undefined, scale)).toBe(calcBubbleSize(hotFile, undefined, scale));
  });

  it('읽는 주체(agent)와 길(root/back)은 히트맵에서도 불변', () => {
    const scale = { max: 10 };
    for (const t of ['agent', 'root', 'back', 'brain', 'trash'] as BubbleType[]) {
      const b = bubble({ id: t, bubbleType: t, activity: 7, readCount: 0 });
      expect(calcBubbleSize(b, undefined, scale)).toBe(calcBubbleSize(b));
    }
  });

  it('iframe 고정 지름도 불변 — 히트 대상이 아니다', () => {
    const b = bubble({ id: 'i', bubbleType: 'iframe', readCount: 0 });
    expect(calcBubbleSize(b, undefined, { max: 10 })).toBe(IFRAME_BUBBLE_HEIGHT);
  });

  it('히트를 안 넘기면 평상시 규칙 그대로', () => {
    const b = bubble({ id: 'f', bubbleType: 'file', readCount: 99 });
    expect(calcBubbleSize(b)).toBe(FILE_MIN_SIZE); // range 없음 → 종전 동작
  });

  it('척도가 0 이어도(아직 아무것도 안 읽음) 모두 최소 크기로 떨어진다 — 전부 최대가 되지 않는다', () => {
    const b = bubble({ id: 'f', bubbleType: 'file', readCount: 0 });
    expect(calcBubbleSize(b, undefined, { max: 0 })).toBe(HEAT_MIN_SIZE);
  });
});

describe('calcReadCountRange — 상대 척도', () => {
  const nodes: BubbleData[] = [
    bubble({ id: 'p1-file', bubbleType: 'file', readCount: 4 }),
    bubble({ id: 'p1-folder', bubbleType: 'internal_folder', readCount: 9 }),
    bubble({ id: 'p2-file', bubbleType: 'file', readCount: 500 }),
    bubble({ id: 'p1-agent', bubbleType: 'agent', readCount: 999 }),
    bubble({ id: 'orphan', bubbleType: 'file', readCount: 7 }),
  ];
  const owners: Record<string, string> = {
    'p1-file': 'alpha',
    'p1-folder': 'alpha',
    'p2-file': 'beta',
    'p1-agent': 'alpha',
  };

  it('다른 프로젝트의 뜨거운 파일이 이 지도를 누르지 않는다', () => {
    expect(calcReadCountRange(nodes, owners, 'alpha').max).toBe(9);
    expect(calcReadCountRange(nodes, owners, 'beta').max).toBe(500);
  });

  it('히트 대상이 아닌 버블(agent)은 척도에 끼지 않는다', () => {
    expect(calcReadCountRange(nodes, owners, 'alpha').max).not.toBe(999);
  });

  it('소속을 모르는 노드는 포함한다 — 오차는 덜 뜨거운 쪽으로', () => {
    // orphan(7) 은 owners 에 없으므로 alpha 척도(9)에 함께 든다.
    const onlyOrphan = calcReadCountRange(
      [bubble({ id: 'orphan', bubbleType: 'file', readCount: 7 })],
      owners,
      'alpha',
    );
    expect(onlyOrphan.max).toBe(7);
  });

  it('활성 프로젝트가 없으면 전부 본다', () => {
    expect(calcReadCountRange(nodes, owners, null).max).toBe(500);
  });

  it('아무것도 안 읽었으면 0 — 램프를 켜지 않는 신호', () => {
    expect(calcReadCountRange([bubble({ id: 'f', bubbleType: 'file' })], {}, null).max).toBe(0);
  });
});
