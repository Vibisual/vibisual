import type { BrowserWindow } from 'electron';
import koffi from 'koffi';

interface User32 {
  GetCursorPos(point: { x: number; y: number }): number;
  GetAsyncKeyState(key: number): number;
  GetSystemMetrics(index: number): number;
  ReleaseCapture(): number;
  PostMessageW(hwnd: unknown, message: number, wParam: number, lParam: number): number;
}

let user32: User32 | null | undefined;

export type NativeTitlebarMoveResult = 'started' | 'released' | 'unavailable';

function loadUser32(): User32 | null {
  if (user32 !== undefined) return user32;
  try {
    const lib = koffi.load('user32.dll');
    // A separate name avoids colliding with backgroundClick.ts's POINT binding.
    koffi.struct('VibisualTitlebarPoint', { x: 'long', y: 'long' });
    user32 = {
      GetCursorPos: lib.func('int __stdcall GetCursorPos(_Out_ VibisualTitlebarPoint *lpPoint)') as User32['GetCursorPos'],
      GetAsyncKeyState: lib.func('short __stdcall GetAsyncKeyState(int vKey)') as User32['GetAsyncKeyState'],
      GetSystemMetrics: lib.func('int __stdcall GetSystemMetrics(int nIndex)') as User32['GetSystemMetrics'],
      ReleaseCapture: lib.func('int __stdcall ReleaseCapture()') as User32['ReleaseCapture'],
      PostMessageW: lib.func('int __stdcall PostMessageW(void *hWnd, unsigned int Msg, uintptr_t wParam, intptr_t lParam)') as User32['PostMessageW'],
    };
  } catch {
    user32 = null;
  }
  return user32;
}

/** Hand an already-dragging logo gesture to Windows without removing its no-drag cover.
 * Call only after the drag threshold: ordinary clicks must still reach the renderer's
 * double-click handler. A queued caption press uses the same Windows move loop as the
 * native title bar, including restore anchoring and edge snapping.
 *
 * started means the handoff was queued, not that the window has already moved. Both
 * started and released consume the gesture: only unavailable permits manual fallback.
 */
export function tryStartNativeTitlebarMove(
  win: Pick<BrowserWindow, 'isDestroyed' | 'getNativeWindowHandle'>,
): NativeTitlebarMoveResult {
  if (process.platform !== 'win32') return 'unavailable';
  if (win.isDestroyed()) return 'released';
  const api = loadUser32();
  if (!api) return 'unavailable';

  try {
    // GetAsyncKeyState reports physical buttons. Respect swapped primary/secondary buttons.
    const primaryButton = api.GetSystemMetrics(23 /* SM_SWAPBUTTON */) ? 0x02 : 0x01;
    if ((api.GetAsyncKeyState(primaryButton) & 0x8000) === 0) return 'released';

    const handle = win.getNativeWindowHandle();
    if (handle.byteLength < koffi.sizeof('void *')) return 'unavailable';
    // Electron's Buffer contains an HWND value; passing the Buffer itself passes its address.
    const hwnd: unknown = koffi.decode(handle, 'void *');
    if (!hwnd) return 'unavailable';

    // Win32 messages take native screen pixels, not Electron's getCursorScreenPoint() DIP.
    const point = { x: 0, y: 0 };
    if (!api.GetCursorPos(point)) return 'unavailable';
    // LPARAM contains two signed 16-bit coordinates. Do not wrap a very large desktop.
    if (![point.x, point.y].every((value) => Number.isInteger(value) && value >= -32768 && value <= 32767)) return 'unavailable';
    const lParam = ((point.y & 0xffff) << 16) | (point.x & 0xffff);

    if (win.isDestroyed() || (api.GetAsyncKeyState(primaryButton) & 0x8000) === 0) return 'released';
    // Chromium may hold client-area capture from the original press. Nothing to release
    // is harmless; ReleaseCapture returning zero alone must not reject the handoff.
    api.ReleaseCapture();
    // Post instead of synchronously entering a nested Windows move loop inside this IPC.
    // Chromium defers this caption press to its next mouse move before entering that loop.
    return api.PostMessageW(hwnd, 0x00a1 /* WM_NCLBUTTONDOWN */, 2 /* HTCAPTION */, lParam)
      ? 'started' : 'unavailable';
  } catch {
    return 'unavailable';
  }
}
