import { screen, desktopCapturer } from 'electron';
import { recordDiagnostic } from '@vibisual/server';
import { tryBackgroundClick } from './backgroundClick';
import type { CaptureInputEvent, CaptureMouseInput, CaptureKeyInput, CaptureTargetRect, CaptureInjectResult } from '@vibisual/shared';

// §5.9 Phase B — 캡처 버블 원격 조작(입력 주입, main 전용).
//
// 렌더러가 캡처 본체 위 제스처를 정규화 좌표(u,v)로 보내면, 여기서 소스(화면/창)의 실제 화면
// 좌표로 매핑해 nut.js 로 OS 레벨 마우스/키보드를 주입한다. nut.js(@nut-tree-fork)는 N-API
// 프리빌드라 electron-rebuild 없이 로드된다(node-pty 선례). 로드 실패 시 조용히 무시(진단 로그).
//
// v3.58 — 주입은 **사용자가 물리 버튼을 뗀 뒤 원자적으로 한 번**만 일어난다(click/dblclick/drag/wheel).
// Windows 는 사용자가 우리 창에서 버튼을 누르는 순간 그 창으로 마우스 캡처를 걸어, 버튼이 눌려 있는
// 동안엔 SendInput 주입까지 전부 우리 창으로 되돌아온다 — 그래서 v3.57 의 down→(손이 끔)→up 사슬은
// 대상에 아무것도 닿지 않았다. 이제 렌더러가 제스처를 끝까지 지켜본 뒤 여기서 재생한다.
//
// 좌표계 주의:
//  - screen 소스: Electron display.bounds(DIP) × scaleFactor 로 물리 픽셀 근사. 배율 1 인 기본
//    데스크톱·주 모니터에서 정확. 멀티 DPI 멀티모니터는 근사(추후 보정 여지).
//  - window 소스: nut.js Window.getRegion()이 물리 픽셀을 직접 주므로 그대로 사용 + 창 포커스.

type NutModule = typeof import('@nut-tree-fork/nut-js');

let nutPromise: Promise<NutModule | null> | null = null;

/** nut.js 지연 로드(1회) — 실패 시 null 캐시(이후 조용히 no-op). */
async function loadNut(): Promise<NutModule | null> {
  if (!nutPromise) {
    nutPromise = import('@nut-tree-fork/nut-js')
      .then((mod) => {
        // 반응성 우선 — 자동 지연 제거.
        mod.mouse.config.autoDelayMs = 0;
        mod.keyboard.config.autoDelayMs = 0;
        return mod;
      })
      .catch((err: unknown) => {
        recordDiagnostic('main', 'error', `capture input: nut.js load failed — ${err instanceof Error ? err.message : String(err)}`);
        return null;
      });
  }
  return nutPromise;
}

interface ScreenRect { x: number; y: number; width: number; height: number }

/** 물리 픽셀 사각형 + 같은 영역의 DIP 사각형(렌더러 드래그 계산용). */
interface ResolvedRect { physical: ScreenRect; dip: ScreenRect }

/**
 * screen 소스 → 화면 사각형(desktopCapturer display_id ↔ Electron display 매칭).
 *
 * v3.57 좌표 정정 — 종전엔 `bounds × scaleFactor` 로 물리 픽셀을 **직접 계산**했는데, 이는 모든
 * 모니터의 배율이 같을 때만 맞는다. 실제 측정(3모니터, 150%/150%/175%): 세 번째 모니터의 DIP 원점
 * x=3415 × 1.75 = 5976 이지만 진짜 물리 원점은 5120 — **856px 어긋나** 클릭이 엉뚱한 곳(대개 화면
 * 밖)으로 갔다. 물리 원점은 그 디스플레이의 배율이 아니라 **왼쪽 모니터들의 물리 폭 합**으로 정해지기
 * 때문이다. 이제 Electron 이 그 변환을 정확히 아는 `screen.dipToScreenPoint()` 로 양 끝점을 바꿔 만든다.
 */
