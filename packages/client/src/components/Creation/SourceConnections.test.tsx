import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CreationDoc, CreationLink } from '@vibisual/shared';
import { SourceConnections, linkState } from './SourceConnections.js';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../apps/appWindows.js', () => ({ openAppWindow: vi.fn() }));
vi.mock('../../apps/registry.js', () => ({ getInternalApp: () => ({}) }));
let view: ReactTestRenderer | undefined;
afterEach(() => { act(() => view?.unmount()); view = undefined; vi.unstubAllGlobals(); });

const link: CreationLink = { id: 'link', sourceId: 'model', sourceRevision: 1, role: 'image', targets: ['product'] };
const doc: CreationDoc = {
  schemaVersion: 1, id: 'a', appId: 'vibimage', title: 'A', revision: 1, payload: {}, parameters: {}, lockedPaths: [], createdAt: 1, updatedAt: 1,
  label: '', author: 'user', links: [link],
};
interface Server { latest: number; failImpacts?: boolean; keep?: (body: { revision: number | null }) => Promise<Response> | Response }
function serve(server: Server): void {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const json = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), { status });
    if (init?.method === 'POST' && url.includes('/keep')) return server.keep!(JSON.parse(String(init.body)) as { revision: number | null });
    if (url.includes('/head')) return json({ head: { id: 'a', appId: 'vibimage', revision: 1, updatedAt: 1, candidateStamp: 0, pendingCandidates: 0 } });
    if (url.includes('/impact')) return server.failImpacts ? json({ error: 'source-unreadable' }, 500) : json({ impacts: [] });
    if (url.includes('/outputs')) return json({ outputs: [] });
    if (url.includes('/history')) return json({ revisions: [] });
    return json({ docs: [{ ...doc, id: 'model', appId: 'vibi3d', title: 'Model', revision: server.latest, links: [] }], failed: [] });
  }));
}
const texts = (): string[] => view!.root.findAll((node) => typeof node.type === 'string').flatMap((node) => node.children.filter((c): c is string => typeof c === 'string'));
const button = (label: string) => view!.root.findAllByType('button').find((item) => item.children.join('') === label);
async function openPanel(props: Parameters<typeof SourceConnections>[0]): Promise<void> {
  await act(async () => { view = create(createElement(SourceConnections, props)); });
  await act(async () => { view!.root.findByType('details').props.onToggle({ currentTarget: { open: true } }); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

describe('linkState', () => {
  it('is current, available, or kept up to the reviewed revision', () => {
    expect(linkState({ sourceRevision: 2 }, 2)).toBe('current');
    expect(linkState({ sourceRevision: 1 }, 2)).toBe('available');
    expect(linkState({ sourceRevision: 1, keptRevision: 2 }, 2)).toBe('kept');
    expect(linkState({ sourceRevision: 1, keptRevision: 2 }, 3)).toBe('available');
  });
});

describe('SourceConnections', () => {
  it('reads nothing until the panel is opened', async () => {
    serve({ latest: 2 });
    await act(async () => { view = create(createElement(SourceConnections, { projectId: 'project', doc })); });
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('(6) keep → the notice folds into "keeping" → a newer source revision notifies again → keep can be withdrawn', async () => {
    let keptBody: { revision: number | null } | null = null;
    const server: Server = { latest: 2, keep: (body) => { keptBody = body; return new Response(JSON.stringify({ doc: { ...doc, links: [{ ...link, ...(body.revision ? { keptRevision: body.revision } : {}) }] } }), { status: 200 }); } };
    serve(server);
    const onDoc = vi.fn();
    await openPanel({ projectId: 'project', doc, onDoc });
    expect(texts()).toContain('panel.creation.updateAvailable');
    await act(async () => { button('panel.creation.keep')!.props.onClick(); });
    expect(keptBody).toMatchObject({ revision: 2 });
    const kept = onDoc.mock.calls.at(-1)![0] as CreationDoc;
    expect(kept.links[0]!.keptRevision).toBe(2);
    await act(async () => { view!.update(createElement(SourceConnections, { projectId: 'project', doc: kept, onDoc })); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(texts()).toContain('panel.creation.kept');
    expect(texts()).not.toContain('panel.creation.updateAvailable');
    // The source moves on: the decision covered revision 2 only.
    server.latest = 3;
    await act(async () => { button('panel.gitStatus.refresh')!.props.onClick(); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(texts()).toContain('panel.creation.updateAvailable');
    server.latest = 2;
    await act(async () => { button('panel.gitStatus.refresh')!.props.onClick(); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    await act(async () => { button('panel.creation.unkeep')!.props.onClick(); });
    expect(keptBody).toMatchObject({ revision: null });
  });

  it('shows the other sections when one list fails to load', async () => {
    serve({ latest: 2, failImpacts: true });
    await openPanel({ projectId: 'project', doc });
    expect(texts()).toContain('panel.creation.updateAvailable');
    expect(texts()).toContain('panel.creation.sectionFailed');
  });

  it('does not apply a delayed keep-version response to a newly opened source', async () => {
    let resolve!: (response: Response) => void;
    serve({ latest: 2, keep: () => new Promise<Response>((done) => { resolve = done; }) });
    const onDoc = vi.fn();
    await openPanel({ projectId: 'project', doc, onDoc });
    await act(async () => { button('panel.creation.keep')!.props.onClick(); });
    await act(async () => { view!.update(createElement(SourceConnections, { projectId: 'project', doc: { ...doc, id: 'b' }, onDoc })); });
    await act(async () => { resolve(new Response(JSON.stringify({ doc: { ...doc, revision: 2 } }), { status: 200 })); });
    expect(onDoc).not.toHaveBeenCalled();
  });
});
