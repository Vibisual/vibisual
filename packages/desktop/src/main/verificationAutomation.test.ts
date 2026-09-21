import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ navigate: vi.fn(), close: vi.fn(), observe: vi.fn(), act: vi.fn(), check: vi.fn(), desktopProbe: vi.fn(), desktopAct: vi.fn(), desktopObserve: vi.fn(), compare: vi.fn() }));
vi.mock('./verificationBrowser', () => ({ VerificationBrowser: class { navigate = mocks.navigate; close = mocks.close; observe = mocks.observe; act = mocks.act; check = mocks.check; } }));
vi.mock('./verificationDesktop', () => ({ probeVerificationDesktop: mocks.desktopProbe, observeVerificationDesktop: mocks.desktopObserve, actVerificationDesktop: mocks.desktopAct }));
vi.mock('./verificationImage', () => ({ compareVerificationImages: mocks.compare }));
import { verificationAutomationAdapter as adapter, closeAllVerificationTargets } from './verificationAutomation';
const target = { kind: 'browser' as const, url: 'http://localhost:3000' };

beforeEach(() => {
  closeAllVerificationTargets(); vi.clearAllMocks();
  mocks.navigate.mockResolvedValue(undefined); mocks.desktopProbe.mockResolvedValue(undefined);
  mocks.observe.mockResolvedValue({ png: Buffer.from('png'), width: 1280, height: 720, elements: [] });
});

describe('verification target lifecycle', () => {
  it('cleans up a failed open and permits a later retry', async () => {
    mocks.navigate.mockRejectedValueOnce(new Error('Connection refused'));
    await expect(adapter.open('retry', target)).rejects.toThrow('Connection refused'); expect(mocks.close).toHaveBeenCalledTimes(1);
    await adapter.open('retry', target); await adapter.close('retry');
  });
  it('does not resurrect a target stopped while loading', async () => {
    let finish: () => void = () => undefined;
    mocks.navigate.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const opening = adapter.open('stopped', target); const rejected = expect(opening).rejects.toThrow('stopped');
    await adapter.close('stopped'); finish(); await rejected;
    await expect(adapter.observe('stopped')).rejects.toThrow('closed');
  });
  it('passes a live cancellation predicate into queued desktop input', async () => {
    await adapter.open('desktop', { kind: 'desktop', sourceKind: 'window', sourceId: 'window:1', sourceName: 'Target' });
    await adapter.act('desktop', { kind: 'press', key: 'Enter' });
    const cancelled = mocks.desktopAct.mock.calls[0]![2] as () => boolean;
    expect(cancelled()).toBe(false); await adapter.close('desktop'); expect(cancelled()).toBe(true);
  });
  it('requires real image bytes for screenshot checks and invokes the comparator', async () => {
    await adapter.open('compare', target);
    await expect(adapter.check('compare', { kind: 'screenshot', referenceFrame: 0 })).rejects.toThrow('missing');
    mocks.compare.mockReturnValue({ passed: false, detail: 'Different' });
    expect(await adapter.check('compare', { kind: 'screenshot', referenceFrame: 0 }, Buffer.from('reference'))).toEqual({ passed: false, detail: 'Different' });
    expect(mocks.compare).toHaveBeenCalledWith(Buffer.from('png'), Buffer.from('reference'), undefined);
  });
  it('does not pretend desktop targets support DOM assertions', async () => {
    await adapter.open('native', { kind: 'desktop', sourceKind: 'window', sourceId: 'window:1', sourceName: 'Target' });
    await expect(adapter.check('native', { kind: 'visible', selector: 'button' })).rejects.toThrow('Desktop');
  });
  it('reports invalid connections as unavailable with no actionable capabilities', async () => {
    expect(await adapter.probe({ kind: 'browser', url: 'file:///private' })).toMatchObject({ available: false, actions: [], checks: [] });
  });
});
