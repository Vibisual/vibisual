import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCommandAppIconCache } from './commandAppIcon.js';

const PNG = 'data:image/png;base64,aGVsbG8=';
afterEach(() => { vi.useRealTimers(); });

describe('command app icon cache', () => {
  it('shares concurrent requests and bounds remembered entries with LRU eviction', async () => {
    const fetchIcon = vi.fn(async () => PNG);
    const get = createCommandAppIconCache(fetchIcon);
    expect(await Promise.all([get('app'), get('app')])).toEqual([PNG, PNG]);
    expect(fetchIcon).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 64; i++) await get(`app-${i}`);
    await get('app');
    expect(fetchIcon).toHaveBeenCalledTimes(66);
  });

  it('bounds simultaneous requests without retaining a queue', async () => {
    let resolve: (value: string | null) => void = () => {};
    const wait = new Promise<string | null>((done) => { resolve = done; });
    const fetchIcon = vi.fn(() => wait);
    const get = createCommandAppIconCache(fetchIcon);
    const requests = Array.from({ length: 32 }, (_, i) => get(`app-${i}`));
    expect(await get('overflow')).toBe(null);
    expect(fetchIcon).toHaveBeenCalledTimes(32);
    resolve(PNG);
    await Promise.all(requests);
    expect(await get('overflow')).toBe(PNG);
    expect(fetchIcon).toHaveBeenCalledTimes(33);
  });

  it('bounds cached data bytes even when fewer than 64 valid icons fill the budget', async () => {
    const fetchIcon = vi.fn(async () => `data:image/png;base64,${'a'.repeat(33 * 1024)}`);
    const get = createCommandAppIconCache(fetchIcon);
    for (let i = 0; i < 35; i++) expect(await get(`app-${i}`)).not.toBe(null);
    await get('app-0');
    expect(fetchIcon).toHaveBeenCalledTimes(36);
  });

  it('peeks a live answer synchronously — including "no icon" — and forgets it with its TTL', async () => {
    vi.useFakeTimers();
    const fetchIcon = vi.fn().mockResolvedValueOnce(PNG).mockResolvedValueOnce(null);
    const get = createCommandAppIconCache(fetchIcon);
    expect(get.peek('app')).toBeUndefined();
    await get('app');
    await get('none');
    expect(get.peek('app')).toBe(PNG);
    expect(get.peek('none')).toBeNull();
    vi.advanceTimersByTime(30_001);
    expect(get.peek('none')).toBeUndefined();
    expect(get.peek('app')).toBe(PNG);
    vi.advanceTimersByTime(300_000);
    expect(get.peek('app')).toBeUndefined();
  });

  it('accepts SVG data from Linux icon themes but no other image types', async () => {
    const svg = 'data:image/svg+xml;base64,PHN2Zy8+';
    const fetchIcon = vi.fn().mockResolvedValueOnce(svg).mockResolvedValueOnce('data:text/html;base64,PGgxPg==');
    const get = createCommandAppIconCache(fetchIcon);
    expect(await get('svg')).toBe(svg);
    expect(await get('html')).toBeNull();
  });

  it('rejects external or oversized images and retries missing icons after the short TTL', async () => {
    vi.useFakeTimers();
    const fetchIcon = vi.fn().mockResolvedValueOnce('https://example.invalid/icon.png').mockResolvedValueOnce(PNG).mockResolvedValueOnce(`data:image/png;base64,${'a'.repeat(128 * 1024)}`);
    const get = createCommandAppIconCache(fetchIcon);
    expect(await get('app')).toBe(null);
    expect(await get('app')).toBe(null);
    expect(fetchIcon).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30_001);
    expect(await get('app')).toBe(PNG);
    expect(await get('large')).toBe(null);
  });
});
