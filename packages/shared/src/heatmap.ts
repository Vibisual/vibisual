/** §5.24 — 히트맵 공용 판정·색. 서버 `toolAxis()`(카운터)와 클라 `heatRatio()`/`heatColor()` 가 한 벌이어야 숫자와 색이 같이 움직인다. 순수. */
import {
  DEFAULT_HEAT_CURVE,
  HEATMAP_RAMP,
  HEATMAP_ZERO_COLOR,
  HEAT_CURVES,
  HEAT_MAX_SIZE,
  HEAT_MIN_SIZE,
  HEAT_QUANTILE_BINS,
  READ_TOOLS,
  WEB_TOOLS,
  WRITE_TOOLS,
} from './constants.js';
import type { BubbleType } from './types.js';

/** 히트 카운터의 축. 표에 없는 이름은 `null` — **모르는 것을 넘겨짚지 않는다.** */
export type ToolAxis = 'read' | 'write';

/** 히트 곡선 — 횟수 → 0~1(`HEAT_CURVES`). 접촉은 롱테일이라 선형이면 극단값이 나머지를 첫 칸에 누른다(실측 2026-09-09: 97.8% 가 7칸 중 첫 칸). */
export type HeatCurve = (typeof HEAT_CURVES)[number];

/** 도구 → 읽기/쓰기 축(표 밖은 `null`). 웹 도구는 읽기(§5.23 이 도메인 엣지를 `Read` 로 낸다). `manual`·미지 도구는 `null` — 그래서 `readCount + writeCount ≤ activity`. */
export function toolAxis(toolName: string): ToolAxis | null {
  if (!toolName) return null;
  if (READ_TOOLS.has(toolName) || WEB_TOOLS.has(toolName)) return 'read';
  if (WRITE_TOOLS.has(toolName)) return 'write';
  return null;
}

/** 히트맵이 크기·색을 바꾸는 버블 — 에이전트가 읽는 대상만. `agent`(주체)·`root`/`back`(길)·`bash`·`iframe` 등은 평상시 규칙. */
export function isHeatBubbleType(type: BubbleType): boolean {
  return (
    type === 'file' ||
    type === 'internal_folder' ||
    type === 'external_folder' ||
    type === 'domain'
  );
}

/** 히트 척도 — 바닥은 늘 0(§5.24)이라 최대값만 든다. 축·곡선을 함께 들고 다닌다(따로 들면 쓰기 지도에 읽기 숫자, 로그 지도에 선형 눈금이 적힌다). */
export interface HeatScale {
  /** 지금 이 프로젝트 캔버스에서 이 축이 가장 높은 버블의 값. */
  max: number;
  /** 이 척도가 재고 있는 축 — `readCount` 인가 `writeCount` 인가. */
  axis: ToolAxis;
  /** 횟수를 0~1 로 옮기는 곡선. 사용자가 범례에서 고른다(기본 `log`). */
  curve: HeatCurve;
  /** `quantile` 곡선의 분포 표본(오름차순 `HEAT_QUANTILE_BINS + 1` 칸, §9 범위 무관 전량 칸). 없으면 기본 곡선으로 떨어진다(구버전 서버). */
  quantiles?: readonly number[];
}

/** 히트 카운터 네 칸 — 자기 값 둘 + §2.1 (A) 접합의 자손 합 둘. */
export interface HeatCounts {
  readCount?: number;
  writeCount?: number;
  externalRollupReadCount?: number;
  externalRollupWriteCount?: number;
}

/**
 * 히트 척도가 볼 값 — 외부 폴더 접합(§2.1 (A))은 자기 카운터가 늘 0 이라 자손 합(`externalRollup*Count`)이 크면 그것을 본다.
 * 색·지름·배지·클라 척도·서버 척도 다섯이 이 함수를 같이 써야 한다(빠지면 같은 버블이 다른 말을 한다).
 */
export function heatValueOf(bubble: HeatCounts, axis: ToolAxis): number {
  const own = (axis === 'write' ? bubble.writeCount : bubble.readCount) ?? 0;
  const rollup = (axis === 'write' ? bubble.externalRollupWriteCount : bubble.externalRollupReadCount) ?? 0;
  return rollup > own ? rollup : own;
}