async function resolveScreenRect(sourceId: string): Promise<ResolvedRect> {
  let displayId: string | undefined;
  try {
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } });
    displayId = sources.find((s) => s.id === sourceId)?.display_id;
  } catch { /* 폴백: 주 디스플레이 */ }
  const display =
    (displayId ? screen.getAllDisplays().find((d) => String(d.id) === displayId) : undefined) ??
    screen.getPrimaryDisplay();
  const b = display.bounds;
  const topLeft = screen.dipToScreenPoint({ x: b.x, y: b.y });
  const bottomRight = screen.dipToScreenPoint({ x: b.x + b.width, y: b.y + b.height });
  return {
    physical: { x: topLeft.x, y: topLeft.y, width: bottomRight.x - topLeft.x, height: bottomRight.y - topLeft.y },
    dip: { x: b.x, y: b.y, width: b.width, height: b.height },
  };
}

/** window 소스 → 물리 픽셀 창 사각형(제목 매칭) + 포커스. 못 찾으면 null. */
async function resolveWindowRect(nut: NutModule, sourceName: string): Promise<ResolvedRect | null> {
  try {
    const windows = await nut.getWindows();
    for (const win of windows) {
      const title = await win.getTitle();
      if (title !== sourceName) continue;
      try { await win.focus(); } catch { /* 포커스 실패해도 좌표 매핑은 진행 */ }
      const region = await win.getRegion();
      const physical = { x: region.left, y: region.top, width: region.width, height: region.height };
      // 창 사각형은 물리 픽셀이라 렌더러용 DIP 는 역변환해서 함께 준다.
      const tl = screen.screenToDipPoint({ x: physical.x, y: physical.y });
      const br = screen.screenToDipPoint({ x: physical.x + physical.width, y: physical.y + physical.height });
      return { physical, dip: { x: tl.x, y: tl.y, width: br.x - tl.x, height: br.y - tl.y } };
    }
  } catch (err) {
    recordDiagnostic('main', 'warn', `capture input: window resolve failed — ${err instanceof Error ? err.message : String(err)}`);
  }
  return null;
}

async function rectFor(nut: NutModule, ev: CaptureInputEvent): Promise<ResolvedRect | null> {
  return ev.sourceKind === 'screen'
    ? resolveScreenRect(ev.sourceId)
    : resolveWindowRect(nut, ev.sourceName);
}

/**
 * 렌더러가 드래그 좌표를 닫힌 루프로 계산할 수 있게 대상 사각형(DIP+물리)을 알려준다(v3.57).
 * 대상을 못 찾으면 `ok:false` — 렌더러가 "조작 대상 없음"으로 처리한다.
 */
export async function resolveCaptureTargetRect(
  spec: { sourceId: string; sourceKind: CaptureInputEvent['sourceKind']; sourceName: string },
): Promise<CaptureTargetRect> {
  const empty = { x: 0, y: 0, width: 0, height: 0 };
  const nut = await loadNut();
  if (!nut) return { ok: false, dip: empty, physical: empty };
  const rect = await rectFor(nut, { type: 'mouse', action: 'move', u: 0, v: 0, ...spec } as CaptureInputEvent);
  if (!rect) return { ok: false, dip: empty, physical: empty };
  return { ok: true, dip: rect.dip, physical: rect.physical };
}

function buttonOf(nut: NutModule, b: CaptureMouseInput['button']): number {
  if (b === 'right') return nut.Button.RIGHT;
  if (b === 'middle') return nut.Button.MIDDLE;
  return nut.Button.LEFT;
}

