import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { completeRenderJob, completeStillJob, importVideoAsset, openRenderOutputStream, openSegmentStore, reportJob } from './videoApi.js';

vi.mock('../../i18n/index.js', () => ({ default: { t: (_key: string, vars: { status: number }) => `Request failed (${vars.status})` } }));
const request = vi.fn<typeof fetch>();
beforeEach(() => { request.mockReset(); request.mockImplementation(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })); vi.stubGlobal('fetch', request); });
afterEach(() => vi.unstubAllGlobals());
describe('Studio binary transport', () => {
  it('sends render bytes as binary after small metadata instead of base64 JSON', async () => {
    const bytes = new Uint8Array(256 * 1024).fill(7);
    await completeRenderJob('job/test', bytes, 'note');
    expect(request).toHaveBeenCalledTimes(2);
    expect(JSON.parse(request.mock.calls[0]![1]!.body as string)).toEqual({ note: 'note' });
    const [url, options] = request.mock.calls[1]!;
    expect(url).toBe('/api/app/vibistudio/job/job%2Ftest/output');
    expect(options?.method).toBe('PUT');
    expect(options?.headers).toEqual({ 'Content-Type': 'application/octet-stream' });
    const body = options?.body as Blob;
    expect(new Uint8Array(await body.arrayBuffer())).toEqual(bytes);
  });
  it('converts a still to raw PNG bytes for the output route', async () => {
    request.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])));
    await completeStillJob('still', 'data:image/png;base64,AQID');
    expect(request.mock.calls[1]?.[0]).toBe('/api/app/vibistudio/job/still/output');
    expect(new Uint8Array(await (request.mock.calls[1]![1]!.body as Blob).arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });
  it('surfaces progress/save failures instead of silently reporting success', async () => {
    request.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'disk full' }), { status: 500 }));
    await expect(reportJob('job', { status: 'done' })).rejects.toThrow('disk full');
  });
  it('drops the streamed render output through the job output route', async () => {
    await openRenderOutputStream('job/test').reset();
    expect(request.mock.calls[0]?.[0]).toBe('/api/app/vibistudio/job/job%2Ftest/output');
    expect(request.mock.calls[0]?.[1]?.method).toBe('DELETE');
    request.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'output upload already in progress' }), { status: 409 }));
    await expect(openRenderOutputStream('job').reset()).rejects.toThrow('output upload already in progress');
  });
  it('reads the render segment cache through the worker-only routes', async () => {
    const key = 'ab'.repeat(32);
    const store = openSegmentStore('my project', 'doc/1');
    const base = '/api/app/vibistudio/doc/doc%2F1/render-cache';

    request.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, files: { pic: '9:1' }, shared: 'abc' }), { status: 200 }));
    expect(await store.env()).toEqual({ files: { pic: '9:1' }, shared: 'abc' });
    expect(request.mock.calls[0]?.[0]).toBe(`${base}/env`);
    expect(JSON.parse(request.mock.calls[0]![1]!.body as string)).toEqual({ project: 'my project' });

    request.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, have: [key] }), { status: 200 }));
    expect([...await store.has([key, 'cd'.repeat(32)])]).toEqual([key]);
    expect(JSON.parse(request.mock.calls[1]![1]!.body as string)).toEqual({ project: 'my project', keys: [key, 'cd'.repeat(32)] });
    expect((await store.has([])).size).toBe(0);
    expect(request).toHaveBeenCalledTimes(2);

    request.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    expect([...(await store.get(key))!]).toEqual([1, 2, 3]);
    expect(request.mock.calls[2]?.[0]).toBe(`${base}/${key}?project=my%20project`);
    request.mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, error: 'no segment' }), { status: 404 }));
    expect(await store.get(key)).toBeNull();

    await store.put(key, new Uint8Array([7, 8]));
    const [url, options] = request.mock.calls[4]!;
    expect(url).toBe(`${base}/${key}?project=my%20project`);
    expect(options?.method).toBe('PUT');
    expect(options?.headers).toEqual({ 'Content-Type': 'application/octet-stream' });
    expect([...new Uint8Array(await (options?.body as Blob).arrayBuffer())]).toEqual([7, 8]);
    request.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'renderer-only' }), { status: 403 }));
    await expect(store.put(key, new Uint8Array([1]))).rejects.toThrow('renderer-only');
  });
  it('reports HTTP failures even when a body-limit handler returns HTML', async () => {
    request.mockResolvedValueOnce(new Response('<html>Too large</html>', { status: 413 }));
    await expect(importVideoAsset('project', new File(['x'], 'test.mp4'))).rejects.toThrow('413');
  });
});
