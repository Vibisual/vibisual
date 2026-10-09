import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyDoc, type VideoDoc } from '@vibisual/video';
import { VideoStudioShell } from './VideoStudioShell.js';
import { WindowControls } from '../Layout/WindowControls.js';

const mocks = vi.hoisted(() => {
  vi.stubGlobal('window', { location: { protocol: 'http:', host: 'localhost' } });
  return { target: vi.fn(), read: vi.fn(), list: vi.fn(), create: vi.fn(), measure: vi.fn(), patch: vi.fn(), prepare: null as (() => Promise<boolean>) | null };
});
vi.mock('react-i18next', () => {
  const t = (key: string, options?: { defaultValue?: string }): string => options?.defaultValue ?? key;
  return { useTranslation: () => ({ t }) };
});
vi.mock('../../hooks/useWebSocket.js', () => ({ useWebSocket: () => undefined }));
vi.mock('../../stores/graphStore.js', () => {
  const state = { projects: {}, agents: [], addCommand: vi.fn() };
  return { useGraphStore: (select: (value: typeof state) => unknown) => select(state) };
});
vi.mock('../../apps/appWindowLifecycle.js', () => ({ useAppWindowTarget: mocks.target,
  useAppWindowTransferGuard: (_params: unknown, prepare: () => Promise<boolean>) => { mocks.prepare = prepare; },
}));
vi.mock('../Layout/WindowControls.js', () => ({ WindowControls: () => null }));
vi.mock('./VideoTimeline.js', () => ({ VideoTimeline: () => null }));
vi.mock('./useVideoRenderer.js', () => {
  const renderer = { drawPreview: vi.fn(), render: vi.fn() };
  return { useVideoRenderer: () => renderer, measureAssets: mocks.measure };
});
vi.mock('./videoApi.js', () => ({
  listDocs: mocks.list, readDoc: mocks.read, createDoc: mocks.create, patchDoc: mocks.patch,
  claimJob: vi.fn(), reportJob: vi.fn(), startRender: vi.fn(), VersionConflictError: class extends Error {},
}));

let view: ReactTestRenderer | undefined;
function mount(params: Record<string, string>): void {
  view = create(createElement(VideoStudioShell, { appId: 'vibistudio', params }));
}
function docSelect() { return view!.root.findAllByType('select')[0]!; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => {
  vi.clearAllMocks(); mocks.prepare = null; mocks.read.mockReset(); mocks.create.mockReset(); mocks.measure.mockReset(); mocks.patch.mockReset(); mocks.list.mockResolvedValue([]);
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
});
afterEach(() => { act(() => view?.unmount()); view = undefined; vi.useRealTimers(); });

describe('video shell window handoff', () => {
  it('blocks transfer while the initial document is opening', async () => {
    const pending = deferred<{ doc: VideoDoc }>(); mocks.read.mockReturnValueOnce(pending.promise);
    await act(async () => mount({ projectId: '/project', docId: 'requested' }));
    expect(await mocks.prepare!()).toBe(false);
    await act(async () => pending.resolve({ doc: createEmptyDoc('requested', 'Requested') }));
    expect(await mocks.prepare!()).toBe(true);
  });

  it('keeps a pending new document in its source window until its target is available', async () => {
    const pending = deferred<VideoDoc>(); mocks.create.mockReturnValueOnce(pending.promise);
    await act(async () => mount({ projectId: '/project' }));
    expect(await mocks.prepare!()).toBe(true);
    act(() => view!.root.findAllByType('button').find(node => node.children.join('') === '새 영상')!.props.onClick());
    expect(await mocks.prepare!()).toBe(false);
    await act(async () => pending.resolve(createEmptyDoc('new', 'New')));
    expect(await mocks.prepare!()).toBe(true);
    expect(mocks.target).toHaveBeenLastCalledWith(expect.anything(), { ref: 'new', file: undefined });
  });

  it('blocks transfer while an imported file is being measured and until document edits finish', async () => {
    mocks.create.mockResolvedValueOnce(createEmptyDoc('file-doc', 'Imported'));
    const measured = deferred<Record<string, never>>(); mocks.measure.mockReturnValueOnce(measured.promise);
    await act(async () => mount({ projectId: '/project', file: 'input.mp4' }));
    expect(await mocks.prepare!()).toBe(false);
    await act(async () => measured.resolve({}));
    expect(await mocks.prepare!()).toBe(true);
    const patched = deferred<{ doc: VideoDoc }>(); mocks.patch.mockReturnValueOnce(patched.promise);
    act(() => view!.root.findAllByType('button').find(node => node.children.join('') === '제목 추가')!.props.onClick());
    expect(await mocks.prepare!()).toBe(false);
    await act(async () => patched.resolve({ doc: createEmptyDoc('file-doc', 'Edited') }));
    expect(await mocks.prepare!()).toBe(true);
  });

  it('opens the requested document and publishes later selections without retaining the original file', async () => {
    mocks.read.mockImplementation(async (_project: string, id: string) => ({ doc: createEmptyDoc(id, id) }));
    const params = { projectId: '/project', docId: 'requested', file: 'original.mp4', appWindowId: 'window' };
    await act(async () => mount(params));
    expect(mocks.read).toHaveBeenCalledWith('/project', 'requested');
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.target).toHaveBeenLastCalledWith(params, { ref: 'requested', file: undefined });
    await act(async () => { docSelect().props.onChange({ target: { value: 'selected' } }); });
    expect(mocks.target).toHaveBeenLastCalledWith(params, { ref: 'selected', file: undefined });
    await act(async () => view!.update(createElement(VideoStudioShell, { appId: 'vibistudio', params: { ...params, docId: 'selected', file: '' } })));
    expect(mocks.read).toHaveBeenCalledTimes(2);
    act(() => docSelect().props.onChange({ target: { value: '' } }));
    expect(mocks.target).toHaveBeenLastCalledWith(expect.anything(), { ref: undefined, file: undefined });
  });

  it('keeps the latest selection when the original requested document loads late', async () => {
    const first = deferred<{ doc: VideoDoc }>();
    mocks.read.mockReturnValueOnce(first.promise).mockResolvedValueOnce({ doc: createEmptyDoc('latest', 'Latest') });
    await act(async () => mount({ projectId: '/project', docId: 'old' }));
    await act(async () => { docSelect().props.onChange({ target: { value: 'latest' } }); });
    await act(async () => { first.resolve({ doc: createEmptyDoc('old', 'Old') }); });
    expect(docSelect().props.value).toBe('latest');
    expect(mocks.target).toHaveBeenLastCalledWith(expect.anything(), { ref: 'latest', file: undefined });
  });

  it.each<Record<string, string>>([{ appWindowId: 'embedded' }, { appWindowHosted: '1' }])('leaves native chrome to its host (%j)', async (host) => {
    await act(async () => mount({ projectId: '/project', ...host }));
    expect(view!.root.findAllByType(WindowControls)).toHaveLength(0);
    expect(view!.root.findByType('header').props.className.split(' ')).not.toContain('app-drag');
  });
});
