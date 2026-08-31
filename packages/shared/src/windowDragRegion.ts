/**
 * 창을 끌고 다닐 때 "지금 앱 안인가 밖인가"를 가르는 **순수 판정** SSOT.
 *
 * §5.5 #17-6 (H-4) — 앱 안 IDE 창을 밖으로 끌어내면 그 순간 독립 창이 되어 커서를 따라오고,
 * 독립 창을 다시 앱 안으로 끌고 들어오면 그 순간 앱 안 IDE 로 돌아온다. 두 방향을 **같은 손짓
 * 하나**로 오가므로, 되돌아오는 판정이 조금만 헐거워도 창이 무한히 왕복한다:
 *
 * - 화면 끝에 막혀 **가장자리 버팀**으로 꺼낸 창은 태어나는 순간 커서가 **아직 앱 안**이다.
 *   "앱 안이면 되돌린다"로 읽으면 꺼내자마자 도로 합쳐진다(그리고 다시 버팀이 시작된다).
 * - 앱 위에 겹쳐 둔 독립 창을 몇 픽셀 밀기만 해도 커서는 앱 위에 있다 — 그것은 "들어왔다"가
 *   아니라 "원래 거기 있었다"이다.
 *
 * 그래서 되돌리기는 ① 경계에서 `inset` 만큼 **깊이** 들어와야 하고 ② **밖 → 안 전이**에서만
 * 친다. 꺼내기 문턱(뷰포트 밖 24px · 가장자리 3px)과 사이가 넓어, 한 손짓이 두 판정을 동시에
 * 만족하는 자리가 없다.
 *
 * ⚠️ 이 파일은 브라우저에서도 로드되는 shared 다 — 화면·창 API 를 부르지 않고 **숫자만** 본다
 * (`pathCase.ts` 머리말과 같은 규약). 그래야 창을 띄우지 않고 단위 테스트로 확인할 수 있고,
 * 창을 실제로 움직이는 쪽(Electron main)과 규칙이 갈라지지 않는다.
 */

/** 화면 좌표계의 네모 — Electron `BrowserWindow.getContentBounds()` 와 같은 모양. */
export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 끌고 온 독립 창이 "앱 안으로 들어왔다"로 읽히는 **안쪽 여백**(px, DIP).
 *
 * 경계선 그 자체를 문턱으로 쓰면 가장자리에서 꺼낸 창이 곧바로 되돌아온다. 48px 은 타이틀바
 * 한 줄(h-10=40px)보다 조금 넓은 값이라, 창을 앱 **안쪽으로 끌어다 놓는 손짓**과 앱 가장자리를
 * 스치는 손짓이 확실히 갈린다.
 */
export const DETACHED_REDOCK_INSET_PX = 48;

/**
 * 커서가 그 네모 **깊숙이** 들어와 있는가 — 테두리에서 `inset` 안쪽까지 들어와야 참.
 *
 * 네모가 `inset` 두 배보다 작으면(아주 작은 창) 안쪽이 없어 영영 거짓이 된다 — 그때는 네모의
 * 가운데를 기준으로 삼는다(문턱이 사라지는 대신 판정이 없어지지는 않는다).
 */
export function isCursorDeepInside(
  cursor: { x: number; y: number },
  rect: ScreenRect,
  inset: number = DETACHED_REDOCK_INSET_PX,
): boolean {
  const insetX = Math.min(inset, Math.max(0, rect.width / 2 - 1));
  const insetY = Math.min(inset, Math.max(0, rect.height / 2 - 1));
  return cursor.x >= rect.x + insetX
    && cursor.x <= rect.x + rect.width - insetX
    && cursor.y >= rect.y + insetY
    && cursor.y <= rect.y + rect.height - insetY;
}

/** 한 틱의 판정 결과 — 다음 틱에 넘길 기억(`inside`)과 지금 되돌릴지(`entered`). */
export interface AppEntryStep {
  /** 다음 틱이 견줄 값. 되돌렸든 아니든 **지금 상태 그대로** 넘긴다. */
  inside: boolean;
  /** 이번 틱에 밖 → 안 **전이**가 일어났는가 = 지금 앱 안으로 되돌릴 때다. */
  entered: boolean;
}

/**
 * 밖 → 안 전이만 걸러 내는 한 칸짜리 상태 기계.
 *
 * 드래그를 시작할 때의 첫 `prevInside` 는 **그 순간의 실측**으로 채운다 — `false` 로 두면
 * 앱 위에 겹쳐 있던 창이 첫 틱에 곧바로 합쳐진다("들어온" 적이 없는데 들어왔다고 읽는다).
 */
export function stepAppEntry(prevInside: boolean, nowInside: boolean): AppEntryStep {
  return { inside: nowInside, entered: !prevInside && nowInside };
}
