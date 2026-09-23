import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEditorDocs, type EditorDocsApi } from './useEditorDocs.js';

let view: ReactTestRenderer | undefined;
let api: EditorDocsApi;
const fetchMock = vi.fn<typeof fetch>();
function Probe({ root }: { root: string }): null { api = useEditorDocs(root); return null; }
async function render(root = '/project'): Promise<void> {
  await act(async () => {
    if (view) view.update(<Probe root={root} />);
    else view = create(<Probe root={root} />);
  });
}
function pending() {
  let resolve!: (r: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, reply: (body: unknown, status = 200) => resolve(new Response(JSON.stringify(body), { status })) };
}
function file(text: string, mtimeMs = 10) {
  return { text, mtimeMs, revision: `rev-${text}`, size: text.length, eol: 'lf', truncated: false, binary: false, image: false, readOnly: false };
}
async function loaded(): Promise<void> {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(file('disk'))));
  await render();
  await act(async () => { api.ensureLoaded('a.txt'); });
}
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
afterEach(async () => { await act(async () => { view?.unmount(); }); view = undefined; vi.unstubAllGlobals(); });

describe('editor request ownership and drafts', () => {
  it('a superseded load cannot replace a newer reload', async () => {
    const old = pending(); const fresh = pending();
    fetchMock.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    await render();
    act(() => { api.ensureLoaded('a.txt'); });
    act(() => { api.reload('a.txt'); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => { fresh.reply(file('fresh')); });
    act(() => { api.setDraft('a.txt', 'fresh draft'); });
    await act(async () => { old.reply(file('old')); });
    expect(api.docs['a.txt']?.draft).toBe('fresh draft');
  });

  it('a closed load cannot replace a reopened file', async () => {
    const old = pending(); const fresh = pending();
    fetchMock.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    await render();
    act(() => { api.ensureLoaded('a.txt'); });
    act(() => { api.drop('a.txt'); api.ensureLoaded('a.txt'); });
    await act(async () => { fresh.reply(file('fresh')); });
    await act(async () => { old.reply(file('old')); });
    expect(api.docs['a.txt']?.draft).toBe('fresh');
  });

  it('a save completion cannot change a reloaded document', async () => {
    await loaded();
    const save = pending();
    fetchMock.mockReturnValueOnce(save.promise).mockResolvedValueOnce(new Response(JSON.stringify(file('external', 30))));
    act(() => { api.setDraft('a.txt', 'submitted'); });
    act(() => { api.save('a.txt'); });
    await act(async () => { api.reload('a.txt'); });
    await act(async () => { save.reply({ mtimeMs: 20, size: 9, readOnly: false }); });
    expect(api.docs['a.txt']).toMatchObject({ draft: 'external', diskText: 'external', mtimeMs: 30 });
  });

  it('coalesces two save invocations before React renders', async () => {
    await loaded(); const save = pending(); fetchMock.mockReturnValue(save.promise);
    act(() => { api.setDraft('a.txt', 'submitted'); });
    act(() => { api.save('a.txt'); api.save('a.txt'); });
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1);
    await act(async () => { save.reply({ mtimeMs: 20, size: 9, readOnly: false }); });
  });

  it('preserves typing during a save and uses the newly acknowledged revision for the next save', async () => {
    await loaded(); const save = pending(); fetchMock.mockReturnValueOnce(save.promise);
    act(() => { api.setDraft('a.txt', 'submitted'); });
    act(() => { api.save('a.txt'); });
    expect(JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body))).toMatchObject({ baseRevision: 'rev-disk', text: 'submitted' });
    act(() => { api.setDraft('a.txt', 'still typing'); });
    await act(async () => { save.reply({ mtimeMs: 20, revision: 'rev-saved', size: 9, readOnly: false }); });
    expect(api.docs['a.txt']).toMatchObject({ draft: 'still typing', diskText: 'submitted', saving: false });
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 409 }));
    await act(async () => { api.save('a.txt'); });
    expect(JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body))).toMatchObject({ baseRevision: 'rev-saved', text: 'still typing' });
    expect(api.docs['a.txt']).toMatchObject({ draft: 'still typing', conflict: true, saving: false });
  });

  it('project switching keeps same-path drafts and delayed failures isolated', async () => {
    await loaded(); const save = pending(); fetchMock.mockReturnValueOnce(save.promise);
    act(() => { api.setDraft('a.txt', 'project A'); });
    act(() => { api.save('a.txt'); });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(file('project B'))));
    await render('/other');
    await act(async () => { api.ensureLoaded('a.txt'); });
    await act(async () => { save.reply({}, 409); });
    expect(api.docs['a.txt']).toMatchObject({ draft: 'project B', conflict: false });
  });

  it('a late save failure cannot mark a reopened file as conflicted', async () => {
    await loaded(); const save = pending(); fetchMock.mockReturnValueOnce(save.promise);
    act(() => { api.setDraft('a.txt', 'submitted'); });
    act(() => { api.save('a.txt'); });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(file('reopened'))));
    await act(async () => { api.drop('a.txt'); api.ensureLoaded('a.txt'); });
    await act(async () => { save.reply({}, 409); });
    expect(api.docs['a.txt']).toMatchObject({ draft: 'reopened', conflict: false, saving: false });
  });

  it('force uses the explicit zero-mtime contract without an old revision', async () => {
    await loaded();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ mtimeMs: 20, revision: 'forced', size: 4, readOnly: false })));
    await act(async () => { api.save('a.txt', { force: true }); });
    const body = JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body));
    expect(body.baseMtimeMs).toBe(0);
    expect(body).not.toHaveProperty('baseRevision');
    expect(api.docs['a.txt']).toMatchObject({ saving: false, revision: 'forced' });
  });
});
