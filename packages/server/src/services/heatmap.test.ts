/**
 * §5.24 읽기 히트맵의 **순수 판정·색 계산** 고정 시험.
 *
 * 대상 모듈은 `packages/shared/src/heatmap.ts` 인데 shared 에는 러너가 없어 여기 둔다
 * (§2.1 #3 `bashWritePaths.test.ts` · §5.23 `webToolEntry.test.ts` 와 같은 자리).
 */
import { describe, it, expect } from 'vitest';
import {
  HEATMAP_RAMP,
  HEATMAP_ZERO_COLOR,
  HEAT_MAX_SIZE,
  HEAT_MIN_SIZE,
  heatColor,
  heatRatio,
  heatSize,
  isHeatBubbleType,
  toolAxis,
} from '@vibisual/shared';
import type { BubbleType } from '@vibisual/shared';

/** 램프 판정용 소도구 — 상수표의 `#RRGGBB` 만 먹인다. */
const rgb = (hex: string): [number, number, number] => {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
};
const lum = (hex: string): number => {
  const [r, g, b] = rgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/**
 * 명도 정점이 앉은 비율. **색을 박아 두지 않고 램프에서 직접 찾는다** — 램프를 손봐도
 * 시험이 "정점까지 밝아지고 그 위는 색상으로 갈린다"는 규칙 자체를 계속 지킨다.
 */
const PEAK_INDEX = HEATMAP_RAMP.reduce(
  (best, hex, i) => (lum(hex) > lum(HEATMAP_RAMP[best] ?? hex) ? i : best),
  0,
);
const PEAK = PEAK_INDEX / (HEATMAP_RAMP.length - 1);

describe('toolAxis — 도구 이름을 읽기/쓰기 축으로 가른다', () => {
  it('READ_TOOLS 는 읽기', () => {
    expect(toolAxis('Read')).toBe('read');
    expect(toolAxis('Grep')).toBe('read');
    expect(toolAxis('Glob')).toBe('read');
  });

  it('웹 도구도 읽기 — §5.23 이 엣지를 Read 로 정규화하는 것과 같은 사실', () => {
    expect(toolAxis('WebFetch')).toBe('read');
    expect(toolAxis('WebSearch')).toBe('read');
  });

  it('WRITE_TOOLS 는 쓰기', () => {
    expect(toolAxis('Write')).toBe('write');
    expect(toolAxis('Edit')).toBe('write');
    expect(toolAxis('MultiEdit')).toBe('write');
    expect(toolAxis('NotebookEdit')).toBe('write');
  });

  it('표 밖은 세지 않는다 — 모르는 것을 넘겨짚지 않는다', () => {
    expect(toolAxis('manual')).toBeNull();
    expect(toolAxis('Bash')).toBeNull();
    expect(toolAxis('Task')).toBeNull();
    expect(toolAxis('')).toBeNull();
    expect(toolAxis('read')).toBeNull(); // 대소문자 정확히 일치해야 한다
  });
});

describe('isHeatBubbleType — 히트가 크기·색을 갈아끼우는 종류', () => {
  it('에이전트가 읽는 것 넷만 대상', () => {
    for (const t of ['file', 'internal_folder', 'external_folder', 'domain'] as BubbleType[]) {
      expect(isHeatBubbleType(t)).toBe(true);
    }
  });

  it('읽는 주체(agent)와 길(root/back)은 대상이 아니다', () => {
    for (const t of ['agent', 'root', 'back', 'bash', 'iframe', 'brain', 'trash', 'ghost',
      'pipeline', 'worktree', 'conti', 'spec', 'lab', 'shelf'] as BubbleType[]) {
      expect(isHeatBubbleType(t)).toBe(false);
    }
  });
});

describe('heatRatio — 상대값 0~1', () => {
  it('최대값 대비 비율', () => {
    expect(heatRatio(5, { max: 10 })).toBeCloseTo(0.5);
    expect(heatRatio(10, { max: 10 })).toBe(1);
  });

  it('안 읽은 것·척도 없음은 0 — 0 으로 나누지 않는다', () => {
    expect(heatRatio(undefined, { max: 10 })).toBe(0);
    expect(heatRatio(0, { max: 10 })).toBe(0);
    expect(heatRatio(3, { max: 0 })).toBe(0);
  });

  it('상한을 넘어도 1 을 넘지 않는다 (척도가 뒤늦게 따라오는 프레임)', () => {
    expect(heatRatio(30, { max: 10 })).toBe(1);
  });

  it('쓰레기 값에 NaN 을 흘리지 않는다', () => {
    expect(heatRatio(Number.NaN, { max: 10 })).toBe(0);
    expect(heatRatio(5, { max: Number.NaN })).toBe(0);
    expect(heatRatio(-3, { max: 10 })).toBe(0);
  });
});

describe('heatColor — 램프', () => {
  it('안 읽은 것은 램프 최저온이 아니라 별도 색이다', () => {
    expect(heatColor(0)).toBe(HEATMAP_ZERO_COLOR);
    expect(heatColor(0)).not.toBe(HEATMAP_RAMP[0]);
  });

  it('양 끝은 램프의 양 끝', () => {
    expect(heatColor(1).toLowerCase()).toBe(HEATMAP_RAMP[HEATMAP_RAMP.length - 1]!.toLowerCase());
    // 최저온 바로 위는 첫 칸에 매우 가깝다
    expect(heatColor(0.0001).toLowerCase()).toBe(HEATMAP_RAMP[0]!.toLowerCase());
  });

  it('항상 #RRGGBB 여섯 자리를 돌려준다', () => {
    for (let i = 0; i <= 20; i++) {
      expect(heatColor(i / 20)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('명도는 노랑 정점까지 단조 증가한다 — 램프의 대부분은 밝기만으로 순서가 읽힌다', () => {
    let prev = -1;
    for (let i = 1; i <= 10; i++) {
      const cur = lum(heatColor((PEAK * i) / 10));
      expect(cur).toBeGreaterThan(prev);
      prev = cur;
    }
  });

  it('정점 위 뜨거운 구간은 초록 성분이 단조로 빠진다 — 노랑 → 주황 → 빨강', () => {
    let prev = 256;
    for (let i = 0; i <= 10; i++) {
      const g = rgb(heatColor(PEAK + ((1 - PEAK) * i) / 10))[1];
      expect(g).toBeLessThan(prev);
      prev = g;
    }
  });

  it('가장 뜨거운 끝은 빨강, 가장 차가운 끝은 파랑 — 명도가 겹쳐도 색상이 갈린다', () => {
    const hot = rgb(heatColor(1));
    expect(hot[0]).toBeGreaterThan(hot[1] * 2);
    expect(hot[0]).toBeGreaterThan(hot[2] * 2);
    const cold = rgb(heatColor(0.0001));
    expect(cold[2]).toBeGreaterThan(cold[0]);
  });

  it('쓰레기 비율은 안 읽음으로 떨어진다', () => {
    expect(heatColor(Number.NaN)).toBe(HEATMAP_ZERO_COLOR);
    expect(heatColor(-1)).toBe(HEATMAP_ZERO_COLOR);
  });
});

describe('heatSize — 파일·폴더·도메인이 함께 쓰는 한 자', () => {
  it('양 끝이 상수와 같다', () => {
    expect(heatSize(0)).toBe(HEAT_MIN_SIZE);
    expect(heatSize(1)).toBe(HEAT_MAX_SIZE);
  });

  it('단조 증가하고 범위를 벗어나지 않는다', () => {
    let prev = -1;
    for (let i = 0; i <= 10; i++) {
      const s = heatSize(i / 10);
      expect(s).toBeGreaterThanOrEqual(HEAT_MIN_SIZE);
      expect(s).toBeLessThanOrEqual(HEAT_MAX_SIZE);
      expect(s).toBeGreaterThan(prev);
      prev = s;
    }
  });

  it('범위 밖·쓰레기 값도 자 안에 갇힌다', () => {
    expect(heatSize(5)).toBe(HEAT_MAX_SIZE);
    expect(heatSize(-5)).toBe(HEAT_MIN_SIZE);
    expect(heatSize(Number.NaN)).toBe(HEAT_MIN_SIZE);
  });
});
