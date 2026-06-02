import { join } from 'node:path';
import { BrowserWindow, screen } from 'electron';

// SCENARIO.md §5.4 #14-1 (v2.29) — 탭 Detach/Redock 별창 매니저.
//
// 메인 윈도우 외에 사용자가 탭바에서 끌어 분리한 탭들을 별도 BrowserWindow 로 띄우고
// tabKey ↔ BrowserWindow 매핑을 추적한다. 같은 in-process 서버와 같은 preload 를 쓰므로
// 별창은 자동으로 같은 graph_snapshot 을 받는다(main/index.ts setBroadcastSink 가
// BrowserWindow.getAllWindows() 순회 — 별창도 그 순회에 포함).
//
// Redock-drag(v2.30): 별창의 미니 타이틀바를 잡고 끌면 별창 자체가 mini ghost(MINI_W×MINI_H,
// opacity 0.85, alwaysOnTop)로 축소되어 cursor 를 따라다닌다. 메인 헤더 영역 위에서
// 떼면 redock, 그 외 위치에서 떼면 원본 bounds/opacity 복원.

export type DetachKind = 'project' | 'iframe';

export interface DetachOptions {
  kind: DetachKind;
  tabKey: string;
  cursor?: { x: number; y: number } | undefined;
}

interface DetachedEntry {
  id: number;
  tabKey: string;
  kind: DetachKind;
  window: BrowserWindow;
  /** drag 모드 진입 직전의 원본 bounds (복원용). */
  originalBounds: { x: number; y: number; width: number; height: number } | null;
  /** drag 모드 진입 직전의 opacity. */
  originalOpacity: number;
  /** drag 폴링 타이머. */
  dragTimer: NodeJS.Timeout | null;
  /** drag 중 마지막 hover 상태. pointerup 시 redockCommit 결정에 사용. */
  lastHover: boolean;
  /** drag 모드 진입 직전 최대화 상태였는지. 복원 시 다시 maximize 하기 위함. */
  wasMaximized: boolean;
  /** startDetachDrag~endDetachDrag 동안 true. 비동기 복원 대기 중 떼더라도 지연 진입을 막는다. */
  dragActive: boolean;
}

const POPUP_DEFAULT_W = 1100;
const POPUP_DEFAULT_H = 720;
const POPUP_MIN_W = 480;
const POPUP_MIN_H = 320;

// Mini ghost 사이즈 — detach 시 cursor 옆 floating hint card 와 동일한 컴팩트 칩 느낌.
const MINI_W = 200;
const MINI_H = 44;
// 메인 윈도우의 redock zone: 타이틀바(36) + 탭바(36) ≈ 72px. 살짝 더 여유.
const MAIN_HEADER_ZONE = 72;
// drag polling 주기. 16ms ≈ 60fps.
const DRAG_POLL_MS = 16;

let getMainWindow: () => BrowserWindow | null = () => null;
const byTabKey = new Map<string, DetachedEntry>();
const byWindowId = new Map<number, DetachedEntry>();
let onChange: (() => void) | null = null;

export function configureWindowManager(opts: {
  getMainWindow: () => BrowserWindow | null;
  onChange?: () => void;
}): void {
  getMainWindow = opts.getMainWindow;
  onChange = opts.onChange ?? null;
}

function notifyChange(): void {
  broadcastList();
  onChange?.();
}

export function broadcastList(): void {
  const list = listDetached();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('vibisual:detached:list', list);
  }
}

export interface DetachedTabInfo {
  windowId: number;
  tabKey: string;
  kind: DetachKind;
}

export function listDetached(): DetachedTabInfo[] {
  const out: DetachedTabInfo[] = [];
  for (const e of byTabKey.values()) {
    out.push({ windowId: e.id, tabKey: e.tabKey, kind: e.kind });
  }
  return out;
}

export function hasTabKey(tabKey: string): boolean {
  return byTabKey.has(tabKey);
}