/** 배지 문자열 — 네 자리부터 접는다(`1153` → `1.2k`, 정확한 값은 `title`). 소수는 10 미만에서만, 반올림이 단위를 넘기면 다음 단위(`999,999` → `1M`). */
export function formatHeatCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  const v = Math.round(n);
  if (v < 1000) return String(v);
  let scaled = v;
  for (const suffix of ['k', 'M', 'B']) {
    scaled /= 1000;
    const rounded = scaled < 10 ? Math.round(scaled * 10) / 10 : Math.round(scaled);
    if (rounded < 1000) return `${rounded}${suffix}`;
  }
  return `${Math.round(scaled)}B`;
}

/** 분포 표본 — 양수 값에서 `HEAT_QUANTILE_BINS + 1` 칸을 고르게(§9 — 전체 값을 싣지 않고 보간한다). 0 이하는 빼야 읽은 것들이 위로 몰리지 않는다. */
export function heatQuantileSamples(values: readonly number[]): number[] {
  const pos = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (pos.length === 0) return [];
  const last = pos.length - 1;
  const out: number[] = [];
  for (let i = 0; i <= HEAT_QUANTILE_BINS; i++) {
    out.push(pos[Math.round((i / HEAT_QUANTILE_BINS) * last)]!);
  }
  return out;
}

/** 표본에서 값의 자리(0~1), 표본이 없으면 `null`. 동률은 첫 칸 자리를 받는다 — 1회짜리 절반이 최저 칸에 모여 남은 램프를 갈리는 값이 쓴다. */
function quantilePosition(count: number, quantiles: readonly number[]): number | null {
  const n = quantiles.length;
  if (n < 2) return null;
  const bins = n - 1;
  if (count >= quantiles[bins]!) return 1;
  if (count <= quantiles[0]!) return 1 / bins;
  // 하한 이진 탐색 — 마지막 칸을 잡으면 가장 낮은 값이 중간색이 된다.
  let lo = 0;
  let hi = bins;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (quantiles[mid]! < count) lo = mid + 1;
    else hi = mid;
  }
  // 여기서 `quantiles[lo] >= count`. 정확히 같으면 그 칸이 답이고, 크면 앞 칸과의 사이를 잇는다.
  if (quantiles[lo]! === count) return lo / bins;
  const a = quantiles[lo - 1] ?? quantiles[0]!;
  const b = quantiles[lo]!;
  const t = b > a ? (count - a) / (b - a) : 0;
  return (lo - 1 + t) / bins;
}

/** 곡선 적용 날 비율(클램프 전). `quantile` 은 표본이 없으면 기본 곡선으로 — 선형이면 롱테일 눌림이 돌아온다. */
function curveRatio(count: number, scale: HeatScale): number {
  const max = scale.max;
  switch (scale.curve) {
    case 'linear':
      return count / max;
    case 'sqrt':
      return Math.sqrt(count / max);
    case 'cbrt':
      return Math.cbrt(count / max);
    case 'quantile': {
      const q = scale.quantiles;
      if (q && q.length >= 2) {
        const p = quantilePosition(count, q);
        if (p !== null) return p;
      }
      return Math.log1p(count) / Math.log1p(max);
    }
    case 'log':
    default:
      return Math.log1p(count) / Math.log1p(max);
  }
}

/** 횟수 → 0~1 상대값(척도·값이 없으면 0). 기준은 늘 `max` — 고정 상한(`MAX_EXPECTED_ACTIVITY` 류)을 쓰지 마라(§5.24 — 지도가 단색이 된다). */
export function heatRatio(count: number | undefined, scale: HeatScale): number {
  if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0) return 0;
  if (!Number.isFinite(scale.max) || scale.max <= 0) return 0;
  const r = curveRatio(count, scale);
  if (!Number.isFinite(r)) return 0;
  return r <= 0 ? 0 : r >= 1 ? 1 : r;
}

