/**
 * IDE 타이틀바 손잡이 노출 규칙 — **폰 폭에서 무엇을 접고 무엇을 남길지** 한 곳에서 정한다.
 *
 * 왜 함수로 빼는가: 타이틀바 한 줄에 손잡이가 아홉 개까지 늘어나면서, 폰 폭(360~430px)에서는
 * 줄이 넘쳐 **맨 오른쪽 [닫기]가 화면 밖으로 밀려났다**(사용자 보고 — "ide창 닫는 게 안 보여").
 * 어떤 손잡이를 접을지는 창의 모드(모달·도킹·떠 있음)마다 답이 다르므로, JSX 안에 조건을
 * 흩어 두면 한쪽만 고쳐져 **폰에서 창에 갇히는 조합**(붙어 있는데 [떼기]가 사라짐)이 생긴다.
 * 규칙을 여기 한 벌만 두고 단위 테스트로 고정한다.
 *
 * 접는 기준은 "폰에서 그 손잡이가 **하는 일이 없거나**, 같은 일을 하는 다른 손잡이가 이미
 * 있는가" 하나다. 정보를 없애지 않는다 — 접힌 것들은 전부 다른 자리(하단 상태바 토글·세션 탭)에
 * 그대로 남는다.
 */
export interface TitleBarChromeInput {
  /** 폰 폭(`useIsNarrowViewport`, max-width: 767px). 데스크톱은 항상 false → 화면 불변. */
  narrow: boolean;
  /**
   * 터치 기기(굵은 포인터 — `useCoarsePointer`). 창 끌기·변 끌기·도킹 두께 손잡이가 전부 마우스 이벤트라
   * 손가락으로는 떠 있는 창을 옮기지도, 도킹 두께를 바꾸지도 못한다. 그래서 폭이 넓은 태블릿이어도 폰과 같이
   * [붙이기/떼기] 를 **붙어 있을 때만**(나올 길) 남긴다 — 창은 모달로 선다(`AgentIDEOverlay` 가 떠 있는 창을 모달로 둔다).
   * 생략하면 false(마우스 기기 — 종전 그대로).
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
   * [최대화]. 폰의 풀스크린 모달에서는 눌러도 달라지는 것이 없다.
   *
   * §17-6 (H-5) — **독립 창에서는 남긴다.** 종전에는 "창 조작은 OS 몫"이라며 접었는데, 그 창은
   * `frame:false + transparent` 라 OS 타이틀바도 시스템 최대화도 없다(Windows 는 투명 창의
   * 시스템 최대화를 막는다). 접어 두면 창을 키우는 길이 **네 변을 손으로 끄는 것뿐**이 된다.
   * 그 창에서 이 버튼이 다루는 것은 in-window 크기가 아니라 **OS 창**이다.
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
 * 터치 기기에서 창이 실제로 설 모양 — **떠 있는 창은 모달로 선다.**
 *
 * 떠 있는 창은 제목줄 끌기·여덟 변 끌기로만 옮기고 늘리는데, 그 손잡이가 전부 마우스 이벤트라 손가락으로는
 * 꼼짝도 하지 않는다(창이 둘 이상이면 저절로 떠 있는 창이 되므로 고르지 않아도 그렇게 된다). 앱 창·캡처 창이
 * 터치에서 화면 전체로 고정되는 것(`useFloatingWindowFullScreenLock`)과 같은 결이다. 붙은 창은 그대로 둔다 —
 * [떼기] 로 나올 길이 남아 있고(뗀 창은 여기서 다시 모달이 된다), 자리를 비운 캔버스 여백도 그 창이 쥐고 있다.
 * 독립 창(`fullWindow`)은 이 판정 밖이다 — 그 창의 크기와 자리는 OS 창의 몫이다.
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
