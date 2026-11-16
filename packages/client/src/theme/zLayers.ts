/**
 * 겹침 층 표(SSOT §4 「겹침 층 표」) — 뿌리(body) 수준에 서는 것의 앞뒤는 여기서만 정한다. 뒤에 적힌 층이 앞에 선다.
 * `fixed` 로 서는 것은 전부 이 표의 이름을 쓴다(`zLayerGuard.test.ts` 가 막는다). 표 밖은 부모 안에서만 도는 작은 수(`absolute`·`relative`)뿐이다.
 * ⚠ Tailwind 이름표(`z-dialog` 등)는 `index.css` `@theme` 의 `--z-index-*` — 값을 바꾸면 함께 바꾼다(`zLayers.test.ts` 대조).
 */
export const Z_LAYER = {
  /** 캔버스에서 끄는 선·미리보기 — 화면 층. */
  CANVAS_DRAG: 30,
  /** IDE 창 겹침의 바닥(창마다 한 칸씩). 전체화면 IDE·보드보다 아래여야 그 위에 설정창이 선다. */
  IDE_PANE: 40,
  /** 전체화면 IDE 오버레이. */
  IDE: 50,
  /** 전체화면 보드(콘티·랩·선반·스펙). */
  BOARD: 55,
  /** 앱 안 창 스택의 바닥 — 누른 창이 여기서부터 단조 증가한다. */
  WINDOW: 1_000_000,
  /** 사용자가 연 모달·팝업. */
  DIALOG: 100_000_000,
  /** 모달 위에 겹쳐 뜨는 확인·하위 팝업. */
  DIALOG_OVER: 100_001_000,
  /** 사용량 팝업 — 사용자가 연 것 가운데 맨 위. */
  USAGE: 100_002_000,
  /** 사용량 팝업 위에 겹치는 것(비용 지도). */
  USAGE_OVER: 100_003_000,
  /** 앱 헤더 — 모달 백드롭에 덮이지 않아야 창 조작이 살아 있다. 앱 안 창은 헤더 아래에서만 움직인다. */
  HEADER: 150_000_000,
  /** 헤더까지 덮는 전면 덮개. */
  OVERLAY: 160_000_000,
  /** 이미지 크게 보기. */
  LIGHTBOX: 160_001_000,
  /** 권한 요청 — 에이전트가 멈춰 기다리므로 사용자가 연 것에 가려지면 안 된다. 스택은 `+i`. */
  PERMISSION: 200_000_000,
  /** 온보딩·차단 게이트 — 앞선 질문일수록 위. 폴더·버전·업데이트 확인. */
  GATE: 300_000_000,
  GATE_LOGIN: 300_000_100,
  GATE_SETUP: 300_000_200,
  GATE_ENGINE: 300_000_300,
  /** 게이트 안 링크가 실패했을 때의 안내 — 그 게이트 위여야 보인다. */
  GATE_NOTICE: 300_000_350,
  /** 게이트 위로 띄운 헤더 언어 전환기. */
  GATE_LANGUAGE: 300_000_400,
  /** 잠깐 뜨는 것 — 어느 층에서 열어도 그 위에 보여야 한다. 메뉴·드롭다운(하위 메뉴는 `+1`). */
  MENU: 1_000_000_000,
  TOAST: 1_000_001_000,
  TOOLTIP: 1_000_002_000,
  /** 끌기 미리보기. */
  DRAG: 1_000_003_000,
  IMMERSIVE_EXIT: 1_900_000_000,
  /** 앱 공용 알림·확인 대화상자. */
  APP_DIALOG: 2_000_000_000,
  STUDIO_POPOVER: 2_100_000_000,
  /** 창 밖으로 끄는 카드의 잔상 — Alt 인스펙터 덮개(CSS 상한) 바로 아래. */
  DRAG_GHOST: 2_147_483_000,
} as const;

export type ZLayerName = keyof typeof Z_LAYER;

/** Tailwind `z-*` 이름표로도 쓰는 층 — `index.css` `@theme` 에 같은 값이 있어야 한다. */
export const Z_LAYER_CLASS_TOKENS: Record<string, ZLayerName> = {
  'canvas-drag': 'CANVAS_DRAG',
  ide: 'IDE',
  board: 'BOARD',
  dialog: 'DIALOG',
  'dialog-over': 'DIALOG_OVER',
  usage: 'USAGE',
  'usage-over': 'USAGE_OVER',
  header: 'HEADER',
  overlay: 'OVERLAY',
  lightbox: 'LIGHTBOX',
  menu: 'MENU',
  toast: 'TOAST',
  tooltip: 'TOOLTIP',
  drag: 'DRAG',
};
