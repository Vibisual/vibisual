import { join } from 'node:path';
import { app, BrowserWindow, screen } from 'electron';
import { isCursorDeepInside, isCursorOutsideRect, stepRedockDwell } from '@vibisual/shared';
import { hidePopOutGhost, isPopOutGhostVisible, nudgePopOutGhost, showPopOutGhost } from './ghostFrame';
import { openExternalWithNotice } from './externalOpen';
import { keepDragRegionsFresh } from './dragRegions';
import {
  isOverlaySlotUsable,
  overlayAttentionOnReuse,
  overlayFollowsMainFocus,
  overlayRaiseSteps,
  overlayReuseActivation,
  overlayTopMostFor,
  releaseSlotIfOwner,
} from './overlaySlot';
import { acceptReportedSize, dipStepFor, movedBounds, snapDip, type OverlaySize } from './overlaySize';

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

/**
 * 창 아이콘 경로 — Windows 만 `.ico`, mac/linux 는 `.png`.
 *
 * 다섯 군데의 `BrowserWindow` 생성이 같은 삼항식을 각자 적고 있었다. 하나를 고치고 넷을 빠뜨리면
 * 창마다 아이콘이 갈리는데, 그건 그 OS 에서 띄워 보기 전에는 드러나지 않는다.
 * **플랫폼을 인자로 받아** 세 경우를 단위 테스트로 고정한다(mac 은 실제로는 앱 번들 아이콘을 쓰므로
 * 이 값이 쓰이지 않지만, 넘겨도 해가 없고 linux 와 같은 가지로 두는 편이 규칙이 단순하다).
 */
export function windowIconPath(baseDir: string, platform: NodeJS.Platform): string {
  return join(baseDir, '..', platform === 'win32' ? 'icon.ico' : 'icon.png');
}

/**
 * §보안 감사 2026-09-09 — **창이 우리 문서를 떠나지 못하게 잠근다.**
 *
 * 본체 창(main/index.ts)에는 오래전부터 `setWindowOpenHandler` + `will-navigate` 가 있었는데,
 * 이 파일이 만드는 **다섯 창(별창·오버레이 메뉴·오버레이 위젯·지휘통제실·내부 앱)에는 한 곳도
 * 없었다.** 그 창들은 전부 `sandbox:false` + 우리 preload(=`window.api` 전량)를 달고 뜬다.
 *
 * 최상위 항해를 막지 않으면, 그 창 안의 문서가 원격 주소로 옮겨 간 뒤에도 **preload 가 새 문서에
 * 다시 주입된다**(Electron 31 실측). 그때부터 원격 스크립트가 `window.api` 를 그대로 부른다.
 * 창을 띄우는 내용(에이전트가 그린 카드·마크다운 링크·내부 앱 화면)은 우리가 만든 것이 아니므로,
 * 이 잠금은 본체 창 하나로는 부족하다.
 *
 * - 새 창 요청은 창을 만들지 않고 바깥 브라우저로 넘긴다(스킴 허용 목록은 `externalOpen` 이 본다).
 * - 최상위 이동은 막고 같은 길로 넘긴다. **iframe 안쪽 항해는 건드리지 않는다** — 프리뷰 iframe 이
 *   그 길로 살아 있고, 거기는 `sandbox` 속성이 따로 잠근다.
 * - 해시 이동(`index.html#…`)과 main 이 부르는 `loadFile` 은 `will-navigate` 를 타지 않으므로
 *   이 잠금과 무관하다(본체 창이 같은 규약으로 오래 돌아온 근거).
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
  // §보안 감사 2026-09-09 — 이 창들에는 항해 가드가 한 곳도 없었다(본체 창에만 있었다).
  hardenWindow(win);
  // §3.7 v2.10 — 창이 돌아오면(show·restore·최대화 전이) 드래그 영역을 다시 신고시킨다.
  //   신고를 한 번 놓치면 타이틀바가 정적이라 다시 신고할 계기가 영영 오지 않는다(dragRegions).
  keepDragRegionsFresh(win);

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

// 별창 + §5.12 Command Center 창 + §5.13 (O) 내부 앱 창을 함께 조회 — 이 창들이 모두 같은
// `vibisual:window:*-self` 채널로 자기 창의 최소화/최대화/닫기를 요청하기 때문
// (Command Center 는 redock 만 없다). frame:false 라 여기서 빠지면 그 창은 타이틀바 버튼이
// 눌려도 아무 일이 일어나지 않는다 — 창을 새로 만들면 여기에도 등록할 것.
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

// ─── §5.5 #17-6 v2.73 — 버블 오버레이 창 ──────────────────────────────────
//
// 커스텀/CMD 에이전트 버블을 데스크톱 상시-위 위젯으로 분리한다. 별창(detach)과 같은
// in-process 서버/preload 를 공유하므로 graph_snapshot 을 자동 수신(setBroadcastSink 의
// BrowserWindow 순회에 포함). 별창과의 차이:
//   - frame:false + transparent + alwaysOnTop + skipTaskbar, 버블 크기 작은 창(엣지 미표시)
//   - 더블클릭 시 IDE 크기로 확대(expand) ↔ 닫으면 버블 크기로 축소(collapse)
//   - 포커스 무관 항상 위(§17-6 (E) — focus-hide 는 사용자 요청으로 제거됨)
//   - Header 전역 토글로 사용자 show/hide. 실제 표시 = userVisible.

interface OverlayEntry {
  id: number;
  agentId: string;
  projectId: string;
  window: BrowserWindow;
  /** 버블 ↔ IDE 펼침 상태. */
  expanded: boolean;
  /** 펼치기 직전의 버블 창 bounds(접을 때 위치 복원용). */
  collapsedBounds: { x: number; y: number; width: number; height: number } | null;
  /** §17-6 (G) v2.82 — 우클릭 메뉴 불투명도(1/0.75/0.5). 접힘 버블에만 적용, 펼침 시 1로 보고 접으면 이 값 복원. */
  opacity: number;
  /**
   * §17-6 (H-5) — **최대화 상태를 우리가 쥔다.** `isMaximized()` 는 테두리 없는 창에서
   * `unmaximize()` 뒤에도 참으로 남고(§5.4 #14-1 회귀), 투명 창의 네이티브 최대화는 플랫폼마다
   * 되고 안 되고가 갈린다. 그래서 "지금 최대화인가"는 OS 가 아니라 이 값이 답한다.
   */
  maximized: boolean;
  /** 최대화 직전의 자리 — 되돌릴 때 **정확히** 여기로 온다(어디로 갈지 OS 에 묻지 않는다). */
  restoreBounds: { x: number; y: number; width: number; height: number } | null;
  /**
   * §17-6 (H-10) — **이미 닫으라고 말한 창인가.** `close()` 와 `closed` 사이에는 틈이 있고,
   * 그동안 `isDestroyed()` 는 아직 거짓이다. 그 틈에 들어온 팝아웃이 이 창을 "이미 있는 창"으로
   * 알고 다시 쓰면, 새 창이 서지 않은 채 이 창이 죽어 화면에서 IDE 가 통째로 사라진다.
   */
  closing: boolean;
  /**
   * §17-6 (H-19) — **이 창이 가져야 할 크기(DIP).** 창에 되묻지 않는다.
   *
   * Windows 의 분수 배율(125%·150%)에서 창은 쓸 때와 읽을 때 따로 반올림한다 — `setPosition()`
   * 은 크기를 창에 되물어 다시 쓰므로 부를 때마다 폭이 1px 자랐고(실측 150%: 40번에 +40px),
   * `getBounds()` 로 읽은 크기를 되돌아오는 길에 되쓰면 왕복마다 2px 자랐다. 이제 크기를
   * 정하는 자리마다 여기에 적고, 창에는 늘 **이 값**을 쓴다(`overlaySize.ts`).
   */
  size: OverlaySize;
  /** (H-19) 우리가 마지막으로 크기를 쓴 시각 — 그 직후의 `resize` 는 OS 의 반올림 메아리다. */
  sizeWrittenAt: number;
  /**
   * §17-6 (H-25) ② — **아직 태어나지 않은 창인가.** 참이면 이 창은 밖으로 나갈 것에 대비해
   * 미리 지어 두고 **부팅만 시키는 중**이고, 사용자에게는 어디에도 보이지 않는다.
   *
   * 목록(`listOverlays`)에서 빠지고, 전역 표시 토글(`applyOverlayVisibility`)이 건드리지 않으며,
   * `ready-to-show` 가 보여주지 않는다. 특히 보여주지 않는 것이 요점이다 — 지금 그 자리에는
   * 윤곽선이 있고, 실물 창이 겹쳐 뜨면 무엇이 진짜인지 알 수 없다((H-6) ③ · (H-12) ①).
   *
   * 손을 떼면 `openOverlay` 의 **재사용 갈래**가 이 비트를 풀고 창을 세운다.
   */
  warming: boolean;
  /**
   * §17-6 (H-25) ④ — **그 창이 자기 IDE 를 다 그렸는가**(`overlay:shell-ready`).
   *
   * (H-7) 은 이 신호를 "선을 걷어도 되는 시점"으로만 썼다. 예열이 생기면서 그 신호가 **뗌보다
   * 먼저 와 있을 수 있게** 되었으므로, 인계와 무관하게 여기 적어 둔다 — 뗌에 선을 곧바로
   * 걷을지(예열이 노린 그 순간) 종전대로 기다릴지를 이 비트가 가른다.
   */
  shellReady: boolean;
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
 * §17-6 (H-10) — 장부에서 **지금** 뗀다(`closed` 를 기다리지 않는다).
 *
 * 기다리면 그 틈에 온 팝아웃이 죽어 가는 창을 다시 쓴다. 뗄 때는 **내가 아직 쥐고 있는 칸만**
 * 뗀다 — 그 사이 같은 `agentId` 로 새 창이 들어섰다면 그 칸은 이미 남의 것이고, 조건 없이
 * 지우면 살아 있는 창이 장부에서 사라져 뗌 신호가 닿지 못한다(= 커서에 달라붙은 창).
 */
