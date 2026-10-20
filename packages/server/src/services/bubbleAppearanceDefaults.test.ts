import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BUBBLE_SKINS,
  BUBBLE_EDGE_STYLES,
  DEFAULT_BUBBLE_SKIN,
  DEFAULT_BUBBLE_EDGE_STYLE,
  resolveBubbleSkin,
  resolveBubbleEdgeStyle,
} from '@vibisual/shared';
import type { UserDefaultsPatch } from '@vibisual/shared';

// Exercise the real persistence service while keeping every read/write in memory.
const disk = vi.hoisted(() => ({ raw: undefined as string | undefined, temporary: undefined as string | undefined }));
const io = vi.hoisted(() => ({ mkdir: vi.fn(), writeFile: vi.fn(), rename: vi.fn() }));
vi.mock('node:fs/promises', () => ({ default: io }));
vi.mock('node:fs', () => ({ default: { existsSync: () => disk.raw !== undefined, readFileSync: () => disk.raw } }));
vi.mock('../logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  disk.raw = undefined;
  disk.temporary = undefined;
  io.mkdir.mockResolvedValue(undefined);
  io.writeFile.mockImplementation(async (_file: string, contents: string) => { disk.temporary = contents; });
  io.rename.mockImplementation(async () => { disk.raw = disk.temporary; });
});

async function loadService() {
  return (await import('./userDefaultsService.js')).userDefaultsService;
}

describe('bubble appearance shared choices', () => {
  it('resolves all supported choices and rejects unknown persisted input', () => {
    expect(DEFAULT_BUBBLE_SKIN).toBe('signal');
    expect(DEFAULT_BUBBLE_EDGE_STYLE).toBe('dash');
    expect(BUBBLE_SKINS.map(item => item.id)).toEqual(['outline', 'signal', 'twin', 'frost', 'halo']);
    expect(BUBBLE_EDGE_STYLES.map(item => item.id)).toEqual(['wire', 'dash', 'beads', 'glow', 'rail']);
    for (const item of BUBBLE_SKINS) expect(resolveBubbleSkin(item.id)).toBe(item.id);
    for (const item of BUBBLE_EDGE_STYLES) expect(resolveBubbleEdgeStyle(item.id)).toBe(item.id);
    for (const invalid of [undefined, null, '', 'unknown', 'SIGNAL', ' dash ', 1, false, {}, ['signal']]) {
      expect(resolveBubbleSkin(invalid)).toBe('signal');
      expect(resolveBubbleEdgeStyle(invalid)).toBe('dash');
    }
  });
});

