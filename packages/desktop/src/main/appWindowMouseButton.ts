import koffi from 'koffi';

let sample: (() => boolean) | null | undefined;

/** Poll physical release while Chromium capture moves between a source, ghost and origin window. */
export function appWindowPrimaryPressed(): boolean | null {
  if (process.platform !== 'win32') return null;
  if (sample === undefined) {
    try {
      const lib = koffi.load('user32.dll');
      const getKey = lib.func('short __stdcall GetAsyncKeyState(int key)') as (key: number) => number;
      const getMetric = lib.func('int __stdcall GetSystemMetrics(int index)') as (index: number) => number;
      sample = () => (getKey(getMetric(23 /* SM_SWAPBUTTON */) ? 0x02 : 0x01) & 0x8000) !== 0;
    } catch { sample = null; }
  }
  try { return sample?.() ?? null; } catch { return null; }
}
