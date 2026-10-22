import { describe, it, expect } from 'vitest';
import {
  TAB_SELECTION_FLIP,
  boxKeyframes,
  labelClipKeyframes,
  labelRevealKeyframes,
  planTabSelectionFlip,
  springCurve,
  springProgress,
  tabSelectionKey,
  translateKeyframes,
  type TabGeom,
} from './tabSelectionMotionGeom.js';

/**
 * §5.4 #14 — 고른 탭이 커지는 움직임의 계산(순수 함수). 화면은 `useTabSelectionMotion` 이 걸고, 여기서는
 * "아이폰처럼"이 숫자로 지켜지는지 본다 — 스프링 곡선 · 글자가 늘어나 보이지 않는 반대 배율 · 합성 스레드가
 * 맡을 수 있는 속성만 · 옛 모양에서 새 모양으로 되돌려 놓는 값.
 */

const scaleXOf = (frame: Keyframe): number => {
  const m = /scaleX\(([-\d.e]+)\)/.exec(String(frame.transform));
  return m ? Number(m[1]) : Number.NaN;
};

describe('스프링 — 빠르게 출발해 살짝 넘쳤다가 앉는다', () => {
  it('0 에서 출발해 1 로 간다', () => {
    expect(springProgress(0, TAB_SELECTION_FLIP.spring)).toBe(0);
    expect(springProgress(-5, TAB_SELECTION_FLIP.spring)).toBe(0);
    expect(springProgress(2000, TAB_SELECTION_FLIP.spring)).toBeCloseTo(1, 4);
  });

  it('처음 160ms 안에 거리의 3/4 이상을 간다 — 누르자마자 커지기 시작한다', () => {
    expect(springProgress(160, TAB_SELECTION_FLIP.spring)).toBeGreaterThan(0.75);
    expect(springProgress(160, TAB_SELECTION_FLIP.reducedSpring)).toBeGreaterThan(0.75);
  });

  it('기본 스프링은 1 을 살짝(0.5~3%) 넘쳤다가 돌아온다 — 아이폰의 탄성', () => {
    let peak = 0;
    for (let t = 0; t <= 1000; t += 4) peak = Math.max(peak, springProgress(t, TAB_SELECTION_FLIP.spring));
    expect(peak).toBeGreaterThan(1.005);
    expect(peak).toBeLessThan(1.03);
  });

  it('움직임 줄이기 스프링은 넘치지 않고 되돌아오지도 않는다(튐 없음)', () => {
    let prev = 0;
    for (let t = 0; t <= 1000; t += 4) {
      const p = springProgress(t, TAB_SELECTION_FLIP.reducedSpring);
      expect(p).toBeGreaterThanOrEqual(prev - 1e-12);
      expect(p).toBeLessThanOrEqual(1);
      prev = p;
    }
  });

  it('표본 — 첫 값 0 · 끝 값 정확히 1 · 같은 간격 · 길이 상한 안', () => {
    for (const spring of [TAB_SELECTION_FLIP.spring, TAB_SELECTION_FLIP.reducedSpring]) {
      const curve = springCurve(spring);
      expect(curve.samples[0]).toBe(0);
      expect(curve.samples.at(-1)).toBe(1);
      expect(curve.durationMs).toBe((curve.samples.length - 1) * TAB_SELECTION_FLIP.sampleMs);
      expect(curve.durationMs).toBeLessThanOrEqual(TAB_SELECTION_FLIP.maxMs);
      // 끝 표본을 1 로 박아도 튀지 않는다 — 그 직전 표본이 이미 앉아 있다.
      expect(Math.abs(1 - curve.samples.at(-2)!)).toBeLessThan(TAB_SELECTION_FLIP.settle * 3);
    }
    expect(springCurve(TAB_SELECTION_FLIP.reducedSpring).durationMs).toBeLessThan(springCurve(TAB_SELECTION_FLIP.spring).durationMs);
  });
});

