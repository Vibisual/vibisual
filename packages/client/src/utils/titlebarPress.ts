/**
 * titlebarPress.ts — **제목줄을 누른 손짓은 그 손짓으로 창을 옮긴다** (§3.7 「제목줄 영역은 코드로 껐다 켜지 않는다」).
 *
 * 제목줄(`.app-drag`)을 누르면 보통은 OS 가 그 손짓을 가져가 창을 옮기고, 페이지에는 아무것도 오지 않는다.
 * 그 자리가 지금 드래그 영역으로 신고돼 있지 않으면(앱을 막 켰을 때 등) 손짓이 페이지까지 온다. 그때 그
 * 누름 그대로 `move-self` 로 창을 옮긴다 — 헤더 로고 덮개가 쓰는 바로 그 길(`beginTitlebarDrag`)이다.
 *
 * ⚠ **영역을 코드로 흔들지 않는다.** 종전에는 같은 관측("제목줄인데 손짓이 왔다")을 다음 누름을 위해 영역을
 *   두 프레임 동안 `no-drag` 로 바꿨다 되돌리는 데 썼고, 창 상태 전이·포커스·시작 시각에도 같은 흔들기를
 *   걸었다. Chromium 126 은 제목줄 누름을 첫 마우스 이동에서야 OS 이동으로 넘기는데, 그 사이 영역이
 *   `no-drag` 가 되면 첫 이동을 페이지가 받아 넘기지 않는다(`hwnd_message_handler.cc` 의 `if (!handled)`).
 *   포커스 없는 창을 누르면 그 누름이 포커스를 부르고 포커스가 흔들기를 불러, 바로 그 손짓이 사라졌다.
 *   계기를 늘릴수록 더 잦아졌다 — 다시 붙이지 말 것(`titlebarPress.test.ts` 가 원문으로 지킨다).
 *
 * 받기는 창 종류를 가리지 않으므로 부팅 지점(`main.tsx`)에서 한 번만 건다 — 제목줄을 가진 창이 메인 하나가
 * 아니다(별창 · 지휘통제실 · 앱 셸 · 오류 화면).
 */

/** 화면 좌표 한 점(DIP) — `MouseEvent.screenX/Y`. 앱은 페이지 배율을 바꾸지 않으므로 그대로 DIP 다. */
export interface TitlebarPoint {
  x: number;
  y: number;
}

type MoveSelf = (phase: 'start' | 'move' | 'end', point?: TitlebarPoint) => Promise<boolean>;

/** 손짓이 실은 화면 좌표. 좌표가 없는 합성 이벤트면 싣지 않는다 — 그때 main 은 OS 커서로 대신한다. */
function pointOf(event: { screenX?: number; screenY?: number }): TitlebarPoint | undefined {
  const { screenX: x, screenY: y } = event;
  if (typeof x !== 'number' || typeof y !== 'number') return undefined;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  return { x, y };
}

/** 한 창에 손짓은 하나 — 새 누름이 오면 앞 손짓을 먼저 끝낸다. */
let activeStop: (() => void) | null = null;

/**
 * 이 누름이 도착한 자리가 **드래그 영역인가** — `app-nodrag` 로 되돌린 자리(덮개·탭·버튼)는 아니다.
 * 판정은 CSS 가 쓰는 두 이름 그대로 본다 — 다른 기준을 세우면 CSS 와 갈라져 조용히 어긋난다.
 */
export function isDragRegionTarget(target: EventTarget | null): boolean {
  if (typeof Element === 'undefined' || !(target instanceof Element)) return false;
  const region = target.closest('.app-drag, .app-nodrag');
  return region !== null && region.classList.contains('app-drag');
}

/**
 * 왼쪽 누름 하나를 **창 이동 손짓**으로 시작한다. 시작했으면 `true` — 부르는 쪽이 그 누름의 기본 동작과
 * 전파를 끊는다. 이동 창구(`move-self`)가 없는 창(웹·모바일 접속)에서는 아무것도 하지 않는다.
 *
 * 최대화 해제가 pointercancel·캡처 상실을 일으켜도 손은 아직 눌려 있으므로 창의 mouseup 을 끝으로 삼는다.
 * IPC 는 응답을 기다리지 않고 start → move → end 순서로 보낸다 — 응답을 기다렸다 이어 보내면 이미 손을
 * 뗀 뒤의 늦은 성공이 끝난 손짓을 되살리거나 다음 손짓을 덮는다.
 *
 * 누른 자리와 놓은 자리는 **렌더러가 잰 화면 좌표**를 싣는다(§3.7 ③). 메인 스레드가 바빠 늦게 받아도 손이
 * 실제로 누르고 놓은 자리로 옮기기 위해서다 — 받는 쪽 규칙은 desktop `titlebarMove.ts`. 이동 중의 자리는 싣지
 * 않는다 — 손이 아직 쥐고 있는 동안은 main 이 읽는 OS 커서가 가장 새 자리다.
 */
