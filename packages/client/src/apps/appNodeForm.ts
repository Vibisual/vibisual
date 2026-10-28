import { APP_NODE_RESIZE, type AppBubble } from '@vibisual/shared';

import type { InternalApp } from './registry.js';

/**
 * §5.4 #36 (F) — 앱 노드 형태 판정 한 벌: `nameplate`(놓아 둔 물건) · `screen`(이어졌거나 결과를 담은 위성 — 커져서 결과를 비춘다).
 * 파생이라 영속 칸이 없고, 그리는 쪽과 옮기는 쪽(잇기·끊기의 가운데 지키기)이 같은 판정을 쓴다.
 * (G) 크기는 형태에 붙는다(`AppBubble.sizedForm`) — 같은 형태일 때만 저장 width/height 를 믿는다(그 밖은 생성 때 선언값일 뿐).
 */
export type AppNodeForm = 'nameplate' | 'screen';

export interface NodeSize {
  readonly width: number;
  readonly height: number;
}

/** 크기 판정에 필요한 칸 — 저장된 크기와 그 크기를 정한 형태. */
export type SizedBubble = Pick<AppBubble, 'width' | 'height' | 'sizedForm'>;

export interface AppNodeResizeBounds {
  readonly minWidth: number;
  readonly minHeight: number;
  readonly maxWidth: number;
  readonly maxHeight: number;
}

/** §5.13 (L) — `ref` 가 묶인 노드도 화면이다(앱이 `faceShowsRef` 로 문서를 그린다 — 안 그리는 앱은 빈 화면에 "결과가 여기 뜹니다"). */
export function appNodeForm(b: Pick<AppBubble, 'linkedAgentIds' | 'file' | 'ref'>): AppNodeForm {
  const linked = (b.linkedAgentIds ?? []).length > 0;
  const holds = typeof b.file === 'string' && b.file !== '';
  const bound = typeof b.ref === 'string' && b.ref !== '';
  return linked || holds || bound ? 'screen' : 'nameplate';
}

/** §5.4 #36 (G) — 그 형태의 크기 조절 한도(손잡이와 렌더가 같은 값으로 자른다). */
export function appNodeResizeBounds(form: AppNodeForm): AppNodeResizeBounds {
  return form === 'screen'
    ? {
        minWidth: APP_NODE_RESIZE.screenMinWidth,
        minHeight: APP_NODE_RESIZE.screenMinHeight,
        maxWidth: APP_NODE_RESIZE.maxWidth,
        maxHeight: APP_NODE_RESIZE.maxHeight,
      }
    : {
        minWidth: APP_NODE_RESIZE.nameplateMinWidth,
        minHeight: APP_NODE_RESIZE.nameplateMinHeight,
        maxWidth: APP_NODE_RESIZE.maxWidth,
        maxHeight: APP_NODE_RESIZE.maxHeight,
      };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * 렌더 치수: 이 형태에서 정한 크기면 저장값(형태 한도로 자른다 — 손으로 고친 체크포인트도 화면을 덮지 않게), 아니면 선언값.
 * 등록되지 않은 앱은 저장값 — 경고 버블이 자리를 잃지 않게.
 */
export function appNodeSize(
  app: Pick<InternalApp, 'defaultSize' | 'screenSize'> | undefined,
  form: AppNodeForm,
  stored: SizedBubble,
): NodeSize {
  if (!app) return { width: stored.width, height: stored.height };
  if (stored.sizedForm === form && Number.isFinite(stored.width) && Number.isFinite(stored.height)) {
    const b = appNodeResizeBounds(form);
    return { width: clamp(stored.width, b.minWidth, b.maxWidth), height: clamp(stored.height, b.minHeight, b.maxHeight) };
  }
  return form === 'screen' ? app.screenSize : app.defaultSize;
}

/** 크기가 바뀔 때 가운데를 지키는 새 좌상단(같으면 `null`) — React Flow 노드는 좌상단에 붙어 자라 그대로 두면 오른쪽 아래로만 부푼다(#36 (A) 와 같은 규칙). */
export function centerKeepingMove(
  pos: { readonly x: number; readonly y: number },
  from: NodeSize,
  to: NodeSize,
): { x: number; y: number } | null {
  if (from.width === to.width && from.height === to.height) return null;
  return { x: pos.x + (from.width - to.width) / 2, y: pos.y + (from.height - to.height) / 2 };
}

/** 형태가 바뀌면 옮길 자리(그대로면 `null`). `after` 는 연결·파일 칸만 본다 — 좌표·크기·정한 형태는 `before` 의 것(잇기·끊기는 그 칸을 안 바꾼다). */
export function formChangeMove(
  app: Pick<InternalApp, 'defaultSize' | 'screenSize'> | undefined,
  before: Pick<AppBubble, 'x' | 'y' | 'width' | 'height' | 'sizedForm' | 'linkedAgentIds' | 'file' | 'ref'>,
  after: Pick<AppBubble, 'linkedAgentIds' | 'file' | 'ref'>,
): { x: number; y: number } | null {
  const fromForm = appNodeForm(before);
  const toForm = appNodeForm(after);
  if (fromForm === toForm) return null;
  return centerKeepingMove(before, appNodeSize(app, fromForm, before), appNodeSize(app, toForm, before));
}

/**
 * §5.4 #36 (G) — [기본 크기로] 가 옮길 자리. 정한 크기를 걷고 선언 크기로 돌아가되 가운데를 지킨다.
 * 지금 형태에서 정한 크기가 없으면(걷을 것이 없으면) `null`.
 */
export function resetSizeMove(
  app: Pick<InternalApp, 'defaultSize' | 'screenSize'> | undefined,
  b: Pick<AppBubble, 'x' | 'y' | 'width' | 'height' | 'sizedForm' | 'linkedAgentIds' | 'file' | 'ref'>,
): { x: number; y: number } | null {
  const form = appNodeForm(b);
  if (!app || b.sizedForm !== form) return null;
  const from = appNodeSize(app, form, b);
  const to = appNodeSize(app, form, { width: b.width, height: b.height });
  return centerKeepingMove(b, from, to) ?? { x: b.x, y: b.y };
}

/** 지금 형태에서 사용자가 정한 크기가 있는가 — 메뉴의 [기본 크기로] 를 띄울지. */
export function hasUserSize(b: Pick<AppBubble, 'sizedForm' | 'linkedAgentIds' | 'file' | 'ref'>): boolean {
  return b.sizedForm !== undefined && b.sizedForm === appNodeForm(b);
}
