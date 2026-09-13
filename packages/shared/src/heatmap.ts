/**
 * heatmap.ts — §5.24 · 히트맵(읽기·쓰기 두 축)의 **공용 판정·색 계산**.
 *
 * 서버는 이 파일의 `toolAxis()` 로 `readCount`/`writeCount` 를 가르고, 클라이언트는 같은 파일의
 * `heatRatio()`/`heatColor()` 로 그 값을 지름과 색으로 옮긴다. **판정이 두 벌이 되면 한쪽만
 * 고쳐져 "숫자는 올랐는데 색이 안 변하는" 상태가 된다**(§2.1 #3 이 셸 토크나이저를 한 벌로 묶은
 * 것과 같은 규율).
 *
 * 순수 함수 모듈이다 — 디스크 접근 ❌ · `process.platform` 읽기 ❌ · 시각 읽기 ❌.
 * 그래서 값이 결정적이고 개발기 한 대에서 단위 테스트로 고정된다.
 */
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

/**
 * 히트 척도 곡선 — **횟수를 0~1 로 옮기는 방식**. 목록은 `HEAT_CURVES`(§3.3 상수 테이블).
 *
 * 왜 곡선이 축이 되었나: 파일 접촉 횟수는 거의 언제나 **롱테일**이라, 선형으로 옮기면 극단값 하나가
 * 나머지를 램프 첫 칸에 통째로 눌러 앉힌다(실측 2026-09-09 · 읽기 대상 502개 중 **491개(97.8%)**
 * 가 7칸 중 첫 칸 · 중앙값 4회 대 최대 2,471회). 그때 지도는 "무엇이 뜨거운가"에 답하지 못한다.
 * 곡선을 갈아 끼우는 것은 **같은 값을 다르게 펴 보는 일**이라, 무엇이 정답인지는 보는 사람이 정한다.
 */
export type HeatCurve = (typeof HEAT_CURVES)[number];

/**
 * 도구 이름 하나를 읽기/쓰기 축으로 가른다. 우리 표 밖이면 `null`(어느 쪽도 올리지 않는다).
 *
 * - 읽기 = `READ_TOOLS`(`Read`/`Grep`/`Glob`) + `WEB_TOOLS`(`WebFetch`/`WebSearch`).
 *   웹 도구를 읽기로 세는 근거는 §5.23 이 이미 도메인 엣지를 `Read` 로 정규화해 흘린다는 것이다 —
 *   화살표가 "도메인 → 에이전트"인데 카운터만 쓰기로 세면 같은 사건을 두 곳이 다르게 말한다.
 * - 쓰기 = `WRITE_TOOLS`(`Write`/`Edit`/`MultiEdit`/`NotebookEdit`).
 * - `manual`(사용자가 손으로 고정한 노드)·미지 도구 = `null`. 그래서
 *   `readCount + writeCount ≤ activity` 이고, 그 차이가 곧 "도구가 아닌 경로로 생긴 버블"이다.
 */
export function toolAxis(toolName: string): ToolAxis | null {
  if (!toolName) return null;
  if (READ_TOOLS.has(toolName) || WEB_TOOLS.has(toolName)) return 'read';
  if (WRITE_TOOLS.has(toolName)) return 'write';
  return null;
}

/**
 * 히트맵이 크기·색을 갈아끼우는 버블 종류 — **에이전트가 읽는 것들**.
 *
 * `agent` 는 읽는 **주체**라 대상이 아니고(쪼그라들면 무엇이 도는지 안 보인다),
 * `root`/`back` 은 **길**이라 작아지면 탐색 자체가 어려워진다. `bash`/`iframe`/`brain`/`trash`/
 * `worktree` 등도 읽기 대상이 아니므로 평상시 규칙 그대로 둔다.
 */
export function isHeatBubbleType(type: BubbleType): boolean {
  return (
    type === 'file' ||
    type === 'internal_folder' ||
    type === 'external_folder' ||
    type === 'domain'
  );
}

