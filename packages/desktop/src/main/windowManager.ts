import { join } from 'node:path';
import { app, BrowserWindow, screen } from 'electron';
import {
  DETACHED_WINDOW,
  detachedWindowPlacement,
  growSpanRight,
  isCursorDeepInside,
  isCursorOutsideRect,
  shrinkSpanBack,
  stepRedockDwell,
  type SpanGrowth,
} from '@vibisual/shared';
import { hidePopOutGhost, isPopOutGhostVisible, nudgePopOutGhost, popOutGhostBounds, showPopOutGhost } from './ghostFrame';
import { openExternalWithNotice } from './externalOpen';
import { allowWebPageViews } from './webPageSession';
import { safeAppThemeChrome, trackThemedWindow } from './themeChrome';
import { broadcastWindowMessage } from './windowDelivery';
import {
  isOverlaySlotUsable,
  overlayAttentionOnReuse,
  overlayBubbleOpensIde,
  overlayExpandAttentionDue,
  overlayFollowsMainFocus,
  overlayOpenIdeCommand,
  overlayRaiseSteps,
  overlayReuseActivation,
  overlayTopMostFor,
  releaseSlotIfOwner,
} from './overlaySlot';
import { acceptReportedSize, dipStepFor, landedSpan, movedBounds, snapDip, type OverlaySize } from './overlaySize';
import { AppWindowTransfers, type AppWindowListItem, type AppWindowPlacement } from './appWindowTransfer';
import { appWindowPrimaryPressed } from './appWindowMouseButton';
import { createAppWindowClose } from './appWindowClose';

// SCENARIO.md §5.4 #14-1 — 탭 Detach/Redock 별창 매니저(tabKey ↔ BrowserWindow). 같은 서버·preload 라 별창도 graph_snapshot 을 받는다.
// Redock-drag: 미니 타이틀바를 끌면 별창이 mini ghost(MINI_W×MINI_H, 0.85, alwaysOnTop)로 줄어 커서를 따르고, 메인 헤더 위에서 떼면 redock.

/**
 * 창 아이콘 경로 — Windows 만 `.ico`, 나머지 `.png`. 모든 `BrowserWindow` 가 이 한 곳을 쓰고 플랫폼을 인자로 받아 시험한다
 * (각자 적으면 갈려도 그 OS 에서 띄우기 전엔 모른다).
 */
export function windowIconPath(baseDir: string, platform: NodeJS.Platform): string {
  return join(baseDir, '..', platform === 'win32' ? 'icon.ico' : 'icon.png');
}

/**
 * §보안 감사 2026-09-09 — 창이 우리 문서를 떠나지 못하게 잠근다(본체 창과 같은 규약을 이 파일의 다섯 창에도).
 * `sandbox:false` + preload(`window.api` 전량) 창은 최상위 항해 뒤에도 preload 가 원격 문서에 다시 주입된다(Electron 31 실측) — 창 내용은 우리가 안 만든다.
 * 새 창·최상위 이동은 바깥 브라우저로(스킴은 `externalOpen`). **iframe 안 항해는 건드리지 않는다**(프리뷰가 그 길로 산다, `sandbox` 가 따로 잠근다).
 */
export function hardenWindow(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalWithNotice(url, win.webContents);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (win.webContents.isDestroyed()) return;
    if (url === win.webContents.getURL()) return;
    event.preventDefault();
    openExternalWithNotice(url, win.webContents);
  });
}
export type DetachKind = 'project' | 'iframe';

export interface DetachOptions {
  kind: DetachKind;
  tabKey: string;
  cursor?: { x: number; y: number } | undefined;
  /**
   * §5.4 #14-1 (H) 탭을 끌어 놓은 판 — 손을 뗀 자리에 멈춰 선 선(가상 창)의 자리·크기 그대로 선다.
   * 선의 경계는 main 이 직접 읽는다(배율이 다른 모니터에서 렌더러 좌표는 어긋난다). 선이 없으면 `cursor` 기준 자리.
   */
  fromGhost?: boolean | undefined;
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

// §5.4 #14-1 (H) 별창 크기는 shared 한 곳이 쥔다 — 떼어 내는 동안 렌더러가 그리는 선(가상 창)이
//   이 크기로 서야 놓는 순간 창이 선과 다른 크기로 튀지 않는다.
const POPUP_MIN_W = DETACHED_WINDOW.minWidth;
const POPUP_MIN_H = DETACHED_WINDOW.minHeight;

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
  broadcastWindowMessage(BrowserWindow.getAllWindows(), 'vibisual:detached:list', list);
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
  // §5.4 #14-1 (H) 탭을 끌어 놓은 판 — 손을 뗀 자리에 **멈춰 선 선(가상 창)**의 자리·크기 그대로 선다
  //   (§5.13 (S-10) 앱 창 · §5.5 #17-6 (H-17) ④ "놓은 그 자리 그 크기 그대로"와 같은 규율). 선이 없으면
  //   (못 띄운 환경 · 우클릭 [별창으로 분리]) 종전대로 커서 기준 자리다.
  const ghostBounds = opts.fromGhost === true ? popOutGhostBounds() : null;
  const existing = byTabKey.get(opts.tabKey);
  if (existing && !existing.window.isDestroyed()) {
    if (existing.window.isMinimized()) existing.window.restore();
    existing.window.focus();
    // 이어받을 새 창이 없다 — 멈춰 선 선을 남기지 않는다(클릭통과라 사용자가 없앨 수 없다).
    if (ghostBounds) finishGhostHandoff();
    return { windowId: existing.id, reused: true };
  }

  const placement = detachedWindowPlacement({ ghost: ghostBounds, cursor: opts.cursor ?? null });

  const win = new BrowserWindow({
    width: placement.width,
    height: placement.height,
    minWidth: POPUP_MIN_W,
    minHeight: POPUP_MIN_H,
    ...(placement.x !== undefined && placement.y !== undefined ? { x: placement.x, y: placement.y } : {}),
    show: false,
    // §4 앱 테마 — 그리기 전의 빈 창도 고른 테마의 바탕이다(아래 trackThemedWindow 가 바뀔 때 다시 칠한다).
    backgroundColor: safeAppThemeChrome().background,
    autoHideMenuBar: true,
    title: 'Vibisual',
    // §5.4 #14-1 — 별창은 OS 제목줄을 우리 UI 가 대신한다. titleBarOverlay 는 OS 가 그린 단추가 미니 타이틀바와 겹치므로 frame:false.
    frame: false,
    icon: windowIconPath(__dirname, process.platform),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: false,
      // §5.13 (R) — Chromium 내장 PDF 뷰어를 켠다. 우리가 PDF 렌더를 쓰지 않고 iframe 하나로 여는 근거.
      plugins: true,
      contextIsolation: true,
      nodeIntegration: false,
      // §5.23 「더블클릭」 — 떼어 낸 iframe 탭도 인터넷 페이지를 격리 웹뷰로 띄운다(본체 창과 같은 규칙 · 아래 가드와 한 쌍).
      webviewTag: true,
    },
  });
  hardenWindow(win);
  // 태그를 켠 이 자리에서 웹뷰 가드를 건다 — 전용 메모리 세션·샌드박스·권한 거절(`webPageView.ts`).
  allowWebPageViews(win.webContents);
  // §4 앱 테마 — 테마를 바꾸면 이 창의 바탕도 다시 칠한다.
  trackThemedWindow(win);

  // §5.4 #14-1 (H) 선이 서 있으면 이 창이 **보일 때까지** 살려 둔다 — 먼저 걷으면 창이 뜨기까지 놓은
  //   자리가 빈다(그물은 나가는 길의 4초). 창이 보이면 그 자리를 창이 이어받는다("선이 창이 된다").
  //   별창은 불투명 바탕이라(테마 배경색) 앱 창처럼 보인 뒤 합성 한 박자만 기다리면 된다.
  if (ghostBounds) armGhostHandoff(win.id);
  win.on('ready-to-show', () => {
    if (!win.isDestroyed()) win.show();
    if (ghostBounds) finishGhostHandoffOnceShown(win.id);
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
    // §5.4 #14-1 (H) 보이기 전에 닫혔다 — 이 창을 기다리던 선을 남기지 않는다.
    if (isGhostHandoffTarget(win.id)) finishGhostHandoff();
    notifyChange();
  });

  const hash = `detached=1&kind=${encodeURIComponent(opts.kind)}&tabKey=${encodeURIComponent(opts.tabKey)}`;
  void win.loadFile(join(__dirname, '../renderer/index.html'), { hash }).catch(() => {
    // §5.4 #14-1 (H) 못 열었다 — 이 창을 기다리던 선을 그물(4초)까지 끌지 않고 걷는다.
    if (isGhostHandoffTarget(win.id)) finishGhostHandoff();
  });

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

// 별창 + §5.12 Command Center + §5.13 (O) 내부 앱 창 — 모두 `vibisual:window:*-self` 로 자기 창을 조작한다(Command Center 는 redock 만 없다).
// frame:false 라 여기서 빠지면 제목줄 단추가 안 먹는다 — 새 창은 여기에도 등록할 것.
function selfWindowById(windowId: number): BrowserWindow | null {
  const detachedEntry = byWindowId.get(windowId);
  if (detachedEntry) return detachedEntry.window;
  if (commandCenter && commandCenter.id === windowId) return commandCenter.window;
  for (const entry of appWindows.values()) {
    if (entry.id === windowId) return entry.window;
  }
  return null;
}

export function closeByWindowId(windowId: number): boolean {
  // This IPC is sent only after renderer confirmation; transfers use the same explicit teardown.
  for (const entry of appWindows.values()) if (entry.id === windowId) return entry.lifecycle.close();
  const win = selfWindowById(windowId);
  if (!win) return false;
  if (!win.isDestroyed()) win.close();
  return true;
}

// §5.4 #14-1 — 별창 미니 타이틀바의 최소화 버튼. event.sender.id 로 자기 창 식별.
export function minimizeByWindowId(windowId: number): boolean {
  const win = selfWindowById(windowId);
  if (!win || win.isDestroyed()) return false;
  win.minimize();
  return true;
}

// §5.4 #14-1 — 별창 미니 타이틀바의 최대화/복원 토글. 상태 변화는 maximize/unmaximize
// 이벤트 핸들러(openDetached)가 renderer 로 푸시하므로 여기선 토글만 한다.
export function toggleMaximizeByWindowId(windowId: number): boolean {
  const win = selfWindowById(windowId);
  if (!win || win.isDestroyed()) return false;
  toggleMaximize(win);
  return true;
}

// §3.7 · §5.5 #17-6 (H-19) — 본체 창 최대화/복원(로고 덮개는 `app-nodrag` 라 OS 가 더블클릭을 모른다). 본체는 `selfWindowById` 에 없어
// 보낸 창 그 자체로 맞춘다 — 목록은 `win.id`, 채널은 `event.sender.id`(webContents 번호)라 다르다. 최소화·닫기는 잇지 않는다(닫으면 앱이 꺼진다).
export function toggleMaximizeMainWindow(sender: BrowserWindow | null): boolean {
  if (!sender || sender.isDestroyed() || sender !== getMainWindow()) return false;
  toggleMaximize(sender);
  return true;
}

