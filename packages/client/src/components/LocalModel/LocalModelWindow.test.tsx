import { createElement, type ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentConfig, LocalLlmState, LocalModelCatalogRepo, LocalModelDownloadProgress } from '@vibisual/shared';
import { LocalModelWindow } from './LocalModelWindow.js';
import { useGraphStore } from '../../stores/graphStore.js';

vi.mock('react-dom', () => ({ createPortal: (children: ReactNode) => children }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../ScrollFade.js', () => ({ ScrollFade: ({ children }: { children: ReactNode }) => children }));
vi.mock('../../stores/graphStore.js', async () => {
  const { create: makeStore } = await import('zustand');
  return { useGraphStore: makeStore(() => ({})) };
});

let view: ReactTestRenderer;
const json = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), { status });
const repo = (name: string): LocalModelCatalogRepo => ({ repo: name, downloads: 1, likes: 0, trending: 0, updatedAt: 0, files: [] });
const entry = { id: 'model', repo: 'org/A', file: 'model.gguf', sizeBytes: 1, name: 'model' };
const downloaded = { id: 'model', name: 'model', path: '/models/model.gguf', sizeBytes: 1, downloadedAt: 1 };
const progress: LocalModelDownloadProgress = { downloadId: 'attempt-new', modelId: 'model', name: 'model', status: 'starting', receivedBytes: 0, totalBytes: 1 };
const completed: LocalModelDownloadProgress = { ...progress, status: 'done', receivedBytes: 1 };
const initialLocal: LocalLlmState = {
  engine: { installed: true, build: 'b1', backends: [], serverBin: '/llama', dir: '/engine' },
  models: [], downloads: [], loaded: [],
};
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  return { promise: new Promise<T>((done) => { resolve = done; }), resolve: (value) => resolve(value) };
}
function button(label: string) {
  return view.root.findAllByType('button').find((node) => node.children.some((child) => child === label)
    || node.findAllByType('span').some((span) => span.children.includes(label)))!;
}
async function render(): Promise<void> {
  await act(async () => { view = create(createElement(LocalModelWindow)); });
}
const output = (): string => JSON.stringify(view.toJSON());

beforeEach(() => {
  vi.stubGlobal('document', { body: {} });
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  useGraphStore.setState({
    localModelWindow: { agentId: 'a' }, localLlm: initialLocal,
    agentConfigs: { a: { provider: { kind: 'local-llama', modelId: '' } } as AgentConfig }, nodeMap: {},
    bindLocalModel: vi.fn(async () => ({ ok: true as const })),
    closeLocalModelWindow: vi.fn(() => useGraphStore.setState({ localModelWindow: null })),
  });
});
afterEach(async () => {
  await act(async () => { view?.unmount(); });
  vi.unstubAllGlobals();
});

