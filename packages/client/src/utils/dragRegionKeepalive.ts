/**
 * dragRegionKeepalive.ts — **드래그 영역 재신고의 배선부**(DOM · 구독).
 *
 * 판정·상한·계기 규약은 전부 `dragRegionRefresh.ts`(순수)에 있다 — 왜 필요한지도 그쪽에 적혀
 * 있다. 여기는 "언제 부르고 무엇을 만지는가"만 맡는다.
 *
 * **창 종류를 가리지 않아야 하므로 shell 안이 아니라 부팅 지점(`main.tsx`)에서 한 번만 설치한다** —
 * 타이틀바를 가진 창이 메인 하나가 아니다(별창 미니 타이틀바 · 지휘통제실 · 오버레이 위젯 ·
 * 내부 앱 셸이 전부 `.app-drag` 를 쓴다). shell 마다 붙이면 새 창이 늘어날 때 반드시 하나 빠진다.
 */

import { isPackagedDesktop } from '../transport/index.js';
import {
  DRAG_REGION_CSS_PROPS,
  DRAG_REGION_REFRESH_DELAYS_MS,
  DRAG_REGION_RESTORE_TIMEOUT_MS,
  DRAG_REGION_SIGHTING_POLL_MS,
  DRAG_REGION_SIGHTING_TIMEOUT_MS,
  DRAG_REGION_TOGGLE_VALUE,
  shouldHealCaptionMiss,
  shouldRepaintDragRegions,
  type DragRegionRefreshInput,
  type DragRegionRefreshReason,
} from './dragRegionRefresh.js';

/** 부팅 지점에서 한 번만 — 두 번 설치되면 토글이 겹쳐 돌아 신고가 서로를 지운다. */
let installed = false;
/** 지금 토글이 진행 중인가(되돌리기 전). */
let toggling = false;
/** 못 해서 미뤄 둔 요청이 있는가(규약 1·2). */
let deferred = false;
/** 우리 문서가 아는 범위에서 손이 눌려 있는가. */
let pointerDown = false;
/** 마지막으로 캡션 어긋남을 되살린 시각(ms) — 되살리기를 쉬게 하는 최소 간격의 기준. */
let lastCaptionHealAt = 0;

function currentInput(): DragRegionRefreshInput {
  return {
    visible: typeof document === 'undefined' || document.visibilityState === 'visible',
    pointerDown,
  };
}

/**
 * 드래그 영역을 **한 번 바꿨다 되돌린다** — 이 왕복이 곧 신고다.
 *
 * 왜 rAF 를 두 판 겹치는가: 첫 rAF 콜백은 그 프레임의 라이프사이클 **앞**에서 돈다. 같은 판에서
 * 넣고 빼면 계산된 최종 목록이 직전과 같아져 **Chromium 이 아무것도 보내지 않는다**(변한 것이
 * 없으니까). 한 판을 온전히 흘려보내야 `no-drag` 목록이 한 번 나가고, 되돌린 다음 판에서 제대로
 * 된 목록이 다시 나간다. 그 두 번째 신고가 우리가 원하는 것이다.
 *
 * 반환값은 **실제로 흔들었는가**다. 흔들 대상이 없었던 것도 "못 한 것"이므로 부르는 쪽이 미뤄
 * 둘 수 있어야 한다(규약 4) — 조용히 흘리면 첫 기동의 되짚기가 전부 빈 문서 위에서 끝난다.
 */
function toggleOnce(): boolean {
  if (toggling) return false;
  const els = Array.from(document.querySelectorAll<HTMLElement>('.app-drag'));
  if (els.length === 0) return false; // 아직 타이틀바가 안 그려졌다 — 미뤄 두고 다음 계기에 다시.

  toggling = true;
  for (const el of els) {
    for (const prop of DRAG_REGION_CSS_PROPS) el.style.setProperty(prop, DRAG_REGION_TOGGLE_VALUE);
  }

  let restored = false;
  const restore = (): void => {
    if (restored) return;
    restored = true;
    toggling = false;
    for (const el of els) {
      for (const prop of DRAG_REGION_CSS_PROPS) el.style.removeProperty(prop);
    }
  };

  requestAnimationFrame(() => requestAnimationFrame(restore));
  // 규약 3 — rAF 가 오지 않는 경우의 시간 그물. 되돌리지 못하면 그 창은 영영 안 움직인다.
  window.setTimeout(restore, DRAG_REGION_RESTORE_TIMEOUT_MS);
  return true;
}

