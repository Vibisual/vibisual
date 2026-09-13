/**
 * §5.24 — 히트맵이 켜졌을 때 `calcBubbleSize` 가 무엇을 갈아끼우고 무엇을 그대로 두는지,
 * 그리고 상대 척도가 프로젝트 경계를 넘지 않는지를 고정한다.
 */
import { describe, it, expect } from 'vitest';
import { DEFAULT_HEAT_CURVE, FILE_MIN_SIZE, HEAT_MAX_SIZE, HEAT_MIN_SIZE, IFRAME_BUBBLE_HEIGHT } from '@vibisual/shared';
import type { BubbleData, BubbleType, HeatCurve, HeatScale, ToolAxis } from '@vibisual/shared';
import { calcBubbleSize, calcHeatCountRange } from './sizeCalc.js';

/** 척도는 **축·곡선과 한 벌**이라(§5.24) 시험도 그 둘을 명시해서 만든다. */
const heat = (
  max: number,
  axis: ToolAxis = 'read',
  curve: HeatCurve = DEFAULT_HEAT_CURVE,
): HeatScale => ({ max, axis, curve });

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
    expect(calcBubbleSize(hot, undefined, heat(10))).toBe(HEAT_MAX_SIZE);
    expect(calcBubbleSize(cold, undefined, heat(10))).toBe(HEAT_MIN_SIZE);
  });

  it('용량이 큰 파일이라도 안 읽었으면 작다 — 축이 갈아끼워진다', () => {
    const big = bubble({ id: 'big', bubbleType: 'file', fileSize: 1_000_000, readCount: 0 });
    const heatOff = calcBubbleSize(big, { min: 0, max: 1_000_000 });
    const heatOn = calcBubbleSize(big, { min: 0, max: 1_000_000 }, heat(5));
    expect(heatOff).toBeGreaterThan(heatOn);
  });

  it('폴더·도메인도 같은 자를 쓴다 — 뜨거운 파일이 차가운 폴더보다 크다', () => {
    const hotFile = bubble({ id: 'f', bubbleType: 'file', readCount: 20 });
    const coldFolder = bubble({ id: 'd', bubbleType: 'internal_folder', readCount: 1, childCount: 30 });
    const domain = bubble({ id: 'w', bubbleType: 'domain', readCount: 20 });
    const scale = heat(20);
    expect(calcBubbleSize(hotFile, undefined, scale)).toBeGreaterThan(
      calcBubbleSize(coldFolder, undefined, scale),
    );
    expect(calcBubbleSize(domain, undefined, scale)).toBe(calcBubbleSize(hotFile, undefined, scale));
  });

  it('읽는 주체(agent)와 길(root/back)은 히트맵에서도 불변', () => {
    const scale = heat(10);
    for (const t of ['agent', 'root', 'back', 'trash'] as BubbleType[]) {
      const b = bubble({ id: t, bubbleType: t, activity: 7, readCount: 0 });
      expect(calcBubbleSize(b, undefined, scale)).toBe(calcBubbleSize(b));
    }
  });

  it('iframe 고정 지름도 불변 — 히트 대상이 아니다', () => {
    const b = bubble({ id: 'i', bubbleType: 'iframe', readCount: 0 });
    expect(calcBubbleSize(b, undefined, heat(10))).toBe(IFRAME_BUBBLE_HEIGHT);
  });

  it('히트를 안 넘기면 평상시 규칙 그대로', () => {
    const b = bubble({ id: 'f', bubbleType: 'file', readCount: 99 });
    expect(calcBubbleSize(b)).toBe(FILE_MIN_SIZE); // range 없음 → 종전 동작
  });

  it('척도가 0 이어도(아직 아무것도 안 읽음) 모두 최소 크기로 떨어진다 — 전부 최대가 되지 않는다', () => {
    const b = bubble({ id: 'f', bubbleType: 'file', readCount: 0 });
    expect(calcBubbleSize(b, undefined, heat(0))).toBe(HEAT_MIN_SIZE);
  });

  it('지름도 곡선을 따른다 — 색만 바뀌고 크기가 안 따라오면 같은 버블이 두 말을 한다', () => {
    // 롱테일 한복판의 평범한 파일. 선형에서는 최소 지름에 붙어 있지만 기본 곡선에서는 떨어진다.
    const mid = bubble({ id: 'm', bubbleType: 'file', readCount: 42 });
    const linear = calcBubbleSize(mid, undefined, heat(2471, 'read', 'linear'));
    const dflt = calcBubbleSize(mid, undefined, heat(2471, 'read', DEFAULT_HEAT_CURVE));
    expect(linear).toBeLessThan(HEAT_MIN_SIZE + (HEAT_MAX_SIZE - HEAT_MIN_SIZE) * 0.05);
    expect(dflt).toBeGreaterThan(linear);
  });

  it('어느 곡선이든 최대값 버블은 최대 지름이다 — 양 끝은 곡선과 무관하다', () => {
    const top = bubble({ id: 't', bubbleType: 'file', readCount: 2471 });
    for (const curve of ['log', 'linear', 'sqrt', 'cbrt', 'quantile'] as HeatCurve[]) {
      expect(calcBubbleSize(top, undefined, heat(2471, 'read', curve))).toBe(HEAT_MAX_SIZE);
    }
  });
});

