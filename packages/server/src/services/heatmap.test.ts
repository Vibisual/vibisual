/**
 * §5.24 히트맵(읽기·쓰기 두 축)의 **순수 판정·색 계산** 고정 시험.
 *
 * 대상 모듈은 `packages/shared/src/heatmap.ts` 인데 shared 에는 러너가 없어 여기 둔다
 * (§2.1 #3 `bashWritePaths.test.ts` · §5.23 `webToolEntry.test.ts` 와 같은 자리).
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_HEAT_CURVE,
  HEATMAP_RAMP,
  HEATMAP_ZERO_COLOR,
  HEAT_CURVES,
  HEAT_MAX_SIZE,
  HEAT_MIN_SIZE,
  HEAT_QUANTILE_BINS,
  formatHeatCount,
  heatColor,
  heatCountAtRatio,
  heatLegendTicks,
  heatQuantileSamples,
  heatRatio,
  heatSize,
  heatValueOf,
  isHeatBubbleType,
  normalizeHeatCurve,
  toolAxis,
} from '@vibisual/shared';
import type { BubbleType, HeatCurve, HeatScale, ToolAxis } from '@vibisual/shared';

/** 척도는 **축·곡선과 한 벌**이라(§5.24) 시험도 그 둘을 명시해서 만든다. */
const scale = (
  max: number,
  axis: ToolAxis = 'read',
  curve: HeatCurve = DEFAULT_HEAT_CURVE,
  quantiles?: number[],
): HeatScale => ({ max, axis, curve, quantiles });

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

describe('heatValueOf — 색·지름·배지가 함께 보는 한 값', () => {
  it('축마다 자기 카운터를 본다', () => {
    const b = { readCount: 24, writeCount: 3 };
    expect(heatValueOf(b, 'read')).toBe(24);
    expect(heatValueOf(b, 'write')).toBe(3);
  });

  it('§2.1 (A) 접합은 자손 합을 본다 — 자기 값이 늘 0 이라 그러지 않으면 영원히 회색이다', () => {
    expect(heatValueOf({ readCount: 0, externalRollupReadCount: 46 }, 'read')).toBe(46);
    expect(heatValueOf({ writeCount: 0, externalRollupWriteCount: 12 }, 'write')).toBe(12);
  });

  it('자기 값이 더 크면 자기 값 — 만진 폴더·파일은 종전 그대로', () => {
    expect(heatValueOf({ readCount: 50, externalRollupReadCount: 7 }, 'read')).toBe(50);
    expect(heatValueOf({ writeCount: 9, externalRollupWriteCount: 2 }, 'write')).toBe(9);
  });

  it('한 축이 비어도 다른 축을 끌어오지 않는다', () => {
    expect(heatValueOf({ readCount: 30 }, 'write')).toBe(0);
    expect(heatValueOf({ writeCount: 30 }, 'read')).toBe(0);
    expect(heatValueOf({}, 'read')).toBe(0);
  });
});

describe('formatHeatCount — 배지에 적히는 문자열', () => {
  it('세 자리까지는 그대로', () => {
    expect(formatHeatCount(0)).toBe('0');
    expect(formatHeatCount(7)).toBe('7');
    expect(formatHeatCount(999)).toBe('999');
  });

  it('네 자리부터 접는다 — 10 미만에서만 소수 한 자리', () => {
    expect(formatHeatCount(1000)).toBe('1k');
    expect(formatHeatCount(1153)).toBe('1.2k');
    expect(formatHeatCount(9949)).toBe('9.9k');
    expect(formatHeatCount(12345)).toBe('12k');
    expect(formatHeatCount(999000)).toBe('999k');
  });

  it('반올림이 다음 단위를 만들면 그 단위가 맡는다', () => {
    expect(formatHeatCount(999999)).toBe('1M');
    expect(formatHeatCount(2_400_000)).toBe('2.4M');
  });

  it('네 글자를 넘지 않는다 — 버블 안에서 읽혀야 한다', () => {
    for (const n of [0, 9, 99, 999, 1000, 1153, 12345, 999999, 5_000_000, 3_000_000_000]) {
      expect(formatHeatCount(n).length).toBeLessThanOrEqual(4);
    }
  });

  it('쓰레기 값은 0 으로 떨어진다', () => {
    expect(formatHeatCount(Number.NaN)).toBe('0');
    expect(formatHeatCount(-5)).toBe('0');
    expect(formatHeatCount(Number.POSITIVE_INFINITY)).toBe('0');
  });
});

