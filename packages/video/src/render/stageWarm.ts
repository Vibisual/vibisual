/**
 * §5.13 (X) 39-5 — 미리보기 무대의 **데우기 판단**(순수 — 시험이 고정한다).
 *
 * 종전 무대는 지금 시각에 보이는 아이템만 세우고 나머지는 그 자리에서 버렸다. 컴포지션 하나는 샌드박스 문서 한 벌이라, 장면이
 * 넘어갈 때마다(재생 중에도, 앞뒤로 훑을 때도) 새 문서를 처음부터 불러왔고 그 사이 화면이 비거나 멈췄다. 이제 무대는
 *  ① 곧 시작할 컴포지션을 미리 열어 첫 시각에 맞춰 두고(보이지 않게)
 *  ② 막 지나간 컴포지션은 버리지 않고 잠시 보관한다(보이지 않게).
 * 수와 시간에 상한이 있어 오래 쉰 것부터 버린다 — 데우기가 메모리를 끝없이 먹지 않는다. 렌더 무대(엄격)는 쓰지 않는다.
 */

import type { ResolvedTimeline } from '../types.js';

export interface StageWarmOptions {
  /** 이 시간(초) 안에 시작하는 컴포지션을 미리 연다. */
  readonly aheadSeconds: number;
  /** 한 번에 미리 여는 수 상한. */
  readonly aheadMax: number;
  /** 지나간 것을 보관하는 수 상한(미리 연 것은 세지 않는다). */
  readonly keepParked: number;
  /** 보관한 것을 이만큼(ms) 다시 안 쓰면 버린다. */
  readonly parkedTtlMs: number;
}

/** 지금(`t`) 보이지 않지만 `aheadSeconds` 안에 시작하는 컴포지션 아이템 — 가까운 것부터 `aheadMax` 개. */
export function upcomingCompositions(
  timeline: ResolvedTimeline,
  t: number,
  alive: ReadonlySet<string>,
  opts: Pick<StageWarmOptions, 'aheadSeconds' | 'aheadMax'>,
): { readonly id: string; readonly start: number }[] {
  if (opts.aheadMax <= 0 || opts.aheadSeconds <= 0) return [];
  const out: { id: string; start: number }[] = [];
  for (const r of timeline.items) {
    if (r.kind !== 'composition' || alive.has(r.id)) continue;
    if (r.start <= t || r.start > t + opts.aheadSeconds) continue;
    out.push({ id: r.id, start: r.start });
  }
  out.sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : 1));
  return out.slice(0, opts.aheadMax);
}

/**
 * 보관한 것 중 **버릴 것**. 시간이 지난 것은 버리고, 남은 것이 상한을 넘으면 오래 쉰 것부터 버린다. 곧 쓸 것(`keep` — 미리 연
 * 것)은 셈에도 넣지 않는다. 결과 순서는 버릴 순서다.
 */
export function parkedToRelease(
  parked: readonly { readonly id: string; readonly parkedAt: number }[],
  now: number,
  keep: ReadonlySet<string>,
  opts: Pick<StageWarmOptions, 'keepParked' | 'parkedTtlMs'>,
): string[] {
  const release: string[] = [];
  const remaining: { id: string; parkedAt: number }[] = [];
  for (const p of parked) {
    if (keep.has(p.id)) continue;
    if (now - p.parkedAt > opts.parkedTtlMs) release.push(p.id);
    else remaining.push({ id: p.id, parkedAt: p.parkedAt });
  }
  remaining.sort((a, b) => b.parkedAt - a.parkedAt);
  for (const p of remaining.slice(Math.max(0, opts.keepParked)).reverse()) release.push(p.id);
  return release;
}

/**
 * §5.13 (Y) 40-8 ① — 데운·보관한 슬롯을 **어떻게 숨기나**. 실측(Electron 31 = Chromium 126):
 *  - 투명도 0 만으로는 같은 프로세스 프레임(웹·dev)이 쉬지 않았고(rAF 초당 32번), 다른 프로세스 프레임(패키지 앱)은 쉬었지만 다시
 *    보일 때 첫 그림이 약 59ms 늦었다.
 *  - `content-visibility:hidden` 은 두 경우 다 쉬게 하고(rAF 0) 풀면 1~30ms 안에 그린다 — 단 **한 번도 그려지지 않은** 다른
 *    프로세스 프레임에 처음부터 걸면 전혀 쉬지 않는다(초당 128번 — 가시성 판정이 돌지 않는다).
 * 그래서 셋으로 간다: 새로 연 것은 거의 안 보이게(`prime` — 투명도 0.01) 첫 그림을 그리고, 그 뒤 `rest`(content-visibility
 * hidden + 투명도 0)로 쉬며, 컷 `STAGE_WARM_PRIME_FRAMES` 프레임 전에 다시 `prime` 으로 깨운다. 보이는 순간은 무대가 맞춘다.
 */
export type WarmSlotState = 'prime' | 'rest';

/** 컷 이 프레임 수 전부터 깨운다(그 프레임을 그려 둘 시간). */
export const STAGE_WARM_PRIME_FRAMES = 2;
/** 깨우는 앞당김의 하한(초) — fps 가 높아도 한 프레임 그림보다 짧게 잡지 않는다. */
export const STAGE_WARM_PRIME_MIN_S = 0.05;
/** 깨운 투명도 — 보이지 않을 만큼 작지만 0 이 아니다(0 이면 다른 프로세스 프레임이 그리기를 늦춘다). */
export const STAGE_WARM_PRIME_OPACITY = 0.01;

/**
 * 숨긴 슬롯 하나의 상태. `start` = 그 아이템이 시작할 시각(지나간 보관분이면 null), `painted` = 깨운 뒤 첫 그림을 그렸는가.
 */
export function warmSlotState(opts: { readonly start: number | null; readonly t: number; readonly fps: number; readonly painted: boolean }): WarmSlotState {
  if (!opts.painted) return 'prime';
  if (opts.start === null || opts.start <= opts.t) return 'rest';
  const lead = Math.max(STAGE_WARM_PRIME_MIN_S, STAGE_WARM_PRIME_FRAMES / Math.max(1, opts.fps));
  return opts.start - opts.t <= lead ? 'prime' : 'rest';
}

/** 긴 프레임(50ms 넘는 LoAF)이 이 수만큼 이어지면 앞 데우기를 줄인다(§5.13 (Y) 40-8 ⑤). */
export const STAGE_WARM_LONG_FRAMES = 3;

/**
 * §5.13 (Y) 40-8 ⑤ — 기기 등급에서 시작한 데우기 수를 **실측 프레임 시간**으로 조절한다. 최근 창(호출부가 정한 길이)에 긴 프레임이
 * `STAGE_WARM_LONG_FRAMES` 이상이면 미리 여는 수와 보관 수를 하나씩 줄인다(0 아래로는 안 간다). 조용하면 기본값 그대로.
 */
export function adaptWarm(base: StageWarmOptions, recentLongFrames: number): StageWarmOptions {
  if (recentLongFrames < STAGE_WARM_LONG_FRAMES) return base;
  return { ...base, aheadMax: Math.max(0, base.aheadMax - 1), keepParked: Math.max(0, base.keepParked - 1) };
}
