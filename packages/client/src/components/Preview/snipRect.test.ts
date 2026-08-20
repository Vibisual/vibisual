import { describe, it, expect } from 'vitest';
import { PREVIEW_DEVICE_PRESETS, PREVIEW_SNIP_MIN_PX, resolveCompareWidths } from '@vibisual/shared';

import { normalizeSnipRect, snipFileName } from './snipRect.js';

describe('§5.17 (A) — 나란히 놓을 폭은 프리셋 표에서 파생한다', () => {
  it('폭이 있는 칸만 남는다 — auto·compare 는 폭이 없어 빠진다', () => {
    const widths = resolveCompareWidths();
    expect(widths.map((w) => w.id)).toEqual(['mobile', 'tablet', 'desktop']);
    expect(widths.every((w) => typeof w.width === 'number' && w.width > 0)).toBe(true);
  });

  it('프리셋 표가 늘면 비교 줄도 함께 는다 — 목록을 따로 적지 않는다(§3.3)', () => {
    const widths = resolveCompareWidths([
      ...PREVIEW_DEVICE_PRESETS,
      { id: 'desktop', labelKey: 'common.preview.deviceDesktop', width: 1920 },
    ]);
    expect(widths).toHaveLength(4);
    expect(widths[3]?.width).toBe(1920);
  });

  it('폭 프리셋 표에 compare 칸이 실제로 있다 — 화면의 버튼은 이 표에서 나온다', () => {
    expect(PREVIEW_DEVICE_PRESETS.some((p) => p.id === 'compare' && p.width === null)).toBe(true);
  });
});

describe('§5.17 (B) — 드래그 두 점에서 캡처할 사각형', () => {
  it('오른쪽 아래로 끌든 왼쪽 위로 끌든 같은 사각형', () => {
    const a = normalizeSnipRect({ x: 10, y: 20 }, { x: 110, y: 90 });
    const b = normalizeSnipRect({ x: 110, y: 90 }, { x: 10, y: 20 });
    expect(a).toEqual({ x: 10, y: 20, width: 100, height: 70 });
    expect(b).toEqual(a);
  });

  it('소수 좌표는 정수로 반올림한다 — capturePage 는 정수 rect 를 받는다', () => {
    expect(normalizeSnipRect({ x: 10.4, y: 20.6 }, { x: 110.5, y: 90.2 }))
      .toEqual({ x: 10, y: 21, width: 100, height: 70 });
  });

  it('프리뷰 밖으로 나간 부분은 잘라 낸다 — 옆 패널이 함께 찍히면 안 된다', () => {
    const rect = normalizeSnipRect(
      { x: -50, y: -50 },
      { x: 500, y: 500 },
      { x: 0, y: 0, width: 200, height: 150 },
    );
    expect(rect).toEqual({ x: 0, y: 0, width: 200, height: 150 });
  });

  it(`${PREVIEW_SNIP_MIN_PX}px 미만이면 null — 캡처 모드에서 무심코 누른 클릭은 버린다`, () => {
    expect(normalizeSnipRect({ x: 10, y: 10 }, { x: 10, y: 10 })).toBeNull();
    expect(normalizeSnipRect({ x: 10, y: 10 }, { x: 200, y: 10 + PREVIEW_SNIP_MIN_PX - 1 })).toBeNull();
  });

  it('경계 밖으로 완전히 벗어나면 null — 남는 넓이가 없다', () => {
    expect(normalizeSnipRect(
      { x: 300, y: 300 },
      { x: 400, y: 400 },
      { x: 0, y: 0, width: 200, height: 150 },
    )).toBeNull();
  });

  it('딱 최소 크기면 받는다 — 경계값은 통과 쪽', () => {
    expect(normalizeSnipRect({ x: 0, y: 0 }, { x: PREVIEW_SNIP_MIN_PX, y: PREVIEW_SNIP_MIN_PX }))
      .toEqual({ x: 0, y: 0, width: PREVIEW_SNIP_MIN_PX, height: PREVIEW_SNIP_MIN_PX });
  });

  it('파일 이름에 찍은 시각이 들어간다 — 목록에서 언제 것인지 보인다', () => {
    expect(snipFileName(new Date(2026, 7, 20, 9, 5, 3).getTime())).toBe('preview-20260820-090503.png');
  });
});
