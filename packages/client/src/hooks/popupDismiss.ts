/**
 * 팝업 닫기 공통 규약 — **팝업 안에서 시작한 제스처는 그 팝업을 닫지 못한다.**
 *
 * 왜 필요한가:
 *  - 백드롭(전면 스크림) 위에 패널을 얹은 팝업에서, 패널 안에서 누르고(mousedown) 백드롭 위에서
 *    떼면(mouseup) 브라우저는 **두 지점의 공통 조상**인 백드롭에 click 을 쏜다. 그래서
 *    `onClick={onClose}` 백드롭은 "패널 안에서 시작한 드래그"만으로 닫혀 버린다.
 *  - 드래그가 창 밖까지 나갔다가 끝나면 릴리스 지점이 뷰포트 경계로 클램프되며 같은 일이 벌어진다.
 *    사용자에겐 "팝업을 누른 채 화면 밖으로 밀었더니 팝업이 꺼졌다"로 보인다.
 *
 * 그래서 닫기 판정은 **누르기 시작한 지점**과 **뗀 지점**을 함께 본다. 판정 자체는 DOM 없이
 * 검증할 수 있도록 순수 함수로 두고(테스트 환경에 jsdom 이 없다), DOM 배선은
 * `usePopupDismiss.ts` 가 맡는다.
 */

export interface ViewportSize {
  readonly w: number;
  readonly h: number;
}

export interface PointerPoint {
  readonly x: number;
  readonly y: number;
}

export const POPUP_DISMISS = {
  /** 팝업이 열린 직후 이 시간 안에 오는 press 는 "팝업을 연 그 제스처의 잔여 이벤트"로 보고 무시한다. */
  openGraceMs: 50,
  /** 터치 롱프레스로 연 메뉴는 손을 떼는 순간 브라우저가 합성 mousedown 을 쏜다 — 그 창을 넘긴다. */
  touchOpenGraceMs: 400,
} as const;

/**
 * 이벤트 좌표가 뷰포트 안인가. 창 밖까지 끌고 나간 드래그는 음수·초과 좌표로 도착하므로,
 * "화면 밖에서 뗀 것"을 클릭으로 치지 않기 위한 1차 방어다.
 */
export function isPointWithinViewport(p: PointerPoint, v: ViewportSize): boolean {
  return p.x >= 0 && p.y >= 0 && p.x <= v.w && p.y <= v.h;
}

export interface BackdropRelease {
  /** press 가 백드롭 자신에서 시작했는가(자식=패널에서 시작한 드래그면 false). */
  readonly pressedOnBackdrop: boolean;
  /** release 가 백드롭 자신에서 일어났는가. */
  readonly releasedOnBackdrop: boolean;
  /** release 지점이 뷰포트 안인가. */
  readonly releaseWithinViewport: boolean;
}

/** 백드롭 클릭으로 닫아도 되는가 — 누른 곳도 뗀 곳도 백드롭 자신일 때만. */
export function shouldDismissOnBackdropRelease(r: BackdropRelease): boolean {
  return r.pressedOnBackdrop && r.releasedOnBackdrop && r.releaseWithinViewport;
}

export interface PressFacts {
  /** press 가 팝업(또는 그 트리거) 안에서 일어났는가. */
  readonly insidePopup: boolean;
  /** press 지점이 뷰포트 안인가. */
  readonly withinViewport: boolean;
}

/**
 * 문서 바깥 press 로 닫아도 되는가.
 * `insideGestureHeld` = 팝업 안에서 시작해 아직 떼지 않은 제스처가 살아 있는 상태 —
 * 그 와중에 도착한 바깥 press 는 합성 이벤트이므로 닫기 사유가 못 된다.
 */
export function shouldDismissOnOutsidePress(f: PressFacts, insideGestureHeld: boolean): boolean {
  if (f.insidePopup) return false;
  if (insideGestureHeld) return false;
  return f.withinViewport;
}

export interface InsideGestureLatch {
  /** press 하나를 기록하고 "이 press 로 닫아도 되는가"를 돌려준다. */
  press(f: PressFacts): boolean;
  /** 버튼을 뗐거나 제스처가 취소됐다(포커스 이탈 포함). */
  release(): void;
  /** 팝업 안에서 시작한 제스처가 아직 살아 있는가(진단·테스트용). */
  isHeld(): boolean;
}

/** 팝업 하나가 자기 안에서 시작한 제스처를 기억하는 래치. 팝업마다 하나씩 만든다. */
export function createInsideGestureLatch(): InsideGestureLatch {
  let held = false;
  return {
    press(f: PressFacts): boolean {
      const dismiss = shouldDismissOnOutsidePress(f, held);
      held = f.insidePopup;
      return dismiss;
    },
    release(): void {
      held = false;
    },
    isHeld(): boolean {
      return held;
    },
  };
}