describe('키프레임 — 옛 모양에서 출발해 제자리(항등)로 끝난다', () => {
  const curve = springCurve(TAB_SELECTION_FLIP.spring);

  it('미끄러짐 — 첫 장은 옛 자리, 끝 장은 제자리, offset 은 0→1 같은 간격', () => {
    const frames = translateKeyframes(32, -5, curve);
    expect(frames).toHaveLength(curve.samples.length);
    expect(frames[0]!.transform).toBe('translate(32px, -5px)');
    expect(frames.at(-1)!.transform).toBe('translate(0px, 0px)');
    expect(frames[0]!.offset).toBe(0);
    expect(frames.at(-1)!.offset).toBe(1);
    for (let i = 1; i < frames.length; i++) expect(Number(frames[i]!.offset)).toBeGreaterThan(Number(frames[i - 1]!.offset));
  });

  it('판 — 옛 크기에서 새 크기로(이동 + 배율), 끝은 scale(1, 1)', () => {
    const frames = boxKeyframes({ dx: 0, dy: 5, sx: 0.7, sy: 0.86 }, curve);
    expect(frames[0]!.transform).toBe('translate(0px, 5px) scale(0.7, 0.86)');
    expect(frames.at(-1)!.transform).toBe('translate(0px, 0px) scale(1, 1)');
  });

  it('이름 칸 — 바깥 배율 × 안쪽 배율 = 1 이 모든 표본에서 지켜진다(글자는 늘어나 보이지 않는다)', () => {
    for (const sx of [0.42, 0.7, 1.55]) {
      const { outer, inner } = labelClipKeyframes({ dx: 0, dy: 2.5, sx }, curve);
      expect(outer).toHaveLength(inner.length);
      outer.forEach((frame, i) => {
        expect(frame.offset).toBe(inner[i]!.offset);
        expect(scaleXOf(frame) * scaleXOf(inner[i]!)).toBeCloseTo(1, 3);
      });
      expect(scaleXOf(outer[0]!)).toBeCloseTo(sx, 4);
      expect(scaleXOf(outer.at(-1)!)).toBe(1);
    }
  });

  it('흐림은 따로 — 불투명도·위치(합성 스레드)와 한 움직임에 섞지 않는다', () => {
    const { main, blur } = labelRevealKeyframes(TAB_SELECTION_FLIP.reveal);
    for (const frame of main) expect(frame.filter).toBeUndefined();
    expect(blur).not.toBeNull();
    for (const frame of blur!) {
      expect(frame.opacity).toBeUndefined();
      expect(frame.transform).toBeUndefined();
    }
    // 고르지 않은 글자(gray-400) 밝기에서 출발해 또렷하게 끝난다 — 첫 프레임에서 번쩍이지 않는다.
    expect(Number(main[0]!.opacity)).toBe(TAB_SELECTION_FLIP.reveal.fromOpacity);
    expect(Number(main.at(-1)!.opacity)).toBe(1);
    expect(blur!.at(-1)!.filter).toBe('blur(0px)');
  });

  it('움직임 줄이기 — 흐림도 위아래 움직임도 없이 불투명도만', () => {
    const { main, blur } = labelRevealKeyframes(TAB_SELECTION_FLIP.reducedReveal);
    expect(blur).toBeNull();
    for (const frame of main) expect(frame.transform).toBe('translateY(0px)');
    expect(Number(main.at(-1)!.opacity)).toBe(1);
  });

  it('어떤 키프레임도 폭·높이·여백을 건드리지 않는다 — 메인 스레드 속성이 끼면 캔버스 전환에 묻힌다', () => {
    const all: Keyframe[] = [
      ...translateKeyframes(10, 2, curve),
      ...boxKeyframes({ dx: 0, dy: 5, sx: 0.7, sy: 0.86 }, curve),
      ...labelClipKeyframes({ dx: 0, dy: 2, sx: 0.6 }, curve).outer,
      ...labelClipKeyframes({ dx: 0, dy: 2, sx: 0.6 }, curve).inner,
      ...labelRevealKeyframes(TAB_SELECTION_FLIP.reveal).main,
    ];
    for (const frame of all) {
      for (const prop of Object.keys(frame)) expect(['offset', 'easing', 'transform', 'opacity']).toContain(prop);
    }
  });
});

