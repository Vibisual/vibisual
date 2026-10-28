/**
 * §5.5 #17-48 — 내 입력 레일: 알약 하나에 [맨 위]·[이전]·입력 점·[다음]·[맨 아래로] + 올리면 내 글. 판정·배치·생략은 순수 함수,
 * DOM 은 `measureViewportItems`·`settleItemAtTop` 둘뿐 — Sub 탭과 메인 탭 타임라인이 같은 측정·도착을 쓴다.
 */
import { visualClientRect, visualRectScale } from '../../utils/inspector.js';
import { findItemElement, flashElement } from './bookmarkScroll.js';
import { lastPassedIndex, VIEWED_TOP_MARGIN } from './streamViewedCommand.js';

/** 입력으로 옮길 때 말풍선 윗변을 세우는 자리(화면 위에서 px) — 상태바 점프(-16)와 같은 자리. */
export const PROMPT_JUMP_TOP_GAP = 16;
/** 팝업 본문 상한(줄). 넘으면 그 뒤를 `…` 로 생략한다. */
export const PROMPT_RAIL_PREVIEW_LINES = 8;
/** 팝업 본문 상한(글자). 넘으면 그 뒤를 `…` 로 생략한다. */
export const PROMPT_RAIL_PREVIEW_MAX = 320;
/** 바닥 판정(px) — 상태바 추종(§5.5 #17-12 ③-2)과 같은 임계. */
export const PROMPT_RAIL_BOTTOM_EPS = 40;
/** "화면 안에 들어왔다"고 볼 최소 노출(px) — 바닥 가장자리에 몇 px 걸친 말풍선은 보인 것이 아니다. */
export const PROMPT_RAIL_VISIBLE_MIN = 12;
/** 점 트랙 높이(px) — 입력 수만큼 자라되 이 사이에 머문다. 창이 낮으면 그보다 더 줄어든다(flex). */
export const PROMPT_RAIL_TRACK_MIN_PX = 40;
export const PROMPT_RAIL_TRACK_MAX_PX = 192;
export const PROMPT_RAIL_TRACK_PX_PER_PROMPT = 14;
/** 점 간격(px)이 이보다 좁으면 점을 작게 그린다 — 큰 점이 겹쳐 덩어리로 뭉치지 않고 가는 줄처럼 이어지게. */
export const PROMPT_RAIL_DENSE_GAP_PX = 7;

/** 레일 눈금 하나 = 내 입력 하나. */
export interface PromptRailEntry {
  /** 목록 항목 id(`cmd-…` · `evt-…`) — 옮길 때 이 id 로 찾는다. */
  id: string;
  /** 내가 쓴 글 그대로. */
  text: string;
  /** 보낸 시각(ms). 없으면 팝업에 시각을 적지 않는다. */
  at?: number;
}

/** 두 입력 목록이 같은가 — 같으면 부모가 스트리밍 토큰마다 레일을 다시 그리지 않게 옛 참조를 쓴다. */
export function samePromptOutline(a: readonly PromptRailEntry[], b: readonly PromptRailEntry[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x.id !== y.id || x.text !== y.text || x.at !== y.at) return false;
  }
  return true;
}

/** 화면을 잰 결과 — 항목 id 만 담는다(어느 입력에 속하는지는 항목 배열로 되짚는다). */
export interface ViewportItems {
  /** 화면 맨 위를 채운 항목(상단 여백 안으로 지난 마지막 래퍼, 하나도 못 지났으면 첫 래퍼). */
  topId: string | null;
  /** 윗변이 화면 안에 들어온 마지막 항목. */
  lastVisibleId: string | null;
  /** 바닥에 닿아 더 내려갈 수 없는가. */
  atBottom: boolean;
}

/** 레일이 묻는 지금 자리(입력 id 단위). */
export interface PromptProbe {
  /** 화면 맨 위 항목이 속한 입력(첫 입력보다 위면 `null`). */
  ownerId: string | null;
  /** 맨 위 항목이 그 입력 말풍선 자체인가. */
  anchored: boolean;
  /** 맨 위 항목보다 아래, 화면 안에 들어온 마지막 입력(없으면 `null`). */
  lastVisibleId: string | null;
  atBottom: boolean;
}