/**
 * 주입 뒤 사용자의 실제 커서를 제자리에 돌려놓는 기본 동작들("빌려 쓰고 제자리 반납" 패턴).
 * 이 PC 의 OS 커서는 하나뿐이라 주입 지점에 그냥 두면 **사용자의 마우스가 캡처 대상 화면으로 끌려가
 * 거기 갇힌다**(다른 모니터를 캡처하면 커서가 그 모니터로 넘어가 버리고, 자기 화면을 캡처하면 버블 안을
 * 튕겨 다닌다). v3.58 부터 렌더러가 보내는 것은 전부 **원자적 동작**이라 여기 다 들어 있다 — 사용자의
 * 커서는 잠깐 빌려 쓰이고 언제나 원래 자리로 돌아온다.
 */
const RESTORE_CURSOR_ACTIONS: ReadonlySet<CaptureMouseInput['action']> = new Set(['click', 'dblclick', 'drag', 'wheel', 'up']);

/** "커서 안 움직이기"로 대신 처리해 볼 수 있는 원자적 동작들(v3.62). */
const BACKGROUND_CLICK_ACTIONS: ReadonlySet<CaptureMouseInput['action']> = new Set(['click', 'dblclick', 'drag', 'wheel']);

/** 클릭 순간 좌표를 `GetCursorPos` 로 다시 읽는 대상 앱을 위한 최소 유예(ms) — 이 뒤에 커서를 되돌린다. */
const CURSOR_RESTORE_DELAY_MS = 24;

/**
 * 드래그 직후의 반납은 더 늦춘다 — 놓는 순간 대상 앱이 자체 드래그/드롭 루프(DoDragDrop 등)에 들어가
 * **커서를 자기가 다시 옮기는** 경우가 있어, 곧바로 되돌리면 그 루프에 덮여 반납이 무효가 된다.
 */
const DRAG_RESTORE_DELAY_MS = 70;
/** 반납이 정말 먹었는지 확인하기까지의 간격(ms) — 이 뒤에 한 번만 다시 시도한다. */
const RESTORE_VERIFY_DELAY_MS = 140;
/** 반납 성공으로 볼 허용 오차(px). */
const RESTORE_TOLERANCE_PX = 3;
/** 커서가 아직 드롭 지점에 붙어 있다고 볼 거리(px) — 이보다 멀면 사용자가 이미 마우스를 잡은 것이다. */
const DROP_STUCK_TOLERANCE_PX = 8;

/** 커서를 옮긴 직후 버튼을 누르기까지의 유예(ms) — 대상 앱이 hover 상태를 갱신할 시간. */
const PRESS_SETTLE_MS = 16;
/** 드래그 재생의 중간 지점 수 — 많을수록 부드럽지만 느리다. */
const DRAG_STEPS = 14;
/** 드래그 재생 중 각 중간 지점 사이의 간격(ms). */
const DRAG_STEP_MS = 10;

/** 드래그 사슬이 up 없이 끊겼을 때(렌더러 크래시 등) 묵은 원점을 버리는 시간(ms). */
const CHAIN_ORIGIN_TTL_MS = 30_000;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 드래그 사슬(down→move…→up)의 **시작 시점** 사용자 커서 위치. 사슬 중간엔 커서가 이미 대상에 가 있어
 * 그때 읽으면 대상 좌표가 나오므로, 반납할 원점은 반드시 사슬이 시작되기 전 값이어야 한다.
 */
let chainOrigin: { point: { x: number; y: number }; at: number } | null = null;

/** down 뒤 up 이 끝내 안 오면(창 포커스 이탈·렌더러 사고) 버튼이 눌린 채 남는다 — 이 시간 뒤 강제 해제. */
const STUCK_BUTTON_RELEASE_MS = 8_000;
let stuckGuard: { timer: NodeJS.Timeout; button: number } | null = null;

function clearStuckButtonGuard(): void {
  if (!stuckGuard) return;
  clearTimeout(stuckGuard.timer);
  stuckGuard = null;
}

