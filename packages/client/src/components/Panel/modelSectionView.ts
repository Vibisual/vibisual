/**
 * §4 (상태바 모델 칸 ②③) — 설정창(`AgentConfigPopup`)을 **모델 구역만** 연 작은 카드의 순수 판정.
 *
 * 카드는 새 설정창이 아니라 같은 창의 `section="model"` 보기다 — 상태·저장·렌더 조각은 전체 보기와
 * 한 벌이고, 여기에는 **그 보기에만 있는 것**(칸 위에 붙는 자리 · 목록을 언제 어디서 확인했는가 ·
 * 바꾼 값이 언제부터 먹는가)만 둔다. 화면이 판정을 들고 있으면 DOM 없는 테스트로 고정할 수 없다.
 */
import type { ModelRegistry } from '@vibisual/shared';
import type { ViewportSize } from '../../hooks/popupDismiss.js';

/** 카드를 붙일 칸의 화면 사각형(`getBoundingClientRect` 에서 필요한 넷). */
export interface PopupAnchorRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** 카드 폭(px). 모델 드롭다운의 설명 한 줄이 두 줄로 꺾이지 않는 선. */
export const MODEL_SECTION_CARD_WIDTH = 360;
/** 뷰포트 가장자리와 남기는 여백 — 드롭다운(`DD_VIEWPORT_MARGIN`)과 같은 값. */
const EDGE_MARGIN = 8;
/** 칸과 카드 사이 간격. */
const ANCHOR_GAP = 6;
/**
 * 칸 위 공간이 이만큼 있으면 아래가 더 넓어도 위로 연다 — 상태바는 창 바닥에 있어 위가 제자리다.
 * 떠 있는 작은 IDE 창이 화면 꼭대기에 붙어 있을 때만 아래로 뒤집힌다.
 */
const PREFER_ABOVE_MIN = 280;

export interface ModelSectionPlacement {
  left: number;
  width: number;
  /** 칸 아래로 열 때만 — 카드 위 변의 뷰포트 위로부터 거리. */
  top?: number;
  /** 칸 위로 열 때만 — 카드 아래 변의 뷰포트 아래로부터 거리(카드가 칸 위로 자란다). */
  bottom?: number;
  /** 넘치면 카드 안에서 스크롤한다. 뷰포트 밖으로 밀려나지 않게 그 방향의 남은 공간이 상한이다. */
  maxHeight: number;
}

/**
 * 칸 위(모자라면 아래)에 붙는 카드 자리. 가로는 칸 왼쪽에 맞추되 뷰포트 안으로 밀어 넣는다 —
 * 상태바 모델 칸은 줄 가운데쯤이라, 창을 좁히면 그대로 두었을 때 오른쪽이 잘린다.
 */
export function placeModelSectionCard(
  anchor: PopupAnchorRect,
  viewport: ViewportSize,
  width: number = MODEL_SECTION_CARD_WIDTH,
): ModelSectionPlacement {
  const w = Math.max(0, Math.min(width, viewport.w - EDGE_MARGIN * 2));
  const left = Math.min(
    Math.max(anchor.left, EDGE_MARGIN),
    Math.max(EDGE_MARGIN, viewport.w - EDGE_MARGIN - w),
  );
  const spaceAbove = Math.max(0, anchor.top - ANCHOR_GAP - EDGE_MARGIN);
  const spaceBelow = Math.max(0, viewport.h - anchor.bottom - ANCHOR_GAP - EDGE_MARGIN);
  if (spaceAbove >= PREFER_ABOVE_MIN || spaceAbove >= spaceBelow) {
    return { left, width: w, bottom: viewport.h - anchor.top + ANCHOR_GAP, maxHeight: spaceAbove };
  }
  return { left, width: w, top: anchor.bottom + ANCHOR_GAP, maxHeight: spaceBelow };
}

/** 모델 목록이 실제로 싣고 있는 출처. 순서가 곧 표시 순서다. */
export type ModelListSource = 'seed' | 'api' | 'observed';