/**
 * 잰 화면 → 입력 단위. 소속은 §5.5 #17-12 ③-2 규칙(맨 위 항목에서 배열을 거슬러 처음 만나는 입력)이되, 첫 입력보다 위(세션 서두)는
 * 첫 입력으로 뭉개지 않는다(거기선 [이전] 없음·[다음] = 첫 입력). 맨 위 항목이 배열에 없으면 `null`(앞 판정 유지).
 * `idOf` 는 래퍼의 `data-stream-item-id` 와 같은 값이어야 한다.
 */
export function probePromptPlace<T>(
  items: readonly T[],
  isPrompt: (item: T) => boolean,
  viewport: ViewportItems,
  idOf: (item: T) => string,
): PromptProbe | null {
  if (viewport.topId === null) return null;
  const topIdx = items.findIndex((it) => idOf(it) === viewport.topId);
  if (topIdx < 0) return null;
  let ownerId: string | null = null;
  let anchored = false;
  for (let k = topIdx; k >= 0; k--) {
    const it = items[k]!;
    if (isPrompt(it)) {
      ownerId = idOf(it);
      anchored = k === topIdx;
      break;
    }
  }
  let lastVisibleId: string | null = null;
  const lastIdx = viewport.lastVisibleId === null ? -1 : items.findIndex((it) => idOf(it) === viewport.lastVisibleId);
  for (let k = lastIdx; k > topIdx; k--) {
    const it = items[k]!;
    if (isPrompt(it)) {
      lastVisibleId = idOf(it);
      break;
    }
  }
  return { ownerId, anchored, lastVisibleId, atBottom: viewport.atBottom };
}

/** 레일의 지금 자리와 두 버튼의 행선지(입력 순번). */
export interface PromptRailPlace {
  /** 지금 자리(입력 순번). 첫 입력보다 위면 -1. */
  current: number;
  /** 그 입력에 서 있는가(맨 위 항목이 그 말풍선 자체 · 바닥 예외 · 레일로 옮긴 직후). */
  anchored: boolean;
  /** [이전 입력]이 갈 순번(없으면 `null`). */
  prev: number | null;
  /** [다음 입력]이 갈 순번(없으면 `null`). */
  next: number | null;
}

export const EMPTY_PROMPT_RAIL_PLACE: PromptRailPlace = { current: -1, anchored: false, prev: null, next: null };

/**
 * 지금 자리 → [이전]·[다음]. 이전 = 입력 위면 앞 입력, 응답 중간이면 지금 턴의 입력. 첫 입력보다 위(-1)면 다음 = 첫 입력.
 * 바닥 예외: 바닥인데 화면에 더 뒤의 입력이 보이면 그게 지금 자리. 붙든 자리(`held`, 먼저 적용): 레일로 옮긴 직후엔 옮겨 간 입력
 * (예외가 없으면 [다음]이 헛돌거나 같은 입력으로 되돌아간다).
 */
export function resolvePromptRailPlace(input: {
  count: number;
  /** 맨 위 항목이 속한 입력의 순번(-1 = 첫 입력보다 위). */
  owner: number;
  anchored: boolean;
  /** 맨 위보다 아래, 화면 안의 마지막 입력 순번(-1 = 없음). */
  lastVisible: number;
  atBottom: boolean;
  /** 레일로 옮겨 붙든 순번(-1 = 없음). */
  held: number;
}): PromptRailPlace {
  const { count } = input;
  if (count <= 0) return EMPTY_PROMPT_RAIL_PLACE;
  let current = Math.max(-1, Math.min(count - 1, input.owner));
  let anchored = input.anchored && current >= 0;
  if (input.held >= 0 && input.held < count) {
    current = input.held;
    anchored = true;
  } else if (input.atBottom && input.lastVisible > current && input.lastVisible < count) {
    current = input.lastVisible;
    anchored = true;
  }
  const back = current < 0 ? -1 : anchored ? current - 1 : current;
  const fwd = current + 1;
  return {
    current,
    anchored,
    prev: back >= 0 ? back : null,
    next: fwd < count ? fwd : null,
  };
}