function detachOverlaySlot(entry: OverlayEntry): void {
  releaseSlotIfOwner(overlaysByAgentId, entry.agentId, entry);
  releaseSlotIfOwner(overlaysByWindowId, entry.id, entry);
}

/**
 * §17-6 (H-10) — 오버레이 창을 닫는 **한 길**. 자리를 먼저 놓고, 이 창에 걸려 있던 시계와
 * 윤곽선을 걷은 다음 창을 닫는다.
 *
 * 닫는 자리가 여러 곳이라 각자 `win.close()` 만 부르면, 그중 하나만 정리를 빠뜨려도 그 판이
 * 남는다(고아 폴링·고아 윤곽선). 여기 한 곳으로 모은다.
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

// ─── §17-6 (H-19) — 창 크기는 장부가 답한다 ────────────────────────────────
//
// 창에 크기를 **쓰는** 길은 아래 둘뿐이다. 어느 쪽도 창에 크기를 되묻지 않는다 — 되물으면 배율의
// 반올림이 값에 섞여 들어와 쓸 때마다 자란다(`overlaySize.ts` 머리말). 자리는 그 화면의 배율
// 격자에 맞춘다: 격자를 벗어난 좌표는 물리 픽셀 폭을 1px 씩 흔들어 렌더러가 틱마다 창을 다시
// 놓는다(실측 150%: 격자 밖 40번 이동에 `resize` 39회, 격자 위에서는 0회).

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

// ─── §17-6 (H) — 창이 자리를 옮길 때 들고 가는 상자 ────────────────────────
//
// 앱 안 IDE 창을 밖으로 꺼내거나 다시 합칠 때, 종전에는 받는 쪽이 `openIDEOverlay` 로 창을
// **새로** 만들었다. 그 함수는 열어 둔 편집 탭을 비우고 뷰를 첫 화면으로 되돌리므로, 꺼내고
// 나면 보던 파일이 전부 닫힌 채 다른 창이 서 있었다 — 같은 창이 밖으로 나온 것이 아니었다.
//
// 그래서 보내는 쪽이 그 창의 상태를 이 상자에 넣고, 받는 쪽이 꺼내 쓴다. **한 번 꺼내면
// 사라진다**(같은 상자를 두 창이 나눠 쓰면 어느 쪽이 진짜인지 알 수 없다). 내용은 main 이
// 해석하지 않는다 — 렌더러끼리 주고받는 짐이고 여기는 맡아 두는 자리일 뿐이다.
//
// 창 사이를 건너는 동안에만 살아 있으면 되므로 디스크에 쓰지 않는다(영속화 ❌ — 별창 선례).
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
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('vibisual:overlay:list', { overlays: list, userVisible: visible });
  }
}

// 한 오버레이가 지금 보여야 하는지 — 오버레이의 본질은 "어떤 프로그램이 선택(포커스)돼 있든 항상
// 윈도우 위에 떠 있는 것"이므로(사용자 정의), 메인 포커스 여부와 무관하게 전역 토글만 본다.
function overlayShouldShow(): boolean {
  return overlaysUserVisible;
}

/**
 * §17-6 (E) 개정 — **층을 다시 박는다. 어느 층인지는 `expanded` 가 답한다.**
 *
 * (v2.80) Windows 에선 `setResizable`/`setBounds`/`show` 류 창 상태 전이가 층을 조용히
 * 풀어버리는 회귀가 있어, 모든 전이 직후 다시 박는다(멱등이라 비용 없음). 달라진 것은 **박는
 * 값**이다 — 접힌 버블은 상시-위(`screen-saver`), 펼친 IDE 는 보통 층이다. 펼친 IDE 는 화면을
 * 크게 덮는 작업 창이라 그것까지 위에 박히면 그 옆에서 다른 앱을 쓸 수 없다(사용자 지시).
 * 오버레이 버블은 여전히 그 위에 뜬다 — 상시-위 층이 보통 층보다 위라 따로 조율할 것이 없다.
 *
 * 값을 정하는 일은 `overlayTopMostFor` 한 곳이 하고 여기서는 실행만 한다(창을 띄우지 않고
 * 확인할 수 있어야, 전이 하나가 규칙을 빠뜨리는 v2.80 의 회귀가 다시 나지 않는다).
 */
function keepOverlayOnTop(win: BrowserWindow, expanded: boolean): void {
  if (win.isDestroyed()) return;
  const want = overlayTopMostFor(expanded);
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
 * §17-6 (H-16) — **이미 서 있는 창을 앞으로 세운다.** 밟을 순서는 `overlayRaiseSteps` 한 곳이
 * 정하고(세 OS 를 인자로 갈라 단위 테스트할 수 있게), 여기서는 그대로 실행만 한다.
 *
 * 모든 손짓이 멱등이라 여러 번 불러도 안전하다 — 창 상태를 바꾸는 다른 일(펼치기 등) 뒤에
 * 한 번 더 부르는 것이 이 함수의 쓰임새다(그 전이가 층·Z 순서를 흩뜨리기 때문).
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
        case 'reassertTop': keepOverlayOnTop(win, entry.expanded); break;
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
    keepOverlayOnTop(win, entry.expanded);
  } else if (win.isVisible()) {
    win.hide();
  }
}

