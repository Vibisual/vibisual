import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ sources: vi.fn(), displays: vi.fn(), windows: vi.fn(), activeWindow: vi.fn(), type: vi.fn(), move: vi.fn(), primary: vi.fn() }));
vi.mock('electron', () => ({ desktopCapturer: { getSources: mocks.sources }, screen: { getAllDisplays: mocks.displays, getPrimaryDisplay: mocks.primary, dipToScreenPoint: (p: unknown) => p, screenToDipPoint: (p: unknown) => p } }));
vi.mock('@vibisual/server', () => ({ recordDiagnostic: vi.fn() }));
vi.mock('./backgroundClick', () => ({ tryBackgroundClick: vi.fn(() => ({ ok: false })) }));
vi.mock('@nut-tree-fork/nut-js', () => ({
  getWindows: mocks.windows, getActiveWindow: mocks.activeWindow,
  keyboard: { config: {}, type: mocks.type },
  mouse: { config: {}, getPosition: async () => ({ x: 0, y: 0 }), setPosition: mocks.move, click: async () => undefined },
  Key: { Enter: 13, A: 65 }, Button: { LEFT: 0 }, Point: class { constructor(public x: number, public y: number) {} },
}));

const windowSpec = { sourceKind: 'window' as const, sourceId: 'window:1:0', sourceName: 'Test window' };
const windowStub = (): { getTitle: () => Promise<string>; focus: ReturnType<typeof vi.fn>; getRegion: ReturnType<typeof vi.fn> } => ({ getTitle: async () => 'Test window', focus: vi.fn(async () => true), getRegion: vi.fn(async () => ({ left: 100, top: 200, width: 300, height: 200 })) });

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  mocks.sources.mockResolvedValue([{ id: windowSpec.sourceId, name: windowSpec.sourceName }]);
  mocks.displays.mockReturnValue([]); mocks.windows.mockResolvedValue([windowStub()]); mocks.type.mockResolvedValue(undefined); mocks.move.mockResolvedValue(undefined);
});

describe('exact capture input target', () => {
  it('never redirects a disappeared display to the primary display', async () => {
    const { resolveCaptureTargetRect } = await import('./captureInputManager');
    expect((await resolveCaptureTargetRect({ sourceKind: 'screen', sourceId: 'screen:gone', sourceName: 'gone' })).ok).toBe(false);
    expect(mocks.primary).not.toHaveBeenCalled();
  });
  it('does not type when a window source vanished', async () => {
    mocks.sources.mockResolvedValue([]);
    const { injectCaptureInput } = await import('./captureInputManager');
    expect(await injectCaptureInput({ ...windowSpec, type: 'key', action: 'type', text: 'unsafe' })).toEqual({ ok: false, reason: 'target-not-found' });
    expect(mocks.type).not.toHaveBeenCalled();
  });
  it('rejects duplicate titles without focusing either window', async () => {
    const first = windowStub(), second = windowStub(); mocks.windows.mockResolvedValue([first, second]);
    const { injectCaptureInput } = await import('./captureInputManager');
    expect((await injectCaptureInput({ ...windowSpec, type: 'key', action: 'press', key: 'Enter' })).ok).toBe(false);
    expect(first.focus).not.toHaveBeenCalled(); expect(second.focus).not.toHaveBeenCalled();
  });
  it('does not type when focusing the only target fails', async () => {
    const win = windowStub(); win.focus.mockResolvedValue(false); mocks.windows.mockResolvedValue([win]);
    const { injectCaptureInput } = await import('./captureInputManager');
    expect((await injectCaptureInput({ ...windowSpec, type: 'key', action: 'press', key: 'Enter' })).ok).toBe(false);
    expect(mocks.type).not.toHaveBeenCalled();
  });
  it('probes target geometry without stealing focus', async () => {
    const win = windowStub(); mocks.windows.mockResolvedValue([win]);
    const { resolveCaptureTargetRect } = await import('./captureInputManager');
    expect((await resolveCaptureTargetRect(windowSpec, { focus: false })).ok).toBe(true);
    expect(win.focus).not.toHaveBeenCalled();
  });
  it('keeps the bottom right normalized coordinate inside the target', async () => {
    const { injectCaptureInput } = await import('./captureInputManager');
    expect((await injectCaptureInput({ ...windowSpec, type: 'mouse', action: 'click', u: 1, v: 1 })).ok).toBe(true);
    expect(mocks.move).toHaveBeenNthCalledWith(1, { x: 399, y: 399 });
  });
  it('rejects an unsupported key instead of reporting silent success', async () => {
    const { injectCaptureInput } = await import('./captureInputManager');
    expect((await injectCaptureInput({ ...windowSpec, type: 'key', action: 'press', key: 'Unsupported' })).ok).toBe(false);
    expect(mocks.type).not.toHaveBeenCalled();
  });
  it('does not type into a focused window on another selected display', async () => {
    mocks.sources.mockResolvedValue([{ id: 'screen:2', display_id: '2' }]); mocks.displays.mockReturnValue([{ id: 2, bounds: { x: 1000, y: 0, width: 1000, height: 800 } }]);
    mocks.activeWindow.mockResolvedValue({ getRegion: async () => ({ left: 0, top: 0, width: 500, height: 500 }) });
    const { injectCaptureInput } = await import('./captureInputManager');
    expect((await injectCaptureInput({ type: 'key', action: 'type', text: 'unsafe', sourceId: 'screen:2', sourceKind: 'screen', sourceName: 'Display 2' })).ok).toBe(false);
    expect(mocks.type).not.toHaveBeenCalled();
  });
  it('checks cancellation when input reaches the shared OS queue', async () => {
    const { injectCaptureInput } = await import('./captureInputManager');
    expect((await injectCaptureInput({ ...windowSpec, type: 'key', action: 'type', text: 'unsafe' }, { cancelled: () => true })).ok).toBe(false);
    expect(mocks.type).not.toHaveBeenCalled();
  });
  it('rechecks stop after asynchronous focus before injecting a key', async () => {
    let stopped = false;
    const win = windowStub(); win.focus.mockImplementation(async () => { stopped = true; return true; }); mocks.windows.mockResolvedValue([win]);
    const { injectCaptureInput } = await import('./captureInputManager');
    expect((await injectCaptureInput({ ...windowSpec, type: 'key', action: 'type', text: 'unsafe' }, { cancelled: () => stopped })).ok).toBe(false);
    expect(mocks.type).not.toHaveBeenCalled();
  });
  it('does not focus a target after a stop during source lookup', async () => {
    let stopped = false;
    const win = windowStub(); mocks.windows.mockImplementation(async () => { stopped = true; return [win]; });
    const { injectCaptureInput } = await import('./captureInputManager');
    expect((await injectCaptureInput({ ...windowSpec, type: 'key', action: 'press', key: 'Enter' }, { cancelled: () => stopped })).ok).toBe(false);
    expect(win.focus).not.toHaveBeenCalled();
  });
});
