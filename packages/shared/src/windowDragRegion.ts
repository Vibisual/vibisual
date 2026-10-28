/**
 * 창을 끌 때 앱 안/밖의 순수 판정(§5.5 #17-6 (H-4)) — 꺼내기·되돌리기가 같은 손짓이라 헐거우면 창이 무한히 왕복한다.
 * 되돌리기는 ① 경계에서 `inset` 만큼 깊이 들어와야 하고 ② 밖 → 안 전이에서만 친다 — 버팀으로 꺼낸 창은 태어날 때 커서가 아직 앱 안이고,
 * 앱 위에 겹친 창을 조금 밀어도 커서는 앱 위다. 브라우저에서도 로드되는 shared 라 화면·창 API 없이 숫자만 본다(Electron main 과 규칙 한 벌).
 */

/** 화면 좌표계의 네모 — Electron `BrowserWindow.getContentBounds()` 와 같은 모양. */
export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * "앱 안으로 들어왔다"로 읽히는 안쪽 여백(px, DIP). 경계선을 문턱으로 쓰면 가장자리에서 꺼낸 창이 곧바로 되돌아온다.
 * 48px 은 타이틀바(40px)보다 조금 넓어, 안으로 끌어다 놓는 손짓과 가장자리를 스치는 손짓이 갈린다.
 */
export const DETACHED_REDOCK_INSET_PX = 48;

/** 테두리에서 `inset` 안쪽까지 들어와야 참. 네모가 `inset` 두 배보다 작으면 영영 거짓이 되므로 가운데를 기준으로 삼는다. */
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

/**
 * (H-8) 화면 좌표로 재는 이탈 판정(렌더러의 `isCursorOutsideViewport` 는 창 안 좌표). 끌던 손을 이어받은 판은 `mousedown` 이 없어
 * 마우스 캡처가 없다 — 커서가 창을 벗어나면 이벤트가 끊겨 렌더러는 이탈을 못 본다. 그래서 main 이 커서를 폴링해 이 함수로 본다(판정 한 곳).
 * margin 0 이면 화면 끝까지 끌기만 해도 튀어나간다(렌더러 쪽과 같은 뜻).
 */
export function isCursorOutsideRect(
  cursor: { x: number; y: number },
  rect: ScreenRect,
  margin: number,
): boolean {
  return cursor.x < rect.x - margin
    || cursor.y < rect.y - margin
    || cursor.x > rect.x + rect.width + margin
    || cursor.y > rect.y + rect.height + margin;
}

/** 한 틱의 판정 결과 — 다음 틱에 넘길 기억(`inside`)과 지금 되돌릴지(`entered`). */
export interface AppEntryStep {
  /** 다음 틱이 견줄 값. 되돌렸든 아니든 **지금 상태 그대로** 넘긴다. */
  inside: boolean;
  /** 이번 틱에 밖 → 안 **전이**가 일어났는가 = 지금 앱 안으로 되돌릴 때다. */
  entered: boolean;
}

/** 밖 → 안 전이만 거르는 한 칸 상태 기계. 첫 `prevInside` 는 드래그 시작 순간의 실측으로 — `false` 면 앱 위에 겹친 창이 첫 틱에 합쳐진다. */
export function stepAppEntry(prevInside: boolean, nowInside: boolean): AppEntryStep {
  return { inside: nowInside, entered: !prevInside && nowInside };
}

/**
 * §5.5 #17-6 (H-12) — 들어오는 길에도 구간을 둔다. 전이 순간 합치면 앱을 가로질러 반대편에 두려는 손짓도 합쳐진다.
 * 들어오면 가상 창으로만 바뀌고 `dwellMs` 를 버텨야 들어가며, 그동안 밖으로 나가면 즉시 원래 창으로 돌아온다((H-3) 과 같은 규율).
 */
export const REDOCK_DWELL_MS = 500;

/** 한 틱의 판정 결과 — 다음 틱에 넘길 기억 둘과, 지금 해야 할 일 셋. */
export interface RedockDwellStep {
  /** 다음 틱이 견줄 값(지금 커서가 앱 깊숙이 있는가). */
  inside: boolean;
  /** 다음 틱에 넘길 값(지금 가상 창으로 바꿔 두고 기다리는 중인가). */
  dwelling: boolean;
  /** 지금 창을 **가상 창으로 바꿀** 때인가(막 들어왔다). */
  start: boolean;
  /** 지금 창을 **도로 돌려놓을** 때인가(버티다 다시 나갔다). */
  cancel: boolean;
  /** (H-17) 다 버텨 무장할 때인가 — 합치기는 손을 뗄 때 `finishOverlayFollow` 한 곳에서만 한다. 무장해도 화면은 가상 창이고 선만 밝아진다. */
  arm: boolean;
}

/**
 * 들어오기 = `start` + 버팀 + `arm`. 합치는 순간은 없다(손을 뗄 때의 일, H-17). `start`·`cancel` 틱은 `arm` 이 아니다 —
 * 버팀 0 이어도 무장 전 선이 한 틱은 보여야 구간이 산다. 무장 뒤에도 `dwelling` 은 참(= 화면은 가상 창)이고 손을 뗄 때 합칠지를 이것으로 가른다.
 */
export function stepRedockDwell(input: {
  wasInside: boolean;
  isInside: boolean;
  dwelling: boolean;
  /** 버티기 시작한 뒤 흐른 시간(ms) — `dwelling` 이 거짓이면 읽지 않는다. */
  elapsedMs: number;
  dwellMs?: number;
}): RedockDwellStep {
  const { wasInside, isInside, dwelling, elapsedMs } = input;
  // 0 을 그대로 받으면 들어오는 그 틱에 합쳐져 종전 절벽으로 되돌아간다 — 최소 한 틱은 버틴다.
  const span = Math.max(1, Number.isFinite(input.dwellMs) ? (input.dwellMs as number) : REDOCK_DWELL_MS);
  if (dwelling) {
    if (!isInside) return { inside: isInside, dwelling: false, start: false, cancel: true, arm: false };
    // (H-17) 다 버텼다 = 선을 밝히기만 한다. 합치는 것은 손을 뗄 때다(가상 창은 그대로 남는다).
    return { inside: isInside, dwelling: true, start: false, cancel: false, arm: elapsedMs >= span };
  }
  // 들어오는 **전이**를 가리는 규칙은 종전 그대로 한 곳(`stepAppEntry`)이다 — 바뀐 것은 그
  //   전이가 곧바로 합치지 않고 **구간을 연다**는 것뿐이다.
  const { entered } = stepAppEntry(wasInside, isInside);
  return { inside: isInside, dwelling: entered, start: entered, cancel: false, arm: false };
}
