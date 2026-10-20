import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Vibi3DDraft } from '@vibisual/shared';
import { Vibi3DDraftPanel, Vibi3DDraftStatus } from './Vibi3DDraftPanel.js';
import { listModelDrafts, readModelDraftHistory, readModelDraftVersion } from './modelDraftApi.js';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, values?: Record<string, unknown>) => values ? `${key}:${JSON.stringify(values)}` : key }) }));
vi.mock('./modelDraftApi.js', async importOriginal => ({
  ...await importOriginal<typeof import('./modelDraftApi.js')>(),
  listModelDrafts: vi.fn(), readModelDraftHistory: vi.fn(), readModelDraftVersion: vi.fn(),
}));
let view: ReactTestRenderer | undefined;
const draft = (key = 'doc:model', actor: 'human' | 'agent' = 'human', version = 1): Vibi3DDraft => ({
  key, actor, version, fileName: key, payload: { value: version }, links: [], createdAt: 1, updatedAt: version,
});
const button = (key: string) => view!.root.findAllByType('button').find(node => node.children.includes(`panel.vibi3d.drafts.${key}`))!;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const versionText = (): string => view!.root.findAllByType('p').map(node => node.children.join('')).join('\n');
beforeEach(() => {
  vi.mocked(listModelDrafts).mockReset().mockResolvedValue({ drafts: [draft()], failed: [] });
  vi.mocked(readModelDraftHistory).mockReset().mockResolvedValue([draft(undefined, 'human', 2), draft()]);
  vi.mocked(readModelDraftVersion).mockReset().mockResolvedValue(draft());
});
afterEach(() => { act(() => view?.unmount()); view = undefined; });