/** `heatRatio` 의 역함수(범례 눈금). 곡선을 바꾸면 램프 가운데가 `max/2` 가 아니라(로그·max 2,471 → 약 50) 눈금 없이 갈면 범례가 거짓말을 한다. */
export function heatCountAtRatio(ratio: number, scale: HeatScale): number {
  if (!Number.isFinite(ratio) || !Number.isFinite(scale.max) || scale.max <= 0) return 0;
  const r = ratio <= 0 ? 0 : ratio >= 1 ? 1 : ratio;
  const max = scale.max;
  switch (scale.curve) {
    case 'linear':
      return r * max;
    case 'sqrt':
      return r * r * max;
    case 'cbrt':
      return r * r * r * max;
    case 'quantile': {
      const q = scale.quantiles;
      if (q && q.length >= 2) {
        const bins = q.length - 1;
        const pos = r * bins;
        const i = Math.min(bins - 1, Math.floor(pos));
        const t = pos - i;
        const a = q[i]!;
        const b = q[i + 1]!;
        return a + (b - a) * t;
      }
      return Math.expm1(r * Math.log1p(max));
    }
    case 'log':
    default:
      return Math.expm1(r * Math.log1p(max));
  }
}

/** 범례 눈금 `{ ratio, count }` 를 왼쪽부터 — 양 끝은 범례가 이미 적어 사이만 낸다. */
export function heatLegendTicks(scale: HeatScale, count: number): { ratio: number; count: number }[] {
  const n = Math.max(0, Math.floor(count));
  if (n <= 0 || !Number.isFinite(scale.max) || scale.max <= 0) return [];
  const out: { ratio: number; count: number }[] = [];
  for (let i = 1; i <= n; i++) {
    const ratio = i / (n + 1);
    out.push({ ratio, count: heatCountAtRatio(ratio, scale) });
  }
  return out;
}

/** 알 수 없는 문자열을 곡선으로 — 표 밖이면 기본값. 저장분·URL·구버전 값이 들어와도 화면이 선다. */
export function normalizeHeatCurve(value: unknown): HeatCurve {
  return (HEAT_CURVES as readonly string[]).includes(value as string)
    ? (value as HeatCurve)
    : DEFAULT_HEAT_CURVE;
}

/** `#RRGGBB` → [r,g,b]. 우리 상수 테이블만 먹이므로 형식 검증은 최소로 둔다. */
function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number): string => Math.round(v).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/**
 * 0~1 을 램프 색으로. **히트가 0 이면 램프를 타지 않고** `HEATMAP_ZERO_COLOR` 를 준다 —
 * 호출부가 그 판정을 잊지 않도록 이 함수가 직접 갈라 준다(`ratio <= 0` = 그 축으로 만진 적 없음).
 */
export function heatColor(ratio: number): string {
  if (!Number.isFinite(ratio) || ratio <= 0) return HEATMAP_ZERO_COLOR;
  const stops = HEATMAP_RAMP;
  const last = stops.length - 1;
  if (last <= 0) return stops[0] ?? HEATMAP_ZERO_COLOR;
  const clamped = ratio >= 1 ? 1 : ratio;
  const pos = clamped * last;
  const i = Math.min(last - 1, Math.floor(pos));
  const t = pos - i;
  const a = hexToRgb(stops[i] ?? HEATMAP_ZERO_COLOR);
  const b = hexToRgb(stops[i + 1] ?? HEATMAP_ZERO_COLOR);
  return rgbToHex(
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  );
}

/**
 * 히트맵 모드에서의 지름. 파일·폴더·도메인이 **한 자**를 나눠 쓰므로
 * "뜨거운 파일이 차가운 폴더보다 크다"가 화면에서 성립한다(타입마다 자가 다르면 비교가 깨진다).
 */
export function heatSize(ratio: number): number {
  const r = !Number.isFinite(ratio) ? 0 : ratio <= 0 ? 0 : ratio >= 1 ? 1 : ratio;
  return Math.round(HEAT_MIN_SIZE + r * (HEAT_MAX_SIZE - HEAT_MIN_SIZE));
}