/** 두 자리가 같은가 — 같으면 상태를 갈지 않는다(스크롤 프레임마다 다시 그리지 않게). */
export function samePromptRailPlace(a: PromptRailPlace, b: PromptRailPlace): boolean {
  return a.current === b.current && a.anchored === b.anchored && a.prev === b.prev && a.next === b.next;
}

/**
 * 눈금 `index` 가 트랙에서 서는 높이(0~1). 내용 높이가 아니라 **순번으로 고르게** 놓는다 —
 * 가상 리스트는 그리지 않은 항목의 높이를 모르므로, 높이에 비례시키면 스크롤할 때마다 눈금이 제자리를 떠난다.
 */
export function promptMarkerRatio(index: number, count: number): number {
  if (count <= 0) return 0.5;
  return (index + 0.5) / count;
}

/** 점 트랙 높이(px) — 입력 하나에 `PROMPT_RAIL_TRACK_PX_PER_PROMPT` 씩, 위아래 한도 안에서. */
export function promptRailTrackPx(count: number): number {
  return Math.min(PROMPT_RAIL_TRACK_MAX_PX, Math.max(PROMPT_RAIL_TRACK_MIN_PX, count * PROMPT_RAIL_TRACK_PX_PER_PROMPT));
}

/** 점이 빽빽한가 — 점 간격이 `PROMPT_RAIL_DENSE_GAP_PX` 보다 좁으면 작은 점으로 그린다. */
export function promptRailDense(count: number, trackPx: number = promptRailTrackPx(count)): boolean {
  return count > 0 && trackPx / count < PROMPT_RAIL_DENSE_GAP_PX;
}

/** 점들을 잇는 선의 자리(트랙 높이 대비 %). */
export interface PromptRailLine {
  /** 옅은 이음선의 위·아래 끝 — 트랙 위·아래 변에서 첫 점·마지막 점까지의 거리. */
  insetPct: number;
  /** 첫 점에서 지금 자리 점까지 강조색으로 차오른 길이. 0 이면 차오른 선이 없다. */
  fillPct: number;
}

/** 첫 점~마지막 점의 옅은 선과 첫 점~지금 자리의 차오른 선. 점이 하나면 `null`, 자리가 첫 입력 이하면 0, 목록보다 크면 마지막 점에서 멈춘다. */
export function promptRailLine(count: number, current: number): PromptRailLine | null {
  if (count < 2) return null;
  const at = Math.min(count - 1, current);
  return {
    insetPct: promptMarkerRatio(0, count) * 100,
    fillPct: at > 0 ? (at / count) * 100 : 0,
  };
}

/**
 * 트랙 위 포인터 높이(0~1)에서 **가장 가까운 눈금**. 눈금이 수백 개면 1px 눈금을 겨눌 수 없으므로
 * 트랙 전체를 눈금 수만큼 고르게 나눠 그 칸의 눈금을 고른다(눈금이 칸 한가운데 서므로 곧 가장 가까운 눈금).
 */
export function nearestPromptMarker(ratio: number, count: number): number {
  if (count <= 0) return -1;
  const r = Number.isFinite(ratio) ? ratio : 0;
  return Math.max(0, Math.min(count - 1, Math.floor(r * count)));
}

/** 팝업에 실을 내 글 — 줄바꿈은 살리고 `maxLines`·`maxChars` 를 넘으면 `…`. 줄 끝 공백·세 줄 넘는 빈 줄은 접고, 서로게이트 쌍 한가운데는 자르지 않는다. */
export function promptPreviewText(
  text: string,
  maxChars: number = PROMPT_RAIL_PREVIEW_MAX,
  maxLines: number = PROMPT_RAIL_PREVIEW_LINES,
): { text: string; clipped: boolean } {
  const norm = text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  let lines = norm.split('\n');
  let clipped = false;
  if (lines.length > maxLines) {
    lines = lines.slice(0, Math.max(1, maxLines));
    clipped = true;
  }
  let out = lines.join('\n');
  if (out.length > maxChars) {
    let cut = Math.max(0, maxChars);
    const code = out.charCodeAt(cut - 1);
    if (cut > 0 && code >= 0xd800 && code <= 0xdbff) cut -= 1;
    out = out.slice(0, cut);
    clipped = true;
  }
  if (clipped) out = `${out.replace(/\s+$/, '')}…`;
  return { text: out, clipped };
}