export function beginTitlebarDrag(down: { button: number; screenX?: number; screenY?: number }): boolean {
  if (down.button !== 0) return false;
  const api = window.api?.window;
  if (!api?.moveSelf) return false;
  const moveSelf: MoveSelf = api.moveSelf.bind(api);

  activeStop?.();

  let finished = false;
  // `at` 은 실제로 손을 뗀 자리일 때만 싣는다. 놓친 mouseup 뒤의 이동·창 이탈은 놓은 자리가 아니다.
  const end = (at?: TitlebarPoint): void => {
    if (finished) return;
    finished = true;
    if (activeStop === stop) activeStop = null;
    window.removeEventListener('mousemove', onMove, true);
    window.removeEventListener('mouseup', onUp, true);
    window.removeEventListener('blur', stop, true);
    window.removeEventListener('pagehide', stop, true);
    try { void moveSelf('end', at).catch(() => { /* 종료 중인 창은 IPC 가 이미 닫혔을 수 있다. */ }); }
    catch { /* preload 가 종료된 경우에도 리스너는 위에서 먼저 걷었다. */ }
  };
  const stop = (): void => { end(); };

  const send = (phase: 'start' | 'move', at?: TitlebarPoint): void => {
    // 거절·실패는 **이 손짓**만 끝낸다 — 이미 끝난 앞 손짓의 늦은 응답은 다음 손짓을 건드리지 않는다.
    try {
      void moveSelf(phase, at).then((accepted) => { if (!accepted) stop(); }, stop);
    } catch { stop(); }
  };

  const onMove = (move: MouseEvent): void => {
    // 창 밖에서 뗀 mouseup 을 놓쳤더라도 다음 움직임에서 멈춘다(이 자리는 놓은 자리가 아니다).
    if ((move.buttons & 1) === 0) { stop(); return; }
    // 이동 중에는 main 이 OS 커서를 직접 읽어 따른다 — 손이 아직 쥐고 있으면 그것이 가장 새 자리다.
    send('move');
  };
  const onUp = (up: MouseEvent): void => {
    // 왼쪽을 쥔 채 다른 버튼만 떼는 동작은 손짓의 끝이 아니다.
    if (up.button === 0) end(pointOf(up));
    else if ((up.buttons & 1) === 0) stop();
  };

  activeStop = stop;
  window.addEventListener('mousemove', onMove, true);
  window.addEventListener('mouseup', onUp, true);
  window.addEventListener('blur', stop, true);
  window.addEventListener('pagehide', stop, true);
  send('start', pointOf(down));
  return true;
}

/** 지금 손짓이 있으면 끝낸다(손잡이가 사라질 때). */
export function endTitlebarDrag(): void {
  activeStop?.();
}

/** 부팅 지점에서 한 번만 — 두 번 걸리면 한 누름이 손짓 둘을 연다. */
let installed = false;

/**
 * **페이지까지 온 제목줄 누름**을 그 누름으로 옮기는 받기를 건다. 반환값은 해제 함수.
 *
 * capture 로 듣는다 — 그 누름이 페이지의 다른 처리기(캔버스·탭 끌기·팝업 닫기)로 흘러가기 전에 받는다.
 * 드래그 영역은 원래 OS 가 손짓을 가져가 페이지가 아무것도 받지 못하는 자리라, 여기서 전파를 끊어도 신고가
 * 맞을 때와 같은 결과다. 덮개(`app-nodrag`)는 여기서 거르고 자기 처리기(`useTitlebarDrag`)가 받는다.
 */
export function installTitlebarPressCatch(): () => void {
  if (installed) return () => { /* 이미 설치됨 — 해제는 첫 설치자의 몫 */ };
  installed = true;
  const onDown = (event: MouseEvent): void => {
    if (event.defaultPrevented || !isDragRegionTarget(event.target)) return;
    if (!beginTitlebarDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
  };
  window.addEventListener('mousedown', onDown, true);
  return (): void => {
    window.removeEventListener('mousedown', onDown, true);
    installed = false;
  };
}
