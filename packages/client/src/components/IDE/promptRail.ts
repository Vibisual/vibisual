/**
 * §5.5 #17-48 — 내 입력 레일: '맨 아래로' 위의 [맨 위] · [이전 입력] · 입력 눈금 · [다음 입력] + 올리면 내 글.
 *
 * 긴 세션에서 "내가 뭐라고 했었지"를 다시 보려면 휠로 한참 거슬러 올라가야 했다(사용자 요청 —
 * "내가 입력한 것을 단계적으로 즉시 이동 · 깔끔하게 선으로 · 마우스 올리면 내가 쓴 글, 길면 일부 생략").
 *
 * 지금 자리·이전·다음 판정, 눈금 배치, 팝업 자리, 글 생략은 DOM 을 모르는 순수 함수로 두어 단위 테스트로
 * 못박는다(클라 테스트에는 jsdom 이 없다). DOM 을 만지는 것은 화면을 재는 `measureViewportItems` 와
 * 도착을 맞추는 `settleItemAtTop` 둘뿐이다 — Sub 탭 렌더러와 메인 탭 타임라인이 같은 측정·같은 도착을 쓴다.
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
 * 잰 화면(`ViewportItems`)을 입력 단위로 옮긴다. 소속은 §5.5 #17-12 ③-2 와 같은 규칙 —
 * 맨 위 항목부터 **항목 배열을 거슬러 올라가** 처음 만나는 입력이다(말풍선이 선렌더 버퍼 밖이어도 정확하다).
 * 단, ③-2 와 달리 첫 입력보다 위(세션 서두)를 첫 입력으로 뭉개지 않는다 — 레일에서는 그 자리에서
 * [이전]이 없고 [다음]이 첫 입력이어야 한다.
 *
 * 맨 위 항목이 배열에 없으면(측정과 데이터가 어긋난 한 프레임) `null` — 부르는 쪽이 앞 판정을 유지한다.
 * `idOf` 는 항목 래퍼의 `data-stream-item-id` 와 같은 값을 내야 한다(메인 탭 노드는 id 를 계산해 낸다).
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
 * 지금 자리 → [이전]·[다음] 행선지.
 *
 * - **이전** = 그 입력에 서 있으면 앞 입력, 그 턴의 응답 중간이면 **지금 턴의 입력**(미디어 플레이어의 "이전").
 * - **다음** = 다음 입력. 첫 입력보다 위(-1)면 이전은 없고 다음은 첫 입력이다.
 * - **바닥 예외** — 바닥에 닿아 더 내려갈 수 없는데 화면 안에 더 뒤의 입력이 보이면 그 입력이 지금 자리다.
 *   그러지 않으면 [다음]이 맨 위까지 못 올라올 입력을 가리켜 눌러도 헛돈다.
 * - **붙든 자리**(`held`) — 레일로 옮긴 직후에는 옮겨 간 입력이 지금 자리다. 바닥 가까운 입력은 맨 위까지
 *   못 올라와 재 보면 앞 턴이 나오고, 그러면 [다음]이 같은 입력으로 되돌아간다. 두 예외 중 이것이 먼저다.
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

/**
 * 트랙 위 포인터 높이(0~1)에서 **가장 가까운 눈금**. 눈금이 수백 개면 1px 눈금을 겨눌 수 없으므로
 * 트랙 전체를 눈금 수만큼 고르게 나눠 그 칸의 눈금을 고른다(눈금이 칸 한가운데 서므로 곧 가장 가까운 눈금).
 */
export function nearestPromptMarker(ratio: number, count: number): number {
  if (count <= 0) return -1;
  const r = Number.isFinite(ratio) ? ratio : 0;
  return Math.max(0, Math.min(count - 1, Math.floor(r * count)));
}

/**
 * 팝업에 실을 내 글 — 줄바꿈은 살리되 `maxLines` 줄 · `maxChars` 자를 넘으면 그 뒤를 `…` 로 생략한다.
 * 줄 끝 공백과 세 줄 넘는 빈 줄은 접는다(붙여 넣은 글의 빈칸이 팝업을 늘리지 않게).
 * 자르는 자리가 서로게이트 쌍 한가운데면 한 칸 앞에서 자른다(그림 글자가 깨진 물음표로 남지 않게).
 */
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
 * 스크롤러 안의 항목 래퍼(`data-stream-item-id`, 위→아래 순서라 top 이 단조증가)를 이분 탐색으로 잰다.
 *
 * 래퍼마다 글자 배율(`ideTextZoom`)이 `zoom` 으로 걸려 있어 Chromium 126 은 그 사각형을 배율로 나눠 준다 —
 * 그대로 쓰면 배율이 1이 아닐 때 "맨 위 항목"이 한 칸씩 어긋났다. 래퍼들은 같은 zoom 아래 있으므로
 * 배율은 첫 래퍼에서 한 번만 구한다(`visualRectScale`). 래퍼가 없으면 `null`.
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
 * 가상 리스트 인덱스 이동(`scrollToIndex`) 뒤, 추정 높이로 내려앉은 오차를 실제 DOM 으로 맞춘다.
 * 두 프레임 뒤(그려진 직후) 한 번 맞추고 도착한 항목을 짧게 빛낸다 — 바닥 근처라 화면이 움직이지 않는
 * 이동도 어디로 갔는지 보이게(북마크·카드 점프와 같은 도착 연출). 위쪽 항목들이 늦게 재측정돼 밀리는
 * 몫은 잠시 뒤 한 번 더 맞춘다(빛내기는 한 번만).
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
