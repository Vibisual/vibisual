/**
 * §5.5 #17-6 — 밖에 선 IDE 창의 닫기 규칙(단독 소유). 출신((A) 위젯 버블·(H-4) 끌어낸 창)도 버블로 바꾼 이력도 뜻을 바꾸지 않는다.
 * · ✕ / Esc 는 닫는다 — 닫기까지 버블로 가면 같은 일을 하는 손잡이가 둘이 된다.
 * · 버블로 접히는 것은 [오버레이 버블로 바꾸기]뿐 — 그도 `closeIDEOverlay()` 로 접으므로 셸이 한 번짜리 표식을 먼저 세우고 미러 효과가 곧바로 내린다.
 * · 닫기 전 `revealInMain({ openIde: false, keepPanes: true })`(열면 닫기를 두 번 눌러야 한다). 받아 주지 못해도 닫는다.
 * · 접기로 물러나는 것은 `closeSelf` 가 없는 옛 preload 뿐이다.
 */

/** 닫기를 눌렀을 때 이 창이 할 일. */
export type OverlayCloseIntent =
  /** 버블로 접는다(창은 남는다) — [오버레이 버블로 바꾸기]의 부탁이거나, 닫을 길이 없을 때의 물러남. */
  | 'collapse'
  /** 창을 닫는다(닫기 전에 (H-9) 대로 앱을 앞으로 끌어올린다). */
  | 'close';

export interface OverlayCloseContext {
  /** 이번 접힘이 [오버레이 버블로 바꾸기]에서 왔는가 — 셸이 세우고 미러 효과가 곧바로 내리는 한 번짜리 표식(그 뒤의 닫기엔 영향 없음). */
  toBubble: boolean;
  /** 창을 닫는 길이 이 창에 있는가(`window.api.overlay.closeSelf`). 없으면 접기로 물러난다. */
  canCloseSelf: boolean;
}

/**
 * 닫기의 뜻을 정한다. 순수 함수라 세 갈래(버블 부탁·닫기·닫을 길 없음)를 DOM 없이 고정한다.
 * 출신(`initiallyExpanded`)은 입력에 **없다** — 닫기의 뜻을 바꾸지 않는 것은 받지 않는다.
 */
export function resolveOverlayCloseIntent(ctx: OverlayCloseContext): OverlayCloseIntent {
  if (ctx.toBubble) return 'collapse';      // [오버레이 버블로 바꾸기] — 이번 접힘만 버블로
  if (!ctx.canCloseSelf) return 'collapse'; // 닫을 다리가 없다 — 남는 쪽으로 물러난다
  return 'close';                           // ✕ / Esc — 닫는다(출신·이력 무관)
}