/** 눌린 버튼이 방치되지 않게 하는 안전장치 — OS 마우스가 눌린 채 굳는 사고를 막는다. */
function armStuckButtonGuard(nut: NutModule, button: number): void {
  clearStuckButtonGuard();
  const timer = setTimeout(() => {
    stuckGuard = null;
    void (async () => {
      try {
        await nut.mouse.releaseButton(button);
        const origin = chainOrigin?.point;
        chainOrigin = null;
        if (origin) await nut.mouse.setPosition(new nut.Point(origin.x, origin.y));
        recordDiagnostic('main', 'warn', 'capture input: stuck mouse button auto-released (no up within 8s)');
      } catch { /* 해제 실패는 무시 */ }
    })();
  }, STUCK_BUTTON_RELEASE_MS);
  stuckGuard = { timer, button };
}

async function injectMouse(nut: NutModule, ev: CaptureMouseInput): Promise<CaptureInjectResult> {
  const resolved = await rectFor(nut, ev);
  // 대상을 못 찾으면 조용히 사라지지 않고 이유를 돌려준다(렌더러가 칩으로 알린다).
  if (!resolved) return { ok: false, reason: 'target-not-found' };
  const rect = resolved.physical;
  const toPhysical = (u: number, v: number): { x: number; y: number } => ({
    x: Math.round(rect.x + Math.min(Math.max(u, 0), 1) * rect.width),
    y: Math.round(rect.y + Math.min(Math.max(v, 0), 1) * rect.height),
  });
  const { x, y } = toPhysical(ev.u, ev.v);

  // ── "커서 안 움직이기"(v3.62) — 켜져 있으면 먼저 대상 창에 메시지를 직접 넣어 본다.
  // 되면 사용자의 커서는 **1px 도 움직이지 않는다**. 게임/보호된 창처럼 무시가 확실한 앱이면
  // 이유를 달고 아래 기본 경로(커서를 잠깐 빌림)로 내려간다.
  let fallback: CaptureInjectResult['fallback'];
  if (ev.preferBackgroundClick && BACKGROUND_CLICK_ACTIONS.has(ev.action)) {
    const end = ev.action === 'drag' ? toPhysical(ev.u2 ?? ev.u, ev.v2 ?? ev.v) : null;
    const outcome = tryBackgroundClick({
      x, y,
      button: ev.button ?? 'left',
      action: ev.action as 'click' | 'dblclick' | 'drag' | 'wheel',
      ...(end ? { x2: end.x, y2: end.y } : {}),
      ...(ev.deltaY !== undefined ? { deltaY: ev.deltaY } : {}),
    });
    if (outcome.ok) return { ok: true, method: 'background' };
    fallback = outcome.reason;
  }
  // "빌려 쓰고 제자리 반납" — 렌더러가 restoreCursor 로 사슬의 끝을 알려준다(중간 false, 마지막 true).
  const restore = ev.restoreCursor ?? RESTORE_CURSOR_ACTIONS.has(ev.action);
  const now = Date.now();
  if (chainOrigin && now - chainOrigin.at > CHAIN_ORIGIN_TTL_MS) chainOrigin = null;
  const current = await nut.mouse.getPosition().catch(() => null);
  if (!restore) {
    // 사슬 시작(첫 down/move) — 이때의 커서가 사용자의 진짜 손 위치다.
    if (!chainOrigin && current) chainOrigin = { point: { x: current.x, y: current.y }, at: now };
  }
  const origin = restore ? (chainOrigin?.point ?? current) : null;
  if (restore) chainOrigin = null;
  // inPlace 면 커서를 옮기지 않는다 — 드래그를 끝내는 up 은 손이 끌고 간 그 자리에서 떼야 한다.
  if (!ev.inPlace) await nut.mouse.setPosition(new nut.Point(x, y));
  const btn = buttonOf(nut, ev.button);
  // 커서 경로로 끝난 경우의 결과 — "커서 안 움직이기"를 켰는데 되돌아온 것이면 그 사유를 함께 알린다.
  const viaCursor = (): CaptureInjectResult => (fallback ? { ok: true, method: 'cursor', fallback } : { ok: true, method: 'cursor' });
  try {
    switch (ev.action) {
      case 'move':
        return viaCursor();
      case 'down':
        await nut.mouse.pressButton(btn);
        armStuckButtonGuard(nut, btn);
        return viaCursor();
      case 'up':
        clearStuckButtonGuard();
        await nut.mouse.releaseButton(btn);
        return viaCursor();
      case 'click':
        await delay(PRESS_SETTLE_MS);
        await nut.mouse.click(btn);
        return viaCursor();
      case 'dblclick':
        await delay(PRESS_SETTLE_MS);
        await nut.mouse.doubleClick(btn);
        return viaCursor();
      case 'drag': {
        // v3.58 — 사용자가 버튼을 뗀 **뒤에** 제스처 전체를 재생한다. 누르고 있는 동안엔 Windows 마우스
        // 캡처가 우리 창을 물고 있어 주입이 대상에 닿지 않기 때문(주입이 통째로 우리 창으로 되돌아온다).
        // 시작점으로 옮겨 누르고 → 중간 지점을 밟아 가며 이동 → 도착점에서 뗀다. 대상 앱 입장에선
        // 사람이 끈 것과 구별되지 않는 평범한 드래그다. 커서는 finally 에서 사용자 자리로 반납된다.
        const end = toPhysical(ev.u2 ?? ev.u, ev.v2 ?? ev.v);
        await delay(PRESS_SETTLE_MS);
        await nut.mouse.pressButton(btn);
        armStuckButtonGuard(nut, btn);
        try {
          for (let i = 1; i <= DRAG_STEPS; i++) {
            const t = i / DRAG_STEPS;
            await nut.mouse.setPosition(new nut.Point(
              Math.round(x + (end.x - x) * t),
              Math.round(y + (end.y - y) * t),
            ));
            await delay(DRAG_STEP_MS);
          }
        } finally {
          clearStuckButtonGuard();
          await nut.mouse.releaseButton(btn).catch(() => { /* 이미 떨어졌으면 무시 */ });
        }
        return viaCursor();
      }
      case 'wheel':
        if ((ev.deltaY ?? 0) >= 0) await nut.mouse.scrollDown(Math.abs(ev.deltaY ?? 0));
        else await nut.mouse.scrollUp(Math.abs(ev.deltaY ?? 0));
        return viaCursor();
    }
    return viaCursor();
  } finally {
    if (origin) await restoreUserCursor(nut, origin, ev.action === 'drag' ? toPhysical(ev.u2 ?? ev.u, ev.v2 ?? ev.v) : null);
  }
}

