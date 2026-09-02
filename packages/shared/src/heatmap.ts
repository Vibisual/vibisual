/**
 * heatmap.ts — §5.24 · 읽기 히트맵의 **공용 판정·색 계산**.
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
  HEATMAP_RAMP,
  HEATMAP_ZERO_COLOR,
  HEAT_MAX_SIZE,
  HEAT_MIN_SIZE,
  READ_TOOLS,
  WEB_TOOLS,
  WRITE_TOOLS,
} from './constants.js';
import type { BubbleType } from './types.js';

/** 히트 카운터의 축. 표에 없는 이름은 `null` — **모르는 것을 넘겨짚지 않는다.** */
export type ToolAxis = 'read' | 'write';

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
 */
export interface HeatScale {
  /** 지금 이 프로젝트 캔버스에서 가장 많이 읽힌 버블의 `readCount`. */
  max: number;
}

/**
 * 읽기 횟수를 0~1 상대값으로. 척도가 비었거나(아직 아무것도 안 읽음) 값이 없으면 `0`.
 * 절대 상한(`MAX_EXPECTED_ACTIVITY` 같은 고정값)을 쓰지 않는 이유는 §5.24 — 큰 세션에서
 * 전부 최고온으로 포화되고 작은 세션에서 전부 최저온이 되어 지도가 단색이 된다.
 */
export function heatRatio(readCount: number | undefined, scale: HeatScale): number {
  if (typeof readCount !== 'number' || !Number.isFinite(readCount) || readCount <= 0) return 0;
  if (!Number.isFinite(scale.max) || scale.max <= 0) return 0;
  const r = readCount / scale.max;
  return r <= 0 ? 0 : r >= 1 ? 1 : r;
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
 * 0~1 을 램프 색으로. **`readCount` 가 0 이면 램프를 타지 않고** `HEATMAP_ZERO_COLOR` 를 준다 —
 * 호출부가 그 판정을 잊지 않도록 이 함수가 직접 갈라 준다(`ratio <= 0` = 안 읽음).
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