function applyAllOverlayVisibility(): void {
  for (const e of overlaysByAgentId.values()) applyOverlayVisibility(e, false);
}

/**
 * §17-6 (E-2) — **본체 창을 고르면 밖에 나가 있는 펼친 IDE 가 따라 올라온다.**
 *
 * (E) 개정으로 펼친 IDE 는 보통 층이 되어 다른 앱 뒤에 깔릴 수 있게 됐는데, 이 창은
 * `skipTaskbar:true` 라 **작업표시줄에도 없다** — 깔리면 되돌릴 길이 캔버스로 돌아가 그 버블을
 * 다시 부르는 것뿐이다. 본체 창이 포커스를 받는 순간 그 창들을 같이 맨 위로 올려 그 길을 낸다.
 *
 * **포커스는 옮기지 않는다**(`moveTop` 만) — 사용자가 고른 것은 본체 창이므로 타이핑은 거기로
 * 가야 한다. 누구를 올릴지는 `overlayFollowsMainFocus` 가 답한다(접힌 버블은 이미 위층이라 할
 * 일이 없고, 감춰 둔 창·최소화한 창·닫히는 중인 창·예열 창은 건드리지 않는다).
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

// ─── (판올림 번호 발급 대기) §5.5 #17-6 (H-7) 선 → 창 인계 ────────────────────
//
// (H-6) ⑤ 는 윤곽선을 `ready-to-show` 까지 살려 두면 빈 구간이 없다고 봤다. 그런데 이 창은
// `transparent:true` 라 그 신호가 **투명한 빈 문서의 첫 페인트**에 떨어지고, 끌어내서 만든
// 창은 그 뒤로도 부팅(번들 파싱 → WS 연결 → 스냅샷 → `takeHandoff` → IDE 마운트)을 더 간다.
// 그동안 커서 아래에는 보이지 않는 창만 있다 — 사용자에게는 창이 사라진 것과 같다.
//
// 그래서 인계 시점을 **렌더러가 다 그렸다고 말하는 순간**으로 옮긴다. 대답이 없는 판(렌더러
// 실패·구버전)에서도 선이 얹힌 채 남지 않게 그물을 하나 둔다 — 선 없이 잠깐 비는 편이,
// 클릭통과 선이 창 위에 영영 얹혀 있는 것보다 낫다.

/** 렌더러가 "다 그렸다"를 말하지 못할 때 선을 걷어 주는 상한(ms). */
const GHOST_HANDOFF_FALLBACK_MS = 4_000;

/**
 * (H-15) **들어오는 길의 그물은 훨씬 짧다 — 기다리는 것이 다르기 때문이다.**
 *
 * 위 4초는 **밖으로 나가 새로 태어나는 창**을 기다리는 값이다(번들 파싱 → WS 연결 → 스냅샷 →
 * `takeHandoff` → IDE 마운트 — 실제로 초 단위가 든다). 그런데 되돌아오는 길이 기다리는 것은
 * **이미 떠서 돌고 있는 메인 창이 칸 하나를 그리는 일**이라 한두 프레임이면 끝난다. 같은 값을
 * 쓰면, 렌더러가 말하지 못한 판에서 **클릭통과 선이 4초 동안 커서에 붙어 있다** — 사용자에게는
 * 그것이 곧 고장이다(사용자 보고). 정상 경로(두 프레임)와 넉넉히 벌리면서도 눈에 남지 않는 값.
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

/**
 * 이 창이 다 그릴 때까지 선을 살려 둔다(앞 판이 남아 있으면 그것부터 끝낸다).
 *
 * (H-15) 그물의 길이는 **무엇을 기다리는가**로 정한다 — 새로 태어나는 창과 이미 돌고 있는 창은
 * 걸리는 시간이 자릿수로 다르다. 부르는 쪽이 그 값을 함께 넘긴다(기본은 나가는 길의 4초).
 */
function armGhostHandoff(windowId: number, fallbackMs: number = GHOST_HANDOFF_FALLBACK_MS): void {
  if (ghostHandoff) clearTimeout(ghostHandoff.timer);
  ghostHandoff = {
    windowId,
    timer: setTimeout(() => { ghostHandoff = null; hidePopOutGhost(); }, fallbackMs),
  };
}

/**
 * (H-12) **선을 걷어 달라**는 렌더러의 부탁 — 그물까지 함께 푼다.
 *
 * 들어오는 길에서는 앱 안 창이 그 자리를 이어받아 다 그린 뒤 이것을 부른다(나가는 길의
 * `overlay:shell-ready` 와 같은 뜻·같은 시점). 그물이 남으면 다음 판의 선을 엉뚱한 때에 걷는다.
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
  if (entry) entry.shellReady = true;
  if (!isGhostHandoffTarget(senderWindowId)) return false;
  finishGhostHandoff();
  return true;
}

/**
 * §17-6 (H-25) — 그 에이전트의 오버레이 창이 **이미 장부에 있는가**(밖에 서 있든 예열 중이든).
 *
 * 예열은 이 답이 거짓일 때만 한다 — 있는데 또 부르면 `openOverlay` 의 재사용 갈래가 그 창을
 * 앞으로 세워, 사용자가 놓기도 전에 창이 튀어나온다. 닫히는 중인 창은 없는 것으로 본다((H-10)).
 */
export function hasOverlayForAgent(agentId: string): boolean {
  const entry = overlaysByAgentId.get(agentId);
  if (!entry) return false;
  return isOverlaySlotUsable({ closing: entry.closing, destroyed: entry.window.isDestroyed() });
}

/**
 * §17-6 (H-25) ⑤ — **예열해 둔 창을 거둔다.** 나가지 않기로 끝난 판(앱 안에 놓았다)이 부른다.
 *
 * 안 거두면 쓰지도 않을 창이 목록 밖에 남아, 그 에이전트를 다음에 꺼낼 때 재사용 갈래가 그
 * 빈 창을 집는다. **이미 태어난 창은 건드리지 않는다** — `warming` 이 아닌 창을 여기서 닫으면
 * 사용자가 보고 있던 IDE 가 손짓 한 번에 사라진다.
 */
export function cancelWarmOverlay(agentId: string): boolean {
  const entry = overlaysByAgentId.get(agentId);
  if (!entry || !entry.warming) return false;
  closeOverlayEntry(entry);
  return true;
}

