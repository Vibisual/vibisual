import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SoundWaveform } from './SoundWaveform.js';
import type { SoundRange } from './soundConfig.js';

vi.mock('react-i18next', () => {
  const t = (key: string): string => key;
  return { useTranslation: () => ({ t }) };
});
const surface = {
  width: 400, height: 200, getContext: () => null,
  getBoundingClientRect: () => ({ left: 0, width: 400 }),
  setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn(),
};
interface Pointer { currentTarget: typeof surface; clientX: number; pointerId: number; button: number }
interface CanvasEvents {
  onPointerDown(event: Pointer): void; onPointerMove(event: Pointer): void;
  onPointerUp(event: Pointer): void; onPointerCancel(event: Pointer): void;
}
let view: ReactTestRenderer | undefined;
const select = vi.fn<(range: SoundRange | null) => void>();
const seek = vi.fn<(at: number) => void>();
function pointer(clientX: number): Pointer { return { currentTarget: surface, clientX, pointerId: 1, button: 0 }; }
function events(): CanvasEvents { return view!.root.findByType('canvas').props as CanvasEvents; }
function render(): void {
  act(() => {
    view = create(<SoundWaveform pcm={{ sampleRate: 8000, channels: [new Float32Array(80000)] }} playhead={0} selection={null} onSeek={seek} onSelect={select} />, {
      createNodeMock: element => element.type === 'canvas' ? surface : { clientWidth: 400 },
    });
  });
}
beforeEach(() => {
  vi.stubGlobal('window', { devicePixelRatio: 1 });
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} });
  select.mockReset(); seek.mockReset();
});
afterEach(() => { act(() => view?.unmount()); view = undefined; vi.unstubAllGlobals(); });

describe('waveform pointer selection', () => {
  it('clears the previous drag range when the pointer returns to its anchor', () => {
    render();
    act(() => events().onPointerDown(pointer(100)));
    act(() => events().onPointerMove(pointer(250)));
    expect(select).toHaveBeenLastCalledWith({ start: 2.5, end: 6.25 });
    act(() => events().onPointerMove(pointer(100)));
    expect(select).toHaveBeenLastCalledWith(null);
    act(() => events().onPointerUp(pointer(100)));
    expect(seek).toHaveBeenCalledExactlyOnceWith(2.5);
  });

  it('sorts a reverse drag and stops updating it after pointer release', () => {
    render();
    act(() => events().onPointerDown(pointer(300)));
    act(() => events().onPointerMove(pointer(100)));
    expect(select).toHaveBeenLastCalledWith({ start: 2.5, end: 7.5 });
    act(() => events().onPointerUp(pointer(100)));
    const calls = select.mock.calls.length;
    act(() => events().onPointerMove(pointer(0)));
    expect(select).toHaveBeenCalledTimes(calls);
  });
});