describe('heatRatio — 상대값 0~1', () => {
  it('선형 곡선은 최대값 대비 비율 그대로', () => {
    expect(heatRatio(5, scale(10, 'read', 'linear'))).toBeCloseTo(0.5);
    expect(heatRatio(10, scale(10, 'read', 'linear'))).toBe(1);
  });

  it('안 읽은 것·척도 없음은 0 — 0 으로 나누지 않는다', () => {
    for (const curve of HEAT_CURVES) {
      expect(heatRatio(undefined, scale(10, 'read', curve))).toBe(0);
      expect(heatRatio(0, scale(10, 'read', curve))).toBe(0);
      expect(heatRatio(3, scale(0, 'read', curve))).toBe(0);
    }
  });

  it('상한을 넘어도 1 을 넘지 않는다 (척도가 뒤늦게 따라오는 프레임)', () => {
    for (const curve of HEAT_CURVES) {
      expect(heatRatio(30, scale(10, 'read', curve))).toBe(1);
    }
  });

  it('쓰레기 값에 NaN 을 흘리지 않는다', () => {
    for (const curve of HEAT_CURVES) {
      expect(heatRatio(Number.NaN, scale(10, 'read', curve))).toBe(0);
      expect(heatRatio(5, scale(Number.NaN, 'read', curve))).toBe(0);
      expect(heatRatio(-3, scale(10, 'read', curve))).toBe(0);
    }
  });

  it('어느 곡선이든 양 끝은 같다 — 최대값은 1, 바닥은 0 (범례의 두 숫자가 곡선과 무관해진다)', () => {
    for (const curve of HEAT_CURVES) {
      expect(heatRatio(100, scale(100, 'read', curve))).toBe(1);
      expect(heatRatio(0, scale(100, 'read', curve))).toBe(0);
    }
  });

  it('어느 곡선이든 단조다 — 더 많이 읽은 것이 덜 뜨거워지지 않는다', () => {
    const q = heatQuantileSamples([1, 1, 1, 2, 3, 5, 8, 13, 40, 200, 1000]);
    for (const curve of HEAT_CURVES) {
      const s = scale(1000, 'read', curve, q);
      let prev = -1;
      for (const v of [1, 2, 3, 5, 8, 13, 40, 200, 1000]) {
        const r = heatRatio(v, s);
        expect(r).toBeGreaterThanOrEqual(prev);
        prev = r;
      }
    }
  });
});

/**
 * 이 절이 존재하는 이유 자체를 고정한다 — **롱테일에서 선형은 지도를 한 칸에 눌러 앉힌다.**
 * 실측(2026-09-09)과 같은 모양의 분포를 만들어, 기본 곡선이 그 눌림을 실제로 푸는지 확인한다.
 */
describe('heatRatio — 곡선이 롱테일을 편다', () => {
  /** 중앙값 4 · 최대 2,471 — 살아 있는 체크포인트에서 잰 읽기 축 분포와 같은 성격. */
  const longTail = [
    ...Array.from({ length: 240 }, () => 1),
    ...Array.from({ length: 120 }, () => 3),
    ...Array.from({ length: 80 }, () => 10),
    ...Array.from({ length: 40 }, () => 42),
    ...Array.from({ length: 15 }, () => 110),
    486, 654, 739, 1188, 2471,
  ];
  const max = 2471;
  /** 램프 7칸 중 **첫 칸**에 갇힌 비율 — 이 숫자가 곧 "지도가 단색인가"다. */
  const stuckRatio = (curve: HeatCurve): number => {
    const s = scale(max, 'read', curve, heatQuantileSamples(longTail));
    const band = 1 / (HEATMAP_RAMP.length - 1);
    const stuck = longTail.filter((v) => heatRatio(v, s) < band).length;
    return stuck / longTail.length;
  };

  it('선형은 거의 전부를 첫 칸에 밀어 넣는다 (고치려는 그 상태)', () => {
    expect(stuckRatio('linear')).toBeGreaterThan(0.9);
  });

  it('기본 곡선은 그 눌림을 절반 아래로 푼다', () => {
    expect(stuckRatio(DEFAULT_HEAT_CURVE)).toBeLessThan(0.6);
    expect(stuckRatio(DEFAULT_HEAT_CURVE)).toBeLessThan(stuckRatio('linear'));
  });

  it('기본 곡선은 최대값이 10배로 자라도 평범한 값을 바닥으로 밀지 않는다', () => {
    // 사용자가 물은 그 자리 — "계속 쓰다 보면 극단값 하나가 나머지를 파랑으로 만든다".
    const linearGrown = heatRatio(4, scale(max * 10, 'read', 'linear'));
    const defaultGrown = heatRatio(4, scale(max * 10, 'read', DEFAULT_HEAT_CURVE));
    expect(linearGrown).toBeLessThan(0.001);
    expect(defaultGrown).toBeGreaterThan(0.1);
  });
});

