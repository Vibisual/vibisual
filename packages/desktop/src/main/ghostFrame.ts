import { BrowserWindow, screen } from 'electron';

// SCENARIO.md §5.5 #17-6 (H-6) — **밖으로 빼는 동안 그려 주는 가상 창(윤곽선)**.
//
// 앱 창 밖은 렌더러가 그릴 수 없다. 그래서 종전에는 IDE 창을 밖으로 빼는 과정이 "앱 경계에서
// 잘린 창"으로만 보였고, 경계를 넘는 순간 창이 사라졌다 새 창으로 나타나 "버벅이다 튄다"로
// 읽혔다. 여기서는 **클릭통과 투명 창** 하나를 화면 좌표에 띄워, 창이 어디로 빠지는지를
// 앱 밖까지 이어지는 선으로 보여 준다.
//
// 자리를 정하는 것은 **main 이 커서를 폴링**하는 쪽이다 — 렌더러가 프레임마다 좌표를 보내면
// IPC 지연만큼 선이 손보다 늦게 따라오고, 무엇보다 (v2.81) 버블 드래그·(H-4) `follow` 와 물리가
// 갈린다. 같은 폴링을 쓰므로 **윤곽선과 곧 태어날 창이 정확히 같은 자리**를 그린다.
//
// 만들지 못하는 환경(컴포지터 없는 리눅스 등에서의 생성 실패)에서는 조용히 포기한다 — 부르는
// 쪽(렌더러)이 앱 안 윤곽선으로 폴백하므로, 기능이 사라지는 것이 아니라 덜 보이게 된다.

/** 커서 폴링 주기(ms) — `windowManager` 의 드래그 폴링과 같은 값이어야 두 그림이 어긋나지 않는다. */
const GHOST_POLL_MS = 16;

/**
 * 윤곽선이 화면에 남을 수 있는 최대 시간(ms).
 *
 * 이 창은 클릭통과라 사용자가 직접 없앨 수 없다 — 끄는 신호를 한 번 놓치면 **영영 떠 있는 선**이
 * 된다. 그물을 시간으로 하나 더 둔다(정상 경로에서는 훨씬 먼저 꺼진다).
 */
const GHOST_MAX_LIFE_MS = 20_000;

interface GhostState {
  window: BrowserWindow;
  timer: NodeJS.Timeout | null;
  lifeTimer: NodeJS.Timeout | null;
  /** 잡은 지점 — 창 좌상단에서 커서까지의 거리(px). 끌던 손 아래 그대로 이어지게. */
  grabX: number;
  grabY: number;
  /** 가장자리 버팀 중 그 변 밖으로 밀어 내는 여분(px) — 어디에 설지를 미리 보여 준다. */
  pushX: number;
  pushY: number;
  width: number;
  height: number;
  /** 지금 손을 떼도 그대로 나가는가 — 선의 밝기가 그것을 미리 말한다. */
  armed: boolean;
}

let ghost: GhostState | null = null;

/**
 * 무장 여부를 선에 반영한다 — 창을 다시 만들지 않고 클래스만 토글한다.
 *
 * 아직 로드 중일 수 있으므로 실패는 삼킨다(다음 호출이 다시 맞춘다). 이 창은 우리가 만든
 * data URL 문서 하나뿐이라 여기서 실행되는 코드에 외부 입력이 섞이지 않는다.
 */
function applyArmed(g: GhostState): void {
  if (g.window.isDestroyed() || g.window.webContents.isDestroyed()) return;
  void g.window.webContents
    .executeJavaScript(`document.body&&document.body.classList.toggle('armed',${g.armed ? 'true' : 'false'})`)
    .catch(() => { /* 로드 전 — 다음 호출이 맞춘다 */ });
}