/**
 * 팝업 자리 — 기준점(레일 왼쪽 변 · 눈금 높이)의 **왼쪽**에 세우고 세로 가운데를 맞춘 뒤 화면 안으로 당긴다.
 * 왼쪽이 모자라면 화면 왼쪽 여백에 붙인다(레일을 조금 덮더라도 글이 잘리는 것보다 낫다).
 */
export function placePromptRailPopup(
  anchor: { left: number; centerY: number },
  box: { width: number; height: number },
  viewport: { width: number; height: number },
  gap = 10,
  margin = 8,
): { left: number; top: number } {
  const maxLeft = Math.max(margin, viewport.width - margin - box.width);
  const left = Math.min(maxLeft, Math.max(margin, anchor.left - gap - box.width));
  const maxTop = Math.max(margin, viewport.height - margin - box.height);
  const top = Math.min(maxTop, Math.max(margin, anchor.centerY - box.height / 2));
  return { left, top };
}

// ─── DOM — 화면 재기 · 도착 맞추기 ───────────────────────────────────────────

/**
 * 항목 래퍼(`data-stream-item-id`, top 단조증가)를 이분 탐색으로 잰다. 래퍼에 `ideTextZoom` 이 `zoom` 으로 걸려 Chromium 126 은 사각형을
 * 배율로 나눠 준다 — 배율은 첫 래퍼에서 한 번 구한다(`visualRectScale`, 안 그러면 배율 ≠ 1 에서 한 칸 어긋난다).
 */
export function measureViewportItems(cont: HTMLElement): ViewportItems | null {
  const els = cont.querySelectorAll<HTMLElement>('[data-stream-item-id]');
  if (els.length === 0) return null;
  const box = visualClientRect(cont);
  const scale = visualRectScale(els[0]!);
  const topAt = (i: number): number => els[i]!.getBoundingClientRect().top * scale - box.top;
  const passed = lastPassedIndex(els.length, topAt, VIEWED_TOP_MARGIN);
  // 하나도 못 지났으면 리스트 맨 위 — 렌더된 첫 항목이 곧 화면 맨 위다.
  const topEl = passed >= 0 ? els[passed]! : els[0]!;
  const visible = lastPassedIndex(els.length, topAt, box.height - PROMPT_RAIL_VISIBLE_MIN);
  const lastEl = visible >= 0 ? els[visible]! : null;
  return {
    topId: topEl.dataset.streamItemId ?? null,
    lastVisibleId: lastEl?.dataset.streamItemId ?? null,
    atBottom: cont.scrollHeight - cont.scrollTop - cont.clientHeight < PROMPT_RAIL_BOTTOM_EPS,
  };
}

/**
 * `scrollToIndex` 뒤 추정 높이 오차를 실제 DOM 으로 맞춘다 — 두 프레임 뒤 맞추고 도착 항목을 짧게 빛낸다(화면이 안 움직이는 이동도 보이게).
 * 위쪽이 늦게 재측정돼 밀린 몫은 잠시 뒤 한 번 더 맞춘다(빛내기는 한 번).
 */
export function settleItemAtTop(getContainer: () => HTMLElement | null, itemId: string, gap: number = PROMPT_JUMP_TOP_GAP): void {
  const fix = (flash: boolean): void => {
    const cont = getContainer();
    if (!cont) return;
    const el = findItemElement(cont, itemId);
    if (!el) return;
    const delta = visualClientRect(el).top - visualClientRect(cont).top - gap;
    if (Math.abs(delta) > 1) cont.scrollTop += delta;
    if (flash) flashElement(el);
  };
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => fix(true)));
  window.setTimeout(() => fix(false), 180);
}
