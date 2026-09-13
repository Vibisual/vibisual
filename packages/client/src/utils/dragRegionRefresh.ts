/**
 * dragRegionRefresh.ts — **창을 다시 잡을 수 있게 만드는 재신고의 판정부**(순수).
 *
 * ## 왜 필요한가 (사용자 보고 — "최소화하거나 앱이 새로 켜지면 간헐적으로 헤더를 잡고 못 옮긴다")
 *
 * OS 가 아는 "여기를 잡으면 창이 움직인다"는 **CSS 가 아니라 렌더러가 신고한 사각형 목록**이다.
 * Chromium 은 그 목록을 라이프사이클 끝에서 계산해 **직전과 달라졌을 때만** 브라우저 프로세스로
 * 보낸다(`LocalFrameView::UpdateDocumentAnnotatedRegions`). 그래서 창이 숨었다 돌아오는 사이에
 * 그 신고를 한 번 놓치면(빈 목록으로 굳거나 아예 도착하지 못하면) **헤더는 정적이라 다시 신고할
 * 계기가 영영 오지 않는다** — CSS 는 그대로 `app-drag` 인데 OS 만 모르는 상태로 남는다.
 *
 * 증상이 그 모양이라는 근거: 사용자는 그때 **인스펙터로 헤더 안쪽 요소를 집어** 보고했다.
 * 인스펙터는 `document` 의 `mousemove` 로 커서 밑을 찾는데(`useInspector`), 그 자리가 드래그
 * 영역으로 등록돼 있으면 Windows 는 그 지점을 캡션(HTCAPTION)으로 판정해 **마우스 이벤트를
 * 렌더러에 주지 않는다.** 집혔다는 것은 곧 그 순간 그 자리가 드래그 영역이 아니었다는 뜻이다.
 *
 * ## 그래서 무엇을 하나
 *
 * 창이 다시 보이는 순간마다 드래그 영역을 **일부러 한 번 바꿨다 되돌려** 신고를 강제한다.
 * 이 파일은 그 왕복 중 DOM 에 닿지 않는 부분만 들고 있다 — 실제 토글·구독은
 * `dragRegionKeepalive.ts` 가 맡는다(`rendererFlushPlan` ↔ `rendererFlush` 와 같은 문법).
 *
 * ## 정확성 규약
 *  1. **숨어 있는 창에는 하지 않는다** — 토글은 두 번의 라이프사이클(rAF 두 판)을 지나야 완성되는데
 *     숨은 창에서는 그 판이 돌지 않는다. 보일 때 다시 하면 되고, 그게 이 기능의 계기 그 자체다.
 *  2. **손이 눌려 있는 동안에는 하지 않는다** — 진행 중인 손짓 위에서 영역을 흔들지 않는다.
 *     뗀 뒤에 한 번 하면 늦지 않다(놓친 신고는 다음 계기까지 남아 있는 성질의 것이다).
 *  3. **되돌리기에는 반드시 시간 그물이 있다** — 바꾼 값을 되돌리지 못하면 그 창은 *영영* 안
 *     움직인다(지금 증상보다 나쁘다). rAF 가 오지 않는 경우를 위해 상한이 필요하다.
 *  4. **못 한 것은 버리지 않는다** — 타이틀바가 아직 안 그려져서 흔들 대상이 없었던 것도 "못 한
 *     것"이다. 이것을 조용히 흘리면 첫 기동의 되짚기가 전부 빈 문서 위에서 돌고 끝난다.
 *
 * ## 그래도 어긋나면 — 증상 자체를 신호로 쓴다 (판올림 번호 발급 대기)
 *
 * 위 계기들은 전부 "이쯤이면 어긋났을 것"이라는 **추측**이다. 추측이 빗나가면 사용자가 그 창을
 * 못 움직이는데 우리는 그것을 모른다. 그래서 어긋남을 **직접 관측**하는 길을 하나 더 둔다 —
 * 드래그 영역 위에서 손짓이 렌더러에 도착하면 그 자리는 지금 캡션이 아니다(`shouldHealCaptionMiss`).
 * 사용자의 손이 타이틀바에 닿는 그 순간에 스스로 되살아나므로, 첫 기동이 아무리 늦어도 첫 손짓
 * 전에는 제자리로 돌아온다.
 */