/**
 * 레지스트리 한 벌이 **실제로** 어느 출처를 담고 있는가(공개 문서 → 공식 API → 사용 기록).
 *
 * 공개 문서 시드는 늘 바닥에 깔린다 — API 가 같은 ID 를 덮어 항목의 `source` 가 전부 `api` 로 바뀌어도
 * 가격은 여전히 시드에서 오기 때문이다. 나머지 둘은 **있을 때만** 적는다(키가 없는 PC 에 "공식 API"
 * 라고 적으면 그 목록이 받아 온 적 없는 것을 받아 왔다고 말하게 된다).
 */
export function modelListSourcesOf(registry: ModelRegistry | null | undefined): ModelListSource[] {
  if (!registry) return [];
  const out: ModelListSource[] = ['seed'];
  if (registry.sourceMix === 'api-merged' || registry.entries.some((e) => e.source === 'api')) out.push('api');
  if (registry.entries.some((e) => e.source === 'observed')) out.push('observed');
  return out;
}

/** 목록을 마지막으로 확인한 시각. 서버가 `checkedAt` 을 싣기 전 판이면 `updatedAt` 으로 대신한다. */
export function modelListCheckedAt(registry: ModelRegistry | null | undefined): number | null {
  if (!registry) return null;
  const at = registry.checkedAt ?? registry.updatedAt;
  return typeof at === 'number' && Number.isFinite(at) && at > 0 ? at : null;
}

/** 로케일별 `Intl.RelativeTimeFormat` 창고 — 렌더마다 짓기엔 비싸다(`promptStamp.ts` 와 같은 규약). */
const relativeFormats = new Map<string, Intl.RelativeTimeFormat>();

function relativeFormatFor(locale: string): Intl.RelativeTimeFormat {
  const hit = relativeFormats.get(locale);
  if (hit) return hit;
  let made: Intl.RelativeTimeFormat;
  try {
    made = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  } catch {
    // 못 알아듣는 로케일 태그는 `RangeError` 다 — 카드 한 줄 때문에 창이 무너지면 안 된다.
    made = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  }
  relativeFormats.set(locale, made);
  return made;
}

/**
 * 확인 시각 → "3분 전"·"지금" 같은 로케일 표기. **새 i18n 키를 만들지 않는다** — 12개 로케일에 같은
 * 말을 12번 적어 두는 대신 `Intl.RelativeTimeFormat` 이 그 언어로 말한다. 모르는 시각이면 `null`.
 * 미래 시각(시계가 어긋난 PC)은 "지금"으로 접는다 — "3분 후에 확인했다"는 말이 되지 않는다.
 */
export function formatCheckedAgo(checkedAt: number | null | undefined, now: number, locale: string): string | null {
  if (typeof checkedAt !== 'number' || !Number.isFinite(checkedAt) || checkedAt <= 0) return null;
  const rtf = relativeFormatFor(locale);
  const seconds = Math.max(0, Math.round((now - checkedAt) / 1000));
  if (seconds < 45) return rtf.format(0, 'second');
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return rtf.format(-minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (hours < 24) return rtf.format(-hours, 'hour');
  return rtf.format(-Math.round(hours / 24), 'day');
}

/** 바꾼 값이 **언제부터** 먹는가 — 갈래마다 답이 다르다. */
export type ModelSectionApplyTiming =
  /** 헤드리스 클로드 — 다음 턴부터(놀던 지속 자식은 새 모델로 갈아 끼운다). */
  | 'nextTurn'
  /** CMD(임베디드 터미널) — "+" 로 연 새 세션부터(이미 떠 있는 터미널은 그대로). */
  | 'newSession'
  /** 코덱스 — 다음 메시지부터(코덱스 쪽 기존 안내문). */
  | 'codex'
  /** 로컬 — 모델 칸의 도움말이 이미 말한다. 따로 적지 않는다. */
  | null;

export function modelSectionApplyTiming(input: {
  isLocal: boolean;
  isCodex: boolean;
  isCmdAgent: boolean;
}): ModelSectionApplyTiming {
  if (input.isLocal) return null;
  if (input.isCodex) return 'codex';
  return input.isCmdAgent ? 'newSession' : 'nextTurn';
}