/** 윤곽선 창의 내용 — 창 하나에 사각형 하나. 폰트·에셋을 쓰지 않는다(동봉물 라이선스 규칙). */
function ghostHtml(label: string): string {
  const safe = label
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;background:transparent;overflow:hidden;
    -webkit-user-select:none;user-select:none;cursor:default}
  .frame{position:fixed;inset:0;box-sizing:border-box;border-radius:10px;
    border:2px solid rgba(167,139,250,0.75);
    background:rgba(139,92,246,0.07);
    box-shadow:0 0 0 1px rgba(15,23,42,0.55) inset, 0 10px 30px rgba(0,0,0,0.35);
    transition:border-color 120ms ease-out, background-color 120ms ease-out}
  /* 무장 — 지금 손을 떼도 그대로 나간다. 선이 굵어지는 것이 아니라 밝아진다(자리는 그대로). */
  body.armed .frame{border-color:rgba(196,181,253,0.98);background:rgba(139,92,246,0.14)}
  body.armed .bar{border-bottom-color:rgba(196,181,253,0.8)}
  .bar{position:fixed;left:0;right:0;top:0;height:34px;box-sizing:border-box;
    border-bottom:1px solid rgba(167,139,250,0.55);
    background:rgba(15,23,42,0.55);
    border-radius:8px 8px 0 0;
    display:flex;align-items:center;gap:6px;padding:0 10px;
    font:500 12px/1 system-ui,-apple-system,"Segoe UI",sans-serif;
    color:rgba(237,233,254,0.95)}
  .dot{width:8px;height:8px;border-radius:50%;background:rgba(167,139,250,0.95);flex:none}
  .name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  </style></head><body>
  <div class="frame"></div>
  <div class="bar"><span class="dot"></span><span class="name">${safe}</span></div>
  </body></html>`;
}

function clearTimers(g: GhostState): void {
  if (g.timer) { clearInterval(g.timer); g.timer = null; }
  if (g.lifeTimer) { clearTimeout(g.lifeTimer); g.lifeTimer = null; }
}

/** 지금 커서 자리에 맞춰 윤곽선을 옮긴다 — 잡은 지점 + 버팀 여분. */
function positionGhost(g: GhostState): void {
  if (g.window.isDestroyed()) { hidePopOutGhost(); return; }
  const p = screen.getCursorScreenPoint();
  try {
    g.window.setBounds({
      x: Math.round(p.x - g.grabX + g.pushX),
      y: Math.round(p.y - g.grabY + g.pushY),
      width: g.width,
      height: g.height,
    }, false);
  } catch {
    // 화면 구성이 바뀌는 찰나에 실패할 수 있다 — 다음 틱이 다시 맞춘다.
  }
}

/**
 * 윤곽선을 띄운다(이미 떠 있으면 크기·잡은 지점만 갈아 끼운다).
 *
 * @returns 실제로 떠 있는가 — 거짓이면 부르는 쪽이 앱 안 윤곽선으로 폴백한다.
 */
export function showPopOutGhost(opts: {
  width: number;
  height: number;
  grabX: number;
  grabY: number;
  label?: string;
  armed?: boolean;
}): boolean {
  const width = Math.max(120, Math.round(opts.width));
  const height = Math.max(80, Math.round(opts.height));
  const grabX = Math.round(opts.grabX);
  const grabY = Math.round(opts.grabY);
  const armed = !!opts.armed;

  if (ghost && !ghost.window.isDestroyed()) {
    ghost.width = width;
    ghost.height = height;
    ghost.grabX = grabX;
    ghost.grabY = grabY;
    if (ghost.armed !== armed) {
      ghost.armed = armed;
      applyArmed(ghost);
    }
    positionGhost(ghost);
    return true;
  }

  // 죽은 창을 가리키고 있었다면 그 판을 먼저 정리한다 — 남은 타이머가 새 창의 자리를 흔든다.
  if (ghost) hidePopOutGhost();

  let win: BrowserWindow;
  try {
    win = new BrowserWindow({
      width,
      height,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      // 이 창은 **보여 주기만** 한다 — 손짓은 전부 메인 창이 받고 있어야 한다(활성화되면 OS 가
      //   메인 창의 마우스 캡처를 걷어, 아직 눌려 있는 그 드래그가 어디에도 도착하지 않는다).
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      // mac 은 기본적으로 화면 밖·화면보다 큰 창을 허용하지 않는다 — 밖으로 빼는 그림이 잘린다.
      enableLargerThanScreen: true,
      acceptFirstMouse: false,
      title: 'Vibisual',
      webPreferences: {
        // 정적인 그림 하나뿐이라 노드도 preload 도 필요 없다(표면을 넓히지 않는다).
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
  } catch {
    return false;
  }

  try {
    win.setIgnoreMouseEvents(true, { forward: false });
    win.setAlwaysOnTop(true, 'screen-saver');
  } catch {
    // 일부 플랫폼에서 없는 조합 — 선이 보이는 것이 더 중요하므로 계속 간다.
  }
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(ghostHtml(opts.label ?? ''))}`);

  const state: GhostState = {
    window: win,
    timer: null,
    lifeTimer: null,
    grabX,
    grabY,
    pushX: 0,
    pushY: 0,
    width,
    height,
    armed,
  };
  ghost = state;

  // 문서가 서면 무장 상태를 한 번 더 박는다 — 첫 호출이 로드 전이라 삼켜졌을 수 있다.
  win.webContents.once('did-finish-load', () => { if (ghost === state) applyArmed(state); });

  win.on('closed', () => {
    if (ghost === state) {
      clearTimers(state);
      ghost = null;
    }
  });

  // 첫 자리는 **지금** 잡는다 — 한 틱을 기다리면 태어난 자리에 한 프레임 머물렀다 손 아래로 튄다.
  positionGhost(state);
  win.showInactive();
  state.timer = setInterval(() => positionGhost(state), GHOST_POLL_MS);
  state.lifeTimer = setTimeout(() => hidePopOutGhost(), GHOST_MAX_LIFE_MS);
  return true;
}

