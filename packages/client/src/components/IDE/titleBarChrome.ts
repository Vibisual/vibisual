/**
 * IDE 타이틀바 손잡이 노출 규칙 — 폰 폭(360~430px)에서 무엇을 접을지 한 곳에서 정한다(넘치면 [닫기]가 화면 밖으로 밀린다).
 * 창 모드마다 답이 달라 JSX 에 흩으면 폰에서 창에 갇히는 조합(붙었는데 [떼기]가 없음)이 생긴다.
 * 기준: 폰에서 하는 일이 없거나 같은 일을 하는 손잡이가 있는가. 접힌 것은 다른 자리(하단 상태바·세션 탭)에 남는다.
 */
export interface TitleBarChromeInput {
  /** 폰 폭(`useIsNarrowViewport`, max-width: 767px). 데스크톱은 항상 false → 화면 불변. */
  narrow: boolean;
  /**
   * 터치 기기(`useCoarsePointer`) — 끌기 손잡이가 전부 마우스 이벤트라, 넓은 태블릿이어도 [붙이기/떼기]는 붙어 있을 때만 남기고 떠 있는 창은 모달로 선다.
   * 생략하면 false(마우스 기기).
   */
  touch?: boolean;
  /** 모달 모드 — 폰에서는 이미 헤더 아래 전체를 채우는 풀스크린이다(max-md 분기). */
  isModal: boolean;
  /** 어느 변에 붙어 있는가 — 붙어 있으면 폰에서도 [떼기] 로 나올 길이 있어야 한다. */
  isDocked: boolean;
  /** 오버레이 창(창 하나가 통째로 IDE) — 창 조작은 OS 몫이라 애초에 대부분 안 그린다. */
  fullWindow: boolean;
  /** 이 창에서 도킹 자체가 꺼져 있는가. */
  disableDock: boolean;
}

export interface TitleBarChrome {
  /**
   * 한 칸을 나눠 쓰는 **다른 창들**의 탭 줄. 이 줄은 붙어 있는(도킹) 창끼리 한 슬롯에 겹쳤을 때만
   * 생기고, 겹친 뒤쪽 창을 앞으로 꺼내는 **유일한 손잡이**다 — 그래서 폰에서도 붙어 있으면 남긴다.
   */
  showSlotTabs: boolean;
  /** `커스텀 / 훅 / CMD` 정체 뱃지. 같은 사실이 하단 상태바에 있고, 폰에선 이름 자리를 먹는다. */
  showTypeBadge: boolean;
  /** [붙이기/떼기] 메뉴. 폰에서는 **붙어 있을 때만** — 나올 길을 막지 않기 위해서다. */
  showDockMenu: boolean;
  /** [접기]. 폰의 풀스크린 모달에서는 [닫기]와 생김새·결과가 겹쳐 오히려 헷갈린다. */
  showCollapse: boolean;
  /**
   * [최대화]. 폰의 풀스크린 모달에선 하는 일이 없다. §17-6 (H-5) — **독립 창에선 남긴다**: `frame:false + transparent` 라 시스템 최대화가 없고
   * (Windows 는 투명 창의 시스템 최대화를 막는다) 접으면 키우는 길이 변 끌기뿐이다. 그 창에서 이 버튼은 OS 창을 다룬다.
   */
  showMaximize: boolean;
}

/** 타이틀바에 무엇을 그릴지 — 순수 판정(렌더 부작용 없음). */
export function resolveTitleBarChrome({
  narrow,
  touch = false,
  isModal,
  isDocked,
  fullWindow,
  disableDock,
}: TitleBarChromeInput): TitleBarChrome {
  // 폰의 풀스크린 모달 — "이미 창 전체" 라서 창 크기를 다루는 손잡이가 전부 무의미해지는 조합.
  const phoneFullScreen = narrow && isModal;
  return {
    // 겹쳐 있는 창을 꺼내는 유일한 길이라, 붙어 있는 동안에는 폰에서도 접지 않는다.
    showSlotTabs: !narrow || isDocked,
    showTypeBadge: !narrow,
    // 붙어 있으면 폰·터치에서도 남긴다 — 이 메뉴가 유일한 [떼기] 진입로다. 안 붙어 있으면 터치에서는 접는다 —
    //   붙이면 두께를 손으로 못 바꾸고, 떼면 손으로 못 옮기는 창이 된다.
    showDockMenu: !fullWindow && !disableDock && ((!narrow && !touch) || isDocked),
    showCollapse: !fullWindow && !phoneFullScreen,
    // 독립 창은 폭과 무관하게 남긴다 — 그 창에는 이것 말고 창을 키우는 길이 없다(H-5).
    showMaximize: fullWindow || !phoneFullScreen,
  };
}

/** IDE 창이 서는 모양 — `AgentIDEOverlay` 의 로컬 모드와 같은 세 값. */
export type IDEWindowMode = 'modal' | 'floating' | 'docked';

/**
 * 터치 기기에서 떠 있는 창은 모달로 선다(끌기 손잡이가 마우스 전용 — `useFloatingWindowFullScreenLock` 과 같은 결).
 * 붙은 창은 그대로([떼기]로 나올 길이 있다), 독립 창(`fullWindow`)은 판정 밖(OS 창의 몫).
 */
export function touchWindowMode(mode: IDEWindowMode, touch: boolean, fullWindow: boolean): IDEWindowMode {
  return touch && !fullWindow && mode === 'floating' ? 'modal' : mode;
}

/**
 * 창이 둘 이상일 때 모달을 저절로 떠 있는 창으로 풀어도 되는가(§5.5 #17-1 — 모달은 옆 창을 통째로 가린다).
 * 터치 기기에서는 풀지 않는다 — 풀면 손으로 못 옮기는 창이 되고, 위 판정이 곧바로 모달로 되돌려 두 규칙이 서로를 되감는다.
 */
export function autoFloatOnMultiPane(paneCount: number, touch: boolean): boolean {
  return paneCount > 1 && !touch;
}