/** 최대화면 풀고 아니면 최대화한다 — 바뀐 상태를 알리는 일은 창의 maximize/unmaximize 이벤트가 맡는다. */
function toggleMaximize(win: BrowserWindow): void {
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
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
  // Closing the main application owns teardown, including hidden retained app renderers.
  for (const entry of [...appWindows.values()]) if (!entry.window.isDestroyed()) entry.window.destroy();
  appWindows.clear();
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

// §5.4 #14-1 Redock-drag — startDetachDrag 가 별창을 mini ghost 로 줄여 커서를 폴링한다. 메인 헤더 위면 메인 탭바·별창에 hover 신호
// ("release to redock"), pointerup 에 commit=hovering 으로 endDetachDrag.

// mini ghost 로 축소 + 커서 추적 폴링(최대화/전체화면도 같다). frame:false 창은 Windows 에서 unmaximize 가 ~130ms 비동기라 그동안
// isMaximized() 가 참이고 setBounds 가 no-op 이다 — 그래서 큰 창은 hide() 한 채 unmaximize+setBounds(mini)(숨긴 창은 즉시 처리된다).
// 일반 창은 바로 setBounds. 폴링은 매 틱 다시 줄이는 안전망이다.
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
  // §5.4 #14-1 — 최대화 상태에서 redock 트리거를 잡았다 떼면(재합치기 취소) 일반 창으로 복원한다(다시 최대화하지 않는다).
  const bounds = entry.originalBounds;
  entry.wasMaximized = false;
  entry.originalBounds = null;
  try { win.setOpacity(entry.originalOpacity || 1); } catch { /* noop */ }
  // 복원 위치는 cursor 근처(뗀 자리)로. 좌표는 한 번만 정해 매 틱 같은 rect 로 재시도한다.
  const cur = screen.getCursorScreenPoint();
  const target = bounds
    ? { x: Math.round(cur.x - bounds.width / 2), y: Math.round(cur.y - 18), width: bounds.width, height: bounds.height }
    : null;
  // §5.4 #14-1 — 최대화/전체화면이면 setBounds 가 먹지 않고 frame:false 는 isMaximized() 가 부정확하다 — 실제 bounds 가 target 에 근접할 때까지 매 틱 unmaximize + setBounds 를 재시도한다.
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

// §5.5 #17-6 — 버블 오버레이 창: 커스텀/CMD 에이전트 버블을 데스크톱 상시-위 위젯으로 분리(별창처럼 같은 서버·preload).
// frame:false + transparent + alwaysOnTop + skipTaskbar 의 버블 크기 창 · 더블클릭 시 IDE 크기 ↔ 닫으면 축소 · 포커스 무관 위(§17-6 (E)) · Header 전역 토글(userVisible).

interface OverlayEntry {
  id: number;
  agentId: string;
  projectId: string;
  window: BrowserWindow;
  /** 버블 ↔ IDE 펼침 상태. */
  expanded: boolean;
  /** 펼치기 직전의 버블 창 bounds(접을 때 위치 복원용). */
  collapsedBounds: { x: number; y: number; width: number; height: number } | null;
  /** §17-6 (G) — 우클릭 메뉴 불투명도(1/0.75/0.5). 접힘 버블에만 적용, 펼침 시 1로 보고 접으면 이 값 복원. */
  opacity: number;
  /**
   * §17-6 (H-5) — 최대화 상태는 OS 가 아니라 이 값이 답한다. 테두리 없는 창은 `unmaximize()` 뒤에도 `isMaximized()` 가 참이고(§5.4 #14-1),
   * 투명 창의 네이티브 최대화는 플랫폼마다 갈린다.
   */
  maximized: boolean;
  /** 최대화 직전의 자리 — 되돌릴 때 **정확히** 여기로 온다(어디로 갈지 OS 에 묻지 않는다). */
  restoreBounds: { x: number; y: number; width: number; height: number } | null;
  /**
   * §5.5 #17-27 ①-1 — 편집창 판이 열리며 **오른쪽으로 넓힌** 기록(가로만). 판이 닫히면 이것과
   * 대조해 되돌린다 — 그 사이 사용자가 폭을 바꿨으면 손대지 않는다. 넓히지 않았으면 `null`.
   */
  editorGrowth: SpanGrowth | null;
  /**
   * §17-6 (H-10) — **이미 닫으라고 말한 창인가.** `close()` 와 `closed` 사이에는 틈이 있고,
   * 그동안 `isDestroyed()` 는 아직 거짓이다. 그 틈에 들어온 팝아웃이 이 창을 "이미 있는 창"으로
   * 알고 다시 쓰면, 새 창이 서지 않은 채 이 창이 죽어 화면에서 IDE 가 통째로 사라진다.
   */
  closing: boolean;
  /**
   * §17-6 (H-19) — 이 창이 가져야 할 크기(DIP) — 창에 되묻지 않는다. Windows 분수 배율에서 창은 쓸 때·읽을 때 따로 반올림해 `setPosition()` 마다
   * 1px(실측 150%: 40번에 +40px), `getBounds()` 되쓰기마다 2px 자란다. 크기를 정하는 자리마다 여기에 적고 창엔 이 값만 쓴다(`overlaySize.ts`).
   */
  size: OverlaySize;
  /** (H-19) 우리가 마지막으로 크기를 쓴 시각 — 그 직후의 `resize` 는 OS 의 반올림 메아리다. */
  sizeWrittenAt: number;
  /**
   * §17-6 (H-25) ② — 예열 중인 창(미리 지어 부팅만, 어디에도 안 보임). `listOverlays`·`applyOverlayVisibility`·`ready-to-show` 표시에서 빠진다 —
   * 그 자리엔 윤곽선이 있어 실물이 겹치면 무엇이 진짜인지 모른다. 손을 떼면 `openOverlay` 재사용 갈래가 풀고 세운다.
   */
  warming: boolean;
  /**
   * §17-6 (H-25) ④ — 그 창이 자기 IDE 를 다 그렸는가(`overlay:shell-ready`). 예열 때문에 이 신호가 뗌보다 먼저 올 수 있어 인계와 따로 적는다 —
   * 뗌에 선을 곧바로 걷을지 기다릴지를 이 비트가 가른다.
   */
  shellReady: boolean;
  /**
   * §17-6 (H-27) ④ — 앱이 이 접힌 창에 IDE 를 열라고 보낸 시각(없으면 `null`). 기척은 IDE 일 때만 비추므로((H-16)) 시각만 적어 두고,
   * 펴는 순간(`expandOverlaySelf`) 한 번 읽어 앞세우기·기척을 준 뒤 지운다.
   */
  attentionOnExpandAt: number | null;
  /**
   * §17-6 (H-27) ⑦ — 이 창이 IDE 를 다 그리면 세울 세션(없으면 `null`, 모양은 main 이 모른다). 부팅 중인 렌더는 아직 [IDE 열기]를 안 들어
   * 바로 보내면 사라진다 — `overlayShellReady` 에 한 번 건네고 지운다. 버블로 태어난 창은 그 신호가 없어 창과 함께 사라진다(이미 듣고 있다).
   */
  pendingIdeFocus: unknown;
  /**
   * §17-6 (H-28) — 사용자가 [항상 위에 고정]을 켰는가. 펼친 IDE 는 기본이 보통 층((E))이라 참이면 펼친 동안 `'floating'`(`overlayTopMostFor`).
   * 접었다 펴도 남고, 창이 닫히거나 앱을 다시 켜면 풀린다((F) 휘발).
   */
  pinned: boolean;
}

// 실제 BubbleNode 한 개(+선택 코로나/라벨)가 여유 있게 들어가고 살짝 드래그할 공간이 있는 컴팩트 창.
const OVERLAY_BUBBLE_W = 280;
const OVERLAY_BUBBLE_H = 320;
// 펼친(IDE) 상태에서 사용자가 줄일 수 있는 최소 크기.
const MIN_FLOAT_W_OVERLAY = 460;
const MIN_FLOAT_H_OVERLAY = 340;
// 오버레이 창을 처음 띄울 때 살짝씩 어긋나게 캐스케이드.
let overlayCascade = 0;

const overlaysByAgentId = new Map<string, OverlayEntry>();
const overlaysByWindowId = new Map<number, OverlayEntry>();
// 사용자 전역 토글(Header). 기본 표시.
let overlaysUserVisible = true;

/**
 * §17-6 (H-10) — 장부에서 지금 뗀다(`closed` 를 기다리면 그 틈의 팝아웃이 죽어 가는 창을 다시 쓴다). 내가 쥔 칸만 뗀다 —
 * 같은 `agentId` 로 새 창이 섰다면 조건 없이 지울 때 산 창이 빠져 뗌 신호가 못 닿는다(커서에 달라붙은 창).
 */
function detachOverlaySlot(entry: OverlayEntry): void {
  releaseSlotIfOwner(overlaysByAgentId, entry.agentId, entry);
  releaseSlotIfOwner(overlaysByWindowId, entry.id, entry);
}

/**
 * §17-6 (H-10) — 오버레이 창을 닫는 한 길: 자리를 먼저 놓고, 걸린 시계·윤곽선을 걷은 뒤 닫는다.
 * 닫는 자리마다 `win.close()` 만 부르면 하나만 정리를 빠뜨려도 고아 폴링·고아 윤곽선이 남는다.
 */
function closeOverlayEntry(entry: OverlayEntry): void {
  if (entry.closing) return;
  entry.closing = true;
  detachOverlaySlot(entry);
  stopOverlayDrag(entry.id);
  // (H-7) 이 창이 이어받기로 했던 선은 여기서 걷는다 — 받을 창이 닫히므로 기다릴 것이 없다.
  if (isGhostHandoffTarget(entry.id)) finishGhostHandoff();
  if (!entry.window.isDestroyed()) entry.window.close();
}

// §17-6 (H-19) — 창 크기는 장부가 답한다. 크기를 쓰는 길은 아래 둘뿐이고 창에 되묻지 않는다(배율 반올림이 섞여 자란다). 자리는 그 화면의
// 배율 격자에 맞춘다 — 격자 밖이면 물리 폭이 1px 씩 흔들려 틱마다 다시 놓인다(실측 150%: 40번 이동에 `resize` 39회, 격자 위 0회).

/** 이 자리(DIP)가 놓일 화면의 배율 격자 — 좌표·크기를 이 배수로 맞춰 써야 물리 픽셀이 흔들리지 않는다. */
export function dipStepAt(x: number, y: number): number {
  try {
    return dipStepFor(screen.getDisplayNearestPoint({ x: Math.round(x), y: Math.round(y) }).scaleFactor);
  } catch {
    return 1;
  }
}

/** 크기까지 **우리가 정해서** 쓴다 — 장부를 먼저 적고 창에 쓴다(펼치기·접기·최대화·복원·칩 복원). */
function writeOverlayBounds(entry: OverlayEntry, b: { x: number; y: number; width: number; height: number }): void {
  entry.size = { width: Math.round(b.width), height: Math.round(b.height) };
  entry.sizeWrittenAt = Date.now();
  if (entry.window.isDestroyed()) return;
  try {
    entry.window.setBounds(movedBounds(entry.size, b.x, b.y, dipStepAt(b.x, b.y)), false);
  } catch { /* noop */ }
}

/** 자리만 옮긴다 — 크기는 장부 값으로 **함께** 쓴다(`setPosition` 은 창에 되물어 배율에서 자란다). */
function moveOverlayTo(entry: OverlayEntry, x: number, y: number): void {
  entry.sizeWrittenAt = Date.now();
  if (entry.window.isDestroyed()) return;
  try {
    entry.window.setBounds(movedBounds(entry.size, x, y, dipStepAt(x, y)), false);
  } catch { /* noop */ }
}

// §17-6 (H) — 창이 자리를 옮길 때 들고 가는 상자(렌더러끼리의 짐, main 은 해석하지 않는다). `openIDEOverlay` 로 새로 만들면 편집 탭·뷰가 초기화되므로
// 보내는 쪽이 넣고 받는 쪽이 꺼낸다. 한 번 꺼내면 사라진다. 건너는 동안만 살아 디스크에 쓰지 않는다.
interface PaneHandoffBox {
  handoff: unknown;
  at: number;
}
/** 늦게 꺼낸 상자는 이미 뜻이 없다 — 창이 뜨는 데 걸리는 시간보다 넉넉히 준 상한. */
const PANE_HANDOFF_TTL_MS = 60_000;
const paneHandoffs = new Map<string, PaneHandoffBox>();

/** 오래된 상자를 걷어낸다 — 받는 창이 끝내 안 뜨면(취소·크래시) 그대로 남기 때문. */
function prunePaneHandoffs(): void {
  const now = Date.now();
  for (const [key, box] of paneHandoffs) {
    if (now - box.at > PANE_HANDOFF_TTL_MS) paneHandoffs.delete(key);
  }
}

/** 보내는 쪽이 짐을 맡긴다(같은 에이전트의 옛 상자는 덮어쓴다 — 마지막 것이 진짜다). */
export function putPaneHandoff(agentId: string, handoff: unknown): void {
  prunePaneHandoffs();
  if (handoff === undefined || handoff === null) {
    paneHandoffs.delete(agentId);
    return;
  }
  paneHandoffs.set(agentId, { handoff, at: Date.now() });
}

/** 받는 쪽이 꺼낸다 — **꺼내면 사라진다**. 없으면 null(받는 쪽은 종전대로 새 창을 만든다). */
export function takePaneHandoff(agentId: string): unknown {
  prunePaneHandoffs();
  const box = paneHandoffs.get(agentId);
  if (!box) return null;
  paneHandoffs.delete(agentId);
  return box.handoff;
}

export interface OverlayInfo {
  windowId: number;
  agentId: string;
  projectId: string;
  expanded: boolean;
}

export function listOverlays(): OverlayInfo[] {
  const out: OverlayInfo[] = [];
  for (const e of overlaysByAgentId.values()) {
    // (H-25) ② 예열 창은 아직 태어나지 않았다 — 놓기도 전에 헤더 개수·창 목록이 흔들리지 않게.
    if (e.warming) continue;
    out.push({ windowId: e.id, agentId: e.agentId, projectId: e.projectId, expanded: e.expanded });
  }
  return out;
}

export function getOverlaysVisible(): boolean {
  return overlaysUserVisible;
}

export function broadcastOverlayList(): void {
  const list = listOverlays();
  const visible = overlaysUserVisible;
  broadcastWindowMessage(BrowserWindow.getAllWindows(), 'vibisual:overlay:list', { overlays: list, userVisible: visible });
}

// 한 오버레이가 지금 보여야 하는지 — 오버레이의 본질은 "어떤 프로그램이 선택(포커스)돼 있든 항상
// 윈도우 위에 떠 있는 것"이므로(사용자 정의), 메인 포커스 여부와 무관하게 전역 토글만 본다.
function overlayShouldShow(): boolean {
  return overlaysUserVisible;
}

/**
 * §17-6 (E) — 층을 다시 박는다(`expanded` 가 층을 정한다). Windows 는 `setResizable`/`setBounds`/`show` 전이가 층을 조용히 풀어 전이마다 다시 박는다(멱등).
 * 접힌 버블은 상시-위(`screen-saver`), 펼친 IDE 는 보통 층 — 큰 작업 창까지 위면 옆에서 다른 앱을 못 쓴다. 값은 `overlayTopMostFor` 한 곳.
 * `pinned` 는 필수 인자 — 기본값이 있으면 전이 하나가 고정을 빠뜨려도 타입이 말하지 않는다.
 */
function keepOverlayOnTop(win: BrowserWindow, expanded: boolean, pinned: boolean): void {
  if (win.isDestroyed()) return;
  const want = overlayTopMostFor(expanded, pinned);
  try {
    if (want.alwaysOnTop) win.setAlwaysOnTop(true, want.level);
    else win.setAlwaysOnTop(false);
  } catch { /* noop */ }
}

/**
 * §17-6 (G) — **커서 팝업 메뉴는 그 규칙 밖이다.** 이 창은 버블 위에서도 펼친 IDE 위에서도
 * 떠야 하고 수명이 한 손짓뿐이라, 늘 상시-위다(위 갈림을 타면 메뉴가 자기 대상 창 뒤로 숨는다).
 */
function keepOverlayMenuOnTop(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  try { win.setAlwaysOnTop(true, 'screen-saver'); } catch { /* noop */ }
}

/**
 * §17-6 (H-16) — 이미 서 있는 창을 앞으로 세운다. 순서는 `overlayRaiseSteps` 한 곳(세 OS 를 인자로 시험), 여기서는 실행만.
 * 멱등이라 펼치기 등 층·Z 순서를 흩뜨리는 전이 뒤에 한 번 더 부른다.
 */
function raiseOverlayWindow(entry: OverlayEntry, activation: 'inactive' | 'foreground'): void {
  const win = entry.window;
  if (win.isDestroyed()) return;
  const steps = overlayRaiseSteps({
    platform: process.platform,
    activation,
    minimized: win.isMinimized(),
  });
  for (const step of steps) {
    try {
      switch (step) {
        case 'restore': win.restore(); break;
        case 'showInactive': win.showInactive(); break;
        case 'show': win.show(); break;
        // mac 전용 — 창 하나를 포커스해도 앱이 뒤에 있으면 그 포커스는 화면에 보이지 않는다.
        case 'activateApp': app.focus({ steal: true }); break;
        case 'focus': win.focus(); break;
        case 'reassertTop': keepOverlayOnTop(win, entry.expanded, entry.pinned); break;
        case 'moveTop': win.moveTop(); break;
      }
    } catch { /* noop — 죽는 찰나에 닿아도 나머지 손짓까지 잃지 않는다 */ }
  }
}

function applyOverlayVisibility(entry: OverlayEntry, focusIt: boolean): void {
  const win = entry.window;
  if (win.isDestroyed()) return;
  // (H-25) ② 예열 창은 **어느 길로도** 보이지 않는다 — 지금 그 자리에는 윤곽선이 있고, 실물
  //   창이 겹쳐 뜨면 무엇이 진짜인지 알 수 없다. 세우는 자리는 뗌(재사용 갈래) 하나다.
  if (entry.warming) return;
  if (overlayShouldShow()) {
    if (focusIt) win.show();
    else if (!win.isVisible()) win.showInactive();
    keepOverlayOnTop(win, entry.expanded, entry.pinned);
  } else if (win.isVisible()) {
    win.hide();
  }
}

function applyAllOverlayVisibility(): void {
  for (const e of overlaysByAgentId.values()) applyOverlayVisibility(e, false);
}

/**
 * §17-6 (E-2) — 본체 창이 포커스를 받으면 밖의 펼친 IDE 를 같이 올린다(보통 층이라 깔릴 수 있고 `skipTaskbar` 라 작업표시줄에도 없다).
 * 포커스는 옮기지 않는다(`moveTop` 만). 대상은 `overlayFollowsMainFocus`(접힌 버블·감춤·최소화·닫히는 중·예열 제외).
 */
export function raiseExpandedOverlaysForMainFocus(): void {
  for (const entry of overlaysByAgentId.values()) {
    const win = entry.window;
    const destroyed = win.isDestroyed();
    const follows = overlayFollowsMainFocus({
      expanded: entry.expanded,
      visible: !destroyed && win.isVisible(),
      minimized: !destroyed && win.isMinimized(),
      closing: entry.closing,
      destroyed,
      warming: entry.warming,
    });
    if (!follows) continue;
    try { win.moveTop(); } catch { /* noop — 죽는 찰나에 닿아도 나머지 창까지 잃지 않는다 */ }
  }
}

// §5.5 #17-6 (H-7) 선 → 창 인계. 투명 창의 `ready-to-show` 는 빈 문서의 첫 페인트이고 끌어낸 창은 그 뒤로도 부팅이 남아, 그때 걷으면 커서 밑이 빈다 —
// 렌더러가 다 그렸다고 말할 때 걷는다. 대답이 없어도 선이 남지 않게 그물을 둔다(잠깐 비는 편이 클릭통과 선이 영영 얹힌 것보다 낫다).

/** 렌더러가 "다 그렸다"를 말하지 못할 때 선을 걷어 주는 상한(ms). */
const GHOST_HANDOFF_FALLBACK_MS = 4_000;

/**
 * (H-15) 들어오는 길의 그물은 짧다 — 4초는 새로 태어나는 창(초 단위)용이고, 돌아오는 길은 도는 메인 창이 칸 하나 그리는 일(한두 프레임)이다.
 * 같은 값이면 말 못 한 판에서 클릭통과 선이 4초간 커서에 붙는다.
 */
const GHOST_REDOCK_FALLBACK_MS = 700;

/** 지금 선을 이어받기로 되어 있는 창과 그 그물. 선이 하나뿐이라 이 판도 하나뿐이다. */
let ghostHandoff: { windowId: number; timer: NodeJS.Timeout } | null = null;

/** 이 창이 지금 선을 이어받기로 되어 있는가. */
function isGhostHandoffTarget(windowId: number): boolean {
  return ghostHandoff?.windowId === windowId;
}

/** 인계 끝 — 선을 걷고 그물을 푼다(여러 번 불려도 안전). */
function finishGhostHandoff(): void {
  if (ghostHandoff) {
    clearTimeout(ghostHandoff.timer);
    ghostHandoff = null;
  }
  hidePopOutGhost();
}

/** 이 창이 다 그릴 때까지 선을 살려 둔다(앞 판은 먼저 끝낸다). (H-15) 그물 길이는 기다리는 것에 따라 부르는 쪽이 넘긴다(기본은 나가는 길의 4초). */
function armGhostHandoff(windowId: number, fallbackMs: number = GHOST_HANDOFF_FALLBACK_MS): void {
  if (ghostHandoff) clearTimeout(ghostHandoff.timer);
  ghostHandoff = {
    windowId,
    timer: setTimeout(() => { ghostHandoff = null; hidePopOutGhost(); }, fallbackMs),
  };
}

/** §5.13 (S-10) 끌어낸 내부 앱 창이 보인 뒤 선을 걷기까지(ms) — `show()` 순간엔 합성 전일 수 있다. 불투명 창이라 합성 몇 프레임이면 된다. */
const APP_GHOST_SHOWN_SETTLE_MS = 50;

/** §5.13 (S-10) 이 창이 보였다 — 한 박자 뒤 그때도 선의 주인일 때만 걷는다. 주인을 다시 세우지 않는다 — 그 사이 선이 걷혔다면 지금 선은 다른 판의 것이다. */
function finishGhostHandoffOnceShown(windowId: number): void {
  setTimeout(() => { if (isGhostHandoffTarget(windowId)) finishGhostHandoff(); }, APP_GHOST_SHOWN_SETTLE_MS);
}

/**
 * (H-12) 선을 걷어 달라는 렌더러의 부탁 — 그물까지 함께 푼다(남으면 다음 판의 선을 엉뚱한 때에 걷는다).
 * 들어오는 길에서 앱 안 창이 자리를 이어받아 다 그린 뒤 부른다(나가는 길의 `overlay:shell-ready` 와 같은 뜻).
 */
export function dismissPopOutGhost(): boolean {
  finishGhostHandoff();
  return true;
}

/**
 * (H-7) 끌어내서 만든 창이 **자기 IDE 를 다 그렸다**고 알려 왔다 — 선이 서 있던 자리를 창이
 * 이어받은 그 순간이다. 다른 창(그냥 켠 버블 창 등)이 말해도 조용히 넘어간다.
 */
export function overlayShellReady(senderWindowId: number): boolean {
  // (H-25) ④ **다 그렸다는 사실은 인계와 따로 적어 둔다.** 예열 창은 아직 선의 주인이 아니라
  //   아래 판정에서 걸러지는데, 뗌에 선을 곧바로 걷을지를 가르는 것이 바로 이 신호다 —
  //   여기서 흘려보내면 예열이 다 끝난 판에서도 종전처럼 기다리게 된다.
  const entry = overlaysByWindowId.get(senderWindowId);
  if (entry) {
    entry.shellReady = true;
    // (H-27) ⑦ 갓 지은 창에 미뤄 둔 세션을 이제 건넨다 — 이 창의 렌더가 방금 IDE 를 다 그렸으니 듣고 있다.
    //   인계 판정보다 **앞**이어야 한다 — 이 창이 선의 주인이 아니면 아래에서 곧바로 돌아간다.
    const focus = entry.pendingIdeFocus;
    entry.pendingIdeFocus = null;
    if (focus !== null && focus !== undefined && !entry.window.webContents.isDestroyed()) {
      entry.window.webContents.send('vibisual:overlay:menu-command', { command: 'open-ide', focus });
    }
  }
  if (!isGhostHandoffTarget(senderWindowId)) return false;
  finishGhostHandoff();
  return true;
}

/**
 * §17-6 (H-25) — 그 에이전트의 오버레이 창이 장부에 있는가(밖이든 예열 중이든, 닫히는 중은 없음 — (H-10)). 예열은 거짓일 때만 —
 * 있는데 또 부르면 `openOverlay` 재사용 갈래가 놓기도 전에 창을 앞으로 세운다.
 */
export function hasOverlayForAgent(agentId: string): boolean {
  const entry = overlaysByAgentId.get(agentId);
  if (!entry) return false;
  return isOverlaySlotUsable({ closing: entry.closing, destroyed: entry.window.isDestroyed() });
}

/**
 * §17-6 (H-25) ⑤ — 예열해 둔 창을 거둔다(앱 안에 놓은 판). 안 거두면 다음에 꺼낼 때 재사용 갈래가 그 빈 창을 집는다.
 * `warming` 이 아닌 창은 건드리지 않는다 — 닫으면 보던 IDE 가 사라진다.
 */
export function cancelWarmOverlay(agentId: string): boolean {
  const entry = overlaysByAgentId.get(agentId);
  if (!entry || !entry.warming) return false;
  closeOverlayEntry(entry);
  return true;
}

// §5.5 #17-6 (H-8) 앱 안 드래그의 눈 — 렌더러 `mousemove` 가 창 밖에서도 오는 것은 그 창 `mousedown` 의 캡처 덕이다. (H-4) ③ 으로 이어받은 판엔 그것이 없어
// 커서가 앱 밖으로 나가면 렌더러가 못 본다(가장자리 띠 3px 도 빠른 손은 못 잡는다). 그동안 main 이 같은 폴링으로 본다 — 판정은 shared `isCursorOutsideRect`.
// 알림은 한 번뿐, 그 뒤는 (H-4) 매달림·뗌 그물이 받는다.

/** 감시가 스스로 멎는 상한(ms) — 렌더러가 끝을 말하지 못해도 타이머가 남지 않게. */
const PANE_ESCAPE_TTL_MS = 30_000;
/** 커서가 창 경계에서 이만큼 더 나가야 "밖"으로 읽는다(px) — 렌더러 `POP_OUT_MARGIN` 과 같은 값. */
const PANE_ESCAPE_MARGIN_PX = 24;

/** 지금 앱 안 드래그를 지켜보는 판. 한 번에 한 손짓뿐이라 이 판도 하나뿐이다. */
let paneEscape: { windowId: number; timer: NodeJS.Timeout } | null = null;

/** 감시를 끝낸다(여러 번 불려도 안전). */
export function stopPaneDragEscapeWatch(senderWindowId?: number): boolean {
  if (!paneEscape) return false;
  if (senderWindowId !== undefined && paneEscape.windowId !== senderWindowId) return false;
  clearInterval(paneEscape.timer);
  paneEscape = null;
  return true;
}

/**
 * 이 창에서 앱 안 IDE 창을 끄는 동안 커서를 지켜보다 창 밖으로 나가면 한 번 알린다. 창은 부른 쪽(`event.sender`, 메인·별창)이다 —
 * 그 창의 콘텐츠 경계로 재야 "이 앱 밖"이 보이는 화면과 맞는다.
 */
export function startPaneDragEscapeWatch(senderWindowId: number): boolean {
  const win = BrowserWindow.fromId(senderWindowId);
  if (!win || win.isDestroyed()) return false;
  stopPaneDragEscapeWatch();
  const deadline = Date.now() + PANE_ESCAPE_TTL_MS;
  const timer = setInterval(() => {
    if (win.isDestroyed() || Date.now() > deadline) { stopPaneDragEscapeWatch(senderWindowId); return; }
    const cursor = screen.getCursorScreenPoint();
    if (!isCursorOutsideRect(cursor, win.getContentBounds(), PANE_ESCAPE_MARGIN_PX)) return;
    // 나갔다 — 한 번만 말하고 감시를 끝낸다(두 번 말하면 렌더러가 같은 판을 두 번 꺼내려 든다).
    stopPaneDragEscapeWatch(senderWindowId);
    if (win.webContents.isDestroyed()) return;
    win.webContents.send('vibisual:ide:pane-drag-escape', { cursor });
  }, DRAG_POLL_MS);
  paneEscape = { windowId: senderWindowId, timer };
  return true;
}

export function openOverlay(opts: {
  agentId: string;
  projectId: string;
  cursor?: { x: number; y: number } | undefined;
  /** 앱 창 밖으로 끌어내 만든 창 — 버블로 접힌 채가 아니라 처음부터 IDE 크기로 뜬다(끌어낸 사람은 창이 나오길 기대한다). */
  expanded?: boolean | undefined;
  /** 끌고 있던 창의 크기(px). 그대로 물려받아 **빠져나온 그 창**으로 보이게 한다. */
  size?: { width: number; height: number } | undefined;
  /** §17-6 (H) — 앱 안에서 그 창이 들고 있던 것(편집 탭·뷰·세션·붙어 있던 변). 새 창이 부팅하며 꺼내 잇는다 — 없으면 첫 화면에서 시작. */
  handoff?: unknown;
  /**
   * §17-6 (H-4) — **끌던 손 아래에서 그대로 이어지는 창.** 커서가 앱 경계를 넘는 그 순간
   * 만들어지는 창이라, 뜨자마자 커서에 매달려 따라와야 "이 창이 밖으로 나왔다"가 된다.
   * `grab` 은 창 좌상단에서 커서까지의 거리(px) — 앱 안에서 잡고 있던 그 지점을 물려받는다.
   */
  follow?: {
    grabX: number;
    grabY: number;
    /**
     * §17-6 (H-12) — 이 창을 **다시 앱 안으로 들일 때** 그 자리에 뜨는 윤곽선에 적을 이름·안내.
     * main 에는 번역이 없으므로 렌더러가 자기 로케일로 지어 넘긴다(선택 — 없으면 이름만 뜬다).
     */
    label?: string | undefined;
    hint?: string | undefined;
    /**
     * §17-6 (H-17) — 이미 놓인 자리다. 이 길의 창은 손이 떠난 뒤라 커서에 매달지 않는다(매달면 놓은 뒤에도 따라다닌다).
     * 자리 셈(`커서 - 잡은 지점`)은 그대로 — 방금까지 떠 있던 윤곽선과 한 픽셀도 어긋나지 않게.
     */
    settled?: boolean | undefined;
  } | undefined;
  /**
   * §17-6 (H-25) — 놓기 전에 미리 짓는 판(부팅만, 안 보임). 창 짓기(초 단위)가 뗌 프레임에 몰리지 않게 선을 무장할 때 지어 두면,
   * 뗌은 재사용 갈래로 자리 옮기기·보이기만 남는다.
   */
  warm?: boolean | undefined;
  /**
   * §17-6 (H-27) ⑦ — **그 창에 세울 세션**(북마크 점프면 그 위치까지). 앱이 세션을 골라 밖의 창을
   * 부를 때만 싣는다. main 은 뜻을 모르고 그 창의 렌더에 [IDE 열기]와 함께 건네기만 한다 — 모양을
   * 아는 곳은 받는 쪽(`client/stores/detachedIDEFocus.ts` 의 `coerceIDEFocusTarget`) 한 곳이다.
   */
  focus?: unknown;
}): { windowId: number; reused: boolean } {
  // 손으로 끌어낸 창은 반드시 보여야 한다 — 전역 표시가 꺼졌으면 유일 스위치(§17-6 (D))를 켠다(창만 몰래 보이면 토글이 계속 "숨김"이다).
  // (H-25) ② 예열은 아직 꺼낸 것이 아니다 — 지금 켜면 놓기도 전에 다른 오버레이 창들이 나타난다. 켜기는 뗌 때.
  if (opts.expanded && !opts.warm && !overlaysUserVisible) {
    overlaysUserVisible = true;
    applyAllOverlayVisibility();
    broadcastOverlayList();
  }
  // 짐은 창을 만들기 **전에** 맡긴다 — 창이 뜨면서 곧바로 꺼내 가므로 순서가 뒤집히면 빈손으로 시작한다.
  if (opts.handoff) putPaneHandoff(opts.agentId, opts.handoff);
  const existing = overlaysByAgentId.get(opts.agentId);
  // (H-10) **닫히는 중인 창은 없는 것으로 본다.** `close()` 와 `closed` 사이의 틈에서 이 자리를
  //   다시 쓰면 새 창이 서지 않은 채 그 창이 죽어, 앱 안 창까지 닫힌 뒤라 IDE 가 어디에도 없다.
  if (existing && isOverlaySlotUsable({ closing: existing.closing, destroyed: existing.window.isDestroyed() })) {
    // §17-6 (H-16) — 밖의 그 창을 앞으로. 손짓 목록은 `overlayRaiseSteps` 한 곳이고 `inactive`((H-4) ⑥)도 그 목록이 가른다 — 갈림이 두 곳이면 한쪽만 고쳐진다.
    // (H-25) ③ 예열 창은 여기서 태어난다 — 손짓보다 먼저 비트를 푼다(`applyOverlayVisibility` 가 그 비트를 보고 도로 감춘다). 원래 값은 뒤 판정용으로 든다.
    const wasWarming = existing.warming;
    if (wasWarming) {
      existing.warming = false;
      // 예열 동안 미뤄 둔 전역 스위치를 지금 켠다 — 이 길은 "손으로 꺼낸 창"이므로 반드시 보여야
      //   한다((D) 숨김 스위치는 하나뿐이라 창만 몰래 보이면 토글이 계속 "숨김"으로 남는다).
      if (opts.expanded && !overlaysUserVisible) {
        overlaysUserVisible = true;
        applyAllOverlayVisibility();
      }
      // §17-6 (H-27) ① 태어난 창은 목록에 알린다 — 예열 창은 펼친 채 지어져 목록을 알리는 펼치기를 안 지난다((H-7) 셸도 첫 펼침을 미러하지 않는다).
      // 안 알리면 (H-13) 이 "밖에 없음"으로 읽고 앱 안에 같은 IDE 를 한 벌 더 세운다.
      broadcastOverlayList();
    }
    const activation = overlayReuseActivation(!!opts.follow, !!opts.follow?.settled);
    // §17-6 (H-27) ③ 앱이 **접힌 버블**을 IDE 로 불렀다(끌어 넣기·짐 없이) — 창만 키우지 않고 그 창의
    //   렌더에게 IDE 를 열게 한다. 갈림은 `overlayBubbleOpensIde` 한 곳이다.
    const bubbleOpensIde = overlayBubbleOpensIde({
      expanded: !!opts.expanded,
      wasExpanded: existing.expanded,
      follow: !!opts.follow,
      handoff: !!opts.handoff,
    });
    raiseOverlayWindow(existing, activation);
    // 이미 버블로 떠 있는 창을 다시 끌어냈다면 그 창을 펼쳐 준다(창 두 개 ❌ — 한 에이전트 한 창).
    //   (H-27) ③ 앱이 부른 버블은 여기서 펴지 않는다 — 렌더가 IDE 를 열면 미러(`expand-self`)가 편다.
    if (opts.expanded && !existing.expanded && !bubbleOpensIde) expandOverlayByWindowId(existing.id);
    // 펼치기(`setBounds`·`setResizable`·`show`)가 Windows 에서 상시-위·Z 순서를 흩뜨리므로(§17-6 (E)) 끝난 뒤 같은 순서를 한 번 더 밟는다(멱등).
    raiseOverlayWindow(existing, activation);
    // §17-6 (H-16) — 이미 보이던 창은 앞으로 와도 화면이 그대로라 기척 신호를 보낸다(듣는 렌더러가 없으면 지나간다). (H-27) ④ 버블은 기척을 안 비춰 편 뒤에 보낸다.
    if (!bubbleOpensIde && overlayAttentionOnReuse(activation) && !existing.window.webContents.isDestroyed()) {
      existing.window.webContents.send('vibisual:overlay:attention', { agentId: opts.agentId });
    }
    // §17-6 (H-27) ③④ 그 창에 [IDE 열기]를 보낸다((G) 메뉴와 같은 길)·보낸 시각을 적어 펼 때(`expandOverlaySelf`) 한 번 더 세우고 비춘다.
    // ⑦ 세울 세션이 있으면 함께 싣는다(이미 IDE 인 창에도). 판정은 `overlayOpenIdeCommand` 한 곳.
    const openIde = overlayOpenIdeCommand({
      bubbleOpensIde,
      wasExpanded: existing.expanded,
      follow: !!opts.follow,
      handoff: !!opts.handoff,
      focus: opts.focus,
    });
    if (openIde && !existing.window.webContents.isDestroyed()) {
      if (bubbleOpensIde) existing.attentionOnExpandAt = Date.now();
      existing.window.webContents.send('vibisual:overlay:menu-command', openIde);
      // 펼친 채 태어나 **아직 다 그리지 않은** 창(방금 끌어낸 창)은 부팅 중이라 지금 이 신호를 못 들을
      //   수 있다 — 다 그렸다고 말할 때(짐을 푼 뒤) 한 번 더 건넨다. 들었다면 그 렌더가 짐을 풀 때까지
      //   세션을 맡아 두므로(`OverlayShell`) 두 번 닿아도 같은 세션에 한 번 더 설 뿐이다.
      if (openIde.focus !== undefined && existing.expanded && !existing.shellReady) {
        existing.pendingIdeFocus = openIde.focus;
      }
    }
    // (H-4) 이미 서 있던 창을 앱에서 다시 끌어냈다 — 그 창도 커서에 매달려야 "이 창이 나왔다"가
    //   된다(안 매달면 창은 제자리에 있고 손만 움직여, 끌어낸 것이 아니라 그냥 켜진 것으로 보인다).
    if (opts.follow && !overlayDrags.has(existing.id)) {
      if (opts.follow.settled) {
        // (H-17) 손은 이미 떠났다 — 매달지 않고 **선이 서 있던 그 자리**로 옮겨 놓기만 한다.
        const cur = screen.getCursorScreenPoint();
        // (H-19) 크기는 장부 값으로 함께 쓴다 — `setPosition` 은 배율에서 부를 때마다 창을 키운다.
        moveOverlayTo(existing, cur.x - opts.follow.grabX, cur.y - opts.follow.grabY);
      } else {
        startOverlayFollow(existing, {
          offX: opts.follow.grabX,
          offY: opts.follow.grabY,
          redockOnEnter: true,
          handoff: opts.handoff,
          label: opts.follow.label,
          hint: opts.follow.hint,
        });
      }
      // (H-6) ⑤ 이미 선 창이라 윤곽선을 지금 걷는다. (H-25) ④ 아직 다 안 그린 예열 창만 예외 — 걷으면 투명한 빈 창만 남는다.
      if (wasWarming && !existing.shellReady) armGhostHandoff(existing.id);
      else finishGhostHandoff();
    }
    // 이미 서 있는 창은 부팅을 다시 하지 않는다 — 짐이 있으면 그 창에 직접 건네야 도착한다.
    if (opts.handoff && !existing.window.webContents.isDestroyed()) {
      existing.window.webContents.send('vibisual:overlay:pane-handoff', {
        agentId: opts.agentId,
        handoff: takePaneHandoff(opts.agentId),
      });
    }
    return { windowId: existing.id, reused: true };
  }

  // (판올림 번호 발급 대기) 끌어내서 만든 창은 **커서가 있는 화면**의 작업영역 안에, 끌던 크기로.
  //   커서는 렌더러가 넘긴 값이 아니라 **여기서 직접** 읽는다 — DPI 배율이 다른 모니터에서
  //   렌더러 좌표를 그대로 쓰면 창이 엉뚱한 화면에 앉는다.
  const dropPoint = opts.expanded ? (opts.cursor ?? screen.getCursorScreenPoint()) : opts.cursor;
  const dropDisp = screen.getDisplayNearestPoint(dropPoint ?? screen.getCursorScreenPoint());
  const dropWa = dropDisp.workArea;
  // (H-19) 크기는 그 화면의 배율 격자에 맞춘다 — 격자 밖 크기는 창이 되돌려 주는 값이 매번 달라진다.
  const dipStep = dipStepFor(dropDisp.scaleFactor);
  const winW = opts.expanded
    ? snapDip(Math.max(MIN_FLOAT_W_OVERLAY, Math.min(opts.size?.width ?? 840, dropWa.width)), dipStep)
    : OVERLAY_BUBBLE_W;
  const winH = opts.expanded
    ? snapDip(Math.max(MIN_FLOAT_H_OVERLAY, Math.min(opts.size?.height ?? 600, dropWa.height)), dipStep)
    : OVERLAY_BUBBLE_H;

  // 위치: cursor 근처가 있으면 그 옆, 없으면 현재 디스플레이 우상단에서 캐스케이드.
  let x: number;
  let y: number;
  if (opts.follow) {
    // (H-4) 커서에 매달릴 창 — **잡은 지점 그대로** 앉힌다. 작업영역으로 클램프하면 창이 손에서
    //   어긋난 채 태어나고, 어차피 다음 틱부터 커서를 따라 움직이므로 가둘 이유도 없다.
    const cur = dropPoint ?? screen.getCursorScreenPoint();
    // (H-19) 자리도 격자에 맞춘다 — 격자 밖 좌표는 창이 되돌려 주는 크기를 2px 키운다(안정적이지만 어긋난다).
    x = snapDip(cur.x - opts.follow.grabX, dipStep);
    y = snapDip(cur.y - opts.follow.grabY, dipStep);
  } else if (opts.expanded && dropPoint) {
    // 뗀 자리에 **타이틀바가** 오게 앉힌다(끌던 손 아래에서 창이 이어지는 느낌).
    x = Math.max(dropWa.x, Math.min(Math.round(dropPoint.x - winW / 2), dropWa.x + dropWa.width - winW));
    y = Math.max(dropWa.y, Math.min(Math.round(dropPoint.y - 18), dropWa.y + dropWa.height - winH));
  } else if (opts.cursor) {
    x = Math.round(opts.cursor.x - OVERLAY_BUBBLE_W / 2);
    y = Math.round(opts.cursor.y - 24);
  } else {
    const disp = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const wa = disp.workArea;
    const offset = (overlayCascade % 6) * 28;
    x = wa.x + wa.width - OVERLAY_BUBBLE_W - 32 - offset;
    y = wa.y + 80 + offset;
  }
  overlayCascade += 1;

  const win = new BrowserWindow({
    width: winW,
    height: winH,
    x,
    y,
    show: false,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    resizable: !!opts.expanded,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    autoHideMenuBar: true,
    title: 'Vibisual',
    icon: windowIconPath(__dirname, process.platform),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: false,
      // §5.13 (R) — Chromium 내장 PDF 뷰어를 켠다. 우리가 PDF 렌더를 쓰지 않고 iframe 하나로 여는 근거.
      plugins: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  hardenWindow(win);
  // 층은 태어나는 모양이 정한다((E) 개정) — 버블로 태어나면 상시-위, 펼친 IDE 로 태어나면
  //   보통 층이다. 장부(entry)는 아직 없으므로 여기서는 `opts.expanded` 가 그 답을 대신한다.
  //   (H-28) 갓 태어난 창은 아직 아무도 고정하지 않았다 — 장부의 `pinned: false` 와 같은 값.
  keepOverlayOnTop(win, !!opts.expanded, false);

  if (opts.expanded) {
    // 펼친 채로 태어난 창 — 최소 크기를 IDE 기준으로 두고, 나중에 접으면 이 자리에 버블로 앉는다.
    try { win.setMinimumSize(MIN_FLOAT_W_OVERLAY, MIN_FLOAT_H_OVERLAY); } catch { /* noop */ }
  }

  const entry: OverlayEntry = {
    id: win.id,
    agentId: opts.agentId,
    projectId: opts.projectId,
    window: win,
    expanded: !!opts.expanded,
    collapsedBounds: opts.expanded
      ? { x, y, width: OVERLAY_BUBBLE_W, height: OVERLAY_BUBBLE_H }
      : null,
    opacity: 1,
    maximized: false,
    restoreBounds: null,
    editorGrowth: null,
    closing: false,
    // (H-19) 태어난 크기가 장부의 첫 값이다 — 이제부터 창에는 이 값만 쓴다.
    size: { width: winW, height: winH },
    sizeWrittenAt: Date.now(),
    // (H-25) ② 예열로 지은 창은 아직 태어나지 않은 것으로 친다(목록·표시·`ready-to-show` 모두에서).
    warming: !!opts.warm,
    shellReady: false,
    attentionOnExpandAt: null,
    // (H-27) ⑦ 펼친 채 태어나는 창만 그 신호(`shell-ready`)를 보낸다 — 버블로 태어나는 창에 적으면 영영 안 건넨다.
    pendingIdeFocus: opts.expanded ? (opts.focus ?? null) : null,
    // (H-28) 고정은 사용자가 그 창의 제목줄에서만 켠다 — 태어날 때는 늘 꺼져 있다.
    pinned: false,
  };
  overlaysByAgentId.set(opts.agentId, entry);
  overlaysByWindowId.set(win.id, entry);

  // (H-10) 선을 이어받을 창은 태어나는 여기서 정한다 — `ready-to-show` 에서 정하면 빠르게 오갈 때 그 전에 창이 닫혀 `closed` 가 선을 못 걷고
  // 클릭통과 윤곽선이 수명 상한(20초) 내내 커서를 따른다. `ready-to-show` 는 그물 시간만 다시 잰다.
  if (opts.follow && isPopOutGhostVisible()) armGhostHandoff(win.id);

  // 준비되면 표시(전역 토글이 꺼져 있을 때만 숨긴 채 둔다). 포커스 숨김은 없다 — 본체가 떠 있어도,
  // 다른 어떤 프로그램이 선택돼 있어도 항상 위에 떠 있는다(alwaysOnTop 'screen-saver').
  win.on('ready-to-show', () => {
    if (win.isDestroyed()) return;
    // (H-25) ② 예열 창은 **여기서 보여주지 않는다** — 지금 커서 아래에는 윤곽선이 서 있고,
    //   실물 창이 겹쳐 뜨면 무엇이 진짜인지 알 수 없다((H-6) ③). 세우는 자리는 뗌 하나다.
    if (entry.warming) return;
    if (!overlaysUserVisible) return;
    if (opts.follow) {
      // (H-4) ⑥ 활성화하지 않고 띄운다 — 손짓은 아직 메인 창이 잡고 있고, 새 창이 활성화되면 OS 가 캡처를 걷어 이동·뗌이 어디에도 안 닿는다.
      // (H-17) `settled` 는 손이 떠난 판이라 앞으로 세운다(뒤에 뜨면 놓았는데 안 보인다).
      if (opts.follow.settled) { win.show(); win.focus(); } else win.showInactive();
      // (H-6) ⑤ 선이 창이 되는 지점 — 팝아웃 때 끄면 창을 띄우는 동안 커서 아래가 빈다. (H-7) 다만 투명 창의 `ready-to-show` 는 React 전의 빈 창이고
      // 끌어낸 창은 WS 스냅샷이 와야 IDE 를 연다(`OverlayShell`) — 선은 렌더러가 다 그렸다고 할 때 걷는다.
      // (H-10) 주인은 생성 때 정했고, 여기서는 그물 시간을 다시 잰다(렌더러가 그릴 시간을 온전히).
      armGhostHandoff(win.id);
    } else if (opts.expanded) {
      // 방금 손으로 끌어낸 창이라 바로 쓰게 된다 — 뒤에 뜨면 "꺼냈는데 안 보인다"로 읽힌다.
      win.show();
      win.focus();
    } else {
      win.showInactive();
    }
    keepOverlayOnTop(win, entry.expanded, entry.pinned);
  });

  // (H-10) 어떤 길로 닫히든(OS 닫기 포함, `closed` 는 늦다) 자리를 바로 놓는다 — 죽어 가는 창을 팝아웃이 다시 쓰면 IDE 가 어디에도 없다.
  // (H-19) 보고된 크기는 사용자가 창틀로 늘린 것만 받는다(`acceptReportedSize`) — 우리 쓰기의 메아리를 받으면 왕복마다 자란다.
  win.on('resize', () => {
    if (win.isDestroyed()) return;
    const b = win.getBounds();
    const next = acceptReportedSize({
      ledger: entry.size,
      writtenAt: entry.sizeWrittenAt,
      reported: { width: b.width, height: b.height },
      now: Date.now(),
      following: overlayDrags.has(entry.id),
    });
    if (next) entry.size = next;
  });

  win.on('close', () => {
    entry.closing = true;
    detachOverlaySlot(entry);
  });

  win.on('closed', () => {
    entry.closing = true;
    stopOverlayDrag(win.id);
    // (H-7) 이 창이 이어받기로 한 선이 있었다면 여기서 걷는다 — 받을 창이 사라졌으므로
    //   기다릴 것이 없다(클릭통과 선이라 남으면 사용자가 없앨 수 없다).
    if (isGhostHandoffTarget(win.id)) finishGhostHandoff();
    // 이 버블의 우클릭 메뉴가 떠 있으면 함께 닫는다(고아 메뉴 방지).
    if (overlayMenu && overlayMenu.targetWindowId === win.id) closeOverlayMenu();
    // (H-10) **내가 아직 쥐고 있는 칸만** 놓는다. `closed` 는 늦게 오므로 그 사이 같은
    //   `agentId` 로 새 창이 들어섰을 수 있다 — 조건 없이 지우면 살아 있는 그 창이 장부에서
    //   사라져 뗌 신호(`dragEndFor`)가 닿지 못하고 커서를 영영 따라다닌다.
    detachOverlaySlot(entry);
    broadcastOverlayList();
  });

  const hash = `overlay=1&agentId=${encodeURIComponent(opts.agentId)}&projectId=${encodeURIComponent(opts.projectId)}`
    + (opts.expanded ? '&expanded=1' : '');
  void win.loadFile(join(__dirname, '../renderer/index.html'), { hash });

  win.webContents.once('did-finish-load', () => {
    if (win.isDestroyed()) return;
    win.webContents.send('vibisual:overlay:list', { overlays: listOverlays(), userVisible: overlaysUserVisible });
    // (H-4) 창이 부팅을 마치기 **전에** 이미 끌리고 있다 — 그동안 보낸 상태를 못 받았으므로
    //   지금 다시 알린다(이 창도 뗌을 함께 들어야 한다).
    // (H-23) 되돌아올 수 있는 판이면 메인 창에도 다시 알린다 — 판정은 그 판이 쥔 값 하나다.
    const pending = overlayDrags.get(win.id);
    if (pending) sendFollowDragState(entry, true, pending.redockOnEnter);
    // (H-5) 아이콘이 실제와 어긋나지 않게 지금 상태를 알린다(렌더러는 push 값만 믿는다).
    sendOverlayMaximizeState(entry);
  });

  // (H-4) 매다는 것은 **지금** 시작한다(ready-to-show 를 기다리면 그 100ms 동안 창이 태어난
  //   자리에 멈춰 있다가 갑자기 커서로 튄다). 아직 안 보이는 창이어도 자리는 옮길 수 있다.
  // (H-17) 놓고 나서 태어난 창은 매달지 않는다 — 위에서 이미 선이 있던 그 자리에 앉혔다.
  if (opts.follow && !opts.follow.settled) {
    startOverlayFollow(entry, {
      offX: opts.follow.grabX,
      offY: opts.follow.grabY,
      redockOnEnter: true,
      handoff: opts.handoff,
      label: opts.follow.label,
      hint: opts.follow.hint,
    });
  }

  broadcastOverlayList();
  return { windowId: win.id, reused: false };
}

// §17-6 — 버블 드래그 = OS 창 이동: drag-start 를 받으면 main 이 커서를 폴링해 창째 옮긴다(잡은 지점 유지, 창 경계에 안 잘린다), drag-end 로 해제.
// (H-4) 같은 폴링이 꺼낸 IDE 창도 끈다 — 앱 밖에서 태어나 커서를 따르고(`follow`), 끌다 앱 안에 들면 앱 안 IDE 로 돌아간다(`redockOnEnter`).

/** 창 하나를 커서에 매달아 둔 한 판. 끝나면 통째로 버린다(창에 남는 값은 없다). */
interface OverlayFollowDrag {
  timer: NodeJS.Timeout;
  /** 잡은 지점 — 커서가 안 움직이면 창도 안 움직인다(클릭 판정 무손상). */
  offX: number;
  offY: number;
  /** 끌다 앱 안으로 들어오면 그 자리에서 앱 안 IDE 로 되돌아가는가(버블 드래그는 거짓). */
  redockOnEnter: boolean;
  /** 지난 틱에 커서가 앱 **깊숙이** 있었는가 — 밖→안 전이에서만 되돌린다(stepAppEntry). */
  insideApp: boolean;
  /** 되돌아갈 때 실어 보낼 짐 — 드래그 시작에 한 번 받는다(눌린 동안 상태는 안 바뀌고, 되돌릴 때 물으면 부팅 중인 창은 대답이 없다). */
  handoff: unknown;
  /**
   * §17-6 (H-12) — **들어와서 가상 창으로 바뀐 채 기다리는 중인가.** 참이면 이 창은 숨겨져
   * 있고 화면에 있는 것은 윤곽선뿐이다(움직이는 것이 하나뿐이라는 (H-6) ③ 규율 그대로).
   */
  dwelling: boolean;
  /** 그 기다림이 시작된 시각(ms) — `dwelling` 이 거짓이면 뜻이 없다. */
  dwellStartedAt: number;
  /** §17-6 (H-17) — 버팀을 채워 선이 밝아졌는가(이제 떼면 들어간다). 합치기는 뗌의 몫이다. 매 틱 다시 그리지 않게 기억한다(60Hz 재그리기는 깜빡인다). */
  dwellArmed: boolean;
  /** §17-6 (H-23) ③ — 숨긴 채 기다린 시간의 상한 시계(`dwelling` 동안만). 뗌을 아무도 못 들으면 숨은 창이 영영 숨는다 — 그때 도로 세운다. */
  holdTimer: NodeJS.Timeout | null;
  /** 윤곽선에 적을 이름·안내. main 에는 번역이 없으므로 렌더러가 지어 넘긴다. */
  label: string;
  hint: string;
}

const overlayDrags = new Map<number, OverlayFollowDrag>();

function stopOverlayDrag(windowId: number): void {
  const drag = overlayDrags.get(windowId);
  if (!drag) return;
  clearInterval(drag.timer);
  // (H-23) ③ 판이 끝나면 상한 시계도 함께 멎는다 — 남으면 다음 판의 창을 엉뚱한 때에 되세운다.
  clearRedockHold(drag);
  overlayDrags.delete(windowId);
}

/** 커서가 메인 창 **깊숙이**(경계에서 48px 안쪽) 들어와 있는가 — 규칙은 shared 순수 함수. */
function cursorDeepInsideMain(): boolean {
  const main = getMainWindow();
  if (!main || main.isDestroyed()) return false;
  if (!main.isVisible() || main.isMinimized()) return false;
  return isCursorDeepInside(screen.getCursorScreenPoint(), main.getContentBounds());
}

/**
 * 이 창이 매달렸다고 렌더러에 알린다(뗌을 그 창도 듣게). (H-23) 메인 창도 듣는다 — 들어오는 판은 창이 숨는 순간 캡처를 잃어 그 렌더러에 뗌이 안 닿는다
 * (`agentId` 를 실어 보낸다). 켜기는 `redockOnEnter` 판만, 끄기는 늘 — 못 푼 그물은 다음 손짓을 먹는다.
 */
function sendFollowDragState(entry: OverlayEntry, following: boolean, alsoMain: boolean): void {
  const payload = { following, agentId: entry.agentId };
  const win = entry.window;
  if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
    win.webContents.send('vibisual:overlay:follow-drag-state', payload);
  }
  if (!alsoMain) return;
  const main = getMainWindow();
  if (!main || main.isDestroyed() || main.webContents.isDestroyed()) return;
  main.webContents.send('vibisual:overlay:follow-drag-state', payload);
}

/**
 * §17-6 (H-23) ③ — 숨긴 채 기다리는 상한(ms). 넘으면 창을 도로 세운다 — 뗌을 둘 다 놓치면 숨은 창은 만질 수 없고 선마저 `GHOST_MAX_LIFE_MS` 로 걷히면
 * IDE 가 어디에도 없다. 합치지 않고 되살린다(부르지 않은 합침은 되돌릴 손잡이가 없다).
 */
const REDOCK_DWELL_HOLD_MAX_MS = 15_000;

/** 그 상한 시계를 멎는다(여러 번 불려도 안전). */
function clearRedockHold(drag: OverlayFollowDrag): void {
  if (drag.holdTimer === null) return;
  clearTimeout(drag.holdTimer);
  drag.holdTimer = null;
}

/**
 * §17-6 (H-12) — 들어왔다: 창을 숨기고 윤곽선이 이어받는다(아직 합치지 않는다 — 버팀이 끝나야). 실물과 선이 겹치면 무엇이 진짜인지 모른다((H-6) ③).
 * 숨은 동안에도 폴링이 자리를 옮겨 되돌릴 때 보이기만 하면 손 아래에 선다.
 */
function beginRedockDwell(entry: OverlayEntry, drag: OverlayFollowDrag): void {
  const win = entry.window;
  if (win.isDestroyed()) return;
  drag.dwellStartedAt = Date.now();
  // (H-19) 선의 크기는 **장부**에서 — 창에 되물으면 배율 반올림이 섞여 왕복마다 자란다.
  const shown = showPopOutGhost({
    width: entry.size.width,
    height: entry.size.height,
    grabX: drag.offX,
    grabY: drag.offY,
    label: drag.label,
    hint: drag.hint,
    // 아직 확정이 아니다 — 무장(밝은 선)은 "지금 손을 떼도 그대로"라는 뜻이라 여기 쓰지 않는다.
    armed: false,
  });
  if (!shown) {
    // 선을 만들지 못하는 환경 — **구간 없이 종전대로 곧바로** 합친다. 기다리기만 하고 화면에
    //   아무것도 안 보이는 것이 제일 나쁘다(기능이 사라지는 것이 아니라 구간이 없어질 뿐이다).
    drag.dwelling = false;
    redockFollowedOverlay(entry, drag);
    return;
  }
  // 앞 판(나가는 길의 가장자리 버팀)이 밀어 둔 여분을 지운다 — 남아 있으면 선이 손에서 그만큼
  //   어긋난 자리에 뜬다. 여기서는 밀어 낼 이유가 없다(커서가 화면 끝에 막혀 있지 않다).
  nudgePopOutGhost({ dx: 0, dy: 0 });
  try { win.hide(); } catch { /* noop */ }
  // (H-23) ③ 숨긴 창을 **영영 숨긴 채 두지 않는다.** 창이 숨는 이 순간 OS 는 그 창의 마우스
  //   캡처를 걷으므로, 뗌을 ①② 의 두 창이 모두 놓치면 말해 줄 입이 남지 않는다. 선이 수명으로
  //   걷히기 전에 창을 도로 세워야 화면이 통째로 비는 순간이 없다.
  clearRedockHold(drag);
  drag.holdTimer = setTimeout(() => {
    drag.holdTimer = null;
    // 그사이 판이 끝났거나(뗌이 왔다) 다시 밖으로 나갔으면 할 일이 없다.
    if (overlayDrags.get(entry.id) !== drag || !drag.dwelling) return;
    stopOverlayDrag(entry.id);
    cancelRedockDwell(entry, drag);
    sendFollowDragState(entry, false, true);
  }, REDOCK_DWELL_HOLD_MAX_MS);
}

/** §17-6 (H-17) — 다 버텼다: 선을 밝힌다. 합치지 않는다 — 손을 놓기 전까지 가상의 창 그대로 둔다(밝은 선 = 지금 놓으면 여기, `popOutGhostDecision` 과 같은 어법). */
function armRedockDwell(entry: OverlayEntry, drag: OverlayFollowDrag): void {
  drag.dwellArmed = true;
  showPopOutGhost({
    // 숨어 있는 창의 크기가 곧 선의 크기다 — (H-19) 장부 값이다(창에 되묻지 않는다).
    width: entry.size.width,
    height: entry.size.height,
    grabX: drag.offX,
    grabY: drag.offY,
    label: drag.label,
    hint: drag.hint,
    armed: true,
  });
}

/** §17-6 (H-12) — 버티다 다시 나갔다: 선을 걷고 창을 돌려놓는다((H-3) 과 같은 규율 — 앱 위를 스친 손이 합치면 창을 옮기는 평범한 손짓이 막힌다). */
function cancelRedockDwell(entry: OverlayEntry, drag: OverlayFollowDrag): void {
  drag.dwelling = false;
  drag.dwellStartedAt = 0;
  drag.dwellArmed = false;
  // (H-23) ③ 되살리는 자리가 곧 기다림이 끝나는 자리다 — 시계가 남으면 다음 판을 흔든다.
  clearRedockHold(drag);
  finishGhostHandoff();
  if (entry.window.isDestroyed()) return;
  // 전역 표시 토글을 존중해 되살린다((D) — 표시 스위치는 하나뿐이다).
  applyOverlayVisibility(entry, false);
}

/**
 * (H-4) 끌던 독립 창이 앱 안으로 들어왔다 — 그 자리에서 앱 안 IDE 로 되돌린다.
 * `revealOverlayInMain` + `openIde` 를 탄다 — IDE 를 열린 채 앱 안으로 돌아오는 길은 이것 하나다((H-21)). 다른 점은 `resumeDrag`(잡은 지점·창 크기) 하나다.
 */
/** (H-17) 여기까지 왔다 = 손을 뗐다 — 이제 선이 창이 된다(버팀을 채운 것만으로는 선이 밝아질 뿐). 앱 안에 서는 창은 드래그를 이어받지 않는다 — 이어받을 손이 없다. */
function redockFollowedOverlay(entry: OverlayEntry, drag: OverlayFollowDrag): void {
  stopOverlayDrag(entry.id);
  const ok = revealOverlayInMain({
    agentId: entry.agentId,
    projectId: entry.projectId,
    openIde: true,
    handoff: drag.handoff,
    resumeDrag: {
      grabX: drag.offX,
      grabY: drag.offY,
      // (H-19) 앱 안에 설 창의 크기는 장부 값(방금까지 떠 있던 선과 같다) — 창에 되물은 값은 배율 반올림이 섞여 왕복마다 2px 씩 자란다.
      width: entry.size.width,
      height: entry.size.height,
      // 커서의 **화면 좌표** — 받는 창이 첫 이벤트를 기다리지 않고 곧바로 그 자리에 앉는다
      //   (기다리면 한 프레임 동안 옛 자리에 떴다가 튀어, 창이 깜빡인 것처럼 보인다).
      cursor: screen.getCursorScreenPoint(),
      // (H-17) 손은 이미 떠났다 — 자리·크기만 물려받고 드래그는 이어받지 않는다.
      dragging: false,
    },
  });
  // 메인 창이 없으면(닫혔다) 합칠 곳이 없다 — 드래그만 끝낸다. (H-12) 가상 창으로 바꿔 둔
  //   판이면 **반드시 원래 창을 되살린다** — 선만 남기고 창을 숨긴 채 두면 그 IDE 가 화면
  //   어디에도 없다(선은 클릭통과라 만질 수도 없다).
  if (!ok) {
    cancelRedockDwell(entry, drag);
    sendFollowDragState(entry, false, true);
    return;
  }
  // (H-23) ② 메인 창에 걸어 둔 그물도 **여기서** 푼다 — 이 판은 끝났다. 창이 곧 닫히므로
  //   숨은 창에 보내는 쪽은 닿지 않아도 되지만, 메인 창은 살아서 다음 손짓을 받는다.
  sendFollowDragState(entry, false, true);
  // (H-12) 선은 여기서 걷지 않는다 — 앱 안 창이 다 그린 뒤 스스로 걷는다(`overlay:ghost-hide`). 주인이 메인 창이라 이 창의 `closed` 는 선을 안 걷는다.
  // (H-10)(H-15) 그물은 두되 들어오는 길의 짧은 값 — 4초면 말 못 한 판에서 클릭통과 선이 그만큼 붙어 있다.
  armGhostHandoff(getMainWindow()?.id ?? -1, GHOST_REDOCK_FALLBACK_MS);
  closeOverlayEntry(entry);
}

export function startOverlayDragByWindowId(
  windowId: number,
  opts?: { redockOnEnter?: boolean; handoff?: unknown; label?: string; hint?: string },
): boolean {
  const entry = overlaysByWindowId.get(windowId);
  if (!entry || entry.window.isDestroyed()) return false;
  if (overlayDrags.has(windowId)) return true; // 이미 드래그 중(더블클릭 2번째 mousedown 등)
  const win = entry.window;
  const cur = screen.getCursorScreenPoint();
  const b = win.getBounds();
  let offX = cur.x - b.x;
  const offY = cur.y - b.y;
  if (entry.maximized) {
    // §17-6 (H-5) ② 최대화된 창을 끌면 Windows 처럼 **먼저 원래 크기로 돌아온 뒤** 손을 따라온다.
    //   잡은 지점은 가로 **비율**로 옮긴다 — 픽셀 그대로 두면 오른쪽 끝을 잡았던 손에서 줄어든
    //   창이 빠져나간다. 세로는 타이틀바 높이가 같으므로 그대로 둔다(여전히 타이틀바를 잡고 있다).
    const ratioX = b.width > 0 ? offX / b.width : 0.5;
    restoreOverlayMaximize(entry);
    // (H-19) 되돌아온 크기는 장부가 안다 — 창에 되묻지 않는다.
    offX = Math.round(ratioX * entry.size.width);
  }
  startOverlayFollow(entry, {
    offX,
    offY,
    redockOnEnter: !!opts?.redockOnEnter,
    handoff: opts?.handoff,
    // (H-12) 들어오는 구간에서 선에 적을 말. main 에는 번역이 없어 렌더러가 지어 넘긴다.
    label: opts?.label,
    hint: opts?.hint,
  });
  return true;
}

/**
 * 커서 폴링 시작 — 잡은 지점 그대로 매달고, 필요하면 "앱 안으로 들어왔는가"까지 본다. 첫 `insideApp` 은 지금 실측으로 채운다 —
 * `false` 면 가장자리 버팀으로 꺼낸 창(커서가 아직 앱 안)이 곧바로 합쳐지고, 앱 위에 겹쳐 둔 창을 잡기만 해도 합쳐진다.
 */
function startOverlayFollow(
  entry: OverlayEntry,
  init: {
    offX: number;
    offY: number;
    redockOnEnter: boolean;
    handoff: unknown;
    /** (H-12) 들어오는 구간의 윤곽선에 적을 이름·안내(없으면 선에 이름만 뜬다). */
    label?: string | undefined;
    hint?: string | undefined;
  },
): void {
  const win = entry.window;
  const tick = (): void => {
    if (win.isDestroyed()) {
      stopOverlayDrag(entry.id);
      return;
    }
    const drag = overlayDrags.get(entry.id);
    if (!drag) return;
    const p = screen.getCursorScreenPoint();
    // (H-19) `setPosition` 이 아니다 — 그 호출은 크기를 창에 되물어 다시 쓰므로 분수 배율에서
    //   틱마다 1px 씩 창이 자랐다(끄는 1초에 60px). 크기는 장부 값으로 함께 쓴다.
    moveOverlayTo(entry, p.x - drag.offX, p.y - drag.offY);
    if (!drag.redockOnEnter) return;
    // (H-12) 들어오는 길은 이제 **세 마디**다 — 들어온 순간(선으로 바뀐다) · 버팀 · 확정(합친다).
    //   그 사이에 다시 나가면 원래 창으로 되돌린다. 판정은 shared 순수 함수가 쥔다.
    const step = stepRedockDwell({
      wasInside: drag.insideApp,
      isInside: cursorDeepInsideMain(),
      dwelling: drag.dwelling,
      elapsedMs: drag.dwelling ? Date.now() - drag.dwellStartedAt : 0,
    });
    drag.insideApp = step.inside;
    drag.dwelling = step.dwelling;
    if (step.start) beginRedockDwell(entry, drag);
    else if (step.cancel) cancelRedockDwell(entry, drag);
    // (H-17) 다 버텼다 = **선을 밝힌다**(합치는 것은 손을 뗄 때다). 한 번만 그린다.
    else if (step.arm && !drag.dwellArmed) armRedockDwell(entry, drag);
  };
  overlayDrags.set(entry.id, {
    timer: setInterval(tick, DRAG_POLL_MS),
    offX: init.offX,
    offY: init.offY,
    redockOnEnter: init.redockOnEnter,
    insideApp: init.redockOnEnter ? cursorDeepInsideMain() : false,
    handoff: init.handoff,
    dwelling: false,
    dwellStartedAt: 0,
    dwellArmed: false,
    holdTimer: null,
    label: init.label ?? '',
    hint: init.hint ?? '',
  });
  // (H-23) ① 들어올 수 있는 판(`redockOnEnter`)은 **메인 창에도** 매달림을 알린다 — 창이 숨는
  //   순간 그 렌더러는 뗌을 못 듣게 되므로, 그때 들을 수 있는 것은 커서 아래의 메인 창뿐이다.
  sendFollowDragState(entry, true, init.redockOnEnter);
  // 첫 자리는 **지금** 잡는다 — 한 틱(16ms)을 기다리면 최대화를 푼 그 자리에 한 프레임 머물렀다
  //   손 아래로 튄다(창이 깜빡인 것처럼 보인다).
  tick();
}

function finishOverlayFollow(entry: OverlayEntry | undefined): boolean {
  if (!entry) return false;
  const drag = overlayDrags.get(entry.id);
  // (H-17) 선이 뜬 채 손을 뗐다 = 합치는 유일한 자리(놓는 순간 그 자리·그 크기). 버팀이 안 끝났어도 합친다 — 구간은 보여 주기용이지 관문이 아니다.
  if (drag?.dwelling) {
    redockFollowedOverlay(entry, drag);
    return true;
  }
  const wasDragging = overlayDrags.has(entry.id);
  stopOverlayDrag(entry.id);
  // (H-23) ② 메인 창의 그물은 창이 죽었어도 풀어야 한다 — 아래 `isDestroyed` 반환보다 **먼저**.
  //   못 풀면 그 그물이 남아 다음 손짓의 뗌을 먹는다.
  sendFollowDragState(entry, false, true);
  if (entry.window.isDestroyed()) return true;
  if (wasDragging) {
    // 손을 뗀 자리에 창이 섰다 — 이제 앞으로 올린다. 끄는 **동안**에는 일부러 활성화하지
    //   않았다(§17-6 (H-4) ⑥ — 새 창이 활성화되면 OS 가 메인 창의 마우스 캡처를 걷어 아직
    //   눌려 있는 그 손짓의 나머지가 어디에도 도착하지 않는다).
    try { entry.window.focus(); } catch { /* noop */ }
  }
  keepOverlayOnTop(entry.window, entry.expanded, entry.pinned);
  return true;
}

export function endOverlayDragByWindowId(windowId: number): boolean {
  return finishOverlayFollow(overlaysByWindowId.get(windowId));
}

/**
 * (H-4) 다른 창이 끝내는 길(끌어낸 창은 손이 메인 창에 있다). 캡처는 OS 가 옮기기도 하고 놓치면 창이 영영 커서를 따르므로 두 창이 함께 듣는다.
 * 두 번 불려도 안전하다.
 */
export function endOverlayDragByAgentId(agentId: string): boolean {
  return finishOverlayFollow(overlaysByAgentId.get(agentId));
}

// §17-6 (H-5) — 독립 창 [최대화/복원]은 우리가 한다(`frame:false + transparent` 라 시스템 최대화가 없다): 작업영역으로 옮기고 직전 자리로 되돌린다.
// `maximize()`/`isMaximized()` 는 쓰지 않는다 — 테두리 없는 창은 `unmaximize()` 뒤에도 참이다(§5.4 #14-1).

/** 지금 최대화 상태를 그 창에 알린다 — 렌더러는 **이 값만** 믿는다(짐작 ❌). */
function sendOverlayMaximizeState(entry: OverlayEntry): void {
  const win = entry.window;
  if (win.isDestroyed() || win.webContents.isDestroyed()) return;
  win.webContents.send('vibisual:overlay:maximize-state', { maximized: entry.maximized });
}

/**
 * 최대화를 **푼다**(이미 아니면 아무 일도 하지 않는다). 되돌린 자리를 돌려준다 —
 * 끌기 시작할 때 잡은 지점을 새 크기에 맞춰 다시 잡아야 하기 때문이다.
 */
function restoreOverlayMaximize(entry: OverlayEntry): Electron.Rectangle | null {
  if (!entry.maximized) return null;
  const win = entry.window;
  entry.maximized = false;
  const target = entry.restoreBounds;
  entry.restoreBounds = null;
  if (win.isDestroyed()) return null;
  if (target) writeOverlayBounds(entry, target);
  // setBounds 가 층을 푼다(§17-6 (E)) — 자리를 옮길 때마다 그 창의 층을 다시 박는다.
  keepOverlayOnTop(win, entry.expanded, entry.pinned);
  sendOverlayMaximizeState(entry);
  return target ?? win.getBounds();
}

/** 접기·펼치기처럼 **창 크기를 스스로 정하는** 전이에서 최대화 기억을 지운다. */
function forgetOverlayMaximize(entry: OverlayEntry): void {
  if (!entry.maximized && !entry.restoreBounds) return;
  entry.maximized = false;
  entry.restoreBounds = null;
  sendOverlayMaximizeState(entry);
}

export function toggleMaximizeOverlaySelfByWindowId(windowId: number): boolean {
  const entry = overlaysByWindowId.get(windowId);
  if (!entry || entry.window.isDestroyed()) return false;
  // 버블(접힘)은 최대화할 창이 아니다 — 크기가 그 창의 정체다.
  if (!entry.expanded) return false;
  if (entry.maximized) {
    restoreOverlayMaximize(entry);
    return true;
  }
  const win = entry.window;
  const cur = win.getBounds();
  // (H-19) 되돌릴 크기는 장부 값이다 — 창에 되물은 크기에는 배율 반올림이 섞여 있다.
  entry.restoreBounds = { x: cur.x, y: cur.y, width: entry.size.width, height: entry.size.height };
  entry.maximized = true;
  // **커서가 아니라 그 창이 걸쳐 있는 화면**을 채운다 — 다른 모니터의 커서를 따라가면 창이 순간이동한다.
  const wa = screen.getDisplayMatching(cur).workArea;
  writeOverlayBounds(entry, { x: wa.x, y: wa.y, width: wa.width, height: wa.height });
  keepOverlayOnTop(win, entry.expanded, entry.pinned);
  sendOverlayMaximizeState(entry);
  return true;
}

/**
 * §5.5 #17-27 ①-1 — 편집창 판이 열리면 독립 창을 오른쪽으로 `dx` 넓힌다(폭은 렌더가 정한다). 작업영역 안에 앉히고(`growSpanRight`, 앱 안 창과 같은 규칙)
 * 넓히기 전 자리를 기억한다. 버블·최대화에선 안 한다. 크기는 장부 값에서((H-19)).
 */
export function growOverlayEditorRoomByWindowId(windowId: number, dx: number): boolean {
  const entry = overlaysByWindowId.get(windowId);
  if (!entry || entry.window.isDestroyed() || !entry.expanded || entry.maximized) return false;
  if (typeof dx !== 'number' || !Number.isFinite(dx) || dx <= 0) return false;
  const cur = entry.window.getBounds();
  const wa = screen.getDisplayMatching(cur).workArea;
  const before = { x: cur.x, w: entry.size.width };
  const grown = growSpanRight(before, dx, { x: wa.x, w: wa.width });
  if (grown.w <= before.w) return false;
  // 기억은 창이 **실제로 앉는** 자리로 적는다(격자에 맞춘 x) — 아래 `writeOverlayBounds` 와 같은 격자다.
  const after = landedSpan(grown, dipStepAt(grown.x, cur.y));
  entry.editorGrowth = { before, after };
  writeOverlayBounds(entry, { x: after.x, y: cur.y, width: after.w, height: entry.size.height });
  // setBounds 가 층을 푼다(§17-6 (E)) — 자리를 옮길 때마다 그 창의 층을 다시 세운다.
  keepOverlayOnTop(entry.window, entry.expanded, entry.pinned);
  return true;
}

/**
 * §5.5 #17-27 ①-1 — 판이 닫히면 넓힌 만큼 되돌린다. 폭이 넓힌 그대로일 때만 — 그 사이 사용자가
 * 창 폭을 바꿨으면(장부 `size` 가 `acceptReportedSize` 로 따라간다) 사용자가 정한 크기다.
 * 자리만 옮겼으면 그 자리에서 폭만 되돌린다(`shrinkSpanBack`).
 */
export function restoreOverlayEditorRoomByWindowId(windowId: number): boolean {
  const entry = overlaysByWindowId.get(windowId);
  if (!entry) return false;
  const growth = entry.editorGrowth;
  entry.editorGrowth = null;
  if (!growth || entry.window.isDestroyed() || !entry.expanded || entry.maximized) return false;
  const cur = entry.window.getBounds();
  const back = shrinkSpanBack({ x: cur.x, w: entry.size.width }, growth);
  if (!back) return false;
  writeOverlayBounds(entry, { x: back.x, y: cur.y, width: back.w, height: entry.size.height });
  keepOverlayOnTop(entry.window, entry.expanded, entry.pinned);
  return true;
}

export function closeOverlayByAgentId(agentId: string): boolean {
  const entry = overlaysByAgentId.get(agentId);
  if (!entry) return false;
  closeOverlayEntry(entry);
  return true;
}

export function closeOverlayByWindowId(windowId: number): boolean {
  const entry = overlaysByWindowId.get(windowId);
  if (!entry) return false;
  closeOverlayEntry(entry);
  return true;
}

// 버블 더블클릭 → 창을 IDE 크기로 확대. "그 버블 원 기준으로 좀 작게" — 화면을 다 덮지 않는
// 적당히 작은 크기로, 버블이 있던 자리(중심)에 앵커해 거기서 자라난 듯 보이게 한다.
export function expandOverlayByWindowId(windowId: number): boolean {
  const entry = overlaysByWindowId.get(windowId);
  if (!entry || entry.window.isDestroyed()) return false;
  // §17-6 (H-27) ⑥ 이미 펼친 창은 다시 펴지 않는다 — 다시 펴면 `collapsedBounds` 를 IDE 자리로 덮고 크기를 기본값으로 되돌려,
  // 키워 둔 IDE 가 줄고 접으면 버블이 엉뚱한 자리로 간다.
  if (entry.expanded) return true;
  const win = entry.window;
  const cur = win.getBounds();
  entry.collapsedBounds = { x: cur.x, y: cur.y, width: cur.width, height: cur.height };
  const disp = screen.getDisplayMatching(cur);
  const wa = disp.workArea;
  const w = Math.min(840, Math.round(wa.width * 0.6));
  const h = Math.min(600, Math.round(wa.height * 0.66));
  // 버블 창 중심 기준으로 확대 창을 앉히고 작업영역 안으로 클램프.
  const cx = cur.x + cur.width / 2;
  const cy = cur.y + cur.height / 2;
  const nx = Math.max(wa.x, Math.min(Math.round(cx - w / 2), wa.x + wa.width - w));
  const ny = Math.max(wa.y, Math.min(Math.round(cy - h / 2), wa.y + wa.height - h));
  entry.expanded = true;
  // (H-5) 이 전이는 창 크기를 스스로 정한다 — 최대화 기억을 들고 가면 복원이 엉뚱한 자리로 간다.
  forgetOverlayMaximize(entry);
  try { win.setResizable(true); } catch { /* noop */ }
  try { win.setMinimumSize(MIN_FLOAT_W_OVERLAY, MIN_FLOAT_H_OVERLAY); } catch { /* noop */ }
  writeOverlayBounds(entry, { x: nx, y: ny, width: w, height: h });
  // §17-6 (G) — 펼친 IDE 는 가독성 위해 항상 불투명(접힘 버블의 흐림 설정은 접을 때 복원).
  try { win.setOpacity(1); } catch { /* noop */ }
  win.show();
  win.focus();
  // (E) 개정 — 펼친 IDE 는 **보통 층**이다. 여기가 층이 내려가는 유일한 지점이고, 동시에
  //   `setResizable`/`setBounds`/`show` 가 흩뜨린 층을 그 값으로 다시 박는 자리이기도 하다.
  //   이 뒤로는 이 창 위로 다른 앱이 올라온다(오버레이 버블만은 여전히 그 위 — 층이 다르다).
  keepOverlayOnTop(win, entry.expanded, entry.pinned);
  broadcastOverlayList();
  return true;
}

/**
 * §17-6 (H-27) — 렌더가 IDE 를 열어 스스로 펼 때. 실제로 접힘→펼침이 된 판에만: ④ `attentionOnExpandAt` 이 5초 안이면 편 뒤 앞세우기·기척
 * (버블에 보낸 기척은 사라진다) ⑤ 본체에 `ide-opened` — 앱 안의 같은 에이전트 창은 짐을 넘기고 물러난다.
 */
export function expandOverlaySelf(windowId: number): boolean {
  const entry = overlaysByWindowId.get(windowId);
  if (!entry || entry.window.isDestroyed()) return false;
  const wasExpanded = entry.expanded;
  const ok = expandOverlayByWindowId(windowId);
  if (!ok || wasExpanded) return ok;
  // 표식은 한 번만 읽는다 — 다음 펼침(사용자가 나중에 직접 편 것)까지 들고 가면 부르지 않은 창이 빛난다.
  const due = overlayExpandAttentionDue(entry.attentionOnExpandAt, Date.now());
  entry.attentionOnExpandAt = null;
  if (due) {
    // 버블의 상시-위에서 보통 층으로 막 내려온 창이다 — 그 사이 다른 앱이 끼어들었어도 다시 앞으로.
    raiseOverlayWindow(entry, 'foreground');
    if (!entry.window.webContents.isDestroyed()) {
      entry.window.webContents.send('vibisual:overlay:attention', { agentId: entry.agentId });
    }
  }
  const main = getMainWindow();
  if (main && !main.isDestroyed()) {
    main.webContents.send('vibisual:overlay:ide-opened', { agentId: entry.agentId, projectId: entry.projectId });
  }
  return ok;
}

// IDE 닫기(Esc/백드롭/X) → 다시 버블 크기로 축소.
export function collapseOverlayByWindowId(windowId: number): boolean {
  const entry = overlaysByWindowId.get(windowId);
  if (!entry || entry.window.isDestroyed()) return false;
  const win = entry.window;
  entry.expanded = false;
  // (H-5) 버블로 접히는 창이 "최대화 상태"라고 우기면, 복원 버튼이 버블을 엉뚱한 크기로 되돌린다.
  forgetOverlayMaximize(entry);
  // §5.5 #17-27 ①-1 — 버블로 접히면 넓혔던 폭의 기억도 끝난다(다음에 펴는 크기는 펴는 쪽이 정한다).
  entry.editorGrowth = null;
  const b = entry.collapsedBounds;
  try { win.setMinimumSize(OVERLAY_BUBBLE_W, OVERLAY_BUBBLE_H); } catch { /* noop */ }
  try { win.setResizable(false); } catch { /* noop */ }
  if (b) {
    writeOverlayBounds(entry, { x: b.x, y: b.y, width: OVERLAY_BUBBLE_W, height: OVERLAY_BUBBLE_H });
  } else {
    const cur = win.getBounds();
    writeOverlayBounds(entry, { x: cur.x, y: cur.y, width: OVERLAY_BUBBLE_W, height: OVERLAY_BUBBLE_H });
  }
  // §17-6 (G) — 버블로 복귀하면 사용자가 고른 불투명도를 복원.
  try { win.setOpacity(entry.opacity); } catch { /* noop */ }
  // (E) — 버블로 돌아오면 층도 상시-위로 돌아온다(`setResizable(false)` 가 층을 풀 수 있는 것도 이 한 번으로 덮인다).
  keepOverlayOnTop(win, entry.expanded, entry.pinned);
  broadcastOverlayList();
  return true;
}

// Header 전역 토글.
export function setOverlaysVisible(visible: boolean): void {
  overlaysUserVisible = visible;
  applyAllOverlayVisibility();
  broadcastOverlayList();
}

// ─── §17-6 (H-28) — 떼어 낸 IDE 창을 다른 앱 위에 고정 ─────────────────────────

/**
 * [항상 위에 고정] set(토글 아님, 멱등 — 두 번 와도 버튼과 안 어긋난다). 기억만 바꾸고 층은 `keepOverlayOnTop`(`overlayTopMostFor`)이 세운다.
 * 접힌 창은 그대로 상시-위, 펼칠 때 고정이 걸린다. 돌려주는 값으로 버튼을 칠한다.
 */
export function setOverlayPinnedSelfByWindowId(windowId: number, pinned: boolean): boolean {
  const entry = overlaysByWindowId.get(windowId);
  if (!entry || entry.window.isDestroyed()) return false;
  entry.pinned = pinned;
  keepOverlayOnTop(entry.window, entry.expanded, entry.pinned);
  return entry.pinned;
}

/** 그 창이 지금 고정돼 있는가 — 창이 IDE 로 설 때 버튼이 한 번 묻는다(접었다 편 창도 켜진 칠로 서게). */
export function isOverlayPinnedByWindowId(windowId: number): boolean {
  return overlaysByWindowId.get(windowId)?.pinned ?? false;
}

// §17-6 (G) — 버블 우클릭 컨텍스트 메뉴 액션

// "숨기기(이 버블만)" — 이 오버레이 창만 숨긴다(등록은 유지). 복귀는 Header 전역 토글(유일 스위치).
export function hideOverlaySelfByWindowId(windowId: number): boolean {
  const entry = overlaysByWindowId.get(windowId);
  if (!entry || entry.window.isDestroyed()) return false;
  if (entry.window.isVisible()) entry.window.hide();
  return true;
}

// "불투명도 100/75/50%" — 접힘 버블에만 즉시 적용하고 값은 기억(펼침 시 1, 접으면 이 값 복원).
export function setOverlayOpacitySelfByWindowId(windowId: number, opacity: number): boolean {
  const entry = overlaysByWindowId.get(windowId);
  if (!entry || entry.window.isDestroyed()) return false;
  const clamped = Math.max(0.2, Math.min(1, Number.isFinite(opacity) ? opacity : 1));
  entry.opacity = clamped;
  // 펼친 IDE 는 항상 불투명 유지 — 접힘 상태에서만 즉시 반영.
  if (!entry.expanded) {
    try { entry.window.setOpacity(clamped); } catch { /* noop */ }
  }
  return true;
}

// "본체에서 이 버블로 점프" — 메인 윈도우를 앞으로 끌어올리고, 그 렌더러에 점프 신호를 보낸다.
// 실제 캔버스 이동·선택은 메인 App 의 onReveal 핸들러가 §5.4 #30 북마크 점프 로직으로 수행.
export function revealOverlayInMain(payload: {
  agentId: string;
  projectId: string;
  openIde?: boolean;
  /**
   * §17-6 (H-9) — 앱 안에 열린 창은 하나도 건드리지 않는다(닫기가 타는 길). 앞 창을 닫는 것은 우클릭 점프의 규율이다 —
   * 닫기에 쓰면 밖의 창을 닫았을 뿐인데 앱 안의 남의 창이 함께 닫힌다.
   */
  keepPanes?: boolean;
  /** §17-6 (H) — 그 창이 들고 오던 것(열어 둔 편집 탭·보던 뷰·붙어 있던 변). 메인 창이 꺼내 쓴다. */
  handoff?: unknown;
  /**
   * §17-6 (H-4) — 끌던 도중에 돌아온 창(손이 아직 눌려 있다). 앱 안 창이 드래그를 이어받게 잡은 지점·크기를 넘긴다 —
   * 안 그러면 한 번 놓았다 다시 잡아야 움직인다.
   */
  resumeDrag?: {
    grabX: number;
    grabY: number;
    width: number;
    height: number;
    cursor?: { x: number; y: number };
    /**
     * §17-6 (H-17) — 손이 **아직 눌려 있는가.** 거짓이면 앱 안 창은 자리·크기만 물려받고
     * 그대로 선다(드래그를 이어받으면 놓은 뒤에도 창이 커서를 따라다닌다).
     */
    dragging?: boolean;
  } | undefined;
}): boolean {
  const main = getMainWindow();
  if (!main || main.isDestroyed()) return false;
  // 짐은 **신호보다 먼저** 맡긴다 — 받는 쪽이 신호를 받자마자 꺼내므로 순서가 뒤집히면 빈손이 된다.
  if (payload.handoff) putPaneHandoff(payload.agentId, payload.handoff);
  if (main.isMinimized()) main.restore();
  main.show();
  main.focus();
  main.webContents.send('vibisual:overlay:reveal', {
    agentId: payload.agentId,
    projectId: payload.projectId,
    // (판올림 번호 발급 대기) 끌어냈던 창을 **앱 안으로 되돌리는** 길 — 캔버스로 점프만 하는
    //   종전 동작과 달리 그 자리에서 IDE 창까지 다시 연다(되돌리기가 반쪽이면 되돌린 게 아니다).
    openIde: !!payload.openIde,
    // (H-9) 닫기로 돌아온 길 — 그 버블만 보여 주고 앱 안 창은 그대로 둔다.
    keepPanes: !!payload.keepPanes,
    // 짐이 있다는 사실만 알린다 — 내용은 받는 쪽이 `take-handoff` 로 꺼낸다(한 번만 꺼내지도록).
    hasHandoff: !!payload.handoff,
    // (H-4) 끌던 도중이면 앱 안 창이 그 드래그를 이어받는다(없으면 종전대로 그냥 열린다).
    resumeDrag: payload.resumeDrag,
  });
  return true;
}

// §17-6 (G) — 우클릭 메뉴는 커서 위치의 투명 팝업 창이다(버블 창 안 HTML 메뉴는 커서 아래에 못 열리고 넘친 하단이 잘린다).
// 메뉴 창은 대상 창을 모르므로 main 이 targetWindowId 로 라우팅한다(open-ide 만 버블 렌더러로 push).
const OVERLAY_MENU_INIT_W = 230;
const OVERLAY_MENU_INIT_H = 300;

interface OverlayMenuState {
  window: BrowserWindow;
  targetWindowId: number;
  anchor: { x: number; y: number };
  shown: boolean;
}
let overlayMenu: OverlayMenuState | null = null;

function closeOverlayMenu(): void {
  const m = overlayMenu;
  overlayMenu = null;
  if (m && !m.window.isDestroyed()) m.window.close();
}

// 버블 창에서 우클릭 → 그 창을 대상으로 메뉴 팝업 창을 커서 위치에 띄운다.
export function openOverlayMenuByWindowId(windowId: number): boolean {
  const entry = overlaysByWindowId.get(windowId);
  if (!entry || entry.window.isDestroyed()) return false;
  closeOverlayMenu(); // 기존 메뉴는 닫고 새로(토글/재오픈).
  const cursor = screen.getCursorScreenPoint();
  const wa = screen.getDisplayNearestPoint(cursor).workArea;
  // 초기 위치는 대략 클램프(실제 크기·정밀 클램프는 menu-resize 에서).
  const x = Math.max(wa.x, Math.min(cursor.x, wa.x + wa.width - OVERLAY_MENU_INIT_W));
  const y = Math.max(wa.y, Math.min(cursor.y, wa.y + wa.height - OVERLAY_MENU_INIT_H));
  const win = new BrowserWindow({
    width: OVERLAY_MENU_INIT_W,
    height: OVERLAY_MENU_INIT_H,
    x,
    y,
    show: false,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    autoHideMenuBar: true,
    title: 'Vibisual',
    icon: windowIconPath(__dirname, process.platform),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: false,
      // §5.13 (R) — Chromium 내장 PDF 뷰어를 켠다. 우리가 PDF 렌더를 쓰지 않고 iframe 하나로 여는 근거.
      plugins: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  hardenWindow(win);
  keepOverlayMenuOnTop(win);
  overlayMenu = { window: win, targetWindowId: windowId, anchor: { x: cursor.x, y: cursor.y }, shown: false };
  // 메뉴 밖(다른 창) 클릭 → blur → 닫기. 액션 클릭은 메뉴 창 내부라 blur 없음.
  win.on('blur', () => { if (overlayMenu && overlayMenu.window === win) closeOverlayMenu(); });
  win.on('closed', () => { if (overlayMenu && overlayMenu.window === win) overlayMenu = null; });
  // 렌더가 크기를 신고하기 전 깜빡임 방지 — 신고가 늦어도 보이도록 안전 타이머로 표시.
  setTimeout(() => {
    if (overlayMenu && overlayMenu.window === win && !win.isDestroyed() && !overlayMenu.shown) {
      overlayMenu.shown = true;
      win.show();
      keepOverlayMenuOnTop(win);
    }
  }, 300);
  const hash =
    `overlaymenu=1&targetWindowId=${windowId}` +
    `&agentId=${encodeURIComponent(entry.agentId)}` +
    `&projectId=${encodeURIComponent(entry.projectId)}` +
    `&opacity=${entry.opacity}`;
  void win.loadFile(join(__dirname, '../renderer/index.html'), { hash });
  return true;
}

// 메뉴 렌더가 실제 크기를 측정해 신고 → 창을 딱 맞추고 커서 기준 작업영역 안으로 정밀 배치.
export function resizeOverlayMenu(senderWindowId: number, width: number, height: number): boolean {
  const m = overlayMenu;
  if (!m || m.window.isDestroyed() || m.window.id !== senderWindowId) return false;
  const w = Math.max(160, Math.round(width));
  const h = Math.max(80, Math.round(height));
  const wa = screen.getDisplayNearestPoint(m.anchor).workArea;
  // 커서 아래에 열되, 오른쪽/아래로 넘치면 커서 왼쪽/위로 플립 후 작업영역 안으로 클램프.
  let x = m.anchor.x;
  let y = m.anchor.y;
  if (x + w > wa.x + wa.width) x = m.anchor.x - w;
  if (y + h > wa.y + wa.height) y = m.anchor.y - h;
  x = Math.max(wa.x, Math.min(x, wa.x + wa.width - w));
  y = Math.max(wa.y, Math.min(y, wa.y + wa.height - h));
  m.window.setBounds({ x, y, width: w, height: h }, false);
  if (!m.shown) {
    m.shown = true;
    m.window.show();
  }
  keepOverlayMenuOnTop(m.window);
  return true;
}

// 메뉴 액션을 대상(버블) 창에 적용. opacity 만 메뉴를 유지(미세 조절), 나머지는 닫는다.
export function overlayMenuAction(senderWindowId: number, action: string, value?: number): boolean {
  const m = overlayMenu;
  if (!m || m.window.id !== senderWindowId) return false;
  const targetId = m.targetWindowId;
  const target = overlaysByWindowId.get(targetId);
  switch (action) {
    case 'open-ide':
      // IDE 펼침은 버블 창 렌더러의 openIDEOverlay 를 타야 한다(더블클릭과 동일 경로 — 창 리사이즈만으론 부족).
      if (target && !target.window.isDestroyed()) {
        target.window.webContents.send('vibisual:overlay:menu-command', { command: 'open-ide' });
      }
      closeOverlayMenu();
      return true;
    case 'reveal':
      if (target) revealOverlayInMain({ agentId: target.agentId, projectId: target.projectId });
      closeOverlayMenu();
      return true;
    case 'opacity':
      setOverlayOpacitySelfByWindowId(targetId, typeof value === 'number' ? value : 1);
      return true; // 슬라이더는 메뉴 유지.
    case 'hide':
      hideOverlaySelfByWindowId(targetId);
      closeOverlayMenu();
      return true;
    case 'close':
      closeOverlayByWindowId(targetId);
      closeOverlayMenu();
      return true;
    default:
      closeOverlayMenu();
      return false;
  }
}

// 메뉴 렌더의 Esc 등으로 자기 자신을 닫기.
export function closeOverlayMenuByWindowId(senderWindowId: number): boolean {
  const m = overlayMenu;
  if (!m || m.window.id !== senderWindowId) return false;
  closeOverlayMenu();
  return true;
}

export function closeAllOverlays(): void {
  closeOverlayMenu();
  // (H-6) 밖으로 빼는 중이던 윤곽선도 함께 걷는다 — 클릭통과 창이라 남으면 사용자가 없앨 수 없다.
  //   (H-7) 인계를 기다리던 그물도 함께 푼다(앱이 닫힌 뒤 도는 타이머 ❌).
  finishGhostHandoff();
  for (const entry of [...overlaysByAgentId.values()]) {
    stopOverlayDrag(entry.id);
    if (!entry.window.isDestroyed()) entry.window.destroy();
  }
  overlaysByAgentId.clear();
  overlaysByWindowId.clear();
  // 건너가던 짐도 함께 버린다 — 받을 창이 사라졌으므로 남겨 둘 뜻이 없다.
  paneHandoffs.clear();
}

// §5.12 Command Center — 지휘통제실 창. 앱 전체에 1창 — 어느 root 를 눌러도 같은 창을 focus 하고 `show-project` 를 민다(프로젝트마다면 창만 쌓인다).
// redock 은 없다. `vibisual:window:*-self` 를 쓰므로 byWindowId 조회에 함께 물린다.

const CC_DEFAULT_W = 1180;
const CC_DEFAULT_H = 760;
const CC_MIN_W = 760;
const CC_MIN_H = 460;

interface CommandCenterEntry {
  id: number;
  window: BrowserWindow;
}

let commandCenter: CommandCenterEntry | null = null;

export function openCommandCenter(opts: {
  projectId: string;
  cursor?: { x: number; y: number } | undefined;
}): { windowId: number; reused: boolean } {
  if (commandCenter && !commandCenter.window.isDestroyed()) {
    const win = commandCenter.window;
    if (win.isMinimized()) win.restore();
    win.focus();
    // 창이 하나뿐이므로 "다른 프로젝트의 root 를 눌렀다" = "그 프로젝트를 보여 달라"다.
    if (!win.webContents.isDestroyed()) {
      win.webContents.send('vibisual:command:show-project', { projectId: opts.projectId });
    }
    return { windowId: commandCenter.id, reused: true };
  }

  let x: number | undefined;
  let y: number | undefined;
  if (opts.cursor) {
    const wa = screen.getDisplayNearestPoint(opts.cursor).workArea;
    x = Math.round(Math.min(Math.max(opts.cursor.x - CC_DEFAULT_W / 2, wa.x), wa.x + wa.width - CC_DEFAULT_W));
    y = Math.round(Math.min(Math.max(opts.cursor.y - 40, wa.y), wa.y + wa.height - CC_DEFAULT_H));
  }

  const win = new BrowserWindow({
    width: CC_DEFAULT_W,
    height: CC_DEFAULT_H,
    minWidth: CC_MIN_W,
    minHeight: CC_MIN_H,
    ...(x !== undefined && y !== undefined ? { x, y } : {}),
    show: false,
    // §4 앱 테마 — 별창과 같다.
    backgroundColor: safeAppThemeChrome().background,
    autoHideMenuBar: true,
    title: 'Vibisual — Command Center',
    // 별창과 동일하게 OS 타이틀바를 우리 미니 타이틀바가 대신한다.
    frame: false,
    icon: windowIconPath(__dirname, process.platform),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: false,
      // §5.13 (R) — Chromium 내장 PDF 뷰어를 켠다. 우리가 PDF 렌더를 쓰지 않고 iframe 하나로 여는 근거.
      plugins: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  hardenWindow(win);
  // §4 앱 테마 — 테마를 바꾸면 이 창의 바탕도 다시 칠한다.
  trackThemedWindow(win);

  win.on('ready-to-show', () => {
    if (!win.isDestroyed()) win.show();
  });

  commandCenter = { id: win.id, window: win };

  const pushMaximizeState = (): void => {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send('vibisual:window:maximize-state', { maximized: win.isMaximized() });
    }
  };
  win.on('maximize', pushMaximizeState);
  win.on('unmaximize', pushMaximizeState);

  win.on('closed', () => {
    if (commandCenter?.id === win.id) commandCenter = null;
  });

  const hash = `command=1&projectId=${encodeURIComponent(opts.projectId)}`;
  void win.loadFile(join(__dirname, '../renderer/index.html'), { hash });

  win.webContents.once('did-finish-load', () => {
    if (!win.isDestroyed()) {
      win.webContents.send('vibisual:window:maximize-state', { maximized: win.isMaximized() });
    }
  });

  return { windowId: win.id, reused: false };
}

export function closeCommandCenter(): boolean {
  if (!commandCenter) return false;
  if (!commandCenter.window.isDestroyed()) commandCenter.window.close();
  return true;
}

// "지휘통제실에서 이 세션으로 점프" — 메인 윈도우를 앞으로 끌어올리고 점프 신호를 보낸다.
// 실제 이동은 메인 App 의 useCommandCenterReveal 이 §5.4 #30 세션 북마크 점프 순서로 수행.
export function revealSessionInMain(payload: {
  projectId: string;
  agentId: string;
  subAgentId?: string | undefined;
}): boolean {
  const main = getMainWindow();
  if (!main || main.isDestroyed()) return false;
  if (main.isMinimized()) main.restore();
  main.show();
  main.focus();
  main.webContents.send('vibisual:command:reveal', {
    projectId: payload.projectId,
    agentId: payload.agentId,
    subAgentId: payload.subAgentId ?? null,
  });
  return true;
}

export function closeAllCommandCenters(): void {
  if (commandCenter && !commandCenter.window.isDestroyed()) commandCenter.window.destroy();
  commandCenter = null;
}

// §5.13 (O) 내부 앱 창(앱 무관) — 창 규격은 앱이 선언하고 여기서는 그대로 연다(앱마다 `openXxxWindow` ❌).
// 앱 하나당 창 하나 — 다시 열면 새 창을 쌓지 않고 그 창에 대상을 밀어 넣는다(쌓이면 어느 것이 지금 것인지 모른다).

export interface AppWindowSpec {
  title: string;
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  /** 렌더러가 어떤 화면을 그릴지 정하는 hash. `app=<id>&…` 형태. */
  hash: string;
}

interface AppWindowEntry {
  id: number;
  window: BrowserWindow;
  ready: Promise<void>;
  lifecycle: ReturnType<typeof createAppWindowClose>;
}

const appWindows = new Map<string, AppWindowEntry>();

const appWindowTransfers = new AppWindowTransfers({
  main: () => getMainWindow(),
  cursor: () => screen.getCursorScreenPoint(),
  dipStep: dipStepAt,
  showGhost: (opts) => {
    nudgePopOutGhost({ dx: 0, dy: 0 });
    return showPopOutGhost(opts);
  },
  hideGhost: hidePopOutGhost,
  primaryPressed: appWindowPrimaryPressed,
  // §5.13 (S-11) 창이 서고 닫히거나 보는 문서가 바뀔 때마다 — 본체가 "이미 밖에 떠 있다"를 판정하는 근거다.
  changed: () => broadcastAppWindowList(),
  close: (window) => { closeByWindowId(window.id); },
});

/**
 * §5.13 (S-11) — 밖에 떠 있는 앱 창 목록을 모든 창에 민다(오버레이 목록 `vibisual:overlay:list` 와 같은 길).
 * 캔버스가 있는 창(본체·별창)은 이 목록으로 "그 문서가 이미 밖에 떠 있다"를 알고 앱 안에 한 벌 더 세우지 않는다.
 */
function broadcastAppWindowList(): void {
  broadcastWindowMessage(BrowserWindow.getAllWindows(), 'vibisual:app:list', appWindowTransfers.list());
}

/** §5.13 (S-11) 지금 목록 — 구독을 붙이기 전에 지나간 알림을 메우는 첫 물음. */
export function listAppWindows(): AppWindowListItem[] {
  return appWindowTransfers.list();
}

/**
 * §5.13 (S-11) — 밖에 이미 떠 있는 앱 창을 앞으로 세운다(IDE 창 (H-13)(H-16) 과 같은 규율 — 같은 문서를 두 창에 띄우지 않고, 세운 뒤 테두리 기척).
 * 대상은 다시 밀어 넣지 않는다 — `openAppWindow` 는 대상 전환 확인을 거쳐 편집기를 새로 세울 수 있다. 순서는 `overlayRaiseSteps`.
 * @param windowId 본체가 본 그 창 — 그 사이 다른 문서로 새로 선 창을 대신 세우지 않는다.
 * @returns 세웠으면 true, 없으면 false(본체는 앱 안에 연다).
 */
export async function focusAppWindow(appId: string, windowId?: number): Promise<boolean> {
  const entry = appWindows.get(appId);
  if (!entry || entry.window.isDestroyed()) return false;
  if (windowId !== undefined && entry.id !== windowId) return false;
  // 아직 그리는 중인 창이면 다 그린 뒤에 세운다 — 빈 창이 먼저 번쩍이지 않게.
  try { await entry.ready; } catch { return false; }
  const win = entry.window;
  if (win.isDestroyed()) return false;
  for (const step of overlayRaiseSteps({ platform: process.platform, activation: 'foreground', minimized: win.isMinimized() })) {
    try {
      switch (step) {
        case 'restore': win.restore(); break;
        case 'showInactive': win.showInactive(); break;
        case 'show': win.show(); break;
        case 'activateApp': app.focus({ steal: true }); break;
        case 'focus': win.focus(); break;
        // 앱 창은 보통 층이다 — 오버레이처럼 다시 박을 층이 없다.
        case 'reassertTop': break;
        case 'moveTop': win.moveTop(); break;
      }
    } catch { /* noop — 닫히는 찰나에 닿아도 나머지 손짓까지 잃지 않는다 */ }
  }
  try {
    if (!win.webContents.isDestroyed()) win.webContents.send('vibisual:app:attention', { appId });
  } catch { /* 닫히는 찰나 — 세우기는 이미 끝났다 */ }
  return true;
}

export async function openAppWindow(appId: string, spec: AppWindowSpec, options?: {
  params?: Record<string, string>;
  origin?: BrowserWindow | null;
  placement?: AppWindowPlacement;
}): Promise<{ windowId: number; reused: boolean }> {
  // App modules whitelist document keys. Window chrome metadata belongs to this common layer.
  const appHash = new URLSearchParams(spec.hash.replace(/^#/, ''));
  if (options?.params?.['_windowTitle']) appHash.set('_windowTitle', options.params['_windowTitle']);
  const hash = appHash.toString();
  const placement = options?.placement;
  // §5.13 (S-10) 앱 안 창을 끌어내 놓은 판 — 멈춰 선 선(가상 창)의 자리·크기 그대로 선다((H-17) ④ 와 같은 규율).
  // 렌더러 좌표가 아니라 선의 경계를 읽는다(배율이 다른 모니터에서 어긋난다). 선이 없으면 placement 의 x/y.
  const ghostBounds = placement?.fromGhost === true ? popOutGhostBounds() : null;
  const existing = appWindows.get(appId);
  if (existing && !existing.window.isDestroyed()) {
    const win = existing.window;
    await existing.ready;
    if (win.isDestroyed()) throw new Error('Application window closed before loading');
    await appWindowTransfers.requestTarget(win.id, options?.params ?? {}, options?.origin ?? null, hash);
    if (win.isDestroyed()) throw new Error('Application window closed before accepting the target');
    if (win.isMinimized()) win.restore();
    // (S-10) 다시 쓰는 창도 놓은 곳에 선다 — 선은 여기 있는데 창이 옛 자리에서 나타나면 놓은 보람이 없다.
    //   선은 이 창이 보인 뒤에 걷는다(주인은 보이기 직전에 세운다 — 대상 전환을 기다리는 동안은 선이 제 수명대로 선다).
    if (ghostBounds) {
      appWindowTransfers.place(win.id, ghostBounds);
      armGhostHandoff(win.id);
    }
    win.show();
    win.focus();
    if (ghostBounds) finishGhostHandoffOnceShown(win.id);
    return { windowId: existing.id, reused: true };
  }

  const width = ghostBounds
    ? Math.max(spec.minWidth, Math.round(ghostBounds.width))
    : placement && Number.isFinite(placement.width) ? Math.max(spec.minWidth, Math.round(placement.width)) : spec.width;
  const height = ghostBounds
    ? Math.max(spec.minHeight, Math.round(ghostBounds.height))
    : placement && Number.isFinite(placement.height) ? Math.max(spec.minHeight, Math.round(placement.height)) : spec.height;
  const x = ghostBounds ? ghostBounds.x : placement?.x;
  const y = ghostBounds ? ghostBounds.y : placement?.y;
  const win = new BrowserWindow({
    width,
    height,
    ...(x !== undefined && Number.isFinite(x) ? { x: Math.round(x) } : {}),
    ...(y !== undefined && Number.isFinite(y) ? { y: Math.round(y) } : {}),
    minWidth: spec.minWidth,
    minHeight: spec.minHeight,
    show: false,
    // §4 앱 테마 — 별창과 같다(창 머리줄은 테마를 따르고, 안의 앱 화면은 렌더러가 어두운 판으로 고정한다).
    backgroundColor: safeAppThemeChrome().background,
    autoHideMenuBar: true,
    title: spec.title,
    frame: false,
    icon: windowIconPath(__dirname, process.platform),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: false,
      // §5.13 (R) — Chromium 내장 PDF 뷰어를 켠다. 우리가 PDF 렌더를 쓰지 않고 iframe 하나로 여는 근거.
      plugins: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  hardenWindow(win);
  // §4 앱 테마 — 테마를 바꾸면 이 창의 바탕도 다시 칠한다.
  trackThemedWindow(win);

  // (S-10) 선이 서 있으면 이 창이 **보일 때까지** 살려 둔다 — 걷는 것이 먼저면 창이 뜨기까지 손 아래가
  //   빈다(그물은 나가는 길의 4초). 창이 보이면 그 자리를 창이 이어받는다("선이 창이 된다").
  if (ghostBounds) armGhostHandoff(win.id);
  win.on('ready-to-show', () => {
    if (!win.isDestroyed()) win.show();
    if (ghostBounds) finishGhostHandoffOnceShown(win.id);
  });

  appWindowTransfers.register({ appId, window: win, origin: options?.origin ?? null,
    params: { ...options?.params }, size: { width, height }, writtenAt: Date.now() });
  win.on('resize', () => appWindowTransfers.reportSize(win.id));

  const pushMaximizeState = (): void => {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send('vibisual:window:maximize-state', { maximized: win.isMaximized() });
    }
  };
  win.on('maximize', pushMaximizeState);
  win.on('unmaximize', pushMaximizeState);
  win.on('closed', () => {
    appWindowTransfers.unregister(win.id);
    if (appWindows.get(appId)?.id === win.id) appWindows.delete(appId);
    // (S-10) 보이기 전에 닫혔다 — 이 창을 기다리던 선을 남기지 않는다(클릭통과라 사용자가 못 없앤다).
    if (isGhostHandoffTarget(win.id)) finishGhostHandoff();
  });

  // Keep the embedded source until loading has succeeded; a failed child must not take it away.
  const lifecycle = createAppWindowClose(win);
  win.on('close', lifecycle.onClose);
  const ready = win.loadFile(join(__dirname, '../renderer/index.html'), { hash });
  appWindows.set(appId, { id: win.id, window: win, ready, lifecycle });
  try {
    await ready;
    if (win.isDestroyed()) throw new Error('Application window closed before loading');
  } catch (error) {
    // (S-10) 못 열었다 — 선을 걷는다(앱 안 창은 렌더러가 제자리에 되살린다).
    if (isGhostHandoffTarget(win.id)) finishGhostHandoff();
    if (!win.isDestroyed()) lifecycle.close();
    throw error;
  }
  return { windowId: win.id, reused: false };
}

export function updateAppWindowTarget(windowId: number, params: Record<string, string>): boolean {
  return appWindowTransfers.updateTarget(windowId, params);
}

export function startAppWindowDrag(windowId: number): boolean { return appWindowTransfers.startDrag(windowId); }
export function endAppWindowDrag(windowId: number, commit = true, appId?: string): boolean {
  return appWindowTransfers.endDrag(windowId, commit, appId);
}
export function redockAppWindow(windowId: number): boolean { return appWindowTransfers.redock(windowId); }
export function ackAppWindowRedock(windowId: number, requestId: string): boolean {
  return appWindowTransfers.ackRedock(windowId, requestId);
}
export function ackAppWindowTarget(windowId: number, requestId: string, accepted: boolean): boolean {
  return appWindowTransfers.ackTarget(windowId, requestId, accepted);
}

export function closeAppWindow(appId: string): boolean {
  const entry = appWindows.get(appId);
  if (!entry) return false;
  if (!entry.window.isDestroyed()) entry.lifecycle.close();
  return true;
}

export function setAppWindowCloseRetention(windowId: number, retained: boolean): boolean {
  for (const entry of appWindows.values()) if (entry.id === windowId) return entry.lifecycle.setRetention(retained);
  return false;
}

export function hideAppWindow(windowId: number): boolean {
  for (const entry of appWindows.values()) if (entry.id === windowId) return entry.lifecycle.hide();
  return false;
}