// ─── (판올림 번호 발급 대기) §5.5 #17-6 (H-8) 앱 안 드래그의 **눈** ──────────────
//
// 앱 안 IDE 창을 끄는 일은 렌더러의 `mousemove` 로 한다. 그것이 창 밖에서도 오는 까닭은
// **마우스 캡처** 하나뿐이다 — 그 창에서 `mousedown` 이 일어났기 때문에 OS 가 버튼을 뗄 때까지
// 이벤트를 그 창으로 보내 준다.
//
// 그런데 (H-4) ③ 으로 **밖에서 끌던 드래그를 이어받은 판**에는 그 `mousedown` 이 없다. 손은
// 눌려 있지만 눌린 곳은 이미 닫힌 창이다 — 커서가 앱 밖으로 나가는 순간 렌더러는 눈이 멀고,
// "밖으로 나갔다"가 영영 서지 않는다(사용자 보고 — "한 번 나갔다 되돌린 뒤 다시 밖으로 빼려는데
// 막힌다"). 가장자리 버팀이 받아 주기를 기대할 수도 없다: 손이 빠르면 마지막으로 본 커서가
// 가장자리 띠(3px) 안이 아니라 한참 안쪽이다.
//
// 그래서 그동안 main 이 커서를 대신 본다. 새 물리가 아니라 **이미 세 곳이 쓰는 같은 폴링**이고,
// 판정은 shared 순수 함수(`isCursorOutsideRect`)라 렌더러의 창 안 좌표 판정과 갈라지지 않는다.
// 알리는 것은 **한 번뿐**이다 — 나갔다고 말하는 순간 렌더러가 창을 꺼내고, 그 뒤는 (H-4) 의
// 검증된 매달림·뗌 그물이 받는다.

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
 * 이 창에서 앱 안 IDE 창을 끄는 동안 커서를 지켜본다 — 창 밖으로 나가면 렌더러에 한 번 알린다.
 *
 * 어느 창인지는 **부른 쪽**(`event.sender`)이 정한다 — 메인 창일 수도 별창일 수도 있고, 그
 * 창의 콘텐츠 경계로 재야 "이 앱 밖"이 그 사람이 보는 화면과 맞는다.
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
  /**
   * (판올림 번호 발급 대기) **앱 창 밖으로 끌어내 만든 창** — 버블로 접힌 채가 아니라
   * 처음부터 IDE 크기로 뜬다. 끌어낸 사람은 "이 창이 밖으로 나왔다"를 기대하지,
   * 버블로 접혔다가 다시 더블클릭하기를 기대하지 않는다.
   */
  expanded?: boolean | undefined;
  /** 끌고 있던 창의 크기(px). 그대로 물려받아 **빠져나온 그 창**으로 보이게 한다. */
  size?: { width: number; height: number } | undefined;
  /**
   * §17-6 (H) — 앱 안에서 그 창이 들고 있던 것(열어 둔 편집 탭·보던 뷰·고른 세션·붙어 있던 변).
   * 새로 뜨는 창이 부팅하면서 꺼내 그대로 이어 간다 — 없으면 종전대로 첫 화면에서 시작한다.
   */
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
     * §17-6 (H-17) — **이미 놓인 자리다.** 창은 그 자리에 서기만 하고 커서에 매달리지 않는다.
     *
     * 나가는 판정이 뗌 한 곳으로 모이면서(사용자 지시 — "마우스 놓는 순간 그 자리 그 크기
     * 그대로"), 이 길로 태어나는 창은 손이 이미 떠난 뒤의 창이 됐다. 매달면 놓은 뒤에도
     * 창이 커서를 따라다닌다. 자리를 내는 셈(`커서 - 잡은 지점`)은 그대로 쓴다 — 그래야
     * 방금까지 떠 있던 윤곽선과 한 픽셀도 어긋나지 않는다.
     */
    settled?: boolean | undefined;
  } | undefined;
  /**
   * §17-6 (H-25) — **놓기 전에 미리 짓는 판.** 창을 만들어 부팅만 시키고 **보여주지 않는다**.
   *
   * 손을 뗀 그 프레임에 창 짓기(번들 파싱 → WS 연결 → 스냅샷 → `takeHandoff` → IDE 마운트,
   * 실제로 초 단위)가 통째로 몰려 그 지점만 유독 무거웠다. 나갈 뜻이 분명해지는 순간(선의
   * 무장)에 이 길로 미리 지어 두면, 뗌은 **재사용 갈래**를 타 자리 옮기기와 보여주기만 남는다.
   */
  warm?: boolean | undefined;
}): { windowId: number; reused: boolean } {
  // (판올림 번호 발급 대기) **손으로 끌어낸 창은 반드시 보여야 한다.** 전역 표시(Header 토글)가
  //   꺼진 채로 이 길을 타면 앱 안 창은 닫히는데 밖에도 아무것도 뜨지 않아, 사용자에게는 창이
  //   통째로 사라진 것으로 읽힌다. 숨김 스위치는 하나뿐이므로(그것이 유일 스위치라는 규약, §17-6 (D))
  //   그 스위치를 켜서 화면과 스위치가 어긋나지 않게 한다 — 창만 몰래 보이면 토글은 계속 "숨김"이다.
  // (H-25) ② 예열은 아직 **꺼낸 것이 아니다** — 전역 스위치를 지금 켜면 사용자가 놓기도 전에
  //   다른 오버레이 창들이 한꺼번에 나타난다. 그 켜기는 뗌이 이 길을 다시 탈 때 일어난다.
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
    // §17-6 (H-16) — **밖에 서 있는 그 창을 앞으로.** 밟을 손짓은 `overlayRaiseSteps` 가 정한다
    //   (최소화 복원 · 보이기 · mac 앱 활성화 · 포커스 · 상시-위 재단언 · 같은 층 맨 위로).
    //   `inactive`(§17-6 (H-4) ⑥ 매달린 채 나가는 판)에서는 그 목록이 스스로 활성화를 빼므로
    //   여기서 갈래를 다시 세지 않는다 — 갈림이 두 곳에 있으면 한쪽만 고쳐지는 날이 온다.
    // (H-25) ③ **예열해 둔 창이 여기서 태어난다.** 감춰 두었던 비트를 세우는 손짓보다 **먼저**
    //   푼다 — `raiseOverlayWindow` 아래로 내려가는 길들(`applyOverlayVisibility`)이 이 비트를
    //   보고 창을 도로 감추기 때문이다. 뒤에 오는 판정들이 쓰도록 원래 값을 들고 간다.
    const wasWarming = existing.warming;
    if (wasWarming) {
      existing.warming = false;
      // 예열 동안 미뤄 둔 전역 스위치를 지금 켠다 — 이 길은 "손으로 꺼낸 창"이므로 반드시 보여야
      //   한다((D) 숨김 스위치는 하나뿐이라 창만 몰래 보이면 토글이 계속 "숨김"으로 남는다).
      if (opts.expanded && !overlaysUserVisible) {
        overlaysUserVisible = true;
        applyAllOverlayVisibility();
      }
    }
    const activation = overlayReuseActivation(!!opts.follow, !!opts.follow?.settled);
    raiseOverlayWindow(existing, activation);
    // 이미 버블로 떠 있는 창을 다시 끌어냈다면 그 창을 펼쳐 준다(창 두 개 ❌ — 한 에이전트 한 창).
    if (opts.expanded && !existing.expanded) expandOverlayByWindowId(existing.id);
    // 펼치기는 `setBounds`·`setResizable`·`show` 로 창 상태를 통째로 바꾼다 — Windows 에선 그
    //   전이가 상시-위를 조용히 풀고 Z 순서를 흩뜨리므로(§17-6 (E) v2.80), 끝난 **뒤에** 같은
    //   순서를 한 번 더 밟는다(전부 멱등이라 두 번 밟아도 안전하다).
    raiseOverlayWindow(existing, activation);
    // §17-6 (H-16) — 앞으로 선 것만으로는 **내 더블클릭이 저 창에 닿았다**가 읽히지 않는다.
    //   이미 보이고 있던 창이면 화면이 그대로이기 때문이다. 그래서 그 창이 한 번 대답하게 한다
    //   (렌더러가 짧게 비추는 기척 — main 에는 그림이 없으므로 신호만 보낸다). 구버전 렌더러나
    //   부팅 전이면 아무도 듣지 않고 조용히 지나간다(포커싱 자체는 이미 끝난 뒤다).
    if (overlayAttentionOnReuse(activation) && !existing.window.webContents.isDestroyed()) {
      existing.window.webContents.send('vibisual:overlay:attention', { agentId: opts.agentId });
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
      // (H-6) ⑤ 이 창은 이미 서 있으므로 기다릴 것이 없다 — 윤곽선을 지금 걷는다(선이 창이 됐다).
      // (H-25) ④ **예열 창만 예외다.** 미리 짓긴 했어도 아직 다 안 그렸을 수 있고, 그때 선을
      //   걷으면 그 자리에 투명한 빈 창만 남는다((H-7) 이 새 창 길에서 겪은 그 구간이 예열
      //   길로 옮겨 온 것뿐이다). 다 그린 판은 종전대로 곧바로 걷는다 — 그것이 예열이 노린 순간이다.
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
  // §보안 감사 2026-09-09 — 이 창들에는 항해 가드가 한 곳도 없었다(본체 창에만 있었다).
  hardenWindow(win);
  // §3.7 v2.10 — 창이 돌아오면(show·restore·최대화 전이) 드래그 영역을 다시 신고시킨다.
  //   신고를 한 번 놓치면 타이틀바가 정적이라 다시 신고할 계기가 영영 오지 않는다(dragRegions).
  keepDragRegionsFresh(win);
  // 층은 태어나는 모양이 정한다((E) 개정) — 버블로 태어나면 상시-위, 펼친 IDE 로 태어나면
  //   보통 층이다. 장부(entry)는 아직 없으므로 여기서는 `opts.expanded` 가 그 답을 대신한다.
  keepOverlayOnTop(win, !!opts.expanded);

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
    closing: false,
    // (H-19) 태어난 크기가 장부의 첫 값이다 — 이제부터 창에는 이 값만 쓴다.
    size: { width: winW, height: winH },
    sizeWrittenAt: Date.now(),
    // (H-25) ② 예열로 지은 창은 아직 태어나지 않은 것으로 친다(목록·표시·`ready-to-show` 모두에서).
    warming: !!opts.warm,
    shellReady: false,
  };
  overlaysByAgentId.set(opts.agentId, entry);
  overlaysByWindowId.set(win.id, entry);

  // (H-10) **선을 이어받을 창은 태어나는 이 자리에서 정한다** — 종전에는 `ready-to-show` 에서
  //   정했는데, 빠르게 오가면 그 신호가 오기 **전에** 창이 도로 앱 안으로 합쳐져 닫힌다. 그러면
  //   이 창이 선의 주인이라는 사실을 아무도 몰라 `closed` 가 선을 걷지 못하고, 클릭통과 윤곽선이
  //   수명 상한(20초) 내내 커서를 따라다녔다(사용자 보고 — "빠르게 왔다갔다 하면 마우스에 화면이
  //   달려버린다"). `ready-to-show` 는 그물 시간을 다시 재기만 한다.
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
      // (H-4) ⑥ **활성화하지 않고** 띄운다 — 지금 이 순간 사용자의 손은 아직 눌려 있고, 그
      //   손짓은 메인 창이 잡고 있다. 새 창이 활성화되면 OS 가 그 캡처를 걷어 이동·뗌이
      //   어디에도 도착하지 않는다(창이 영영 커서를 따라다닌다). 손을 뗄 때 앞으로 올린다.
      //
      // (H-17) `settled` 는 그 손이 **이미 떠난** 판이다 — 걷어 갈 캡처가 없으므로 종전
      //   `expanded` 길과 똑같이 앞으로 세운다(방금 놓은 창이 뒤에 뜨면 "놓았는데 안 보인다").
      if (opts.follow.settled) { win.show(); win.focus(); } else win.showInactive();
      // (H-6) ⑤ **선이 창이 되는 지점.** 밖으로 빼는 동안 커서를 따라오던 윤곽선은 여기까지
      //   살아 있다가, 그 자리를 진짜 창이 이어받는 이 순간 꺼진다. 팝아웃 시점에 껐다면
      //   창을 만들고 띄우는 동안 커서 아래에 **아무것도 없는 구간**이 생긴다(= "사라졌다
      //   나타난다"). 둘 다 이 프로세스가 쥐고 있으므로 신호를 주고받을 필요가 없다.
      //
      // (H-7) 다만 **이 순간은 아직 창이 아니다.** `ready-to-show` 는 문서의 첫 페인트라,
      //   `transparent:true` 인 이 창에서는 React 가 마운트되기 전의 **투명한 빈 창**이다.
      //   게다가 끌어내서 만든 창은 WS 스냅샷이 와 자기 버블을 알게 된 뒤에야 IDE 를 연다
      //   (`OverlayShell`) — 여기서 선을 걷으면 그 부팅 내내 커서 아래가 비고, ⑤ 가 없애기로
      //   한 구간이 자리만 옮겨 되살아난다. 선은 **렌더러가 다 그렸다고 알려올 때** 걷는다.
      //
      // (H-10) 주인은 창을 만들 때 이미 정해 두었다 — 여기서는 그물 시간을 **다시 잰다**(창이
      //   뜨기까지 걸린 시간만큼 그물이 이미 흘렀으므로, 렌더러가 그릴 시간을 온전히 준다).
      armGhostHandoff(win.id);
    } else if (opts.expanded) {
      // 방금 손으로 끌어낸 창이라 바로 쓰게 된다 — 뒤에 뜨면 "꺼냈는데 안 보인다"로 읽힌다.
      win.show();
      win.focus();
    } else {
      win.showInactive();
    }
    keepOverlayOnTop(win, entry.expanded);
  });

  // (H-10) **어떤 길로 닫히든** 그 순간 자리를 놓는다 — `closeOverlayEntry` 를 거치지 않는 길
  //   (OS 의 창 닫기 등)도 있고, `closed` 는 늦게 온다. 그 사이에 온 팝아웃이 죽어 가는 이 창을
  //   "이미 있는 창"으로 알고 다시 쓰면 새 창이 서지 않아 IDE 가 어디에도 없다.
  // (H-19) 창이 알려 오는 크기는 **사용자가 창틀을 잡아 늘린 것만** 장부에 받는다. 우리가 방금
  //   쓴 크기의 메아리(배율 반올림)와 끄는 동안의 값은 무시한다 — 받아들이면 그 값을 다시 쓰는
  //   순간 또 자라, 왕복마다 창이 커진다. 가름은 순수 함수(`acceptReportedSize`)가 한다.
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

