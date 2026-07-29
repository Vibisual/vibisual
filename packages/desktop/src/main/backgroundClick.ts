import koffi from 'koffi';
import { recordDiagnostic } from '@vibisual/server';

// §5.9 v3.62 — "커서 안 움직이기"(배경 클릭, main 전용).
//
// 기본 주입 경로(nut.js SendInput)는 OS 커서를 목표 지점으로 **옮겨야** 클릭이 그리로 간다. Windows 는
// 시스템 포인터가 하나뿐이라 이건 회피가 안 되고, 그래서 지금까지는 "빌려 쓰고 제자리 반납"으로 달래 왔다.
// 여기 있는 경로는 그 대안이다 — 커서를 건드리지 않고 **대상 창에 마우스 메시지를 직접 넣는다**
// (`WindowFromPoint` → 클라이언트 좌표 변환 → `PostMessage(WM_*BUTTON*)`).
//
// 한계가 분명해 **기본값이 아니라 사용자가 켜는 옵션**이다:
//   · 일반 Win32 앱(탐색기·메모장·대부분의 데스크톱 앱)에는 잘 먹는다.
//   · 게임·안티치트 보호 창은 합성 메시지를 무시한다 — 알려진 클래스는 아예 시도하지 않고 되돌린다.
//   · 그 외 앱도 무시할 수 있는데 **성공했는지 확인할 방법이 없다**(메시지는 큐에 들어갔을 뿐).
//     그래서 호출부는 "안 되면 옵션을 끄라"는 안내를 함께 띄운다.

/** koffi + user32 바인딩(지연 로드, 1회). 실패하면 null 로 캐시하고 조용히 폴백. */
interface User32 {
  WindowFromPoint: (pt: { x: number; y: number }) => unknown;
  ScreenToClient: (hwnd: unknown, pt: { x: number; y: number }) => boolean;
  PostMessageW: (hwnd: unknown, msg: number, wParam: number, lParam: number) => boolean;
  GetClassNameW: (hwnd: unknown, buf: Buffer, max: number) => number;
  GetWindowDpiAwarenessContext?: (hwnd: unknown) => unknown;
  SetThreadDpiAwarenessContext?: (ctx: unknown) => unknown;
}

let user32: User32 | null | undefined;

function loadUser32(): User32 | null {
  if (user32 !== undefined) return user32;
  try {
    const lib = koffi.load('user32.dll');
    koffi.struct('POINT', { x: 'long', y: 'long' });
    const api: User32 = {
      WindowFromPoint: lib.func('void* __stdcall WindowFromPoint(POINT Point)') as User32['WindowFromPoint'],
      ScreenToClient: lib.func('bool __stdcall ScreenToClient(void *hWnd, _Inout_ POINT *lpPoint)') as User32['ScreenToClient'],
      PostMessageW: lib.func('bool __stdcall PostMessageW(void *hWnd, unsigned int Msg, uintptr_t wParam, intptr_t lParam)') as User32['PostMessageW'],
      GetClassNameW: lib.func('int __stdcall GetClassNameW(void *hWnd, _Out_ char16_t *lpClassName, int nMaxCount)') as User32['GetClassNameW'],
    };
    // DPI 보정용(Win10 1607+) — 없으면 그냥 건너뛴다.
    try {
      api.GetWindowDpiAwarenessContext = lib.func('void* __stdcall GetWindowDpiAwarenessContext(void *hwnd)') as User32['GetWindowDpiAwarenessContext'];
      api.SetThreadDpiAwarenessContext = lib.func('void* __stdcall SetThreadDpiAwarenessContext(void *dpiContext)') as User32['SetThreadDpiAwarenessContext'];
    } catch { /* 구버전 Windows — DPI 보정 없이 진행 */ }
    user32 = api;
  } catch (err) {
    recordDiagnostic('main', 'warn', `background click: user32 bind failed — ${err instanceof Error ? err.message : String(err)}`);
    user32 = null;
  }
  return user32;
}

// 마우스 메시지 상수.
const WM_MOUSEMOVE = 0x0200;
const WM_MOUSEWHEEL = 0x020a;
const BUTTON_MSG = {
  left: { down: 0x0201, up: 0x0202, dbl: 0x0203, mk: 0x0001 },
  right: { down: 0x0204, up: 0x0205, dbl: 0x0206, mk: 0x0002 },
  middle: { down: 0x0207, up: 0x0208, dbl: 0x0209, mk: 0x0010 },
} as const;

/**
 * 합성 마우스 메시지를 **믿을 수 없는** 창 클래스 — 시도해 봐야 조용히 아무 일도 안 일어나므로
 * 처음부터 커서 방식으로 되돌리고 그 이유를 사용자에게 알린다("안 먹는 것"보다 "왜 커서가 움직였는지"가 낫다).
 *
 * ① 게임 엔진·안티치트 보호 창 — 합성 입력을 아예 차단한다.
 * ② **크로미움 계열**(`Chrome_WidgetWin_*`) — 크롬·엣지·VS Code·디스코드·슬랙, 그리고 Vibisual 자신까지
 *    전부 이 클래스다. 버전·경로에 따라 먹기도 하고 안 먹기도 해(내부적으로 커서 위치를 다시 확인하는
 *    경로가 있다) 결과가 복불복이다. 개발자 화면에서 가장 흔한 창인 만큼, 복불복으로 두는 것보다
 *    확실한 커서 경로로 되돌리는 편이 낫다. (확실히 하려면 DevTools 프로토콜 경로가 따로 필요하다.)
 */