describe('heatQuantileSamples — 분포 표본', () => {
  it('표본은 칸 수 + 1 이고 오름차순이다', () => {
    const q = heatQuantileSamples([5, 1, 100, 3, 20, 7]);
    expect(q.length).toBe(HEAT_QUANTILE_BINS + 1);
    for (let i = 1; i < q.length; i++) expect(q[i]!).toBeGreaterThanOrEqual(q[i - 1]!);
    expect(q[0]).toBe(1);
    expect(q[q.length - 1]).toBe(100);
  });

  it('0 이하는 분포에 넣지 않는다 — 그것들은 램프를 타지 않는 회색이다', () => {
    expect(heatQuantileSamples([0, 0, 0])).toEqual([]);
    expect(heatQuantileSamples([-3, 0, 4])[0]).toBe(4);
  });

  it('분포가 없으면 quantile 은 기본 곡선으로 떨어진다 (구버전 서버)', () => {
    const withOut = heatRatio(10, scale(100, 'read', 'quantile'));
    const fallback = heatRatio(10, scale(100, 'read', DEFAULT_HEAT_CURVE));
    expect(withOut).toBeCloseTo(fallback);
  });
});

describe('heatCountAtRatio / heatLegendTicks — 범례가 곡선을 따라간다', () => {
  it('연속 곡선은 비율 → 횟수 → 비율 왕복이 제자리로 돌아온다', () => {
    for (const curve of ['log', 'linear', 'sqrt', 'cbrt'] as HeatCurve[]) {
      const s = scale(2471, 'read', curve);
      for (const r of [0.25, 0.5, 0.75]) {
        expect(heatRatio(heatCountAtRatio(r, s), s)).toBeCloseTo(r, 1);
      }
    }
  });

  it('분위수는 표본 계단 폭 안에서 왕복한다 — 순위 척도는 연속이 아니다', () => {
    // 값이 적으면 한 값이 표본의 여러 칸을 채우므로, 왕복 오차의 하한이 그 계단 폭이다.
    const values = Array.from({ length: 200 }, (_, i) => i + 1);
    const s = scale(200, 'read', 'quantile', heatQuantileSamples(values));
    for (const r of [0.25, 0.5, 0.75]) {
      const back = heatRatio(heatCountAtRatio(r, s), s);
      expect(Math.abs(back - r)).toBeLessThanOrEqual(2 / HEAT_QUANTILE_BINS);
    }
  });

  it('분위수는 동률 덩어리를 아래 칸에 모은다 — 가장 낮은 값이 중간색이 되지 않는다', () => {
    // 1회짜리가 절반인 흔한 분포. 그 절반이 램프 한복판을 차지하면 순위 척도가 뒤집힌 것이다.
    const values = [...Array.from({ length: 50 }, () => 1), ...Array.from({ length: 50 }, (_, i) => i + 2)];
    const s = scale(51, 'read', 'quantile', heatQuantileSamples(values));
    expect(heatRatio(1, s)).toBeLessThan(0.2);
    expect(heatRatio(1, s)).toBeGreaterThan(0);
  });

  it('로그 눈금은 선형 눈금보다 낮은 횟수를 가리킨다 — 램프 한가운데가 max/2 가 아니다', () => {
    const mid = 0.5;
    expect(heatCountAtRatio(mid, scale(2471, 'read', 'log'))).toBeLessThan(
      heatCountAtRatio(mid, scale(2471, 'read', 'linear')) / 10,
    );
  });

  it('눈금은 요청한 개수만큼, 양 끝을 뺀 사이에만 선다', () => {
    const ticks = heatLegendTicks(scale(1000), 3);
    expect(ticks.length).toBe(3);
    for (const t of ticks) {
      expect(t.ratio).toBeGreaterThan(0);
      expect(t.ratio).toBeLessThan(1);
      expect(t.count).toBeGreaterThan(0);
      expect(t.count).toBeLessThan(1000);
    }
  });

  it('척도가 비면 눈금도 없다 (0 을 최대로 둔 램프는 거짓말이다)', () => {
    expect(heatLegendTicks(scale(0), 3)).toEqual([]);
    expect(heatLegendTicks(scale(1000), 0)).toEqual([]);
  });
});

describe('normalizeHeatCurve — 모르는 값은 기본 곡선', () => {
  it('표에 있는 이름은 그대로', () => {
    for (const curve of HEAT_CURVES) expect(normalizeHeatCurve(curve)).toBe(curve);
  });

  it('표 밖·쓰레기는 기본값으로 — 저장분·구버전 값이 들어와도 화면이 선다', () => {
    expect(normalizeHeatCurve('gamma')).toBe(DEFAULT_HEAT_CURVE);
    expect(normalizeHeatCurve(undefined)).toBe(DEFAULT_HEAT_CURVE);
    expect(normalizeHeatCurve(42)).toBe(DEFAULT_HEAT_CURVE);
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
