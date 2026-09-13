import { afterEach, expect, it, vi } from 'vitest';
import { loadStreamImage } from './streamImageResource.js';

afterEach(() => vi.unstubAllGlobals());
it('loads image bytes through the application fetch bridge', async () => {
  const blob = new Blob(['image'], { type: 'image/png' });
  const fetcher = vi.fn().mockResolvedValue({ ok: true, blob: async () => blob });
  vi.stubGlobal('fetch', fetcher);
  expect(await loadStreamImage('/api/codex-image/a/s/e')).toBe(blob);
  expect(fetcher).toHaveBeenCalledWith('/api/codex-image/a/s/e');
});
it('rejects missing images instead of trying to display the error response', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
  await expect(loadStreamImage('/api/codex-image/a/s/missing')).rejects.toThrow('HTTP 404');
});
