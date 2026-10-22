import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCommandAppIconResolver, isCommandAppIconRenderer } from './commandAppIcon';
import { COMMAND_APP_ICON_LIMITS as LIMITS } from './commandAppIconConfig';
import type { IconImage, IconTarget } from './commandAppIconSource';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHZkAAAAASUVORK5CYII=', 'base64');

function fixture() {
  let time = 0;
  /** The per-OS reader is injected; these tests pin queueing, caching and what may reach the renderer. */
  const readIcon = vi.fn(async (_target: IconTarget): Promise<IconImage | null> => ({ mime: 'image/png', data: PNG }));
  const realpath = vi.fn(async (file: string): Promise<string> => file);
  const resolver = createCommandAppIconResolver({
    platform: 'win32', env: {}, knownDirs: [], readIcon, realpath,
    stat: async () => ({ isFile: () => true, mode: 0 }), now: () => time,
  });
  return { ...resolver, readIcon, realpath, advance: (ms: number): void => { time += ms; } };
}

const png = (data: Buffer): IconImage => ({ mime: 'image/png', data });

afterEach(() => { vi.useRealTimers(); });

describe('bounded command app icon cache', () => {
  it('deduplicates concurrent requests and equivalent Windows path keys', async () => {
    const cache = fixture();
    const first = cache.get('C:/Engine.exe');
    expect(cache.get('c:\\engine.exe')).toBe(first);
    expect(await first).toBe(`data:image/png;base64,${PNG.toString('base64')}`);
    expect(await cache.get('C:/Engine.exe')).toBe(await first);
    expect(cache.readIcon).toHaveBeenCalledTimes(1);
    cache.advance(LIMITS.positiveTtlMs + 1);
    await cache.get('C:/Engine.exe');
    expect(cache.readIcon).toHaveBeenCalledTimes(2);
    cache.dispose();
  });

  it('negative-caches failures for the shorter TTL and retries after expiration', async () => {
    const cache = fixture();
    cache.readIcon.mockRejectedValueOnce(new Error('unavailable'));
    expect(await cache.get('C:/Engine.exe')).toBeNull();
    expect(await cache.get('C:/Engine.exe')).toBeNull();
    expect(cache.readIcon).toHaveBeenCalledTimes(1);
    cache.advance(LIMITS.negativeTtlMs + 1);
    expect(await cache.get('C:/Engine.exe')).toMatch(/^data:image\/png;base64,/);
    expect(cache.readIcon).toHaveBeenCalledTimes(2);
    cache.dispose();
  });

  it('evicts the least recently used entry at the count limit', async () => {
    const cache = fixture();
    for (let i = 0; i < LIMITS.maxEntries; i += 1) await cache.get(`C:/app${i}.exe`);
    await cache.get('C:/app0.exe');
    await cache.get('C:/overflow.exe');
    await cache.get('C:/app0.exe');
    expect(cache.readIcon).toHaveBeenCalledTimes(LIMITS.maxEntries + 1);
    await cache.get('C:/app1.exe');
    expect(cache.readIcon).toHaveBeenCalledTimes(LIMITS.maxEntries + 2);
    cache.dispose();
  });

  it('evicts before the count limit when cached image bytes exceed the budget', async () => {
    const cache = fixture();
    const large = Buffer.alloc(LIMITS.maxImageBytes);
    PNG.copy(large);
    cache.readIcon.mockResolvedValue(png(large));
    const count = Math.ceil(LIMITS.maxCacheBytes / (large.toString('base64').length * 2)) + 1;
    expect(count).toBeLessThan(LIMITS.maxEntries);
    for (let i = 0; i < count; i += 1) await cache.get(`C:/app${i}.exe`);
    await cache.get('C:/app0.exe');
    expect(cache.readIcon).toHaveBeenCalledTimes(count + 1);
    cache.dispose();
  });

  it.each([
    null,
    png(Buffer.from('not png')),
    png(Buffer.alloc(LIMITS.maxImageBytes + 1)),
    { mime: 'image/svg+xml', data: Buffer.from('<svg onload="alert(1)"/>') } as const,
  ])('rejects absent, malformed, oversized and active results', async (result) => {
    const cache = fixture();
    cache.readIcon.mockResolvedValue(result);
    expect(await cache.get('C:/app.exe')).toBeNull();
    cache.dispose();
  });

  it('hands a plain SVG (Linux icon themes) to the renderer as a data URL', async () => {
    const cache = fixture();
    cache.readIcon.mockResolvedValue({ mime: 'image/svg+xml', data: Buffer.from('<svg viewBox="0 0 1 1"/>') });
    expect(await cache.get('C:/app.exe')).toMatch(/^data:image\/svg\+xml;base64,/);
    cache.dispose();
  });

  it('passes the verified real path and the command as written to the per-OS reader', async () => {
    const cache = fixture();
    cache.realpath.mockImplementation(async (file: string) => file.replace('Link', 'Real'));
    await cache.get('C:/Link/tool.exe');
    expect(cache.readIcon.mock.calls[0]![0]).toEqual({ file: 'C:\\Real\\tool.exe', command: 'C:\\Link\\tool.exe' });
    cache.dispose();
  });

  it('bounds native work to two requests and refuses overflow beyond the bounded queue', async () => {
    const cache = fixture();
    const releases: Array<(image: IconImage) => void> = [];
    cache.readIcon.mockImplementation(() => new Promise((resolve) => releases.push(resolve)));
    const requests = Array.from({ length: LIMITS.maxConcurrent + LIMITS.maxQueued }, (_, i) => cache.get(`C:/app${i}.exe`));
    await vi.waitFor(() => expect(cache.readIcon).toHaveBeenCalledTimes(LIMITS.maxConcurrent));
    expect(await cache.get('C:/overflow.exe')).toBeNull();
    expect(cache.get('C:/app0.exe')).toBe(requests[0]);
    releases[0]!(png(PNG));
    await requests[0];
    await vi.waitFor(() => expect(cache.readIcon).toHaveBeenCalledTimes(LIMITS.maxConcurrent + 1));
    cache.dispose();
    expect(await Promise.all(requests.slice(1))).toEqual(Array(requests.length - 1).fill(null));
    releases.slice(1).forEach((release) => release(png(PNG)));
  });

  it('times out queued/active callers without releasing an unfinished native slot', async () => {
    vi.useFakeTimers();
    const cache = fixture();
    const releases: Array<(image: IconImage) => void> = [];
    cache.readIcon.mockImplementation(() => new Promise((resolve) => releases.push(resolve)));
    const requests = [cache.get('C:/one.exe'), cache.get('C:/two.exe'), cache.get('C:/queued.exe')];
    await vi.advanceTimersByTimeAsync(0);
    expect(cache.readIcon).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(LIMITS.requestTimeoutMs);
    expect(await Promise.all(requests)).toEqual([null, null, null]);
    const later = cache.get('C:/later.exe');
    await vi.advanceTimersByTimeAsync(0);
    expect(cache.readIcon).toHaveBeenCalledTimes(2);
    releases[0]!(png(PNG));
    await vi.advanceTimersByTimeAsync(0);
    expect(cache.readIcon).toHaveBeenCalledTimes(3);
    cache.dispose();
    expect(await later).toBeNull();
    releases.slice(1).forEach((release) => release(png(PNG)));
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does no filesystem work for invalid or disposed requests', async () => {
    const cache = fixture();
    expect(await cache.get({ path: 'C:/app.exe' })).toBeNull();
    expect(await cache.get('//server/app.exe')).toBeNull();
    cache.dispose();
    expect(await cache.get('C:/app.exe')).toBeNull();
    expect(cache.realpath).not.toHaveBeenCalled();
  });
});

describe('command icon IPC sender boundary', () => {
  it.each([
    ['win32', 'file:///C:/app/renderer/index.html#project=1', 'C:\\app\\renderer\\index.html'],
    ['darwin', 'file:///Applications/Vibisual/renderer/index.html', '/Applications/Vibisual/renderer/index.html'],
    ['linux', 'file:///opt/vibisual/renderer/index.html', '/opt/vibisual/renderer/index.html'],
  ] as const)('allows only the application main frame on %s', (platform, url, file) => {
    const frame: { url: string } = { url };
    const event = { sender: { isDestroyed: () => false, mainFrame: frame }, senderFrame: frame };
    expect(isCommandAppIconRenderer(event, file, platform)).toBe(true);
    expect(isCommandAppIconRenderer({ ...event, senderFrame: { url } }, file, platform)).toBe(false);
    expect(isCommandAppIconRenderer({ ...event, senderFrame: null }, file, platform)).toBe(false);
    expect(isCommandAppIconRenderer(event, `${file}.other`, platform)).toBe(false);
    frame.url = 'https://example.test/renderer/index.html';
    expect(isCommandAppIconRenderer(event, file, platform)).toBe(false);
  });
});