/** 재신고를 부르는 계기. 어느 것이든 "창이 다시 보이게 됐다"는 같은 말이다. */
export type DragRegionRefreshReason =
  /** 창이 처음 떠서 문서가 막 마운트됐다(첫 기동에서 놓친 경우). */
  | 'mount'
  /** 타이틀바가 **이제 막 그려졌다** — 시각 되짚기(`mount`)가 전부 그 전에 끝났을 수 있다. */
  | 'appear'
  /** 문서가 다시 보인다(최소화 복원 · 다른 창에 완전히 가려졌다 돌아옴). */
  | 'visible'
  /** 이 창이 키보드 포커스를 받았다. */
  | 'focus'
  /** main 이 창 상태 전이(show·restore·maximize …)를 알려 왔다. */
  | 'window-state'
  /** 눌려 있어 미뤄 두었던 것을 손을 뗀 지금 처리한다(규약 2). */
  | 'pointer-release'
  /** 드래그 영역 위인데 손짓이 **렌더러에 도착했다** — 그 자리가 지금 OS 캡션이 아니라는 증거. */
  | 'caption-miss';

/**
 * 타이틀바가 그려질 때까지 되짚는 간격(ms)과 그 상한(ms).
 *
 * `DRAG_REGION_REFRESH_DELAYS_MS` 만으로는 부족한 경우가 실제로 있다 — 그 시각들은 **부팅
 * 지점(모듈 로드)** 기준인데, 첫 기동의 렌더러는 i18n·스토어 복원·전송로 설치를 먼저 하므로
 * 헤더가 3초보다 늦게 그려질 수 있다. 그러면 네 번의 되짚기가 **전부 빈 문서 위에서** 돌아
 * 아무것도 하지 못하고, 그 뒤 창은 이미 보이고 포커스도 받은 상태라 다른 계기도 오지 않는다.
 * 결과가 곧 사용자 보고다 — "방금 앱을 열었는데 헤더를 잡아도 창이 안 움직인다".
 *
 * 그래서 **찾을 때까지** 되짚되, 찾으면 즉시 멈춘다(상한을 넘기면 다른 계기에 맡기고 포기한다).
 */
export const DRAG_REGION_SIGHTING_POLL_MS = 200;
export const DRAG_REGION_SIGHTING_TIMEOUT_MS = 20_000;

/**
 * 캡션 어긋남을 다시 되살리기까지의 최소 간격(ms).
 *
 * 되살리기는 두 프레임 동안 그 자리를 `no-drag` 로 두므로, 손이 타이틀바 위를 오갈 때마다
 * 무제한으로 돌면 우리가 고치려는 그 손짓을 우리가 끊는다. 한 번 되살린 뒤에는 이 시간만큼
 * 쉬고, 그래도 안 잡히면 다음 번 손짓에서 다시 시도한다.
 */
export const DRAG_REGION_CAPTION_MISS_COOLDOWN_MS = 1500;

export interface DragRegionCaptionMissInput {
  /** 이 창의 드래그 영역이 실제로 OS 에 걸리는 환경인가(= 데스크톱 앱). */
  osBacked: boolean;
  /** 손짓이 도착한 자리가 드래그 영역인가(`app-nodrag` 로 되돌린 자리는 아니다). */
  overDragRegion: boolean;
  /** 지금 손이 눌려 있는가(규약 2). */
  pointerDown: boolean;
  /** 마지막 되살림으로부터 지난 시간(ms). */
  sinceLastHealMs: number;
}

/**
 * 지금 도착한 손짓이 **캡션 어긋남의 증거**이고, 지금 그것을 되살려도 되는가.
 *
 * 근거는 이 파일 맨 위에 적힌 것과 같다 — 드래그 영역으로 등록된 자리는 Windows 가 캡션으로
 * 판정해 마우스 이벤트를 렌더러에 주지 않는다. 그러므로 **드래그 영역 위에서 손짓이 우리에게
 * 왔다는 것 자체가** 그 순간 OS 가 그 자리를 모른다는 뜻이다. 이보다 정확한 신호는 없다:
 * 증상이 일어나는 바로 그 순간에만 켜지고, 정상일 때는 영영 켜지지 않는다.
 *
 * 웹/브라우저에는 캡션이 아예 없어 손짓이 오는 것이 정상이므로(`osBacked === false`) 이 판정을
 * 걸지 않는다 — 걸면 헤더 위를 지나갈 때마다 영원히 흔들게 된다.
 */
