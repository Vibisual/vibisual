// SCENARIO.md §3.7 · §5.5 #17-6 (H-19) — 헤더 로고 덮개의 끌기 문턱. 덮개(`app-nodrag`)는 OS 캡션이 아니라 끌기·더블클릭을 우리가 대신한다
// (`ipc.ts` 의 `move-self`·`toggle-maximize-self`). 문턱이 없으면 최대화 창의 1px 떨림이 창을 풀어 이어지는 더블클릭이 "다시 최대화"가 된다.
// electron 에 붙지 않는다(DIP 좌표만) — 세 OS 를 단위 테스트한다.

/**
 * 최대화된 창을 풀기 시작하는 끌기 거리(DIP). 누른 자리에서 가로나 세로로 이만큼 움직여야 끌기다.
 * Windows 기본 끌기 사각형(`SM_CXDRAG`·`SM_CYDRAG` = 4px)의 크기다 — 클릭하는 동안의 손떨림(1~2px)은
 * 넘지 못하고, 창을 끌려는 손은 첫 순간에 넘는다.
 */
export const TITLEBAR_RESTORE_DRAG_DIP = 4;

/** 누른 자리(`press`)에서 지금 커서(`cursor`)까지 문턱을 넘었는가 — 가로나 세로 어느 한쪽이면 된다. */
export function passedTitlebarDragThreshold(
  press: { x: number; y: number },
  cursor: { x: number; y: number },
  threshold = TITLEBAR_RESTORE_DRAG_DIP,
): boolean {
  return Math.abs(cursor.x - press.x) >= threshold || Math.abs(cursor.y - press.y) >= threshold;
}

// §3.7 ③ — **누른 자리·놓은 자리는 렌더러가 잰다.** 서버가 창의 메인 스레드에서 함께 돌아, 그 스레드가 바쁘면
//   `move-self` 를 늦게 받는다. 그때 OS 커서는 손이 이미 옮겨 간 자리라, 누른 자리를 거기서 읽으면 창이 손에서
//   떨어지고 손짓이 통째로 0px 이 된다. 렌더러는 그 손짓의 화면 좌표(DIP)를 실어 보낸다.

/** 렌더러가 실어 보낸 화면 좌표 — 모양이 틀리면 없는 것으로 본다(그때는 OS 커서로 대신한다). */
export function toScreenPoint(value: unknown): { x: number; y: number } | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { x, y } = value as { x?: unknown; y?: unknown };
  if (typeof x !== 'number' || typeof y !== 'number') return undefined;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  return { x, y };
}

/**
 * 렌더러가 잰 자리와 지금 OS 커서가 이만큼(DIP, 가로나 세로) 넘게 벌어져 있으면 메인이 그 손짓을 **늦게
 * 받은** 것이다. 제때 받으면 둘은 몇 px 안이다(손이 빨라도 IPC 몇 ms 동안 움직인 만큼).
 */
export const TITLEBAR_LATE_SAMPLE_DIP = 16;

/**
 * 놓은 자리를 고른다 — 렌더러가 잰 자리(`sample`)와 지금 OS 커서(`live`) 중 하나.
 * 벌어졌으면 메인이 늦게 받은 것이라 손이 실제로 놓은 `sample` 이 맞다(그 뒤 손이 어디로 갔든). 가까우면
 * `live` 를 쓴다 — 창을 옮기던 중의 작은 좌표 차이가 놓는 순간의 튐이 되지 않게.
 */
export function pickTitlebarPoint(
  sample: { x: number; y: number } | undefined,
  live: { x: number; y: number },
  gap = TITLEBAR_LATE_SAMPLE_DIP,
): { x: number; y: number } {
  if (!sample) return live;
  return Math.abs(sample.x - live.x) > gap || Math.abs(sample.y - live.y) > gap ? sample : live;
}

// §3.7 — 덮개 끌기는 main 이 제 박자로도 따라간다. 최대화를 푸는 순간 창이 손 밑에서 바뀌어 페이지가 손짓을 놓치면 `move` 가 끊긴다 —
// 앱 창 끌기(`appWindowTransfer.ts`)처럼 박자마다 OS 커서를 읽고, 뗌은 물리 버튼(`appWindowPrimaryPressed`)으로 본다(`titlebarMove.ts`).

/** main 이 OS 커서를 직접 읽어 창을 옮기는 박자(ms) — 앱 창 끌기(`DRAG_POLL_MS`)와 같은 값이다. */
export const TITLEBAR_FOLLOW_MS = 16;

/**
 * 한 손짓의 수명 상한(ms). 버튼을 읽을 수 없는 OS(mac·linux)에서 페이지가 끝을 못 알려도 창이 커서를 영영
 * 쫓지 않게 한다 — 앱 창 끌기와 같은 값이다.
 */
export const TITLEBAR_GESTURE_MAX_MS = 30_000;

/**
 * 최대화 해제를 요청한 뒤 `unmaximize` 소식을 기다리는 박자 수. 테두리 없는 창은 해제 뒤에도 최대화라고 답하고
 * 소식을 늦게 주거나 안 줄 수 있다(§5.4 #14-1). 이만큼 기다렸으면 복원된 것으로 보고 손 밑에 붙인다.
 */
export const TITLEBAR_RESTORE_WAIT_TICKS = 12;

/**
 * 물리 버튼이 떨어진 것을 본 뒤, 페이지가 놓은 자리(§3.7 ③)를 실어 보내기를 기다리는 박자 수. 그동안 창은
 * 자유로운 마우스를 쫓지 않는다. 오지 않으면(캡처를 잃어 페이지가 mouseup 을 못 봤다) 창이 선 자리에서 끝낸다.
 */
export const TITLEBAR_RELEASE_GRACE_TICKS = 3;