// §17-6 v2.81 — 버블 드래그 = OS 창 이동. 렌더러의 .bubble-body mousedown 이 drag-start 를
// 보내면, 별창 mini-ghost 드래그(§5.4 #14-1)와 동일하게 메인 프로세스가 커서를 폴링해 창째
// 따라가게 한다(잡은 지점 오프셋 유지). 창이 통째로 움직이므로 버블이 창 경계에서 잘리지
// 않고 모니터·앱 경계 어디든 넘는다. mouseup 시 drag-end 로 해제.
//
// (H-4) 같은 폴링이 **꺼낸 IDE 창**도 끌고 다닌다 — 앱 밖으로 나가는 순간 태어난 창이 그대로
// 커서를 따라오고(`follow`), 그 창의 타이틀바를 끌다 앱 안으로 들어오면 그 자리에서 앱 안
// IDE 로 돌아간다(`redockOnEnter`). 두 방향이 같은 물리를 쓰므로 배울 손버릇이 하나다.

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
  /**
   * 되돌아갈 때 그대로 실어 보낼 짐. **드래그 시작에 한 번** 받는다 — 손이 눌린 동안에는 그
   * 창의 상태가 바뀌지 않으므로 그 값이 곧 마지막 값이고, 되돌리는 순간 렌더러에 물어보면
   * 왕복이 한 번 더 드는 데다 창이 아직 부팅 중이면 대답이 오지 않는다.
   */
  handoff: unknown;
  /**
   * §17-6 (H-12) — **들어와서 가상 창으로 바뀐 채 기다리는 중인가.** 참이면 이 창은 숨겨져
   * 있고 화면에 있는 것은 윤곽선뿐이다(움직이는 것이 하나뿐이라는 (H-6) ③ 규율 그대로).
   */
  dwelling: boolean;
  /** 그 기다림이 시작된 시각(ms) — `dwelling` 이 거짓이면 뜻이 없다. */
  dwellStartedAt: number;
  /**
   * §17-6 (H-17) — 버팀을 다 채워 **선이 밝아졌는가**(이제 손만 떼면 그 자리로 들어간다).
   *
   * 종전에는 버팀이 끝나는 그 틱에 곧바로 합쳤다. 이제 합치는 일은 뗌 한 곳의 몫이라, 그
   * 순간이 하는 일은 이 비트를 세우고 선을 다시 그리는 것뿐이다. 매 틱 다시 그리지 않게
   * 여기 기억해 둔다(같은 그림을 60Hz 로 다시 그리면 선이 깜빡인다).
   */
  dwellArmed: boolean;
  /**
   * §17-6 (H-23) ③ — 숨긴 채 기다린 시간의 **상한 시계**. `dwelling` 동안에만 돈다.
   *
   * 뗌을 끝내 아무도 말하지 못하면 숨은 창이 영영 숨은 채로 남는다 — 이 시계가 그때 창을
   * 도로 세운다. 정상 경로에서는 뗌이 훨씬 먼저 와 멎는다.
   */
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
 * 이 창이 지금 커서에 매달려 있다고 렌더러에 알린다 — 뗌(mouseup)을 그 창도 함께 듣게.
 *
 * §17-6 (H-23) — **메인 창도 함께 듣는다.** (H-12) 로 들어오는 판은 창이 곧 숨는데, 숨는 순간
 * OS 가 그 창의 마우스 캡처를 걷어 **그 렌더러에는 뗌이 영영 닿지 않는다** — 들어오는 판의
 * 리스너는 전부 그 창에 달려 있으므로 아무도 듣지 못하고, 선이 커서에 붙은 채 남는다. (H-4) ⑥ 이
 * 세운 "두 창이 함께 듣는다"를 들어오는 길에도 그대로 적용한다: 누구의 판인지(`agentId`)를 실어
 * 메인 창에도 보내고, 메인 창은 그 판이 도는 동안 같은 그물을 건다.
 *
 * 켜는 신호는 `redockOnEnter` 인 판만 보낸다(버블 드래그는 앱 안으로 들어올 일이 없다).
 * **끄는 신호는 늘 보낸다** — 안 걸린 그물을 푸는 것은 아무 일도 하지 않지만, 걸린 그물을
 * 못 푸는 것은 다음 손짓을 먹는다.
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
 * §17-6 (H-23) ③ — 숨긴 채 기다리는 **상한**(ms). 넘으면 창을 도로 세운다.
 *
 * ①② 로 뗌을 듣는 창이 둘이 됐어도, 둘 다 놓치는 조합이 남으면 그 대가가 너무 크다 —
 * 숨은 창은 클릭통과 선 뒤에 있어 사용자가 만질 수 없고, 선마저 수명(`GHOST_MAX_LIFE_MS`)으로
 * 걷히고 나면 **그 IDE 가 화면 어디에도 없다**. 그래서 선이 죽기 **전에** 창을 되살린다.
 *
 * 합치는 쪽이 아니라 되살리는 쪽으로 푸는 까닭은 (H-12) 의 되살리기와 같다 — 사용자가 부르지
 * 않은 합침은 되돌릴 손잡이가 없지만, 도로 선 창은 다시 끌면 그만이다.
 */