export function shouldHealCaptionMiss(input: DragRegionCaptionMissInput): boolean {
  if (!input.osBacked) return false;
  if (!input.overDragRegion) return false;
  if (input.pointerDown) return false;
  return input.sinceLastHealMs >= DRAG_REGION_CAPTION_MISS_COOLDOWN_MS;
}

/**
 * 첫 마운트 뒤 **다시 확인하는 시각**(ms).
 *
 * 첫 기동은 창이 뜨는 것과 React 가 헤더를 그리는 것이 겹치는 유일한 구간이라 신고가 가장 잘
 * 어긋난다. 한 번 더 두드리는 값이 싸므로(두 프레임) 몇 지점에서 되짚는다. 3초를 넘겨 붙이지
 * 않는다 — 그때까지 안 잡혔으면 계기가 다른 데 있는 것이고, 늦은 토글은 사용자의 첫 손짓과
 * 겹칠 수 있다.
 */
export const DRAG_REGION_REFRESH_DELAYS_MS: readonly number[] = [0, 250, 1000, 3000];

/**
 * 토글이 지나가는 값 — 지금 값과 **반드시 달라야** 신고가 나간다.
 *
 * `no-drag` 를 고르는 까닭: 이 두 프레임 동안 그 자리는 "창 이동 영역이 아님"이 되는데, 그것이
 * 실패했을 때 남는 상태로도 **덜 위험하다**(클릭은 살아 있다). 반대로 `drag` 로 흔들면 실패한
 * 자리가 통째로 캡션이 되어 그 안의 버튼이 전부 죽는다.
 */
export const DRAG_REGION_TOGGLE_VALUE = 'no-drag';

/**
 * 토글하는 동안 손대는 CSS 속성 이름들.
 *
 * `index.css` 의 `.app-drag` 가 두 이름을 함께 적는 것과 같은 이유다 — 접두사 없는 표준 이름을
 * 이미 쓰는 엔진이 있고, 한쪽만 흔들면 그 엔진에서는 값이 안 바뀌어 신고가 나가지 않는다.
 */
export const DRAG_REGION_CSS_PROPS: readonly string[] = ['-webkit-app-region', 'app-region'];

/**
 * 되돌리기 시간 그물(ms) — 규약 3.
 *
 * 정상 경로(rAF 두 판)는 두 프레임이면 끝난다. 이 값은 그 길이 막혔을 때만 쓰이는 상한이라
 * 넉넉해도 되지만, 그동안 그 자리가 `no-drag` 라 창이 안 움직이므로 짧아야 한다.
 */
export const DRAG_REGION_RESTORE_TIMEOUT_MS = 400;

export interface DragRegionRefreshInput {
  /** 지금 이 문서가 보이는가(`document.visibilityState === 'visible'`). */
  visible: boolean;
  /** 지금 손이 눌려 있는가(우리 문서가 아는 범위에서). */
  pointerDown: boolean;
}

/**
 * 지금 재신고를 해도 되는가 — 규약 1·2.
 *
 * 거짓이면 **버리는 것이 아니라 미루는 것**이다. 부르는 쪽은 다음 계기(보임·뗌)에 다시 묻는다.
 */
export function shouldRepaintDragRegions(input: DragRegionRefreshInput): boolean {
  if (!input.visible) return false;
  if (input.pointerDown) return false;
  return true;
}

/**
 * 지금 못 했을 때 **미뤄 둘 것인가**.
 *
 * 숨어 있거나 눌려 있어서 못 한 것은 곧 다시 계기가 오므로 미뤄 둔다. 그 밖의 이유는 없다 —
 * 이 함수가 `shouldRepaintDragRegions` 의 여집합인 것은 그래서다(둘을 한 이름으로 합치지 않는
 * 까닭은 부르는 쪽에서 "지금 한다 / 다음에 한다"가 서로 다른 일이기 때문이다).
 */
export function shouldDeferDragRegionRepaint(input: DragRegionRefreshInput): boolean {
  return !shouldRepaintDragRegions(input);
}
