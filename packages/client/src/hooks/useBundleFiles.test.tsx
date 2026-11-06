import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BubbleData } from '@vibisual/shared';
import type { InteriorView } from '../stores/graphStore.js';
import { useBundleFiles } from './useBundleFiles.js';
import { useGraphStore } from '../stores/graphStore.js';

const bundle: InteriorView = { kind: 'bundle', bundleId: 'bundle-a', label: 'assets', memberIds: ['a'], folderId: 'folder', fileKind: 'image', totalCount: 240, source: 'folder' };
const file = (id: string, lastActivity = 1): BubbleData => ({ id, label: `${id}.png`, path: `assets/${id}.png`, bubbleType: 'file', status: 'idle', activity: 1, lastActivity });
const response = (items: BubbleData[], total = 240, page = 0): Response => new Response(JSON.stringify({ items, total, page }));
let renderer: ReactTestRenderer | undefined;
let current: ReturnType<typeof useBundleFiles>;
function Probe({ view = bundle, page = 0, fallback = [file('a')] }: { view?: InteriorView; page?: number; fallback?: BubbleData[] }): null {
  current = useBundleFiles(view, page, '/project', fallback);
  return null;
}
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); });

describe('useBundleFiles', () => {
  it('omits unknown legacy session IDs and uses only one server page for layout', async () => {
    const fetch = vi.fn().mockResolvedValue(response([file('server')]));
    vi.stubGlobal('fetch', fetch);
    await act(async () => { renderer = create(<Probe />); });
    const query = new URL(fetch.mock.calls[0]![0], 'http://localhost').searchParams;
    expect(query.has('sessionId')).toBe(false);
    expect(query.get('absolutePath')).toBe('/project');
    expect(current.members.map((n) => n.id)).toEqual(['server']);
    expect(current.total).toBe(240);
    expect(current.layoutPage).toBe(0);
    expect(useGraphStore.getState().bundlePageNodes.server?.id).toBe('server');
    await act(async () => { renderer!.update(<Probe view={{ kind: 'trash' }} />); });
    expect(useGraphStore.getState().bundlePageNodes).toEqual({});
  });

  it('ignores a previous page response after navigation', async () => {
    const resolvers: Array<(response: Response) => void> = [];
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => resolvers.push(resolve))));
    await act(async () => { renderer = create(<Probe />); });
    await act(async () => { renderer!.update(<Probe page={1} />); });
    await act(async () => resolvers[1]!(response([file('second')], 240, 1)));
    await act(async () => resolvers[0]!(response([file('stale')])));
    expect(current.members.map((n) => n.id)).toEqual(['second']);
  });

  it('keeps an exact folder fallback separate from project scope and never widens failed queries', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('', { status: 404 }));
    vi.stubGlobal('fetch', fetch);
    await act(async () => { renderer = create(<Probe view={{ ...bundle, folderId: '', folderAbsolutePath: '/project/deep/assets', sessionId: 'session-a' }} />); });
    const query = new URL(fetch.mock.calls[0]![0], 'http://localhost').searchParams;
    expect(query.get('folderId')).toBe('');
    expect(query.get('absolutePath')).toBe('/project');
    expect(query.get('folderAbsolutePath')).toBe('/project/deep/assets');
    expect(query.get('sessionId')).toBe('session-a');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(current.failed).toBe(true);
    expect(current.members.map((node) => node.id)).toEqual(['a']);
  });

  it('refreshes changed representatives without fetching on unrelated rerenders', async () => {
    const fetch = vi.fn().mockImplementation(async () => response([file('server')]));
    vi.stubGlobal('fetch', fetch);
    await act(async () => { renderer = create(<Probe fallback={[file('a')]} />); });
    await act(async () => { renderer!.update(<Probe fallback={[file('a')]} />); });
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => { renderer!.update(<Probe fallback={[file('a', 2), file('b')]} />); });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('rejects malformed page metadata and supports retry', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response([file('bad')], 240, 0.5)).mockResolvedValueOnce(response([file('good')]));
    vi.stubGlobal('fetch', fetch);
    await act(async () => { renderer = create(<Probe />); });
    expect(current.failed).toBe(true);
    await act(async () => current.retry());
    expect(current.failed).toBe(false);
    expect(current.members.map((n) => n.id)).toEqual(['good']);
  });

  it('loads only the exact numbered sequence IDs for the requested page', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [file('frame-120')] })));
    vi.stubGlobal('fetch', fetch);
    const sequence: InteriorView = { ...bundle, source: 'sequence', memberIds: Array.from({ length: 127 }, (_, i) => `frame-${i}`), sessionId: 'session-a' };
    await act(async () => { renderer = create(<Probe view={sequence} page={1} />); });
    expect(fetch.mock.calls[0]![0]).toBe('/api/bundle-files');
    const body = JSON.parse(fetch.mock.calls[0]![1].body);
    expect(body.ids).toEqual(sequence.memberIds.slice(120));
    expect(body).toMatchObject({ kind: 'image', sessionId: 'session-a', absolutePath: '/project' });
    expect(current.total).toBe(127);
    expect(current.members.map((node) => node.id)).toEqual(['frame-120']);
    expect(current.layoutPage).toBe(0);
  });
});