const REDOCK_DWELL_HOLD_MAX_MS = 15_000;

/** 그 상한 시계를 멎는다(여러 번 불려도 안전). */
function clearRedockHold(drag: OverlayFollowDrag): void {
  if (drag.holdTimer === null) return;
  clearTimeout(drag.holdTimer);
  drag.holdTimer = null;
}

/**
 * §17-6 (H-12) — **들어왔다: 창을 선으로 바꾼다.** 아직 합치지 않는다.
 *
 * 나가는 길에는 이미 구간이 있는데(창은 멎고 윤곽선이 커서를 따라간다) 들어오는 길만 절벽이라,
 * 무슨 일이 일어나는지 보기도 전에 합쳐져 있었다. 이제 들어오는 순간에는 **창이 숨고 그 자리를
 * 윤곽선이 이어받을** 뿐이고, 버팀이 끝나야 실제로 앱 안으로 들어간다.
 *
 * 창을 숨기는 까닭은 (H-6) ③ 의 "움직이는 것이 하나뿐이라 두 그림이 어긋날 수 없다" 그대로다 —
 * 실물 창과 선이 같은 자리에 겹쳐 떠 있으면 무엇이 진짜인지 알 수 없다. 숨어 있는 동안에도
 * 폴링은 창 자리를 계속 옮기므로, 되돌릴 때 그냥 다시 보이기만 하면 손 아래 그대로 선다.
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

/**
 * §17-6 (H-17) — **다 버텼다: 선을 밝힌다.** 아직 합치지 않는다.
 *
 * 종전(H-12)에는 이 순간이 곧 합치는 순간이었다 — 손을 놓지도 않았는데 창이 앱 안으로 들어와,
 * 다시 밖으로 빼면 또 나가고, 한 손짓 안에서 창이 몇 번이고 바뀌었다(사용자 지시 — "마우스
 * 놓기 전까지 가상의 창 그대로 유지해"). 이제 여기서는 선의 색만 바꾼다: 밝은 선 = "지금
 * 놓으면 여기". 나가는 길의 무장(`popOutGhostDecision`)과 같은 어법이라 배울 것이 하나다.
 */
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

/**
 * §17-6 (H-12) — **버티다 다시 나갔다: 선을 걷고 창을 돌려놓는다.**
 *
 * (H-3) 의 "가장자리를 떠나면 즉시 풀린다"와 같은 규율이다 — 앱 위를 스쳐 지나간 손이 창을
 * 합쳐 버리면, 창을 앱 반대편으로 옮기는 평범한 손짓이 통째로 막힌다.
 */
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
 * (H-4) 끌던 독립 창이 **앱 안으로 들어왔다** — 그 자리에서 앱 안 IDE 로 되돌린다.
 *
 * `revealOverlayInMain` + `openIde` 를 탄다 — (H-21) 부터 IDE 를 **열린 채** 앱 안으로 돌아오는 길은
 * 이것 하나다(되돌리기 버튼·칩 드래그는 걷었다; 닫기는 IDE 를 열지 않는다). 다른 점은
 * `resumeDrag` 하나 — 손은 아직 눌려 있으므로, 앱 안에 다시 선 창이 **끌던 드래그를 그대로
 * 이어받아야** 한 손짓이 끊기지 않는다(잡은 지점과 창 크기를 그대로 넘긴다).
 */
