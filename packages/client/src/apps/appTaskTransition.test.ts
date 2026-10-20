import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  build: vi.fn(), save: vi.fn(), hasGuard: vi.fn(), outside: vi.fn(),
  windows: [] as Array<Record<string, unknown>>, detached: [] as Array<Record<string, unknown>>,
}));
vi.mock('./registry.js', () => ({ getInternalApp: (id: string) => id === 'app' ? { name: 'App', taskDocument: async () => mocks.build } : undefined }));
vi.mock('./appWindows.js', () => ({ useAppWindowsStore: { getState: () => ({ windows: mocks.windows, outside: mocks.detached }) } }));
vi.mock('./appWindowTransfer.js', () => ({ prepareAppWindowTransfer: mocks.save, hasAppWindowTransferGuard: mocks.hasGuard, finishAppWindowTransfer: vi.fn() }));
vi.mock('./appTaskWindowBridge.js', async (original) => ({ ...await original<object>(), prepareOutsideTaskWindow: mocks.outside }));
import { prepareAppTaskTransition } from './appTaskTransition.js';

const args = { appId: 'app', projectId: 'C:/project', projectName: 'Project', mode: 'copy' as const,
  bubble: { id: 'bubble', ref: 'old', file: 'old.glb', title: 'Original' }, title: 'New', requestId: 'request' };
beforeEach(() => { vi.clearAllMocks(); mocks.windows = []; mocks.detached = []; mocks.build.mockResolvedValue({ ref: 'new' }); mocks.save.mockResolvedValue(true); mocks.hasGuard.mockReturnValue(true); });
afterEach(() => vi.restoreAllMocks());

describe('separate app task documents', () => {
  it('saves the live document and copies the saved target before returning an independent target', async () => {
    const live = { ...args.bubble, id: 'window', bubbleId: args.bubble.id, appId: args.appId, projectId: args.projectId };
    mocks.windows = [live];
    mocks.save.mockImplementation(async () => { mocks.windows = [{ ...live, ref: 'saved', file: 'saved.glb' }]; return true; });
    const result = await prepareAppTaskTransition(args);
    expect(mocks.save).toHaveBeenCalledWith('window');
    expect(mocks.build).toHaveBeenCalledWith({ projectId: args.projectId, projectName: args.projectName, mode: 'copy',
      source: { ref: 'saved', file: 'saved.glb' }, title: 'New', requestId: 'request' });
    expect(result).toEqual({ previous: { ref: 'saved', file: 'saved.glb' }, next: { ref: 'new' } });
    expect(args.bubble.ref).toBe('old');
  });
  it.each(['save failed', 'not mounted'] as const)('does not create a document when the live editor is %s', async failure => {
    mocks.windows = [{ ...args.bubble, id: 'window', bubbleId: 'bubble', appId: 'app', projectId: args.projectId }];
    if (failure === 'save failed') mocks.save.mockResolvedValue(false); else mocks.hasGuard.mockReturnValue(false);
    await expect(prepareAppTaskTransition(args)).rejects.toThrow('app-task-save-failed');
    expect(mocks.build).not.toHaveBeenCalled();
  });
  it('new mode still saves the old work and passes new intent to the app without clearing its source', async () => {
    mocks.detached = [{ appId: 'app', projectId: args.projectId, ref: 'old' }];
    mocks.outside.mockResolvedValue({ ref: 'old', file: 'saved.glb' });
    const result = await prepareAppTaskTransition({ ...args, mode: 'new' });
    expect(mocks.outside).toHaveBeenCalledOnce();
    expect(mocks.build).toHaveBeenCalledWith(expect.objectContaining({ mode: 'new' }));
    expect(result.previous.ref).toBe('old');
  });
  it('keeps the old target when document creation fails', async () => {
    mocks.build.mockRejectedValue(new Error('disk full'));
    await expect(prepareAppTaskTransition(args)).rejects.toThrow('disk full');
    expect(args.bubble).toEqual({ id: 'bubble', ref: 'old', file: 'old.glb', title: 'Original' });
  });
  it('does not guess between two editors with unsaved changes', async () => {
    mocks.windows = ['one', 'two'].map(id => ({ id, appId: 'app', projectId: args.projectId, ref: 'old' }));
    await expect(prepareAppTaskTransition(args)).rejects.toThrow('app-task-multiple-editors');
    expect(mocks.build).not.toHaveBeenCalled();
  });
});
