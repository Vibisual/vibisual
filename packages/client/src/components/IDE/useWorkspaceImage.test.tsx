import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceImage, type WorkspaceImageResult } from './useWorkspaceImage.js';
import { putWorkspaceImage } from './workspaceImageSave.js';

let view: ReactTestRenderer | undefined;
let image: WorkspaceImageResult;
const snapshots: WorkspaceImageResult[] = [];
const fetchMock = vi.fn<typeof fetch>();
function Probe({ root, path = 'same.png', token = 10 }: { root: string; path?: string; token?: number }): null {
  image = useWorkspaceImage(root, path, token); snapshots.push(image); return null;
}
async function render(root: string, token = 10): Promise<void> {
  await act(async () => { if (view) view.update(<Probe root={root} token={token} />); else view = create(<Probe root={root} token={token} />); });
}
function response(revision: string, mtime = 10): Response {
  return new Response('pixels', { headers: { 'X-Workspace-Revision': revision, 'X-Workspace-Mtime': String(mtime) } });
}
beforeEach(() => {
  fetchMock.mockReset(); snapshots.length = 0; vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:image');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});
afterEach(async () => { await act(async () => { view?.unmount(); }); view = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('workspace image byte revision and request scope', () => {
  it('saves against the bytes displayed and sends no revision on explicit force', async () => {
    fetchMock.mockResolvedValueOnce(response('sha256:visible', 123));
    await render('/a');
    expect(image).toMatchObject({ url: 'blob:image', revision: 'sha256:visible', mtimeMs: 123 });
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 409 }));
    expect(await putWorkspaceImage('/a', 'same.png', new Blob(), image.mtimeMs!, image.revision)).toEqual({ ok: false, status: 409 });
    const target = new URL(String(fetchMock.mock.calls.at(-1)?.[0]), 'http://test');
    expect(target.searchParams.get('baseRevision')).toBe('sha256:visible');
    expect(target.searchParams.get('baseMtimeMs')).toBe('123');
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ mtimeMs: 124, revision: 'new' })));
    await putWorkspaceImage('/a', 'same.png', new Blob(), 0, image.revision);
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).not.toContain('baseRevision');
  });

  it('a new root never renders the old root image, even before effects run', async () => {
    fetchMock.mockResolvedValueOnce(response('a'));
    await render('/a');
    const first = snapshots.length;
    fetchMock.mockReturnValueOnce(new Promise(() => {}));
    await render('/b');
    expect(snapshots.slice(first).every((s) => s.url === null)).toBe(true);
  });

  it('an old delayed image cannot replace the current project image', async () => {
    let resolve!: (r: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise((done) => { resolve = done; })).mockResolvedValueOnce(response('b', 20));
    await render('/a'); await render('/b');
    await act(async () => { resolve(response('a')); });
    expect(image).toMatchObject({ revision: 'b', mtimeMs: 20 });
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });
});
