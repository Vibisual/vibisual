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
  /** [최대화]. 폰의 풀스크린 모달에서는 눌러도 달라지는 것이 없다. */
  showMaximize: boolean;
}

/** 타이틀바에 무엇을 그릴지 — 순수 판정(렌더 부작용 없음). */
export function resolveTitleBarChrome({
  narrow,
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
    // 붙어 있으면 폰에서도 남긴다 — 이 메뉴가 유일한 [떼기] 진입로다.
    showDockMenu: !fullWindow && !disableDock && (!narrow || isDocked),
    showCollapse: !fullWindow && !phoneFullScreen,
    showMaximize: !fullWindow && !phoneFullScreen,
  };
}