/**
 * 사용자의 커서를 원래 자리로 반납한다("빌려 쓰고 제자리 반납"의 반납 쪽).
 *
 * 드래그는 한 번으로 안 끝날 수 있다 — 놓는 순간 대상 앱이 자체 드래그 루프에서 커서를 다시 가져가
 * 우리 반납이 덮이는 일이 있다. 그래서 드래그일 때만 **정말 돌아갔는지 확인하고 한 번 더** 시도한다.
 * 단, 그 사이 커서가 드롭 지점을 떠나 있으면 **사용자가 이미 마우스를 움직인 것**이므로 손대지 않는다
 * (안 그러면 사용자의 손을 거슬러 커서를 도로 낚아채게 된다).
 */
async function restoreUserCursor(
  nut: NutModule,
  origin: { x: number; y: number },
  dropPoint: { x: number; y: number } | null,
): Promise<void> {
  const put = async (): Promise<void> => {
    await nut.mouse
      .setPosition(new nut.Point(origin.x, origin.y))
      .catch(() => { /* 복원 실패는 무시 — 조작 자체는 이미 끝났다 */ });
  };
  await delay(dropPoint ? DRAG_RESTORE_DELAY_MS : CURSOR_RESTORE_DELAY_MS);
  await put();
  if (!dropPoint) return;

  await delay(RESTORE_VERIFY_DELAY_MS);
  const now = await nut.mouse.getPosition().catch(() => null);
  if (!now) return;
  const backHome =
    Math.abs(now.x - origin.x) <= RESTORE_TOLERANCE_PX && Math.abs(now.y - origin.y) <= RESTORE_TOLERANCE_PX;
  if (backHome) return;
  // 아직 드롭 지점에 붙어 있으면 대상 앱이 되채간 것 — 한 번 더 반납한다.
  const stuckAtDrop =
    Math.abs(now.x - dropPoint.x) <= DROP_STUCK_TOLERANCE_PX && Math.abs(now.y - dropPoint.y) <= DROP_STUCK_TOLERANCE_PX;
  if (stuckAtDrop) await put();
}

