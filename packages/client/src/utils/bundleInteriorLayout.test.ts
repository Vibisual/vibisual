/**
 * §5.1 #2-1 (B) — **묶음 안 배치** 고정 시험(순수 함수). ① 지름 = 사용 횟수(넓이 비례 · 최다가 `interiorMaxSize` · 횟수 없는 옛 노드는 활동량 ·
 * 히트맵이 켜지면 히트맵 · 묶음 밖은 용량) ② 많이 쓴 것이 가운데, 나머지는 맞닿아 모인다(고리 ❌) ③ 원·이름 줄이 안 겹친다(120개에서도)
 * ④ 같은 입력은 같은 그림 · `← Back` 은 왼쪽 위 바깥.
 */
import { describe, it, expect } from 'vitest';
import type { BubbleData, HeatScale } from '@vibisual/shared';
import { BUNDLE_BUBBLE, FILE_FACE, FILE_MIN_SIZE, heatRatio, heatSize } from '@vibisual/shared';

import { captionWidthOf, packBundleInterior } from './bundleInteriorLayout.js';
import { calcBubbleSize, fileUsageOf, withBundleUsageRange } from './sizeCalc.js';

const CENTER = { x: 500, y: 400 };

function shot(id: string, extra: Partial<BubbleData> = {}): BubbleData {
  return {
    id,
    label: `${id}.png`,
    bubbleType: 'file',
    path: `assets/${id}.png`,
    absolutePath: `C:/proj/assets/${id}.png`,
    status: 'idle',
    activity: 1,
    ...extra,
  };
}

const BACK: BubbleData = { id: '__interior_back__', label: '← Back', bubbleType: 'back', path: '', status: 'idle', activity: 1 };

/** 배치 결과를 원 가운데 · 반지름 · 이름 줄 반폭으로 되돌린다(시험이 직접 겹침을 잰다). */
function bodiesOf(members: BubbleData[], positions: Map<string, { x: number; y: number }>): { id: string; x: number; y: number; r: number; half: number }[] {
  return members.map((m) => {
    const d = calcBubbleSize(m, undefined, undefined);
    const p = positions.get(m.id)!;
    return { id: m.id, x: p.x + d / 2, y: p.y + d / 2, r: d / 2, half: captionWidthOf(m, d) / 2 };
  });
}

/** 두 몸이 겹치는가 — 원끼리 · 원과 이름 줄 · 이름 줄끼리(틈 `interiorGap` 를 둔 채, 반올림 여유 0.5px). */
function overlaps(a: ReturnType<typeof bodiesOf>[number], b: ReturnType<typeof bodiesOf>[number]): boolean {
  const gap = BUNDLE_BUBBLE.interiorGap - 0.5;
  const dist = Math.hypot(a.x - b.x, a.y - b.y);
  if (dist < a.r + b.r + gap) return true;
  const captionBox = (o: typeof a): { l: number; r: number; t: number; b: number } => {
    const t = o.y + o.r + FILE_FACE.captionGap;
    return { l: o.x - o.half, r: o.x + o.half, t, b: t + FILE_FACE.captionLineHeight };
  };
  const hitsCaption = (c: typeof a, o: typeof a): boolean => {
    const box = captionBox(o);
    const nx = Math.max(box.l, Math.min(c.x, box.r));
    const ny = Math.max(box.t, Math.min(c.y, box.b));
    return Math.hypot(c.x - nx, c.y - ny) < c.r + gap;
  };
  if (hitsCaption(a, b) || hitsCaption(b, a)) return true;
  const ba = captionBox(a);
  const bb = captionBox(b);
  return ba.l < bb.r + gap && bb.l < ba.r + gap && ba.t < bb.b + gap && bb.t < ba.b + gap;
}

describe('묶음 안 지름 — 사용 횟수', () => {
  it('넓이가 사용 횟수에 비례한다 — 가장 많이 쓴 것이 interiorMaxSize, 적게 쓴 것은 미디어 하한까지', () => {
    const members = withBundleUsageRange([
      shot('a', { readCount: 12, writeCount: 4 }), // 16
      shot('b', { readCount: 4 }), // 4
      shot('c', { readCount: 1 }), // 1
    ]);
    const [a, b, c] = members.map((m) => calcBubbleSize(m, undefined, undefined));
    expect(a).toBe(BUNDLE_BUBBLE.interiorMaxSize);
    expect(b).toBe(Math.round(BUNDLE_BUBBLE.interiorMaxSize / 2)); // √(4/16) = 1/2
    expect(c).toBe(FILE_FACE.mediaMinSize); // √(1/16)·140 = 35 → 하한 56
    expect((a! / b!) ** 2).toBeCloseTo(4, 1);
  });

  it('다 같이 썼으면 다 같은 크기 · 횟수가 없는 옛 노드는 활동량으로 잰다', () => {
    const same = withBundleUsageRange([shot('a', { readCount: 2 }), shot('b', { readCount: 2 })]);
    expect(same.map((m) => calcBubbleSize(m, undefined, undefined))).toEqual([BUNDLE_BUBBLE.interiorMaxSize, BUNDLE_BUBBLE.interiorMaxSize]);
    expect(fileUsageOf(shot('old', { activity: 9 }))).toBe(9);
    expect(fileUsageOf(shot('new', { activity: 9, readCount: 2, writeCount: 1 }))).toBe(3);
    expect(fileUsageOf(shot('none', { activity: 0 }))).toBe(1);
  });

  it('히트맵이 켜져 있으면 히트맵이 이긴다 · 묶음 밖(사용 횟수 범위가 없는) 파일은 종전대로 용량으로 잰다', () => {
    const heat: HeatScale = { max: 10, axis: 'read', curve: 'linear' };
    const [m] = withBundleUsageRange([shot('a', { readCount: 5 })]);
    expect(calcBubbleSize(m!, undefined, heat)).toBe(heatSize(heatRatio(5, heat)));
    expect(calcBubbleSize(shot('plain', { readCount: 50 }), undefined, undefined)).toBe(Math.max(FILE_MIN_SIZE, FILE_FACE.mediaMinSize));
  });
});

