import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyDoc, type VideoAsset, type VideoDoc, type VideoDocOp } from '@vibisual/video';
import { VideoSourcesDrawer } from './VideoSourcesDrawer.js';

const mocks = vi.hoisted(() => ({ list: vi.fn(), import: vi.fn() }));
vi.mock('./videoSourcesApi.js', () => ({ listVideoSources: mocks.list, importVideoSource: mocks.import }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
let view: ReactTestRenderer | undefined;
afterEach(() => { act(() => view?.unmount()); view = undefined; vi.unstubAllGlobals(); vi.clearAllMocks(); });
const old: VideoAsset = { id: 'old', kind: 'model', source: { kind: 'file', path: 'old.vibi3d' }, creationSource: { id: 'product', revision: 1, appId: 'vibi3d' } };
const next: VideoAsset = { ...old, id: 'next', creationSource: { ...old.creationSource!, revision: 2 } };
function fixture(): VideoDoc { return { ...createEmptyDoc('video', 'Promo'), assets: { old }, tracks: [{ id: 'v', kind: 'visual', items: [{ id: 'a', kind: 'model', assetId: 'old', at: 0, duration: 5 }, { id: 'b', kind: 'model', assetId: 'old', at: 5, duration: 5 }] }] }; }
function button(): ReturnType<ReactTestRenderer['root']['findByType']> { return view!.root.findAllByType('button').find(button => button.children.includes('panel.videoStudio.sources.update'))!; }
describe('editable source drawer', () => {
  it('keeps the current revision until specific affected items are checked', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ ok: true }) })));
    mocks.list.mockResolvedValue([{ id: 'product', appId: 'vibi3d', title: 'Bottle', revision: 2 }]); mocks.import.mockResolvedValue(next);
    const apply = vi.fn(async (_ops: readonly VideoDocOp[]) => true);
    await act(async () => { view = create(createElement(VideoSourcesDrawer, { project: '/p', doc: fixture(), playhead: 0, disabled: false, onApply: apply, onError: vi.fn() })); });
    expect(button().props.disabled).toBe(true); expect(apply).not.toHaveBeenCalled();
    act(() => view!.root.findAllByType('input')[1]!.props.onChange({ target: { checked: true } }));
    await act(async () => button().props.onClick());
    expect(apply).toHaveBeenCalledWith([{ op: 'setAsset', asset: next }, { op: 'updateItem', itemId: 'b', patch: { assetId: 'next' } }]);
  });
  it('does not apply an imported snapshot over a human edit that occurred while loading', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ ok: true }) })));
    mocks.list.mockResolvedValue([{ id: 'product', appId: 'vibi3d', title: 'Bottle', revision: 2 }]);
    let done!: (value: VideoAsset) => void; mocks.import.mockReturnValue(new Promise<VideoAsset>(resolve => { done = resolve; }));
    const apply = vi.fn(); const error = vi.fn(); const doc = fixture();
    const props = { project: '/p', doc, playhead: 0, disabled: false, onApply: apply, onError: error };
    await act(async () => { view = create(createElement(VideoSourcesDrawer, props)); });
    act(() => view!.root.findAllByType('input')[0]!.props.onChange({ target: { checked: true } }));
    act(() => button().props.onClick());
    act(() => view!.update(createElement(VideoSourcesDrawer, { ...props, doc: { ...doc, version: doc.version + 1 } })));
    await act(async () => done(next));
    expect(apply).not.toHaveBeenCalled(); expect(error).toHaveBeenCalled();
    expect(view!.root.findAllByType('input')[0]!.props.checked).toBe(true);
  });
});