describe('All Model preparation window', () => {
  it('shows loading, discards previous repository files and ignores its late response', async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    const fetcher = vi.fn().mockResolvedValueOnce(json({ repos: [repo('org/A'), repo('org/B')] }))
      .mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    vi.stubGlobal('fetch', fetcher);
    await render();
    await act(async () => { button('org/A').props.onClick(); });
    expect(output()).toContain('localModel.searching');
    expect(output()).not.toContain('localModel.noFiles');
    await act(async () => { button('org/B').props.onClick(); });
    expect(fetcher.mock.calls[1]?.[1].signal.aborted).toBe(true);
    await act(async () => { second.resolve(json({ files: [{ ...entry, id: 'b', repo: 'org/B', file: 'B.gguf' }] })); });
    await act(async () => { first.resolve(json({ files: [{ ...entry, file: 'A.gguf' }] })); });
    expect(output()).toContain('B.gguf');
    expect(output()).not.toContain('A.gguf');
  });

  it('ignores an older search that finishes after a new sort', async () => {
    const old = deferred<Response>();
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce(json({ repos: [repo('org/New')] })));
    await render();
    await act(async () => { button('localModel.sortLikes').props.onClick(); });
    await act(async () => { old.resolve(json({ repos: [repo('org/Old')] })); });
    expect(output()).toContain('org/New');
    expect(output()).not.toContain('org/Old');
  });

  it('keeps a catalog failure visible instead of claiming the repository has no files', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({ repos: [repo('org/A')] }))
      .mockResolvedValueOnce(json({ error: 'Catalog rate limit; retry later.' }, 502)));
    await render();
    await act(async () => { button('org/A').props.onClick(); });
    expect(output()).toContain('Catalog rate limit; retry later.');
    expect(output()).not.toContain('localModel.noFiles');
  });

  it('does not attach A’s download to another bubble opened while it downloads', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({ repos: [repo('org/A')] }))
      .mockResolvedValueOnce(json({ files: [entry] })).mockResolvedValue(json({ ok: true, repos: [], progress })));
    await render();
    await act(async () => { button('org/A').props.onClick(); });
    await act(async () => { button('localModel.download').props.onClick(); });
    await act(async () => { useGraphStore.setState({ localModelWindow: { agentId: 'b' } }); });
    await act(async () => { useGraphStore.setState({ localLlm: { ...initialLocal, models: [downloaded], downloads: [completed] } }); });
    expect(useGraphStore.getState().bindLocalModel).not.toHaveBeenCalled();
  });

  it('attaches a completed download once to the bubble that requested it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({ repos: [repo('org/A')] }))
      .mockResolvedValueOnce(json({ files: [entry] })).mockResolvedValue(json({ ok: true, progress })));
    await render();
    await act(async () => { button('org/A').props.onClick(); });
    await act(async () => { button('localModel.download').props.onClick(); });
    await act(async () => { useGraphStore.setState({ localLlm: { ...initialLocal, models: [downloaded], downloads: [completed] } }); });
    expect(useGraphStore.getState().bindLocalModel).toHaveBeenCalledExactlyOnceWith('a', 'model', 'model');
  });

  it('tracks the accepted retry ID across old failures, cancellations and stale completed attempts', async () => {
    const old: LocalModelDownloadProgress[] = [
      { ...progress, downloadId: 'attempt-error', status: 'error', error: 'Network disconnected' },
      { ...progress, downloadId: 'attempt-canceled', status: 'canceled' },
      { ...completed, downloadId: 'attempt-old-done' },
    ];
    useGraphStore.setState({ localLlm: { ...initialLocal, models: [downloaded], downloads: old } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({ repos: [repo('org/A')] }))
      .mockResolvedValueOnce(json({ files: [entry] })).mockResolvedValue(json({ ok: true, progress })));
    await render();
    await act(async () => { button('org/A').props.onClick(); });
    await act(async () => { button('localModel.download').props.onClick(); });
    // An older snapshot has a valid file and old done record, but the accepted retry is still starting.
    expect(useGraphStore.getState().bindLocalModel).not.toHaveBeenCalled();
    await act(async () => { useGraphStore.setState({ localLlm: { ...initialLocal, models: [downloaded], downloads: [...old, completed] } }); });
    expect(useGraphStore.getState().bindLocalModel).toHaveBeenCalledExactlyOnceWith('a', 'model', 'model');
  });

  it('does not auto-select after download acceptance failed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({ repos: [repo('org/A')] }))
      .mockResolvedValueOnce(json({ files: [entry] })).mockResolvedValue(json({ error: 'Insufficient space' }, 400)));
    await render();
    await act(async () => { button('org/A').props.onClick(); });
    await act(async () => { button('localModel.download').props.onClick(); });
    await act(async () => { useGraphStore.setState({ localLlm: { ...initialLocal, models: [downloaded] } }); });
    expect(useGraphStore.getState().bindLocalModel).not.toHaveBeenCalled();
    expect(output()).toContain('Insufficient space');
  });

  it('shows model binding errors and permits retry without closing the window', async () => {
    const bind = vi.fn().mockResolvedValueOnce({ ok: false, error: 'Missing model shard' }).mockResolvedValue({ ok: true });
    useGraphStore.setState({ localLlm: { ...initialLocal, models: [downloaded] }, bindLocalModel: bind });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ repos: [] })));
    await render();
    await act(async () => { button('localModel.useModelStart').props.onClick(); });
    expect(output()).toContain('Missing model shard');
    expect(button('localModel.useModelStart').props.disabled).toBe(false);
    await act(async () => { button('localModel.useModelStart').props.onClick(); });
    expect(bind).toHaveBeenCalledTimes(2);
  });
});