describe('draft recovery panel', () => {
  it('refreshes the head summary while retaining the selected historical versions', async () => {
    const restore = vi.fn();
    await act(async () => { view = create(createElement(Vibi3DDraftPanel, { projectId: '/project', refreshToken: 1, onRestore: restore })); });
    await act(async () => { button('versions').props.onClick(); });
    const history = view!.root.findByType('ol').findAllByType('span').map(node => node.children);
    const refresh = deferred<Awaited<ReturnType<typeof listModelDrafts>>>();
    vi.mocked(listModelDrafts).mockReturnValueOnce(refresh.promise);
    await act(async () => { view!.update(createElement(Vibi3DDraftPanel, { projectId: '/project', refreshToken: 2, onRestore: restore })); });
    expect(view!.root.findByType('ol').findAllByType('span').map(node => node.children)).toEqual(history);
    expect(versionText()).toContain('"version":1');
    await act(async () => { refresh.resolve({ drafts: [draft(undefined, 'human', 3)], failed: [] }); });
    expect(versionText()).toContain('"version":3');
    expect(view!.root.findByType('ol').findAllByType('span').map(node => node.children)).toEqual(history);
    expect(readModelDraftHistory).toHaveBeenCalledOnce();
  });

  it('allows an in-flight history read to finish across same-scope autosave updates', async () => {
    const pendingHistory = deferred<Awaited<ReturnType<typeof readModelDraftHistory>>>();
    vi.mocked(readModelDraftHistory).mockReturnValueOnce(pendingHistory.promise);
    const restore = vi.fn();
    await act(async () => { view = create(createElement(Vibi3DDraftPanel, { projectId: '/project', refreshToken: 1, onRestore: restore })); });
    await act(async () => { button('versions').props.onClick(); });
    await act(async () => { view!.update(createElement(Vibi3DDraftPanel, { projectId: '/project', refreshToken: 2, onRestore: restore })); });
    expect(button('versions').props.disabled).toBe(true);
    await act(async () => { pendingHistory.resolve([draft(undefined, 'human', 7)]); });
    expect(view!.root.findByType('ol').findByType('span').children.join('')).toContain('"version":7');
    expect(button('versions').props.disabled).toBe(false);
  });

  it('keeps a destructive confirmation locked and preserves its failure across automatic list refreshes', async () => {
    const agent = draft(undefined, 'agent');
    vi.mocked(listModelDrafts).mockResolvedValue({ drafts: [agent], failed: [] });
    vi.mocked(readModelDraftVersion).mockResolvedValue(agent);
    const confirmation = deferred<void>();
    const discard = vi.fn(() => confirmation.promise);
    const restore = vi.fn();
    const render = (refreshToken: number) => createElement(Vibi3DDraftPanel, { projectId: '/project', refreshToken, onRestore: restore, onDiscard: discard });
    await act(async () => { view = create(render(1)); });
    await act(async () => { button('discardAgent').props.onClick(); });
    expect(discard).toHaveBeenCalledOnce();
    await act(async () => { view!.update(render(2)); });
    expect(button('discardAgent').props.disabled).toBe(true);
    // A repeated event from the old render cannot bypass the operation lock.
    await act(async () => { button('discardAgent').props.onClick(); });
    expect(readModelDraftVersion).toHaveBeenCalledOnce();
    await act(async () => { confirmation.reject(new Error('source changed during confirmation')); });
    expect(button('discardAgent').props.disabled).toBe(false);
    await act(async () => { view!.update(render(3)); });
    expect(view!.root.findByProps({ role: 'alert' }).children).toContain('panel.vibi3d.drafts.loadFailed');
  });

  it('does not replace a newer same-scope list with an older request that completed late', async () => {
    const old = deferred<Awaited<ReturnType<typeof listModelDrafts>>>();
    const fresh = deferred<Awaited<ReturnType<typeof listModelDrafts>>>();
    const restore = vi.fn();
    await act(async () => { view = create(createElement(Vibi3DDraftPanel, { projectId: '/project', refreshToken: 1, onRestore: restore })); });
    vi.mocked(listModelDrafts).mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    await act(async () => { view!.update(createElement(Vibi3DDraftPanel, { projectId: '/project', refreshToken: 2, onRestore: restore })); });
    await act(async () => { view!.update(createElement(Vibi3DDraftPanel, { projectId: '/project', refreshToken: 3, onRestore: restore })); });
    await act(async () => { fresh.resolve({ drafts: [draft(undefined, 'human', 3)], failed: [] }); });
    await act(async () => { old.resolve({ drafts: [draft(undefined, 'human', 2)], failed: ['old error'] }); });
    expect(versionText()).toContain('"version":3');
    expect(versionText()).not.toContain('"version":2');
    expect(JSON.stringify(view!.toJSON())).not.toContain('panel.vibi3d.drafts.partial');
  });

  it('invalidates a pending restore on active-editor scope change without filtering the project list', async () => {
    const version = deferred<Vibi3DDraft>();
    vi.mocked(readModelDraftVersion).mockReturnValueOnce(version.promise);
    const restore = vi.fn();
    const render = (scopeKey: string) => createElement(Vibi3DDraftPanel, { projectId: '/project', scopeKey, onRestore: restore });
    await act(async () => { view = create(render('editor-a')); });
    await act(async () => { button('restore').props.onClick(); });
    await act(async () => { view!.update(render('editor-b')); });
    await act(async () => { version.resolve(draft()); });
    expect(restore).not.toHaveBeenCalled();
    expect(button('restore').props.disabled).toBe(false);
    expect(JSON.stringify(view!.toJSON())).toContain('doc:model');
  });

  it('refuses a mismatched version response before invoking a destructive callback', async () => {
    vi.mocked(listModelDrafts).mockResolvedValue({ drafts: [draft(undefined, 'agent')], failed: [] });
    vi.mocked(readModelDraftVersion).mockResolvedValue(draft(undefined, 'human'));
    const discard = vi.fn();
    await act(async () => { view = create(createElement(Vibi3DDraftPanel, { projectId: '/project', onRestore: vi.fn(), onDiscard: discard })); });
    await act(async () => { button('discardAgent').props.onClick(); });
    expect(discard).not.toHaveBeenCalled();
    expect(view!.root.findByProps({ role: 'alert' }).children).toContain('panel.vibi3d.drafts.loadFailed');
  });

  it('offers AI deletion without conflating it with reverting human edits', async () => {
    vi.mocked(listModelDrafts).mockResolvedValueOnce({ drafts: [draft(), draft(undefined, 'agent')], failed: [] });
    await act(async () => { view = create(createElement(Vibi3DDraftPanel, { projectId: '/project', onRestore: vi.fn(), onDiscard: vi.fn() })); });
    expect(button('discardAgent')).toBeDefined();
    expect(button('discardHuman')).toBeUndefined();
  });
  it('cannot display drafts from a project whose read completed after switching project', async () => {
    let finish!: (value: Awaited<ReturnType<typeof listModelDrafts>>) => void;
    vi.mocked(listModelDrafts).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }))
      .mockResolvedValueOnce({ drafts: [draft('doc:new')], failed: [] });
    await act(async () => { view = create(createElement(Vibi3DDraftPanel, { projectId: 'old', onRestore: vi.fn() })); });
    await act(async () => { view!.update(createElement(Vibi3DDraftPanel, { projectId: 'new', onRestore: vi.fn() })); });
    await act(async () => { finish({ drafts: [draft('doc:old')], failed: [] }); });
    const text = JSON.stringify(view!.toJSON());
    expect(text).toContain('doc:new');
    expect(text).not.toContain('doc:old');
  });

  it('loads a selected saved version without writing or applying it and gives ownership to the restore callback', async () => {
    const restore = vi.fn();
    await act(async () => { view = create(createElement(Vibi3DDraftPanel, { projectId: '/project', onRestore: restore })); });
    await act(async () => { button('versions').props.onClick(); });
    expect(readModelDraftHistory).toHaveBeenCalledWith({ projectId: '/project', key: 'doc:model', actor: 'human' });
    const restores = view!.root.findAllByType('button').filter(node => node.children.includes('panel.vibi3d.drafts.restore'));
    vi.mocked(readModelDraftVersion).mockResolvedValueOnce(draft(undefined, 'human', 2));
    await act(async () => { restores[1]!.props.onClick(); });
    expect(readModelDraftVersion).toHaveBeenCalledWith({ projectId: '/project', key: 'doc:model', actor: 'human' }, 2);
    expect(restore).toHaveBeenCalledWith(draft(undefined, 'human', 2));
  });

  it('ignores a late version read after the selected project changed', async () => {
    let finish!: (value: Vibi3DDraft) => void;
    vi.mocked(readModelDraftVersion).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const restore = vi.fn();
    await act(async () => { view = create(createElement(Vibi3DDraftPanel, { projectId: 'old', onRestore: restore })); });
    await act(async () => { button('restore').props.onClick(); });
    await act(async () => { view!.update(createElement(Vibi3DDraftPanel, { projectId: 'new', onRestore: restore })); });
    await act(async () => { finish(draft()); });
    expect(restore).not.toHaveBeenCalled();
  });

  it('keeps the recovery list and shows an error when restore fails', async () => {
    await act(async () => { view = create(createElement(Vibi3DDraftPanel, {
      projectId: '/project', onRestore: vi.fn().mockRejectedValue(new Error('failed')),
    })); });
    await act(async () => { button('restore').props.onClick(); });
    expect(JSON.stringify(view!.toJSON())).toContain('doc:model');
    expect(view!.root.findByProps({ role: 'alert' }).children).toContain('panel.vibi3d.drafts.loadFailed');
    expect(button('restore').props.disabled).toBe(false);
  });

  it('offers retry only after failure and does not label pending work as saved', async () => {
    const retry = vi.fn();
    await act(async () => { view = create(createElement(Vibi3DDraftStatus, {
      state: { status: 'pending', version: 1, editVersion: 2, savedEditVersion: 1 }, onRetry: retry,
    })); });
    expect(JSON.stringify(view!.toJSON())).toContain('panel.vibi3d.drafts.saving');
    expect(view!.root.findAllByType('button')).toHaveLength(0);
    await act(async () => { view!.update(createElement(Vibi3DDraftStatus, {
      state: { status: 'error', version: 1, editVersion: 2, savedEditVersion: 1 }, onRetry: retry,
    })); });
    act(() => { button('retry').props.onClick(); });
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
