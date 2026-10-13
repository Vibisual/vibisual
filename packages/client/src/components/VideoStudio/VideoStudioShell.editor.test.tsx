import { createElement, isValidElement, type JSXElementConstructor } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyPatch, createEmptyDoc, resolveTimeline, type VideoDoc, type VideoDocOp } from '@vibisual/video';
import { MediaDrawer } from './MediaDrawer.js';
import { PartsDrawer } from './PartsDrawer.js';
import { VideoStudioShell } from './VideoStudioShell.js';
import { VideoStudioView, type VideoStudioViewProps } from './VideoStudioView.js';

const mocks = vi.hoisted(() => {
  vi.stubGlobal('window', { location: { protocol: 'http:', host: 'localhost' } });
  return { read: vi.fn(), patch: vi.fn(), importAsset: vi.fn(), measure: vi.fn() };
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
vi.mock('../../apps/appWindowLifecycle.js', () => ({ useAppWindowTarget: () => undefined, useAppWindowTransferGuard: () => undefined }));
vi.mock('./VideoStudioView.js', () => ({ VideoStudioView: () => null }));
vi.mock('./useVideoAudio.js', () => ({ useVideoAudio: () => ({ resume: () => undefined }) }));
vi.mock('./useVideoJobWorker.js', () => ({ useVideoJobWorker: () => undefined }));
vi.mock('./useVideoRenderer.js', () => {
  const renderer = { drawPreview: vi.fn(), render: vi.fn() };
  return { useVideoRenderer: () => renderer, measureAssets: mocks.measure };
});
vi.mock('./videoApi.js', () => ({
  listDocs: vi.fn(async () => []), readDoc: mocks.read, patchDoc: mocks.patch, importVideoAsset: mocks.importAsset,
  createDoc: vi.fn(), getJob: vi.fn(), assetUrl: vi.fn(), startRender: vi.fn(), VersionConflictError: class extends Error {},
  // §5.13 (T-7) — 스튜디오가 몇 초마다 묻는 판본. 0 이면 다시 읽지 않는다.
  readDocVersion: vi.fn(async () => ({ id: '', title: '', version: 0, updatedAt: 0, duration: 0 })),
}));
let view: ReactTestRenderer;
let stored: VideoDoc;
function props(): VideoStudioViewProps { return view.root.findByType(VideoStudioView).props as VideoStudioViewProps; }
// §5.13 (V) 37-1 — 서랍은 레일이 그 자리에 그리는 요소다. 화면(VideoStudioView)은 가짜라 그리지 않으니 요소의 props 를 읽는다.
function drawer<P>(type: JSXElementConstructor<P>): P {
  const node = props().rail?.drawer;
  if (!isValidElement<P>(node) || node.type !== type) throw new Error('drawer is not open');
  return node.props;
}
// 빈 문서는 시작 화면으로 열린다 — '빈 영상'(direct) 레시피로 편집기(부품 서랍)를 연다.
async function openEditor(): Promise<void> {
  act(() => props().start!.onRecipe('blank'));
  await act(async () => props().start!.onSubmit());
}
beforeEach(() => {
  vi.clearAllMocks(); stored = createEmptyDoc('test', 'Test');
  mocks.read.mockImplementation(async () => ({ doc: stored }));
  mocks.patch.mockImplementation(async (_project: string, _id: string, baseVersion: number, ops: readonly VideoDocOp[]) => {
    const result = applyPatch(stored, { baseVersion, ops });
    if (!result.ok) throw new Error('Patch failed');
    stored = result.doc; return { doc: stored };
  });
  mocks.importAsset.mockImplementation(async (_project: string, file: File) => ({ id: file.name, kind: file.name.endsWith('.wav') ? 'audio' : 'video', source: { kind: 'file', path: file.name } }));
  mocks.measure.mockImplementation(async (_project: string, assets: { id: string }[]) => Object.fromEntries(assets.map(asset => [asset.id, { duration: 2, width: 1920, height: 1080, hasAudio: true }])));
});
afterEach(() => act(() => view.unmount()));
async function mount(): Promise<void> {
  await act(async () => { view = create(createElement(VideoStudioShell, { appId: 'vibistudio', params: { projectId: 'project', docId: 'test', appWindowHosted: '1' } })); });
}
describe('Studio editor integration', () => {
  it('persists a parts-drawer scene, selects it for inspection, and undoes/redoes the server document', async () => {
    await mount();
    await openEditor();
    await act(async () => drawer(PartsDrawer).onAddScene('quote'));
    const quote = stored.tracks.flatMap(track => track.items)[0]!;
    expect(quote.sceneId).toBe('quote');
    act(() => props().controls!.onPrecision());
    expect(props().precision?.inspector.selectedItemId).toBe(quote.id);
    expect(props().precision!.undo.disabled).toBe(false);
    await act(async () => props().precision!.undo.run());
    expect(stored.tracks.flatMap(track => track.items)).toHaveLength(0);
    await act(async () => props().precision!.redo.run());
    expect(stored.tracks.flatMap(track => track.items)[0]?.sceneId).toBe('quote');
  });
  it('places batch media sequentially per track kind and retains probed audio metadata', async () => {
    await mount();
    await openEditor();
    act(() => props().rail!.onOpen('media'));
    const files = ['one.mp4', 'two.mp4', 'sound.wav'].map(name => new File(['data'], name));
    await act(async () => drawer(MediaDrawer).onImport(files));
    const items = resolveTimeline(stored).items;
    expect(items.find(item => item.item.label === 'one.mp4')?.start).toBe(0);
    expect(items.find(item => item.item.label === 'two.mp4')?.start).toBe(2);
    expect(items.find(item => item.item.label === 'sound.wav')?.start).toBe(0);
    expect(stored.assets['one.mp4']?.hasAudio).toBe(true);
    expect(drawer(MediaDrawer).importing).toBe(false);
  });
  it('imports SRT as timestamped captions without sending it as media', async () => {
    await mount();
    await openEditor();
    act(() => props().rail!.onOpen('media'));
    const file = new File(['1\n00:00:01,000 --> 00:00:02,000\nHello'], 'captions.srt');
    await act(async () => drawer(MediaDrawer).onImport([file]));
    expect(mocks.importAsset).not.toHaveBeenCalled();
    expect(resolveTimeline(stored).items[0]?.item.cues).toEqual([{ start: 1, end: 2, text: 'Hello' }]);
  });
});