describe('calcHeatCountRange — 분포 폴백', () => {
  it('최대값과 같은 순회에서 분포도 모은다 — 0 이하는 넣지 않는다', () => {
    const nodes: BubbleData[] = [
      bubble({ id: 'a', bubbleType: 'file', readCount: 5 }),
      bubble({ id: 'b', bubbleType: 'file', readCount: 0 }),
      bubble({ id: 'c', bubbleType: 'internal_folder', readCount: 12 }),
      bubble({ id: 'd', bubbleType: 'agent', readCount: 999 }), // 히트 대상이 아니다
    ];
    const got = calcHeatCountRange(nodes, {}, null, 'read');
    expect(got.max).toBe(12);
    expect([...got.values].sort((x, y) => x - y)).toEqual([5, 12]);
  });

  it('프로젝트 경계는 분포에도 그대로 적용된다 (§3.5)', () => {
    const nodes: BubbleData[] = [
      bubble({ id: 'p1', bubbleType: 'file', readCount: 3 }),
      bubble({ id: 'p2', bubbleType: 'file', readCount: 700 }),
    ];
    const owners = { p1: 'alpha', p2: 'beta' };
    expect(calcHeatCountRange(nodes, owners, 'alpha', 'read').values).toEqual([3]);
  });
});

describe('calcHeatCountRange — 상대 척도', () => {
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
    expect(calcHeatCountRange(nodes, owners, 'alpha', 'read').max).toBe(9);
    expect(calcHeatCountRange(nodes, owners, 'beta', 'read').max).toBe(500);
  });

  it('히트 대상이 아닌 버블(agent)은 척도에 끼지 않는다', () => {
    expect(calcHeatCountRange(nodes, owners, 'alpha', 'read').max).not.toBe(999);
  });

  it('소속을 모르는 노드는 포함한다 — 오차는 덜 뜨거운 쪽으로', () => {
    // orphan(7) 은 owners 에 없으므로 alpha 척도(9)에 함께 든다.
    const onlyOrphan = calcHeatCountRange(
      [bubble({ id: 'orphan', bubbleType: 'file', readCount: 7 })],
      owners,
      'alpha',
      'read',
    );
    expect(onlyOrphan.max).toBe(7);
  });

  it('활성 프로젝트가 없으면 전부 본다', () => {
    expect(calcHeatCountRange(nodes, owners, null, 'read').max).toBe(500);
  });

  it('아무것도 안 읽었으면 0 — 램프를 켜지 않는 신호', () => {
    expect(calcHeatCountRange([bubble({ id: 'f', bubbleType: 'file' })], {}, null, 'read').max).toBe(0);
  });
});

describe('§5.24 축 토글 — 같은 지도를 쓰기 축으로 다시 칠한다', () => {
  const nodes: BubbleData[] = [
    bubble({ id: 'read-hot', bubbleType: 'file', readCount: 40, writeCount: 1 }),
    bubble({ id: 'write-hot', bubbleType: 'file', readCount: 2, writeCount: 9 }),
  ];

  it('척도를 축마다 따로 잰다 — 한 자를 나눠 쓰면 쓰기 지도가 통째로 눌린다', () => {
    expect(calcHeatCountRange(nodes, {}, null, 'read').max).toBe(40);
    expect(calcHeatCountRange(nodes, {}, null, 'write').max).toBe(9);
  });

  it('지름도 축을 따른다 — 많이 고친 파일이 쓰기 지도에서 가장 크다', () => {
    const writeHot = nodes[1]!;
    const readHot = nodes[0]!;
    expect(calcBubbleSize(writeHot, undefined, heat(9, 'write'))).toBe(HEAT_MAX_SIZE);
    expect(calcBubbleSize(readHot, undefined, heat(9, 'write'))).toBeLessThan(HEAT_MAX_SIZE);
    // 같은 버블이 읽기 축에서는 정반대다.
    expect(calcBubbleSize(readHot, undefined, heat(40, 'read'))).toBe(HEAT_MAX_SIZE);
  });

  it('한 축이 비어 있어도 다른 축을 끌어오지 않는다', () => {
    const readOnly = bubble({ id: 'r', bubbleType: 'file', readCount: 30 });
    expect(calcHeatCountRange([readOnly], {}, null, 'write').max).toBe(0);
    expect(calcBubbleSize(readOnly, undefined, heat(30, 'write'))).toBe(HEAT_MIN_SIZE);
  });

  it('§2.1 (A) 접합의 자손 합도 축마다 따로 본다', () => {
    const junction = bubble({
      id: 'ext',
      bubbleType: 'external_folder',
      readCount: 0,
      writeCount: 0,
      externalRollupReadCount: 46,
      externalRollupWriteCount: 12,
    });
    expect(calcHeatCountRange([junction], {}, null, 'read').max).toBe(46);
    expect(calcHeatCountRange([junction], {}, null, 'write').max).toBe(12);
  });
});