const MESSAGE_DEAF_CLASSES: readonly string[] = [
  'RiotWindowClass',   // Riot(Vanguard 보호)
  'UnityWndClass',
  'UnrealWindow',
  'SDL_app',
  'GLFW30',
  'CryENGINE',
  'Valve001',
  'Chrome_WidgetWin_', // 크로미움/일렉트론 전반(뒤에 0/1 이 붙는다)
];

/** MAKELPARAM — 16비트 부호 있는 좌표 두 개를 하나로 묶는다. */
function makeLParam(x: number, y: number): number {
  return ((y & 0xffff) << 16) | (x & 0xffff);
}

function classNameOf(api: User32, hwnd: unknown): string {
  const buf = Buffer.alloc(512);
  const n = api.GetClassNameW(hwnd, buf, 256);
  if (n <= 0) return '';
  return buf.toString('utf16le').replace(/\0.*$/, '');
}

/** 대상 창의 DPI 문맥에서 화면 좌표 → 클라이언트 좌표(멀티 DPI 정확도). */
function toClientPoint(api: User32, hwnd: unknown, x: number, y: number): { x: number; y: number } {
  const pt = { x, y };
  let prevCtx: unknown;
  try {
    if (api.GetWindowDpiAwarenessContext && api.SetThreadDpiAwarenessContext) {
      prevCtx = api.SetThreadDpiAwarenessContext(api.GetWindowDpiAwarenessContext(hwnd));
    }
    api.ScreenToClient(hwnd, pt);
  } finally {
    if (prevCtx !== undefined && api.SetThreadDpiAwarenessContext) api.SetThreadDpiAwarenessContext(prevCtx);
  }
  return pt;
}

export interface BackgroundClickSpec {
  /** 물리 픽셀 화면 좌표(주입 지점). */
  x: number;
  y: number;
  button: 'left' | 'right' | 'middle';
  action: 'click' | 'dblclick' | 'drag' | 'wheel';
  /** drag 끝점(물리 픽셀). */
  x2?: number;
  y2?: number;
  /** wheel 델타(양수=아래로). */
  deltaY?: number;
}

export interface BackgroundClickOutcome {
  ok: boolean;
  /** 왜 못 했는지 — 호출부가 커서 방식으로 되돌린다. */
  reason?: 'ffi-unavailable' | 'no-window' | 'message-deaf-app';
  /** 진단·안내용 대상 창 클래스. */
  targetClass?: string;
}

/** 드래그 재생 시 중간 이동 메시지 수(대상 앱이 드래그를 인지하도록). */
const DRAG_MSG_STEPS = 10;

/**
 * 커서를 건드리지 않고 대상 창에 클릭/드래그/휠 메시지를 직접 넣는다.
 * 성공(=메시지를 큐에 넣음)하면 ok:true. 대상 창을 못 찾거나 무시가 확실한 앱이면 false 로 되돌린다.
 */
export function tryBackgroundClick(spec: BackgroundClickSpec): BackgroundClickOutcome {
  const api = loadUser32();
  if (!api) return { ok: false, reason: 'ffi-unavailable' };
  try {
    const hwnd = api.WindowFromPoint({ x: Math.round(spec.x), y: Math.round(spec.y) });
    if (!hwnd) return { ok: false, reason: 'no-window' };
    const cls = classNameOf(api, hwnd);
    if (MESSAGE_DEAF_CLASSES.some((c) => cls === c || cls.startsWith(c))) {
      return { ok: false, reason: 'message-deaf-app', targetClass: cls };
    }

    const b = BUTTON_MSG[spec.button];
    const p = toClientPoint(api, hwnd, spec.x, spec.y);

    if (spec.action === 'wheel') {
      // WM_MOUSEWHEEL 의 lParam 은 **화면 좌표**다(버튼 메시지와 다르다).
      const delta = (spec.deltaY ?? 0) >= 0 ? -120 : 120; // 양수 deltaY = 아래로 스크롤
      const wParam = ((delta & 0xffff) << 16) >>> 0;
      api.PostMessageW(hwnd, WM_MOUSEWHEEL, wParam, makeLParam(Math.round(spec.x), Math.round(spec.y)));
      return { ok: true, targetClass: cls };
    }

    api.PostMessageW(hwnd, WM_MOUSEMOVE, 0, makeLParam(p.x, p.y));
    api.PostMessageW(hwnd, b.down, b.mk, makeLParam(p.x, p.y));

    if (spec.action === 'drag' && spec.x2 !== undefined && spec.y2 !== undefined) {
      const end = toClientPoint(api, hwnd, spec.x2, spec.y2);
      for (let i = 1; i <= DRAG_MSG_STEPS; i++) {
        const t = i / DRAG_MSG_STEPS;
        api.PostMessageW(
          hwnd,
          WM_MOUSEMOVE,
          b.mk,
          makeLParam(Math.round(p.x + (end.x - p.x) * t), Math.round(p.y + (end.y - p.y) * t)),
        );
      }
      api.PostMessageW(hwnd, b.up, 0, makeLParam(end.x, end.y));
      return { ok: true, targetClass: cls };
    }

    api.PostMessageW(hwnd, b.up, 0, makeLParam(p.x, p.y));
    if (spec.action === 'dblclick') {
      api.PostMessageW(hwnd, b.dbl, b.mk, makeLParam(p.x, p.y));
      api.PostMessageW(hwnd, b.up, 0, makeLParam(p.x, p.y));
    }
    return { ok: true, targetClass: cls };
  } catch (err) {
    recordDiagnostic('main', 'warn', `background click failed — ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, reason: 'ffi-unavailable' };
  }
}