describe('bubble appearance defaults persistence', () => {
  it('uses defaults for an absent settings file without writing or materializing preferences', async () => {
    const service = await loadService();
    expect(service.get().appearance).toBeUndefined();
    expect(resolveBubbleSkin(service.get().appearance?.bubbleSkin)).toBe('signal');
    expect(resolveBubbleEdgeStyle(service.get().appearance?.edgeStyle)).toBe('dash');
    expect(io.mkdir).not.toHaveBeenCalled();
    expect(io.writeFile).not.toHaveBeenCalled();
    expect(io.rename).not.toHaveBeenCalled();
  });

  it('loads existing choices and unrelated appearance siblings without a startup write', async () => {
    const appearance = { uiLocale: 'ko', themeId: 'custom:my-theme', bubbleSkin: 'halo', edgeStyle: 'beads', futureOption: { value: 3 } };
    disk.raw = JSON.stringify({ appearance, updatedAt: 100 });
    const rawBefore = disk.raw;
    const service = await loadService();
    expect(service.get().appearance).toEqual(appearance);
    expect(service.get().updatedAt).toBe(100);
    expect(io.writeFile).not.toHaveBeenCalled();
    expect(disk.raw).toBe(rawBefore);
  });

  it('normalizes invalid stored IDs in memory while leaving absent fields sparse', async () => {
    disk.raw = JSON.stringify({ appearance: { themeId: 'dark', uiLocale: 'en', bubbleSkin: 'old-skin', edgeStyle: { id: 'rail' }, futureOption: true }, updatedAt: 1 });
    const rawBefore = disk.raw;
    let service = await loadService();
    expect(service.get().appearance).toEqual({ themeId: 'dark', uiLocale: 'en', bubbleSkin: 'signal', edgeStyle: 'dash', futureOption: true });
    expect(disk.raw).toBe(rawBefore);
    expect(io.writeFile).not.toHaveBeenCalled();

    disk.raw = JSON.stringify({ appearance: { themeId: 'dark', bubbleSkin: null }, updatedAt: 2 });
    vi.resetModules();
    service = await loadService();
    expect(service.get().appearance).toEqual({ themeId: 'dark' });
    expect(io.writeFile).not.toHaveBeenCalled();
  });

  it('merges concurrent independent design updates, preserves theme/language, and reloads both choices', async () => {
    disk.raw = JSON.stringify({ appearance: { themeId: 'custom:kept', uiLocale: 'ko', futureOption: 'kept' }, notifications: { cmdBlocked: false }, updatedAt: 1 });
    const service = await loadService();
    await Promise.all([
      service.update({ appearance: { bubbleSkin: 'twin' } }),
      service.update({ appearance: { edgeStyle: 'rail' } }),
    ]);
    const appearance = { themeId: 'custom:kept', uiLocale: 'ko', futureOption: 'kept', bubbleSkin: 'twin', edgeStyle: 'rail' };
    expect(service.get().appearance).toEqual(appearance);
    expect(service.get().notifications).toEqual({ cmdBlocked: false });
    expect(JSON.parse(disk.raw!).appearance).toEqual(appearance);
    expect(io.rename).toHaveBeenCalledTimes(2);
    vi.resetModules();
    const reloaded = await loadService();
    expect(reloaded.get().appearance).toEqual(appearance);
    expect(io.rename).toHaveBeenCalledTimes(2);
  });

  it('keeps both design settings when another appearance field or category changes', async () => {
    const service = await loadService();
    await service.update({ appearance: { bubbleSkin: 'frost', edgeStyle: 'glow', uiLocale: 'ko', themeId: 'dark' } });
    await service.update({ appearance: { themeId: 'light' } });
    await service.update({ appearance: { uiLocale: 'ja' } });
    await service.update({ notifications: { cmdBlocked: false } });
    expect(service.get().appearance).toEqual({ bubbleSkin: 'frost', edgeStyle: 'glow', themeId: 'light', uiLocale: 'ja' });
  });

  it('normalizes explicitly invalid patch IDs but ignores malformed appearance categories', async () => {
    const service = await loadService();
    await service.update({ appearance: { bubbleSkin: 'outline', edgeStyle: 'wire', themeId: 'kept', uiLocale: 'ko' } });
    for (const appearance of [null, [], 'bad']) {
      await service.update({ appearance } as unknown as UserDefaultsPatch);
      expect(service.get().appearance).toEqual({ bubbleSkin: 'outline', edgeStyle: 'wire', themeId: 'kept', uiLocale: 'ko' });
    }
    await service.update({ appearance: { bubbleSkin: 'unknown', edgeStyle: 7 } } as unknown as UserDefaultsPatch);
    expect(service.get().appearance).toEqual({ bubbleSkin: 'signal', edgeStyle: 'dash', themeId: 'kept', uiLocale: 'ko' });
    expect(JSON.parse(disk.raw!).appearance).toEqual(service.get().appearance);
  });

  it('deletes only explicitly reset fields and falls back without persisting null', async () => {
    const service = await loadService();
    await service.update({ appearance: { bubbleSkin: 'halo', edgeStyle: 'rail', themeId: 'kept', uiLocale: 'ko' } });
    await service.update({ appearance: { bubbleSkin: null } });
    expect(service.get().appearance).toEqual({ edgeStyle: 'rail', themeId: 'kept', uiLocale: 'ko' });
    expect(resolveBubbleSkin(service.get().appearance?.bubbleSkin)).toBe('signal');
    await service.update({ appearance: { edgeStyle: null } });
    expect(service.get().appearance).toEqual({ themeId: 'kept', uiLocale: 'ko' });
    expect(resolveBubbleEdgeStyle(service.get().appearance?.edgeStyle)).toBe('dash');
    expect(JSON.parse(disk.raw!).appearance).toEqual({ themeId: 'kept', uiLocale: 'ko' });
  });

  it('rolls back a failed design save and does not broadcast an unpersisted choice', async () => {
    const service = await loadService();
    await service.update({ appearance: { bubbleSkin: 'frost', edgeStyle: 'wire', themeId: 'kept' } });
    const previous = service.get(), rawBefore = disk.raw, listener = vi.fn();
    service.subscribe(listener);
    io.rename.mockRejectedValueOnce(new Error('disk full'));
    await expect(service.update({ appearance: { edgeStyle: 'glow' } })).rejects.toThrow('disk full');
    expect(service.get()).toBe(previous);
    expect(disk.raw).toBe(rawBefore);
    expect(listener).not.toHaveBeenCalled();
  });
});
