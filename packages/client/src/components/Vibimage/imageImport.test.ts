import { beforeEach, describe, expect, it, vi } from 'vitest';
import { importedImageSource } from './imageImport.js';
const media = vi.hoisted(() => ({ write: vi.fn() }));
vi.mock('../../utils/workspaceMedia.js', () => ({ writeWorkspaceMedia: media.write }));
beforeEach(() => vi.clearAllMocks());
describe('(7) importing a picture writes nothing', () => {
  it('keeps the exact bytes inline (a blob is stored only when the source is first saved) and never touches the project folder', async () => {
    const original = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
    const source = await importedImageSource(original);
    expect(source).toBe('data:image/png;base64,iVBORw==');
    expect(await importedImageSource(original)).toBe(source);
    expect(media.write).not.toHaveBeenCalled();
  });
  it('refuses a file that is not a picture instead of storing it', async () => {
    await expect(importedImageSource(new Blob(['<html>'], { type: 'text/html' }))).rejects.toThrow('image-source-invalid');
    expect(media.write).not.toHaveBeenCalled();
  });
});