/** 정규화 키 이름 → nut.js Key. 미매핑이면 null(무시). */
function specialKey(nut: NutModule, name: string): number | null {
  const K = nut.Key;
  const map: Record<string, number> = {
    Enter: K.Enter, Return: K.Enter, Backspace: K.Backspace, Tab: K.Tab, Escape: K.Escape,
    Delete: K.Delete, Space: K.Space,
    ArrowUp: K.Up, ArrowDown: K.Down, ArrowLeft: K.Left, ArrowRight: K.Right,
    Home: K.Home, End: K.End, PageUp: K.PageUp, PageDown: K.PageDown,
  };
  if (name in map) return map[name]!;
  // 단일 문자 키(Ctrl+A 등 콤보용) — a-z, 0-9.
  if (/^[a-z]$/i.test(name)) {
    const idx = name.toUpperCase().charCodeAt(0) - 65; // A=0
    return (K as unknown as Record<string, number>)[String.fromCharCode(65 + idx)]!;
  }
  if (/^[0-9]$/.test(name)) {
    return (K as unknown as Record<string, number>)[`Num${name}`]!;
  }
  return null;
}

async function injectKey(nut: NutModule, ev: CaptureKeyInput): Promise<void> {
  // window 소스면 대상 창을 먼저 포커스(키가 그 창으로 가도록). screen 은 현재 포커스 창으로.
  if (ev.sourceKind === 'window') await resolveWindowRect(nut, ev.sourceName);

  const mods: number[] = [];
  if (ev.ctrl) mods.push(nut.Key.LeftControl);
  if (ev.shift) mods.push(nut.Key.LeftShift);
  if (ev.alt) mods.push(nut.Key.LeftAlt);
  if (ev.meta) mods.push(nut.Key.LeftSuper);

  if (ev.action === 'type' && ev.text && mods.length === 0) {
    await nut.keyboard.type(ev.text);
    return;
  }
  // press(특수키) 또는 모디파이어 콤보.
  const keyName = ev.action === 'press' ? ev.key : ev.text;
  if (!keyName) return;
  const k = specialKey(nut, keyName);
  if (k == null) {
    // 매핑 없는 문자 + 모디파이어 없음이면 그냥 타이핑.
    if (mods.length === 0 && ev.text) await nut.keyboard.type(ev.text);
    return;
  }
  await nut.keyboard.type(...(mods as number[]), k);
}

/**
 * 렌더러에서 온 캡처 입력 이벤트를 OS 로 주입하고 **성패를 돌려준다**(v3.61).
 * 종전엔 실패를 통째로 삼켜서, 사용자에겐 "클릭이 안 먹는다"로만 보였다.
 */
export async function injectCaptureInput(ev: CaptureInputEvent): Promise<CaptureInjectResult> {
  const nut = await loadNut();
  if (!nut) return { ok: false, reason: 'nut-unavailable' };
  try {
    if (ev.type === 'mouse') return await injectMouse(nut, ev);
    await injectKey(nut, ev);
    return { ok: true };
  } catch (err) {
    recordDiagnostic('main', 'warn', `capture input inject failed — ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, reason: 'error' };
  }
}