/**
 * "지금 드래그 영역을 다시 신고해라." 못 하는 형편이면 **버리지 않고 미룬다**(다음 계기에 처리).
 *
 * 표시 전용이라 어떤 실패도 삼킨다 — 이 왕복이 실패해도 앱은 종전과 똑같이 돌아간다.
 */
export function refreshDragRegions(reason: DragRegionRefreshReason): void {
  void reason; // 계기는 읽는 사람을 위한 것 — 동작은 형편(보임·눌림)만 본다.
  try {
    if (!shouldRepaintDragRegions(currentInput())) {
      deferred = true;
      return;
    }
    // 규약 4 — 흔들 대상이 아직 없었으면 그것도 "못 한 것"이다(다음 계기에 다시 온다).
    deferred = !toggleOnce();
  } catch { /* 표시 전용 — 실패해도 앱은 그대로 간다 */ }
}

/**
 * 이 손짓이 도착한 자리가 **드래그 영역인가** — `app-nodrag` 로 되돌린 자리는 아니다.
 *
 * 되돌린 자리는 원래 손짓이 오는 곳이므로 어긋남의 증거가 될 수 없다. 판정은 CSS 가 쓰는 그
 * 두 이름 그대로 본다 — 다른 기준을 세우면 CSS 와 갈라져 조용히 어긋난다.
 */
function isDragRegionTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const region = target.closest('.app-drag, .app-nodrag');
  return region !== null && region.classList.contains('app-drag');
}

/**
 * 계기들을 건다. 반환값은 해제 함수(테스트·미래의 재설치용). 두 번 불러도 한 번만 설치된다.
 *
 * 계기에 `resize`·`move` 는 **일부러 없다**:
 *  - `resize` 는 레이아웃이 실제로 바뀌므로 Chromium 이 알아서 새 목록을 보낸다(우리가 할 일 없음).
 *  - `move` 는 **창을 끌고 있는 그 순간**에 쏟아진다 — 그때 영역을 흔들면 우리가 고치려는 바로 그
 *    손짓을 우리가 방해한다.
 *
 * 계기는 두 부류다. 위의 창 상태 전이들은 "이쯤이면 어긋났을 것"이라는 **추측**이고,
 * `pointerover`/`pointerdown` 은 어긋남을 **직접 본** 것이다(드래그 영역 위인데 손짓이 우리에게
 * 왔다 = 그 자리가 지금 캡션이 아니다). 추측이 전부 빗나가도 사용자의 손이 타이틀바에 닿는
 * 순간 뒤쪽이 되살린다 — 첫 기동이 아무리 늦어도 첫 손짓 전에는 제자리가 된다.
 */