describe('되돌려 놓을 값 — 고른 탭이 바뀐 커밋에서', () => {
  // 활성 탭은 위로 5px 들어 올려 꽉 차고(높이 36), 쉬는 탭은 한 칸 128px·높이 31 이다.
  const tab = (key: string, active: boolean, x: number, w: number, label: number, trailX: number): TabGeom => ({
    key,
    active,
    surface: { x, y: active ? 0 : 5, w, h: active ? 36 : 31 },
    parts: [
      { x: 0, y: 0, w, h: active ? 36 : 31 }, // 판
      { x: 10, y: active ? 11 : 8.5, w: label, h: 14 }, // 이름
      { x: trailX, y: active ? 11 : 8.5, w: 30, h: 14 }, // 배지
    ],
    plateIndex: 0,
    labelIndex: 1,
  });
  const before = new Map<string, TabGeom>([
    ['p:a', tab('p:a', true, 0, 160, 96, 112)],
    ['p:b', tab('p:b', false, 160, 128, 50, 80)],
    ['p:c', tab('p:c', false, 288, 128, 50, 80)],
  ]);
  const after = [
    tab('p:a', false, 0, 128, 64, 80),
    tab('p:b', true, 128, 180, 116, 132),
    tab('p:c', false, 308, 128, 50, 80),
  ];

  it('고른 탭 — 옛 자리로 미끄러져 있다가, 판은 작고 낮은 데서 커지며 올라오고, 이름이 나타난다', () => {
    const steps = planTabSelectionFlip(before, after, { slideSurfaces: true });
    const b = steps.find((s) => s.key === 'p:b')!;
    expect(b.reveal).toBe(true);
    expect(b.surfaceDx).toBe(32);
    const plate = b.parts.find((p) => p.kind === 'plate')!;
    expect(plate.sx).toBeCloseTo(128 / 180, 6);
    expect(plate.sy).toBeCloseTo(31 / 36, 6);
    expect(plate.dy).toBe(5);
    const label = b.parts.find((p) => p.kind === 'label')!;
    expect(label.sx).toBeCloseTo(50 / 116, 6);
    expect(label.dy).toBeCloseTo(2.5, 6);
    const badge = b.parts.find((p) => p.kind === 'item')!;
    expect(badge.dx).toBe(80 - 132); // 오른쪽 끝을 타고 간다
  });

  it('앞서 고른 탭 — 판은 넓은 데서 줄고, 이름 칸은 넓게 보이다가 한 칸으로, 이름 연출은 없다', () => {
    const steps = planTabSelectionFlip(before, after, { slideSurfaces: true });
    const a = steps.find((s) => s.key === 'p:a')!;
    expect(a.reveal).toBe(false);
    expect(a.surfaceDx).toBe(0);
    expect(a.parts.find((p) => p.kind === 'plate')!.sx).toBeCloseTo(160 / 128, 6);
    expect(a.parts.find((p) => p.kind === 'plate')!.dy).toBe(-5);
    expect(a.parts.find((p) => p.kind === 'label')!.sx).toBeCloseTo(96 / 64, 6);
  });

  it('이웃 탭 — 밀린 만큼만 옆으로 미끄러진다(안쪽 칸은 그대로)', () => {
    const steps = planTabSelectionFlip(before, after, { slideSurfaces: true });
    const c = steps.find((s) => s.key === 'p:c')!;
    expect(c.surfaceDx).toBe(-20);
    expect(c.parts).toHaveLength(0);
    expect(c.reveal).toBe(false);
  });

  it('줄 순서가 바뀐 커밋 — 본체는 옮기지 않는다(밀림 재생이 겉칸을 옮긴다 · 두 번 밀지 않게)', () => {
    const steps = planTabSelectionFlip(before, after, { slideSurfaces: false });
    for (const step of steps) expect(step.surfaceDx).toBe(0);
    expect(steps.some((s) => s.key === 'p:c')).toBe(false);
    expect(steps.find((s) => s.key === 'p:b')!.parts.length).toBeGreaterThan(0);
  });

  it('그 사이 칸 구성이 바뀌었으면(배지가 새로 붙었다) 짝을 짓지 않고 본체만 옮긴다', () => {
    const grown = after.map((t) => (t.key === 'p:c' ? { ...t, parts: [...t.parts, { x: 100, y: 8.5, w: 16, h: 16 }] } : t));
    const shifted = new Map(before);
    const steps = planTabSelectionFlip(shifted, grown, { slideSurfaces: true });
    const c = steps.find((s) => s.key === 'p:c')!;
    expect(c.surfaceDx).toBe(-20);
    expect(c.parts).toHaveLength(0);
  });

  it('새로 생긴 탭·거의 안 움직인 탭은 건드리지 않는다', () => {
    const steps = planTabSelectionFlip(
      new Map([['p:a', tab('p:a', false, 0, 128, 64, 80)]]),
      [tab('p:a', false, 0.2, 128, 64, 80), tab('p:new', false, 128, 128, 50, 80)],
      { slideSurfaces: true },
    );
    expect(steps).toHaveLength(0);
  });
});

describe('고른 탭의 키', () => {
  it('iframe 탭이 프로젝트보다 앞선다 — 탭바와 움직임 훅이 같은 규칙', () => {
    expect(tabSelectionKey('web-1', 'vibisual')).toBe('i:web-1');
    expect(tabSelectionKey(null, 'vibisual')).toBe('p:vibisual');
    expect(tabSelectionKey(null, null)).toBeNull();
  });
});
