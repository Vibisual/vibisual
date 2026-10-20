import { afterEach, expect, it, vi } from 'vitest';
import { externalizeForSave, forgetKnownBlobs, resolveCreationBlobs } from './creationBlobs.js';

afterEach(() => { vi.unstubAllGlobals(); forgetKnownBlobs('tiny-art'); });
it('keeps ordinary small images inline but pins even a one-pixel graphic when its recipe needs a blob source', async () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXbkAAAAASUVORK5CYII=';
  let ref = '', bytes: ArrayBuffer | undefined;
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/missing')) {
      const names = JSON.parse(init!.body as string).names as string[]; ref = `vibi-blob:${names[0]}`;
      return Response.json({ missing: names });
    }
    if (init?.method === 'PUT') { bytes = await (init.body as Blob).arrayBuffer(); return Response.json({ ref }); }
    if (url.includes('/blobs/')) return new Response(bytes);
    throw new Error(url);
  });
  vi.stubGlobal('fetch', fetcher);
  expect(await externalizeForSave('tiny-art', png)).toBe(png); expect(fetcher).not.toHaveBeenCalled();
  const saved = await externalizeForSave('tiny-art', png, { stringMin: 0 });
  expect(saved).toMatch(/^vibi-blob:[a-f0-9]{64}\.png$/);
  expect(new Uint8Array(bytes!).slice(0, 8)).toEqual(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
  expect(await resolveCreationBlobs('tiny-art', saved)).toBe(png);
});