/**
 * 가장자리에 막힌 채 버티는 동안 윤곽선을 그 변 **밖으로 밀어 낸다**.
 *
 * 커서가 화면 끝에 막힌 사람(H-3)에게는 커서를 더 밀 자리가 없어, 잡은 지점만으로는 선이 앱
 * 안에 머문다 — 기다리는 동안 화면에 보이는 것이 다시 약속뿐이 된다. 버팀 진행도만큼 밀어
 * 내면 "지금 밖으로 빠지고 있다"가 눈에 보인다.
 */
export function nudgePopOutGhost(offset: { dx: number; dy: number }): boolean {
  if (!ghost || ghost.window.isDestroyed()) return false;
  ghost.pushX = Number.isFinite(offset.dx) ? Math.round(offset.dx) : 0;
  ghost.pushY = Number.isFinite(offset.dy) ? Math.round(offset.dy) : 0;
  positionGhost(ghost);
  return true;
}

/**
 * 윤곽선을 걷는다. 정상 경로는 셋 — ⓐ 창이 도로 앱 안으로 들어왔다 ⓑ 손을 뗐다
 * ⓒ **밖으로 나가 새 창이 실제로 떴다**(그 순간 `windowManager` 가 부른다 — 선이 있던 자리를
 * 창이 그대로 이어받으므로 빈 화면이 없다).
 */
export function hidePopOutGhost(): boolean {
  const g = ghost;
  if (!g) return false;
  ghost = null;
  clearTimers(g);
  if (!g.window.isDestroyed()) {
    try { g.window.destroy(); } catch { /* noop */ }
  }
  return true;
}

/** 지금 윤곽선이 떠 있는가 — 앱 종료·정리 경로가 묻는다. */
export function isPopOutGhostVisible(): boolean {
  return !!ghost && !ghost.window.isDestroyed();
}