export function installDragRegionKeepalive(): () => void {
  if (installed) return () => { /* 이미 설치됨 — 해제는 첫 설치자의 몫 */ };
  installed = true;

  // 웹/브라우저에는 캡션이 없어 타이틀바 위의 손짓이 오는 것이 정상이다 — 그쪽에서는 어긋남
  // 관측을 걸지 않는다(걸면 헤더 위를 지날 때마다 영원히 흔든다).
  const osBacked = (() => {
    try { return isPackagedDesktop(); } catch { return false; }
  })();

  const onVisibility = (): void => {
    if (document.visibilityState !== 'visible') return;
    refreshDragRegions('visible');
  };
  const onFocus = (): void => refreshDragRegions('focus');
  const onPointerDown = (e: PointerEvent): void => {
    pointerDown = true;
    // 드래그 영역을 **누른 손짓이 우리에게 왔다** = 그 자리는 지금 캡션이 아니다. 지금은 눌려
    // 있어 흔들 수 없으므로(규약 2) 미뤄 두었다가 손을 뗄 때 되살린다 — 그 다음 손짓은 잡힌다.
    if (osBacked && isDragRegionTarget(e.target)) deferred = true;
  };
  const onPointerRelease = (): void => {
    pointerDown = false;
    if (deferred) refreshDragRegions('pointer-release');
  };
  // 손이 타이틀바에 **닿는** 순간의 자가치유. `pointermove` 가 아니라 `pointerover` 를 듣는 까닭:
  // 필요한 것은 "이 자리에 들어왔다" 한 번뿐인데, `pointermove` 는 앱 전체에서 초당 수십 번
  // 쏟아져 그때마다 조상 탐색을 시키게 된다.
  const onPointerOver = (e: PointerEvent): void => {
    if (!isDragRegionTarget(e.target)) return;
    const now = Date.now();
    if (!shouldHealCaptionMiss({
      osBacked,
      overDragRegion: true,
      pointerDown,
      sinceLastHealMs: now - lastCaptionHealAt,
    })) return;
    lastCaptionHealAt = now;
    refreshDragRegions('caption-miss');
  };

  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('focus', onFocus);
  // capture 로 듣는다 — 중간에서 멈추는 손짓(팝업 닫기 등)도 눌림 상태는 정확해야 한다.
  window.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('pointerup', onPointerRelease, true);
  window.addEventListener('pointercancel', onPointerRelease, true);
  if (osBacked) window.addEventListener('pointerover', onPointerOver, true);

  // main 이 알려 주는 창 상태 전이(show·restore·maximize …). 최소화 복원은 환경에 따라
  // `visibilitychange` 가 뜨지 않을 수 있어 이 길이 따로 있어야 한다. 구버전 preload·웹에는
  // 이 창구가 없으므로 선택 호출이다.
  let offWindowState: (() => void) | undefined;
  try {
    offWindowState = window.api?.window?.onDragRegionsRefresh?.(() => refreshDragRegions('window-state'));
  } catch { /* 창구가 없으면 위 브라우저 계기들만으로 간다 */ }

  // 첫 기동 되짚기 — 창이 뜨는 것과 타이틀바가 그려지는 것이 겹치는 유일한 구간이다.
  const timers = DRAG_REGION_REFRESH_DELAYS_MS.map((ms) =>
    window.setTimeout(() => refreshDragRegions('mount'), ms));

  // 규약 4 — 위 되짚기는 **부팅 지점** 기준이라, 헤더가 그보다 늦게 그려지면 네 번이 전부 빈
  // 문서 위에서 돈다(첫 기동의 렌더러는 i18n·스토어 복원·전송로 설치를 먼저 한다). 그러면 그
  // 뒤로 창은 이미 보이고 포커스도 받은 상태라 다른 계기도 오지 않는다 — 그것이 곧 사용자
  // 보고("방금 앱을 열었는데 헤더를 잡아도 창이 안 움직인다")다. 그래서 **그려질 때까지** 되짚고,
  // 그려지면 즉시 멈춘다.
  const sightingStartedAt = Date.now();
  const sightingTimer = window.setInterval(() => {
    try {
      const timedOut = Date.now() - sightingStartedAt >= DRAG_REGION_SIGHTING_TIMEOUT_MS;
      if (!timedOut && document.querySelector('.app-drag') === null) return;
      window.clearInterval(sightingTimer);
      if (!timedOut) refreshDragRegions('appear');
    } catch { /* 표시 전용 — 실패해도 앱은 그대로 간다 */ }
  }, DRAG_REGION_SIGHTING_POLL_MS);

  return (): void => {
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('focus', onFocus);
    window.removeEventListener('pointerdown', onPointerDown, true);
    window.removeEventListener('pointerup', onPointerRelease, true);
    window.removeEventListener('pointercancel', onPointerRelease, true);
    window.removeEventListener('pointerover', onPointerOver, true);
    for (const t of timers) window.clearTimeout(t);
    window.clearInterval(sightingTimer);
    offWindowState?.();
    installed = false;
  };
}