/**
 * 히트 척도 — **바닥은 언제나 0**이라 최대값 하나면 충분하다.
 * ("한 번도 안 읽음"이 스케일의 바닥이 아니면 상대 비교가 뜻을 잃는다 — §5.24.)
 *
 * **축·곡선을 같이 들고 다닌다.** 색·지름·숫자 배지·범례가 그것을 각자 들면 "쓰기로 칠해진 지도에
 * 읽기 숫자가 적히는" · "로그로 칠해진 지도에 선형 눈금이 적히는" 어긋남이 생기는데, 한 벌로
 * 흐르면 그런 상태를 만들 수가 없다(척도를 레이아웃 함수의 필수 인자로 흘리는 것과 같은 규율).
 */
export interface HeatScale {
  /** 지금 이 프로젝트 캔버스에서 이 축이 가장 높은 버블의 값. */
  max: number;
  /** 이 척도가 재고 있는 축 — `readCount` 인가 `writeCount` 인가. */
  axis: ToolAxis;
  /** 횟수를 0~1 로 옮기는 곡선. 사용자가 범례에서 고른다(기본 `log`). */
  curve: HeatCurve;
  /**
   * `quantile` 곡선이 읽는 **분포 표본**(오름차순 `HEAT_QUANTILE_BINS + 1` 칸).
   * 서버가 §9 "범위와 무관하게 전량" 칸으로 실어 준다 — 없으면 `quantile` 은 기본 곡선으로 떨어진다
   * (구버전 서버에서 지도가 통째로 눌리는 것보다, 다른 곡선으로 그리는 편이 낫다).
   */
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
 * 히트 척도가 **실제로 볼 값** — 색·지름·숫자 배지·최대값이 전부 이 한 함수를 거친다.
 *
 * §2.1 (A) 외부 폴더 접합은 `quiet` 로 태어나 자기 카운터가 늘 0 이다. 그 값을 그대로 쓰면
 * **자손이 아무리 뜨거워도 회색**이라, "이 묶음 안이 지금 뜨겁다"를 지도가 말하지 못한다.
 * 그래서 자손 합(`externalRollup*Count`)이 크면 그것을 본다.
 *
 * 만진 폴더·파일·도메인은 자손 합이 없거나 자기 값을 포함하므로 **종전 동작과 어긋나지 않는다**.
 * 다섯 자리(색 · 지름 · 배지 숫자 · 클라 척도 · 서버 척도)가 이 함수를 공유해야 한다 — 한 곳이라도
 * 빠지면 "색은 뜨거운데 크기는 최소"처럼 같은 버블이 서로 다른 말을 한다.
 */
export function heatValueOf(bubble: HeatCounts, axis: ToolAxis): number {
  const own = (axis === 'write' ? bubble.writeCount : bubble.readCount) ?? 0;
  const rollup = (axis === 'write' ? bubble.externalRollupWriteCount : bubble.externalRollupReadCount) ?? 0;
  return rollup > own ? rollup : own;
}

/**
 * 히트 배지가 화면에 적는 문자열 — **네 자리부터 접는다**(`1153` → `1.2k`).
 *
 * 버블 지름은 `HEAT_MIN_SIZE`~`HEAT_MAX_SIZE` 라 다섯 글자가 들어가면 읽히지 않는다. 정확한 값은
 * 호출부가 `title` 에 그대로 남기므로 **정보가 사라지지 않는다**(접는 것이지 감추는 것이 아니다).
 *
 * 소수 한 자리는 **10 미만 구간에서만** 붙인다 — `12.3k` 는 소수점이 자리만 먹고 뜻은 더하지 않는다.
 * 반올림이 다음 단위를 만들면(`999,999` → `1000k`) 그 단위에 넘긴다(`1M`).
 */
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

/**
 * 분포 표본을 만든다 — 정렬된 양수 값에서 `HEAT_QUANTILE_BINS + 1` 칸을 고르게 뽑는다.
 *
 * **값 전체를 전선에 싣지 않기 위해서다.** 노드는 수백~수천인데 곡선이 필요로 하는 것은 "어느 값이
 * 몇 등쯤인가"뿐이라, 등간격 표본 33칸이면 그 답을 보간으로 낼 수 있다(§9 전선 부피 규약).
 *
 * 0 이하는 **넣지 않는다** — 바닥은 언제나 0 이고 그 값들은 램프를 타지 않는 회색이라(`heatColor`),
 * 분포에 섞으면 "안 읽은 것"이 순위의 절반을 차지해 읽은 것들이 위쪽으로 몰린다.
 */
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

/**
 * 분포 표본에서 값 하나의 자리를 0~1 로. 표본이 없으면 `null`(호출부가 기본 곡선으로 떨어진다).
 *
 * **동률 덩어리는 통째로 아래 칸을 받는다** — 같은 값이 표본의 여러 칸을 채우면 그 값은 그중 **첫**
 * 칸의 자리를 받는다. 1회짜리가 전체의 절반인 흔한 분포에서 그 절반이 램프 한복판을 차지하지 않고
 * 최저 칸에 모이므로, 남은 램프를 실제로 갈리는 값들이 넓게 쓴다.
 */
function quantilePosition(count: number, quantiles: readonly number[]): number | null {
  const n = quantiles.length;
  if (n < 2) return null;
  const bins = n - 1;
  if (count >= quantiles[bins]!) return 1;
  if (count <= quantiles[0]!) return 1 / bins;
  // 오름차순이라 이진 탐색 — **그 값이 처음 나타나는 칸**을 찾는다(하한). 마지막 칸을 잡으면
  //   동률 덩어리가 통째로 위로 올라가, 1회짜리가 절반인 흔한 분포에서 그 절반이 램프 한복판을
  //   차지한다(가장 낮은 값이 중간색이 되는 뒤집힘).
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

/**
 * 곡선 하나를 적용한 **날 비율**(클램프 전). 척도가 비어 있으면 호출부가 이미 걸러 낸다.
 *
 * `quantile` 은 분포 표본이 있어야 하는 유일한 곡선이라, 없으면 **기본 곡선으로 떨어진다** —
 * 여기서 선형으로 떨어뜨리면 이 절이 고치려던 눌림이 그대로 돌아온다.
 */
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

/**
 * 히트 횟수를 0~1 상대값으로. 척도가 비었거나(그 축으로 아직 아무 일도 없음) 값이 없으면 `0`.
 *
 * 절대 상한(`MAX_EXPECTED_ACTIVITY` 같은 고정값)을 쓰지 않는 이유는 §5.24 — 큰 세션에서
 * 전부 최고온으로 포화되고 작은 세션에서 전부 최저온이 되어 지도가 단색이 된다. **곡선을 갈아도
 * 기준은 여전히 `max` 라 그 요구는 그대로다** — 바뀌는 것은 "그 사이를 어떻게 펴는가" 하나다.
 */
export function heatRatio(count: number | undefined, scale: HeatScale): number {
  if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0) return 0;
  if (!Number.isFinite(scale.max) || scale.max <= 0) return 0;
  const r = curveRatio(count, scale);
  if (!Number.isFinite(r)) return 0;
  return r <= 0 ? 0 : r >= 1 ? 1 : r;
}

/**
 * `heatRatio` 의 **역함수** — 램프의 그 자리가 몇 회인가. 범례 눈금이 이것으로 서 있다.
 *
 * 곡선을 바꾸면 램프 한가운데가 더 이상 `max/2` 가 아니다(로그·max 2,471 에서는 약 50회다).
 * 그래서 눈금 없이 곡선만 갈면 **범례가 거짓말을 한다** — §5.24 가 "범례가 없으면 상대 척도는
 * 읽을 수 없다"고 못박은 자리를 그대로 어기게 된다.
 */
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

/**
 * 범례 램프 위에 세울 눈금 — `{ ratio, count }` 를 **왼쪽부터** 돌려준다.
 *
 * 양 끝(0 과 `max`)은 범례가 이미 숫자로 적고 있으므로 **사이만** 낸다. 사이가 비면 사용자는 색이
 * 어느 구간을 덮는지 알 수 없고, 그러면 곡선을 바꾼 것이 화면에서 확인되지 않는다.
 */
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
