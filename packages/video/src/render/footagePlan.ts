/**
 * §5.13 (Y) 40-3 — 실사 재생의 **판단**(순수 — 시험이 고정한다). 공급자(`media.ts`)는 이 답대로 반복자를 열고 닫는다.
 *
 * 종전에는 프레임마다 `CanvasSink.getCanvas(t)` 를 불렀고, 그때마다 새 디코더가 키프레임부터 다시 풀었다(실측 프레임당 평균
 * 148ms — 키프레임 간격이 7초인 실사에서 재생이 초당 7장 남짓에 묶였다). 이제 아이템마다 **읽개** 하나가 반복자를 붙들고 순서대로
 * 받는다(같은 3초에 프레임당 2.5ms). 판단은 셋이다 — 이어서 받는가(advance) · 그 자리에서 다시 여는가(restart) · 끄는 중이라
 * 가까운 키프레임만 먼저 보이는가(keyframe).
 */

import type { ResolvedTimeline } from '../types.js';

/** 공급자가 프레임을 받는 방식 — 재생(순서대로, 늦은 것은 건너뜀) · 끌기(키프레임 먼저) · 정확한 한 장(멈춤·스틸·렌더). */
export type FramePlayMode = 'play' | 'scrub' | 'exact';

/** 이만큼(초) 앞으로 뛰는 것까지는 반복자를 이어서 받는다(넘으면 그 자리에서 다시 연다 — 키프레임부터가 더 싸다). */
export const FOOTAGE_SEQUENTIAL_JUMP_S = 2;

/** 시각 비교의 여유(초) — 부동소수 누적 오차로 같은 프레임을 두 번 풀지 않게. */
export const FOOTAGE_TIME_EPSILON_S = 1e-4;

/** 장면 경계 이만큼(초) 전에 다음 실사 아이템의 읽개를 미리 연다(첫 프레임에 세워 둔다). */
export const FOOTAGE_PREWARM_AHEAD_S = 3;

/** 미리보기 그리기 폭의 상한(px) — 칸이 커도 이보다 넓게 풀어 옮기지 않는다. */
export const FOOTAGE_PREVIEW_WIDTH_MAX = 1920;

export type ReaderStep = 'advance' | 'restart' | 'keyframe';

/**
 * 읽개가 지금 붙든 프레임(`currentTs` — 없으면 null)에서 시각 `t` 를 어떻게 얻는가.
 * - 반복자가 있고 `t` 가 지금 프레임 이상 · 그 뒤 `FOOTAGE_SEQUENTIAL_JUMP_S` 안이면 이어서 받는다(늦은 프레임은 건너뛴다).
 * - 끄는 중(`scrub`)인데 이어 받을 수 없으면 가까운 키프레임만 먼저(놓으면 정확한 프레임으로 바꾼다).
 * - 그 밖(뒤로 · 멀리 · 반복자 없음)은 그 자리에서 다시 연다.
 */
export function readerStep(state: { readonly currentTs: number | null; readonly hasIterator: boolean }, t: number, mode: FramePlayMode): ReaderStep {
  const { currentTs, hasIterator } = state;
  if (hasIterator && currentTs !== null && t + FOOTAGE_TIME_EPSILON_S >= currentTs && t - currentTs <= FOOTAGE_SEQUENTIAL_JUMP_S) {
    return 'advance';
  }
  return mode === 'scrub' ? 'keyframe' : 'restart';
}

/**
 * 미리보기에 그릴 폭(px). `scale` 은 문서 픽셀 → 화면 실제 픽셀 배율(무대 배율 × devicePixelRatio). 배율을 모르면(렌더·스틸)
 * 원본 폭 그대로다. 원본보다 넓게 키우지 않고, 상한을 넘지 않으며, 짝수로 맞춘다(색차 표본이 반 픽셀 어긋나지 않게).
 */
export function footageDrawWidth(sourceWidth: number, boxWidth: number | undefined, scale: number | undefined, cap = FOOTAGE_PREVIEW_WIDTH_MAX): number {
  const source = Math.max(1, Math.round(sourceWidth));
  if (scale === undefined || !(scale > 0) || boxWidth === undefined || !(boxWidth > 0)) return source;
  const want = Math.ceil(boxWidth * scale);
  const clamped = Math.max(2, Math.min(source, cap, want));
  return clamped % 2 === 0 ? clamped : Math.min(source, clamped + 1);
}

