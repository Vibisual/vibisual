import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ sources: vi.fn(), input: vi.fn(), rect: vi.fn(), normalize: vi.fn() }));
vi.mock('electron', () => ({ desktopCapturer: { getSources: mocks.sources } }));
vi.mock('./captureInputManager', () => ({ injectCaptureInput: mocks.input, resolveCaptureTargetRect: mocks.rect }));
vi.mock('./verificationImage', () => ({ normalizeVerificationImage: mocks.normalize }));
import { actVerificationDesktop, observeVerificationDesktop, probeVerificationDesktop } from './verificationDesktop';
const target = { kind: 'desktop' as const, sourceId: 'window:42:0', sourceKind: 'window' as const, sourceName: 'Original title' };
const source = (name = 'Original title'): { id: string; name: string; thumbnail: { isEmpty: () => boolean } } => ({ id: target.sourceId, name, thumbnail: { isEmpty: () => false } });
beforeEach(() => {
  vi.clearAllMocks(); mocks.sources.mockResolvedValue([source()]); mocks.input.mockResolvedValue({ ok: true });
  mocks.rect.mockResolvedValue({ ok: true, physical: { x: 0, y: 0, width: 500, height: 500 } });
  mocks.normalize.mockReturnValue({ png: Buffer.from('image'), width: 500, height: 500 });
});

describe('desktop target verification', () => {
  it('follows a changed title through the same user-selected source id', async () => {
    mocks.sources.mockResolvedValue([source('Edited title *')]);
    expect((await observeVerificationDesktop(target)).title).toBe('Edited title *');
    await probeVerificationDesktop(target, 'win32');
    expect(mocks.rect).toHaveBeenCalledWith(expect.objectContaining({ sourceId: target.sourceId, sourceName: 'Edited title *' }), { focus: false });
  });
  it('never chooses a replacement window that only has the old title', async () => {
    mocks.sources.mockResolvedValue([{ ...source(), id: 'window:other:0' }]);
    await expect(observeVerificationDesktop(target)).rejects.toThrow('no longer available');
  });
  it('rejects duplicate current titles before geometry or input', async () => {
    mocks.sources.mockResolvedValue([source('Same'), { ...source('Same'), id: 'window:other:0' }]);
    await expect(probeVerificationDesktop(target, 'win32')).rejects.toThrow('Multiple windows'); expect(mocks.rect).not.toHaveBeenCalled();
  });
  it.each(['darwin', 'linux'] as const)('reports unsupported native input clearly on %s', async (platform) => {
    await expect(probeVerificationDesktop(target, platform)).rejects.toThrow('Connect a browser URL'); expect(mocks.sources).not.toHaveBeenCalled();
  });
  it('refuses empty capture evidence', async () => {
    mocks.sources.mockResolvedValue([{ ...source(), thumbnail: { isEmpty: () => true } }]);
    await expect(observeVerificationDesktop(target)).rejects.toThrow('Screen capture is unavailable');
  });
  it('drops a queued desktop gesture once its run is stopped', async () => {
    await expect(actVerificationDesktop(target, { kind: 'press', key: 'Enter' }, () => true)).rejects.toThrow('stopped');
    expect(mocks.sources).not.toHaveBeenCalled(); expect(mocks.input).not.toHaveBeenCalled();
  });
});