/**
 * (H-17) 여기까지 왔다는 것은 **손을 뗐다**는 뜻이다 — 이제 선이 창이 된다.
 *
 * 버팀을 다 채운 것만으로는 오지 않는다(그때는 선이 밝아질 뿐이다). 합치는 자리를 하나로
 * 모았으므로, 앱 안에 서는 창은 **끌던 드래그를 이어받지 않는다** — 이어받을 손이 없다.
 */
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
      // (H-19) 앱 안에 설 창의 크기는 **장부** 값 — 방금까지 떠 있던 선과 같은 값이고, 창에
      //   되물은 값(배율 반올림이 섞인다)이 아니다. 종전에는 이 왕복마다 창이 2px 씩 자랐다.
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
  // (H-12) 선은 **여기서 걷지 않는다.** 나가는 길의 (H-6) ⑤("선이 있던 자리에 창이 채워지므로
  //   선이 창이 된다")를 들어오는 길에도 그대로 지킨다 — 앱 안 창이 그 자리를 이어받아 다 그린
  //   뒤에 스스로 걷는다(`overlay:ghost-hide`). 주인을 **메인 창**으로 적어 두므로, 방금 닫는 이
  //   독립 창의 `closed` 는 이 선을 걷지 않는다.
  // (H-10) 그물은 그대로다 — 이어받은 창이 끝내 말하지 못해도 선은 반드시 걷힌다(고아 선 ❌).
  //   (H-15) 다만 **길이는 들어오는 길의 것**을 쓴다: 여기서 기다리는 것은 이미 돌고 있는 메인
  //   창이 칸 하나를 그리는 일이라 한두 프레임이면 끝나는데, 나가는 길의 4초를 그대로 쓰면
  //   말 못 한 판에서 클릭통과 선이 그만큼 커서에 붙어 있다.
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
 * 커서 폴링 시작 — 창을 잡은 지점 그대로 매달고, 필요하면 "앱 안으로 들어왔는가"까지 본다.
 *
 * 첫 `insideApp` 은 **지금 실측**으로 채운다. `false` 로 두면 ⓐ 가장자리 버팀으로 꺼낸 창(커서가
 * 아직 앱 안이다)이 태어나자마자 도로 합쳐지고 ⓑ 앱 위에 겹쳐 둔 창을 잡기만 해도 합쳐진다.
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
  // (H-17) **선이 떠 있는 채로 손을 뗐다 = 여기가 합치는 자리다.** 이제 앱 안으로 들어가는
  //   길은 이 한 곳뿐이다(사용자 지시 — "마우스 놓는 순간 그 자리 그 크기 그대로").
  //   버팀이 아직 안 끝났어도 합친다 — 앱 안 깊숙이 끌어다 놓은 손짓의 뜻은 이미 분명하고,
  //   여기서 되돌리면 (H-4) 전부터 되던 평범한 손짓이 막힌다. 구간은 **보여 주기 위한 것**
  //   이지 관문이 아니다(밝은 선은 "다 버텼다"를 말할 뿐, 놓기를 막지 않는다).
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
  keepOverlayOnTop(entry.window, entry.expanded);
  return true;
}

export function endOverlayDragByWindowId(windowId: number): boolean {
  return finishOverlayFollow(overlaysByWindowId.get(windowId));
}

/**
 * (H-4) **다른 창이** 끝내는 길 — 앱 안에서 끌어내 만든 창은 손이 메인 창에 있다.
 *
 * 뗌 신호를 두 창이 함께 듣는 까닭: 마우스 캡처가 어디에 있는지는 OS 가 정한다(창이 활성화되며
 * 캡처가 옮겨 가는 경우가 있다). 놓쳤을 때의 대가가 "창이 영영 커서를 따라다닌다"라, 한쪽만
 * 듣게 두지 않는다. 두 번 불려도 안전하다(이미 끝난 판은 조용히 지나간다).
 */
export function endOverlayDragByAgentId(agentId: string): boolean {
  return finishOverlayFollow(overlaysByAgentId.get(agentId));
}

// ─── §17-6 (H-5) — 독립 창의 [최대화/복원] ────────────────────────────────
//
// 이 창은 `frame:false + transparent` 라 OS 타이틀바도 시스템 메뉴도 없다(Windows 는 투명 창의
// 시스템 최대화를 아예 막는다). 그래서 최대화를 **우리가 한다**: 그 창이 걸쳐 있는 화면의
// 작업영역으로 bounds 를 옮기고, 직전 자리를 적어 뒀다 그대로 되돌린다.
//
// `win.maximize()`/`isMaximized()` 를 쓰지 않는 까닭은 §5.4 #14-1 에서 이미 데인 자리이기 때문이다 —
// 테두리 없는 창에서 그 값은 `unmaximize()` 뒤에도 참으로 남아, 상태를 물어보는 코드가 영영
// 빠져나오지 못한다. 우리가 옮긴 자리는 우리가 안다.

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
  // setBounds 가 층을 푸는 회귀(§17-6 (E) v2.80) — 자리를 옮길 때마다 그 창의 층을 다시 박는다.
  keepOverlayOnTop(win, entry.expanded);
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
  keepOverlayOnTop(win, entry.expanded);
  sendOverlayMaximizeState(entry);
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
  // §17-6 (G) v2.82 — 펼친 IDE 는 가독성 위해 항상 불투명(접힘 버블의 흐림 설정은 접을 때 복원).
  try { win.setOpacity(1); } catch { /* noop */ }
  win.show();
  win.focus();
  // (E) 개정 — 펼친 IDE 는 **보통 층**이다. 여기가 층이 내려가는 유일한 지점이고, 동시에
  //   `setResizable`/`setBounds`/`show` 가 흩뜨린 층을 그 값으로 다시 박는 자리이기도 하다.
  //   이 뒤로는 이 창 위로 다른 앱이 올라온다(오버레이 버블만은 여전히 그 위 — 층이 다르다).
  keepOverlayOnTop(win, entry.expanded);
  broadcastOverlayList();
  return true;
}

// IDE 닫기(Esc/백드롭/X) → 다시 버블 크기로 축소.
export function collapseOverlayByWindowId(windowId: number): boolean {
  const entry = overlaysByWindowId.get(windowId);
  if (!entry || entry.window.isDestroyed()) return false;
  const win = entry.window;
  entry.expanded = false;
  // (H-5) 버블로 접히는 창이 "최대화 상태"라고 우기면, 복원 버튼이 버블을 엉뚱한 크기로 되돌린다.
  forgetOverlayMaximize(entry);
  const b = entry.collapsedBounds;
  try { win.setMinimumSize(OVERLAY_BUBBLE_W, OVERLAY_BUBBLE_H); } catch { /* noop */ }
  try { win.setResizable(false); } catch { /* noop */ }
  if (b) {
    writeOverlayBounds(entry, { x: b.x, y: b.y, width: OVERLAY_BUBBLE_W, height: OVERLAY_BUBBLE_H });
  } else {
    const cur = win.getBounds();
    writeOverlayBounds(entry, { x: cur.x, y: cur.y, width: OVERLAY_BUBBLE_W, height: OVERLAY_BUBBLE_H });
  }
  // §17-6 (G) v2.82 — 버블로 복귀하면 사용자가 고른 불투명도를 복원.
  try { win.setOpacity(entry.opacity); } catch { /* noop */ }
  // (E) 개정 — 버블로 돌아오면 층도 상시-위로 함께 돌아온다(`setResizable(false)` 가 층을
  //   풀 수 있는 v2.80 의 회귀도 이 한 번으로 같이 덮인다).
  keepOverlayOnTop(win, entry.expanded);
  broadcastOverlayList();
  return true;
}