describe('묶음 안 자리 — 많이 쓴 것이 가운데인 무리(고리 하나가 아니다)', () => {
  it('가장 많이 쓴 것이 가운데에 서고, 많이 쓴 것일수록 가깝다 — 모두 같은 반지름의 고리가 아니다', () => {
    const members = withBundleUsageRange(Array.from({ length: 12 }, (_, i) => shot(`s${String(i).padStart(2, '0')}`, { readCount: 12 - i })));
    const positions = packBundleInterior(members, BACK, CENTER, undefined);
    const bodies = bodiesOf(members, positions);
    const top = bodies[0]!;
    expect([top.x, top.y]).toEqual([CENTER.x, CENTER.y]);
    const dist = bodies.map((b) => Math.hypot(b.x - CENTER.x, b.y - CENTER.y));
    expect(new Set(dist.map((d) => Math.round(d / 10))).size).toBeGreaterThan(2);
    const half = dist.length / 2;
    const mean = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;
    expect(mean(dist.slice(0, half))).toBeLessThan(mean(dist.slice(half)));
  });

  it('원끼리 · 원과 이름 줄 · 이름 줄끼리 겹치지 않는다 — 긴 이름 · 크기가 갈린 무리에서도', () => {
    const members = withBundleUsageRange(Array.from({ length: 24 }, (_, i) => shot(`8a4cdea4-592c-4906-b1bb-1f6d0b3157c${String(i)}`, {
      readCount: 1 + ((i * 7) % 13),
    })));
    const bodies = bodiesOf(members, packBundleInterior(members, BACK, CENTER, undefined));
    for (let i = 0; i < bodies.length; i += 1) {
      for (let j = i + 1; j < bodies.length; j += 1) {
        expect(overlaps(bodies[i]!, bodies[j]!), `${bodies[i]!.id} ↔ ${bodies[j]!.id}`).toBe(false);
      }
    }
  });

  it('구성 상한(120)에서도 겹치지 않고 다 앉는다 · 가로가 조금 긴 무리다', () => {
    const members = withBundleUsageRange(Array.from({ length: BUNDLE_BUBBLE.interiorMax }, (_, i) => shot(`p${String(i)}`, { readCount: 1 + (i % 5) })));
    const positions = packBundleInterior(members, BACK, CENTER, undefined);
    const bodies = bodiesOf(members, positions);
    expect(bodies).toHaveLength(BUNDLE_BUBBLE.interiorMax);
    for (let i = 0; i < bodies.length; i += 1) {
      for (let j = i + 1; j < bodies.length; j += 1) expect(overlaps(bodies[i]!, bodies[j]!)).toBe(false);
    }
    const width = Math.max(...bodies.map((b) => b.x + b.r)) - Math.min(...bodies.map((b) => b.x - b.r));
    const height = Math.max(...bodies.map((b) => b.y + b.r)) - Math.min(...bodies.map((b) => b.y - b.r));
    expect(width).toBeGreaterThan(height);
  });

  it('같은 입력은 같은 그림 — 입력 순서와 무관하다(같은 횟수면 최근 것 → id 순)', () => {
    const base = Array.from({ length: 9 }, (_, i) => shot(`m${String(i)}`, { readCount: 1 + (i % 3), lastActivity: i }));
    const a = packBundleInterior(withBundleUsageRange(base), BACK, CENTER, undefined);
    const b = packBundleInterior(withBundleUsageRange([...base].reverse()), BACK, CENTER, undefined);
    for (const m of base) expect(b.get(m.id)).toEqual(a.get(m.id));
    expect(b.get(BACK.id)).toEqual(a.get(BACK.id));
  });

  it('`← Back` 은 무리의 왼쪽 위 바깥이다', () => {
    const members = withBundleUsageRange(Array.from({ length: 7 }, (_, i) => shot(`b${String(i)}`, { readCount: 7 - i })));
    const positions = packBundleInterior(members, BACK, CENTER, undefined);
    const bodies = bodiesOf(members, positions);
    const backSize = calcBubbleSize(BACK, undefined, undefined);
    const back = positions.get(BACK.id)!;
    const leftMost = Math.min(...bodies.map((b) => b.x - Math.max(b.r, b.half)));
    const topMost = Math.min(...bodies.map((b) => b.y - b.r));
    expect(back.x + backSize).toBeLessThan(leftMost);
    expect(back.y + backSize / 2).toBeCloseTo(topMost, 6);
  });

  it('구성이 하나면 가운데 하나 · 없으면 `← Back` 만', () => {
    const one = withBundleUsageRange([shot('solo', { readCount: 3 })]);
    const d = calcBubbleSize(one[0]!, undefined, undefined);
    expect(packBundleInterior(one, null, CENTER, undefined).get('solo')).toEqual({ x: CENTER.x - d / 2, y: CENTER.y - d / 2 });
    const empty = packBundleInterior([], BACK, CENTER, undefined);
    expect([...empty.keys()]).toEqual([BACK.id]);
  });
});