/**
 * 창(렌더러 프로세스)마다 동시에 살려 둘 실사 디코더 수. Chromium 은 OS 마다 하드웨어 디코더에 압력 상한을 둔다(Windows 6 ·
 * macOS 24 · ChromeOS 3 — 넘으면 숨은 것부터 90초 무활동 뒤 회수, linux 는 상한 없음). 그보다 넉넉히 아래로 묶는다 —
 * 넘으면 가장 오래 안 쓴 읽개를 닫는다. `platform` 을 인자로 받아 세 OS 를 다 시험한다.
 */
export function footageDecoderLimit(platform: string): number {
  const p = platform.toLowerCase();
  if (p.includes('cros') || p.includes('chrome os') || p.includes('chromeos')) return 3;
  if (p.startsWith('mac') || p === 'darwin') return 6;
  return 4;
}

/**
 * §5.13 (Y) 40-11 — 실제로 쓸 읽개 상한: 기기 예산(2·3·4)과 그 OS 의 하드웨어 디코더 상한 중 **작은 쪽**. 예산이 OS 상한을 덮어쓰면
 * 상한이 낮은 OS(ChromeOS 3)에서 압력 회수가 난다.
 */
export function effectiveFootageReaderLimit(budget: number, platform: string): number {
  return Math.max(1, Math.min(Math.floor(budget), footageDecoderLimit(platform)));
}

/** 디코더가 회수됐거나(압력 상한 · 오래 숨음) 닫혀 다시 열어야 하는 오류인가. */
export function isDecoderReclaimError(error: unknown): boolean {
  const e = error as { name?: unknown; message?: unknown } | null;
  const name = typeof e?.name === 'string' ? e.name : '';
  const message = typeof e?.message === 'string' ? e.message : String(error ?? '');
  return name === 'QuotaExceededError' || /reclaim/i.test(message) || /closed codec/i.test(message);
}

/** 미리 열 실사 아이템 하나 — 그 아이템의 소재 안 첫 시각(트림 반영). */
export interface FootageWarmRequest {
  readonly itemId: string;
  readonly assetId: string;
  readonly sourceTime: number;
}

/**
 * 지금(`t`) 보이지 않지만 `aheadSeconds` 안에 시작하는 실사 아이템 — 가까운 것부터 `max` 개. 꺼 둔 아이템·트랙 숨김은 그리기
 * 목록이 이미 거르므로 여기서는 시작 시각과 종류만 본다(넉넉히 미리 열어도 그 소재 하나의 첫 프레임뿐이다).
 */
/**
 * §5.13 (Y) 40-10 ① — 포스터를 만들어 둘 실사 아이템들(그 아이템이 시작하는 소재 안 시각의 키프레임 한 장씩). 재생 머리에서 가까운
 * 것부터 `max` 개 — 예산이 넘치면 먼 것부터 밀려난다(가까운 장면이 먼저 서게).
 */
export function footagePosterRequests(timeline: ResolvedTimeline, t: number, max = 24): FootageWarmRequest[] {
  if (max <= 0) return [];
  const out: (FootageWarmRequest & { distance: number })[] = [];
  for (const r of timeline.items) {
    if (r.kind !== 'footage' || r.item.enabled === false) continue;
    const assetId = r.item.assetId;
    if (assetId === undefined) continue;
    const distance = t < r.start ? r.start - t : t >= r.end ? t - r.end + 0.001 : 0;
    out.push({ itemId: r.id, assetId, sourceTime: Math.max(0, r.item.trimStart ?? 0), distance });
  }
  out.sort((a, b) => a.distance - b.distance || (a.itemId < b.itemId ? -1 : 1));
  return out.slice(0, max).map(({ itemId, assetId, sourceTime }) => ({ itemId, assetId, sourceTime }));
}

export function upcomingFootage(timeline: ResolvedTimeline, t: number, alive: ReadonlySet<string>, aheadSeconds = FOOTAGE_PREWARM_AHEAD_S, max = 2): FootageWarmRequest[] {
  if (aheadSeconds <= 0 || max <= 0) return [];
  const out: (FootageWarmRequest & { start: number })[] = [];
  for (const r of timeline.items) {
    if (r.kind !== 'footage' || alive.has(r.id) || r.item.enabled === false) continue;
    const assetId = r.item.assetId;
    if (assetId === undefined || r.start <= t || r.start > t + aheadSeconds) continue;
    out.push({ itemId: r.id, assetId, sourceTime: Math.max(0, r.item.trimStart ?? 0), start: r.start });
  }
  out.sort((a, b) => a.start - b.start || (a.itemId < b.itemId ? -1 : 1));
  return out.slice(0, max).map(({ itemId, assetId, sourceTime }) => ({ itemId, assetId, sourceTime }));
}