// Header 전역 토글.
export function setOverlaysVisible(visible: boolean): void {
  overlaysUserVisible = visible;
  applyAllOverlayVisibility();
  broadcastOverlayList();
}

// ─── §17-6 (G) v2.82 — 버블 우클릭 컨텍스트 메뉴 액션 ──────────────────────

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
   * §17-6 (H-9) — **앱 안에 열려 있는 창은 하나도 건드리지 마라**(닫기가 타는 길).
   *
   * 종전의 점프(`openIde` 없음)는 "직전 세션 점프로 열린 IDE 가 캔버스를 가리지 않게" 앞 창을
   * 하나 닫고 갔다. 그 규율은 우클릭 점프의 것이고, **닫기**에는 맞지 않는다 — 밖에 있던 창을
   * 닫았을 뿐인데 앱 안에서 보고 있던 남의 창이 함께 닫힌다.
   */
  keepPanes?: boolean;
  /** §17-6 (H) — 그 창이 들고 오던 것(열어 둔 편집 탭·보던 뷰·붙어 있던 변). 메인 창이 꺼내 쓴다. */
  handoff?: unknown;
  /**
   * §17-6 (H-4) — **끌던 도중에** 돌아온 창(손이 아직 눌려 있다). 앱 안에 다시 선 창이 그
   * 드래그를 그대로 이어받게 잡은 지점·크기를 넘긴다 — 이어받지 않으면 창은 돌아왔는데 손은
   * 눌린 채라, 한 번 놓았다 다시 잡아야 움직인다.
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

// ─── §17-6 (G) v2.87 — 우클릭 메뉴 = 커서 위치의 독립 팝업 창 ──────────────────
// 280×320 버블 창 안에 HTML 로 그리던 메뉴는 ①커서 아래에 못 열리고 ②창보다 큰 메뉴 하단이
// 창 밖으로 밀려 클릭이 안 됐다. 메뉴를 전용 투명 팝업 BrowserWindow 로 분리해 화면 어디든 커서
// 아래에 온전히 띄운다. 메뉴 창은 자기 액션의 **대상(버블) 창**을 모르므로 main 이 targetWindowId 를
// 기억해 라우팅한다(open-ide 만 IDE 렌더가 필요해 버블 렌더러로 push).
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
  // §보안 감사 2026-09-09 — 이 창들에는 항해 가드가 한 곳도 없었다(본체 창에만 있었다).
  hardenWindow(win);
  // §3.7 v2.10 — 창이 돌아오면(show·restore·최대화 전이) 드래그 영역을 다시 신고시킨다.
  //   신고를 한 번 놓치면 타이틀바가 정적이라 다시 신고할 계기가 영영 오지 않는다(dragRegions).
  keepDragRegionsFresh(win);
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

// ─── §5.12 (v4.43, v4.44 개정) Command Center — 지휘통제실 창 ──────────────
//
// 프로젝트 root 버블 더블클릭으로 뜨는 전용 OS 창. **앱 전체에 1창**(v4.44) — 어느 프로젝트의
// root 를 눌러도 같은 창을 focus 하고, 그 창에 "이 프로젝트를 보여라"(`show-project`)를 민다.
// v4.43 의 projectId 1:1 다중 창은 폐기했다: 사용자가 프로젝트를 옮겨 다니면 창만 쌓이고 정작
// 지금 보는 프로젝트의 통제실이 뒤에 묻힌다.
//
// 별창과 달리 redock 이 없다(탭이 아니라 도구 창). 최소화/최대화/닫기는 별창의 기존
// `vibisual:window:*-self` 채널을 그대로 쓰므로, 아래 entry 를 byWindowId 조회에 함께 물린다.

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
    backgroundColor: '#030712',
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
  // §보안 감사 2026-09-09 — 이 창들에는 항해 가드가 한 곳도 없었다(본체 창에만 있었다).
  hardenWindow(win);
  // §3.7 v2.10 — 창이 돌아오면(show·restore·최대화 전이) 드래그 영역을 다시 신고시킨다.
  //   신고를 한 번 놓치면 타이틀바가 정적이라 다시 신고할 계기가 영영 오지 않는다(dragRegions).
  keepDragRegionsFresh(win);

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

// ─── §5.13 (O) v4.48 내부 앱 창 (앱 무관) ───
//
// 앱마다 `openXxxWindow` 를 만들지 않는다. 창 규격은 앱이 선언하고 여기서는 그대로 연다.
// 앱 하나당 **앱 전체에 창 하나**이며, 다시 열면 새 창을 쌓지 않고 그 창에 대상을 밀어 넣는다
// (편집 창은 오래 띄워 두는 것이라 창이 쌓이면 어느 것이 지금 것인지 알 수 없게 된다).

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
}

const appWindows = new Map<string, AppWindowEntry>();

export function openAppWindow(appId: string, spec: AppWindowSpec): { windowId: number; reused: boolean } {
  const existing = appWindows.get(appId);
  if (existing && !existing.window.isDestroyed()) {
    const win = existing.window;
    if (win.isMinimized()) win.restore();
    win.focus();
    if (!win.webContents.isDestroyed()) {
      win.webContents.send('vibisual:app:show-target', { appId, hash: spec.hash });
    }
    return { windowId: existing.id, reused: true };
  }

  const win = new BrowserWindow({
    width: spec.width,
    height: spec.height,
    minWidth: spec.minWidth,
    minHeight: spec.minHeight,
    show: false,
    backgroundColor: '#030712',
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
  // §보안 감사 2026-09-09 — 이 창들에는 항해 가드가 한 곳도 없었다(본체 창에만 있었다).
  hardenWindow(win);
  // §3.7 v2.10 — 창이 돌아오면(show·restore·최대화 전이) 드래그 영역을 다시 신고시킨다.
  //   신고를 한 번 놓치면 타이틀바가 정적이라 다시 신고할 계기가 영영 오지 않는다(dragRegions).
  keepDragRegionsFresh(win);

  win.on('ready-to-show', () => {
    if (!win.isDestroyed()) win.show();
  });

  appWindows.set(appId, { id: win.id, window: win });

  const pushMaximizeState = (): void => {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send('vibisual:window:maximize-state', { maximized: win.isMaximized() });
    }
  };
  win.on('maximize', pushMaximizeState);
  win.on('unmaximize', pushMaximizeState);
  win.on('closed', () => {
    if (appWindows.get(appId)?.id === win.id) appWindows.delete(appId);
  });

  void win.loadFile(join(__dirname, '../renderer/index.html'), { hash: spec.hash });
  return { windowId: win.id, reused: false };
}

export function closeAppWindow(appId: string): boolean {
  const entry = appWindows.get(appId);
  if (!entry) return false;
  if (!entry.window.isDestroyed()) entry.window.close();
  return true;
}