export function openDetached(opts: DetachOptions): { windowId: number; reused: boolean } {
  const existing = byTabKey.get(opts.tabKey);
  if (existing && !existing.window.isDestroyed()) {
    if (existing.window.isMinimized()) existing.window.restore();
    existing.window.focus();
    return { windowId: existing.id, reused: true };
  }

  let x: number | undefined;
  let y: number | undefined;
  if (opts.cursor) {
    x = Math.round(opts.cursor.x - POPUP_DEFAULT_W / 2);
    y = Math.round(opts.cursor.y - 18);
  }

  const win = new BrowserWindow({
    width: POPUP_DEFAULT_W,
    height: POPUP_DEFAULT_H,
    minWidth: POPUP_MIN_W,
    minHeight: POPUP_MIN_H,
    ...(x !== undefined && y !== undefined ? { x, y } : {}),
    show: false,
    backgroundColor: '#030712',
    autoHideMenuBar: true,
    title: 'Vibisual',
    // §5.4 #14-1 (v2.30) — 별창은 OS titlebar 를 통째로 우리 UI 가 대신한다. titleBarOverlay 를 쓰면
    // 우상단 컨트롤 영역이 OS 가 그려 우리 미니 타이틀바와 시각 충돌하므로 frame:false 로 전환.
    frame: false,
    icon: join(__dirname, '..', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.on('ready-to-show', () => {
    if (!win.isDestroyed()) win.show();
  });

  const entry: DetachedEntry = {
    id: win.id,
    tabKey: opts.tabKey,
    kind: opts.kind,
    window: win,
    originalBounds: null,
    originalOpacity: 1,
    dragTimer: null,
    lastHover: false,
    wasMaximized: false,
    dragActive: false,
  };
  byTabKey.set(opts.tabKey, entry);
  byWindowId.set(win.id, entry);

  // §5.4 #14-1 — 별창 미니 타이틀바의 최대화/복원 버튼 아이콘이 OS 더블클릭 등으로 바뀐
  // 실제 창 상태를 따라가도록, maximize/unmaximize 시 renderer 에 상태를 푸시한다.
  const pushMaximizeState = (): void => {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send('vibisual:window:maximize-state', { maximized: win.isMaximized() });
    }
  };
  win.on('maximize', pushMaximizeState);
  win.on('unmaximize', pushMaximizeState);

  win.on('closed', () => {
    if (entry.dragTimer) {
      clearInterval(entry.dragTimer);
      entry.dragTimer = null;
    }
    byTabKey.delete(opts.tabKey);
    byWindowId.delete(win.id);
    notifyChange();
  });

  const hash = `detached=1&kind=${encodeURIComponent(opts.kind)}&tabKey=${encodeURIComponent(opts.tabKey)}`;
  void win.loadFile(join(__dirname, '../renderer/index.html'), { hash });

  win.webContents.once('did-finish-load', () => {
    if (!win.isDestroyed()) {
      win.webContents.send('vibisual:detached:list', listDetached());
      win.webContents.send('vibisual:window:maximize-state', { maximized: win.isMaximized() });
    }
  });

  notifyChange();
  return { windowId: win.id, reused: false };
}

export function closeByTabKey(tabKey: string): boolean {
  const entry = byTabKey.get(tabKey);
  if (!entry) return false;
  if (!entry.window.isDestroyed()) entry.window.close();
  return true;
}

export function closeByWindowId(windowId: number): boolean {
  const entry = byWindowId.get(windowId);
  if (!entry) return false;
  if (!entry.window.isDestroyed()) entry.window.close();
  return true;
}

// §5.4 #14-1 — 별창 미니 타이틀바의 최소화 버튼. event.sender.id 로 자기 창 식별.
export function minimizeByWindowId(windowId: number): boolean {
  const entry = byWindowId.get(windowId);
  if (!entry || entry.window.isDestroyed()) return false;
  entry.window.minimize();
  return true;
}

// §5.4 #14-1 — 별창 미니 타이틀바의 최대화/복원 토글. 상태 변화는 maximize/unmaximize
// 이벤트 핸들러(openDetached)가 renderer 로 푸시하므로 여기선 토글만 한다.
export function toggleMaximizeByWindowId(windowId: number): boolean {
  const entry = byWindowId.get(windowId);
  if (!entry || entry.window.isDestroyed()) return false;
  const win = entry.window;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
  return true;
}

export function closeAll(): void {
  for (const entry of [...byTabKey.values()]) {
    if (entry.dragTimer) {
      clearInterval(entry.dragTimer);
      entry.dragTimer = null;
    }
    if (!entry.window.isDestroyed()) entry.window.destroy();
  }
  byTabKey.clear();
  byWindowId.clear();
}

export function getCursorScreenPoint(): { x: number; y: number } {
  const p = screen.getCursorScreenPoint();
  return { x: p.x, y: p.y };
}

export function getMainContentBounds(): { x: number; y: number; width: number; height: number } | null {
  const main = getMainWindow();
  if (!main || main.isDestroyed()) return null;
  const b = main.getContentBounds();
  return { x: b.x, y: b.y, width: b.width, height: b.height };
}

export function pushRedockHover(tabKey: string, hovering: boolean): void {
  const main = getMainWindow();
  if (!main || main.isDestroyed()) return;
  main.webContents.send('vibisual:tab:redock-hover', { tabKey, hovering });
}

export function redockCommit(tabKey: string): boolean {
  const entry = byTabKey.get(tabKey);
  const main = getMainWindow();
  if (main && !main.isDestroyed()) {
    main.webContents.send('vibisual:tab:redock-commit', { tabKey, kind: entry?.kind ?? null });
    main.focus();
  }
  if (entry) {
    if (entry.dragTimer) {
      clearInterval(entry.dragTimer);
      entry.dragTimer = null;
    }
    if (!entry.window.isDestroyed()) entry.window.destroy();
  }
  return !!entry;
}

// ─── §5.4 #14-1 v2.30 — Redock-drag mode ────────────────────────────────
//
// 별창의 미니 타이틀바를 잡으면 startDetachDrag — 별창 자체를 mini ghost(MINI_W × MINI_H,
// opacity 0.85, alwaysOnTop)로 축소하고 cursor 따라가게 polling. 메인 헤더 영역 위에 진입하면
// 메인 탭바에 redock-hover 푸시 + 별창 자신에게도 hover 신호 전달(미니 박스에 "release to redock"
// 라벨 표시용). pointerup 시 commit=hovering 으로 endDetachDrag 호출.

// mini ghost 로 축소 + cursor 추적 폴링 시작. 최대화/전체화면이어도 동일하게 동작한다.
//
// ⚠ frame:false(테두리 없는) 창에선 Windows 에서 unmaximize()/leave-full-screen 이 ~130ms 비동기다.
// 그 동안 ① isMaximized() 가 계속 true 이고 ② maximize 스타일이 걸린 채라 setBounds() 가 no-op 이라
// mini 로 줄지 못한다. 그래서 풀스크린 카드가 ~130ms 떠 있다가 사용자가 그 전에 손을 떼면 redock 실패.
//
// 해결(v2.36): 줄여야 할 만큼 큰 창이면 win.hide() 로 숨긴 채 unmaximize()+setBounds(mini) 를 한다.
// 창이 보이지 않으면 Windows DWM 이 복원 애니메이션을 돌리지 않고 즉시 처리하므로, 곧바로 이어지는
// show() 시점엔 이미 mini 크기로 cursor 옆에 떠 있다("최대화든 일반이든 잡으면 즉시 따라옴").
// 일반(비최대화) 창은 hide/show 없이 바로 setBounds — 불필요한 깜빡임 회피.
//
// 폴링 루프는 그대로 두어, 혹시 위 즉시 축소가 일부 환경에서 덜 먹어도(실제 getBounds 가 여전히 큼)
// 매 틱 unmaximize+setBounds(mini) 를 재시도하는 안전망 역할을 한다.
function enterMiniGhostAndPoll(entry: DetachedEntry): void {
  const win = entry.window;
  if (win.isDestroyed()) return;
  if (!entry.dragActive) return; // 복원 대기 중 사용자가 이미 떼어 drag 가 끝났다 — 지연 진입 취소.
  if (entry.dragTimer) return; // 이미 진입(중복 방지)

  // 시각 설정. 상태값에 의존하지 않고 무조건 호출.
  try { win.setAlwaysOnTop(true, 'pop-up-menu'); } catch { /* noop */ }
  // 별창 minWidth/minHeight(POPUP_MIN_*) 가 setBounds 를 클램프하므로, mini ghost 동안은
  // 최소 크기를 mini 크기로 풀어준다. endDetachDrag 복원 시 원래 최소 크기로 되돌린다.
  try { win.setMinimumSize(MINI_W, MINI_H); } catch { /* noop */ }
  try { win.setOpacity(0.85); } catch { /* noop */ }

  // cursor 좌상단에 살짝 오프셋해 박스가 cursor 를 감싸도록 — 첫 프레임부터 mini 위치에 둔다.
  const cur0 = screen.getCursorScreenPoint();
  const miniRect = { x: Math.round(cur0.x - 24), y: Math.round(cur0.y - 16), width: MINI_W, height: MINI_H };

  // 줄여야 할 만큼 크면(= 최대화/전체화면) 숨긴 채 즉시 해제+축소 → show. 실제 bounds 로 판정해
  // frame:false 의 isMaximized() 부정확 버그를 우회한다.
  const cb = win.getBounds();
  const needsForceShrink = cb.width > MINI_W * 2 || cb.height > MINI_H * 3;
  if (needsForceShrink) {
    try { win.hide(); } catch { /* noop */ }
    try { win.setFullScreen(false); } catch { /* noop */ }
    try { win.unmaximize(); } catch { /* noop */ }
    try { win.setBounds(miniRect, false); } catch { /* noop */ }
    // show(): 숨기기 직전 active 였던 이 별창을 그대로 다시 active 로 표시 → 포커스 net-zero.
    // 드래그 종료 신호(renderer window mouseup)가 이 창에 확실히 도달하도록 active 로 둔다
    // (showInactive 면 직전 포커스를 떨궈 mouseup 라우팅이 불안정해질 수 있다).
    try { win.show(); } catch { /* noop */ }
  } else {
    try { win.setFullScreen(false); } catch { /* noop */ }
    try { win.unmaximize(); } catch { /* noop */ }
    try { win.setBounds(miniRect, false); } catch { /* noop */ }
  }

  // 미니 모드에 진입했음을 별창 renderer 에게 알림 (미니 박스에 메시지 표시용).
  if (!win.webContents.isDestroyed()) {
    win.webContents.send('vibisual:tab:redock-drag-state', { dragging: true, hovering: false });
  }

  entry.dragTimer = setInterval(() => {
    if (win.isDestroyed()) {
      if (entry.dragTimer) {
        clearInterval(entry.dragTimer);
        entry.dragTimer = null;
      }
      return;
    }
    // 아직 mini 보다 크면(= 최대화/전체화면이 남아있음) 해제를 한 번 더 시도. 상태 플래그가 아니라
    // 실제 bounds 로 판정해 frame:false 의 isMaximized() 부정확 버그를 우회한다.
    const cb = win.getBounds();
    if (cb.width > MINI_W * 2 || cb.height > MINI_H * 3) {
      try { win.setFullScreen(false); } catch { /* noop */ }
      try { win.unmaximize(); } catch { /* noop */ }
    }
    const cur = screen.getCursorScreenPoint();
    // mini 박스의 좌상단을 cursor 좌상단 가까이에 두되 cursor 가 항상 박스 안에 들어오도록 약간 좌상단 오프셋.
    win.setBounds(
      { x: Math.round(cur.x - 24), y: Math.round(cur.y - 16), width: MINI_W, height: MINI_H },
      false,
    );
    const main = getMainWindow();
    if (!main || main.isDestroyed()) return;
    const mb = main.getContentBounds();
    const hover =
      cur.x >= mb.x &&
      cur.x <= mb.x + mb.width &&
      cur.y >= mb.y &&
      cur.y <= mb.y + MAIN_HEADER_ZONE;
    if (hover !== entry.lastHover) {
      entry.lastHover = hover;
      main.webContents.send('vibisual:tab:redock-hover', { tabKey: entry.tabKey, hovering: hover });
      if (!win.webContents.isDestroyed()) {
        win.webContents.send('vibisual:tab:redock-drag-state', { dragging: true, hovering: hover });
      }
    }
  }, DRAG_POLL_MS);
}

export function startDetachDragByWindowId(windowId: number): boolean {
  const entry = byWindowId.get(windowId);
  if (!entry) return false;
  if (entry.dragTimer) return true; // 이미 drag 중
  if (entry.window.isDestroyed()) return false;

  const win = entry.window;
  // 최대화/전체화면 상태여도 enterMiniGhostAndPoll 가 내부에서 해제를 트리거하고, 해제가 실제로
  // 끝난 시점(afterUnmaximized 폴링)에야 mini ghost 로 줄인다 → "최대화 풀고 드래그" 가 보장된다.
  entry.dragActive = true;
  const wasFullScreen = win.isFullScreen();
  const wasMaximized = win.isMaximized();
  entry.wasMaximized = wasMaximized;

  // 복원용 원본 bounds 는 (최대화/전체화면이었다면) 그 이전의 일반 bounds 를 쓴다.
  entry.originalBounds = (() => {
    const b = wasMaximized || wasFullScreen ? win.getNormalBounds() : win.getBounds();
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  })();
  try {
    entry.originalOpacity = win.getOpacity();
  } catch {
    entry.originalOpacity = 1;
  }
  entry.lastHover = false;

  enterMiniGhostAndPoll(entry);

  return true;
}

export function endDetachDragByWindowId(windowId: number, commit: boolean): boolean {
  const entry = byWindowId.get(windowId);
  if (!entry) return false;
  // 비동기 복원(unmaximize) 대기 중 지연 진입(enterMiniGhostAndPoll)을 취소.
  entry.dragActive = false;
  if (entry.dragTimer) {
    clearInterval(entry.dragTimer);
    entry.dragTimer = null;
  }
  // 메인 탭바 hover 글로우 해제 (commit 시엔 redock-commit 푸시가 별도로 처리).
  const main = getMainWindow();
  if (main && !main.isDestroyed() && entry.lastHover) {
    main.webContents.send('vibisual:tab:redock-hover', { tabKey: entry.tabKey, hovering: false });
  }
  entry.lastHover = false;

  if (commit) {
    // redock commit — 별창 destroy + 메인에 푸시.
    redockCommit(entry.tabKey);
    return true;
  }
  // 원본 bounds/opacity 복원.
  const win = entry.window;
  if (win.isDestroyed()) return false;
  if (!win.webContents.isDestroyed()) {
    win.webContents.send('vibisual:tab:redock-drag-state', { dragging: false, hovering: false });
  }
  try { win.setAlwaysOnTop(false); } catch { /* noop */ }
  // mini ghost 진입 시 풀었던 최소 크기를 원래 값으로 복원.
  try { win.setMinimumSize(POPUP_MIN_W, POPUP_MIN_H); } catch { /* noop */ }
  // §5.4 #14-1 — 최대화 상태에서 좌측 redock 트리거를 잡았다 떼면(메인 헤더까지 끌지 않아
  // 재합치기는 취소된 경우) 최대화를 풀고 일반 창으로 복원한다. 이전엔 wasMaximized 면 다시
  // maximize 했으나, 사용자가 그 버튼을 눌러 본체로 넣으려 할 때 최대화가 그대로 유지되는 문제가
  // 있었다 → 누르면 최대화 해제 + 기존 일반 창 동작.
  const bounds = entry.originalBounds;
  entry.wasMaximized = false;
  entry.originalBounds = null;
  try { win.setOpacity(entry.originalOpacity || 1); } catch { /* noop */ }
  // 복원 위치는 cursor 근처(뗀 자리)로. 좌표는 한 번만 정해 매 틱 같은 rect 로 재시도한다.
  const cur = screen.getCursorScreenPoint();
  const target = bounds
    ? { x: Math.round(cur.x - bounds.width / 2), y: Math.round(cur.y - 18), width: bounds.width, height: bounds.height }
    : null;
  // §5.4 #14-1 — 최대화/전체화면이었으면 setBounds 가 먹지 않으므로(그리고 frame:false 는
  // isMaximized() 가 부정확하므로) 실제 bounds 가 target 크기에 근접할 때까지 매 틱 unmaximize +
  // setBounds 를 재시도한다. 이전엔 wasMaximized 면 다시 maximize 했으나, 사용자가 본체로 넣으려
  // 할 때 최대화가 유지되는 문제 → 누르면 최대화 해제 + 기존 일반 창 동작.
  if (target) {
    const applyRestore = (tries: number): void => {
      if (win.isDestroyed()) return;
      const cb = win.getBounds();
      if (cb.width > target.width + 40 || cb.height > target.height + 40) {
        try { win.setFullScreen(false); } catch { /* noop */ }
        try { win.unmaximize(); } catch { /* noop */ }
      }
      win.setBounds(target, false);
      const after = win.getBounds();
      const done = Math.abs(after.width - target.width) <= 40 && Math.abs(after.height - target.height) <= 40;
      if (!done && tries > 0) setTimeout(() => applyRestore(tries - 1), DRAG_POLL_MS);
    };
    applyRestore(40);
  }
  return true;
}
