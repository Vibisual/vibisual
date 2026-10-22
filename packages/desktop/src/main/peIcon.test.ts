import { existsSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { COMMAND_APP_ICON_LIMITS as LIMITS } from './commandAppIconConfig';
import { crc32, encodeRgbaPng, iconDibToPng, isPng, rankIconFrames, readPeIcon, type PeIconOptions } from './peIcon';
import { buildPe, decodeSimplePng, dibFrame, iconResources, memoryReader, pngFrame, RT_GROUP_ICON, RT_ICON } from './peIcon.fixture';

const OPTIONS: PeIconOptions = {
  targetPx: LIMITS.targetIconPx,
  maxImageBytes: LIMITS.maxImageBytes,
  maxFrameBytes: LIMITS.maxPeFrameBytes,
  maxEntries: LIMITS.maxPeResourceEntries,
  maxFrameAttempts: LIMITS.maxPeFrameAttempts,
};

const pixelAt = (image: { width: number; rgba: Buffer }, x: number, y: number): number[] =>
  [...image.rgba.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)];

describe('PE icon resources (the picture Explorer shows)', () => {
  it('returns the 64px PNG frame of an all-PNG icon group — the UnrealEditor.exe case the OS shell answered generically', async () => {
    const sizes = [16, 32, 48, 64, 256];
    const frames = await Promise.all(sizes.map(async (size) => ({ size, bitCount: 32, data: await pngFrame(size) })));
    const result = await readPeIcon(memoryReader(buildPe(iconResources([frames]))), OPTIONS);
    expect(result).toEqual({ kind: 'image', png: frames[3]!.data });
  });

  it('converts a 32-bit DIB frame to PNG with its colours and alpha (VS Code, node.exe)', async () => {
    const dib = dibFrame(64, 32, (x, y) => (x === 0 && y === 0 ? [10, 20, 30, 128] : [200, 100, 50, 255]));
    const result = await readPeIcon(memoryReader(buildPe(iconResources([[{ size: 64, bitCount: 32, data: dib }]]))), OPTIONS);
    expect(result?.kind).toBe('image');
    const image = decodeSimplePng((result as { png: Buffer }).png);
    expect([image.width, image.height]).toEqual([64, 64]);
    expect(pixelAt(image, 0, 0)).toEqual([10, 20, 30, 128]);
    expect(pixelAt(image, 63, 63)).toEqual([200, 100, 50, 255]);
  });

  it('takes transparency from the AND mask when a legacy 32-bit frame carries no alpha', async () => {
    const dib = dibFrame(16, 32, () => [1, 2, 3, 0], (x) => x < 8);
    const png = await iconDibToPng(dib);
    const image = decodeSimplePng(png!);
    expect(pixelAt(image, 0, 5)).toEqual([1, 2, 3, 0]);
    expect(pixelAt(image, 15, 5)).toEqual([1, 2, 3, 255]);
  });

  it('reports "none" for an image without an icon group — git.exe must not get the generic picture', async () => {
    expect(await readPeIcon(memoryReader(buildPe(null)), OPTIONS)).toEqual({ kind: 'none' });
    const versionOnly = buildPe([{ id: 16, items: [{ id: 1, data: Buffer.from('version') }] }]);
    expect(await readPeIcon(memoryReader(versionOnly), OPTIONS)).toEqual({ kind: 'none' });
  });

  it('leaves palette and 24-bit frames to the OS shell', async () => {
    const frames = [
      { size: 32, bitCount: 8, data: dibFrame(32, 8, () => [0, 0, 0, 0]) },
      { size: 48, bitCount: 24, data: dibFrame(48, 24, () => [9, 9, 9, 0]) },
    ];
    expect(await readPeIcon(memoryReader(buildPe(iconResources([frames]))), OPTIONS)).toEqual({ kind: 'unsupported' });
  });

  it('uses the first icon group (shell index 0) and also reads PE32 images', async () => {
    const first = await pngFrame(64, [0, 255, 0, 255]);
    const second = await pngFrame(64, [0, 0, 255, 255]);
    const file = buildPe(iconResources([[{ size: 64, bitCount: 32, data: first }], [{ size: 64, bitCount: 32, data: second }]]), { pe32: true });
    expect(await readPeIcon(memoryReader(file), OPTIONS)).toEqual({ kind: 'image', png: first });
  });

  it('falls back to the next frame when the preferred one exceeds the image budget', async () => {
    const small = await pngFrame(32);
    const large = Buffer.concat([await pngFrame(64), Buffer.alloc(OPTIONS.maxImageBytes)]);
    const file = buildPe(iconResources([[{ size: 32, bitCount: 32, data: small }, { size: 64, bitCount: 32, data: large }]]));
    expect(await readPeIcon(memoryReader(file), OPTIONS)).toEqual({ kind: 'image', png: small });
  });

  it('returns null for files that are not PE images', async () => {
    expect(await readPeIcon(memoryReader(Buffer.from('#!/bin/sh\necho hi\n'.repeat(8))), OPTIONS)).toBeNull();
    expect(await readPeIcon(memoryReader(Buffer.from('MZ')), OPTIONS)).toBeNull();
    const noSignature = buildPe(null);
    noSignature.writeUInt32LE(0, 0x40);
    expect(await readPeIcon(memoryReader(noSignature), OPTIONS)).toBeNull();
  });

  it('refuses offsets that point outside the file instead of reading there', async () => {
    const file = buildPe(iconResources([[{ size: 64, bitCount: 32, data: await pngFrame(64) }]]));
    // Point the resource directory past the end of the stored section data.
    file.writeUInt32LE(0x1000 + file.length, 0x58 + 112 + 16);
    await expect(readPeIcon(memoryReader(file), OPTIONS)).rejects.toThrow();
  });

  it('bounds the resource walk by entry count', async () => {
    const file = buildPe(iconResources([[{ size: 64, bitCount: 32, data: await pngFrame(64) }]]));
    await expect(readPeIcon(memoryReader(file), { ...OPTIONS, maxEntries: 2 })).rejects.toThrow(/too large/);
  });

  it('ranks the nearest frame at or above the target first, deeper colour on ties', () => {
    const frames = [16, 32, 48, 256, 64].map((size) => ({ size, bitCount: 32 })).concat([{ size: 64, bitCount: 8 }]);
    expect(rankIconFrames(frames, 64).map((f) => `${f.size}/${f.bitCount}`)).toEqual(['64/32', '64/8', '256/32', '48/32', '32/32', '16/32']);
  });

  it.runIf(process.platform === 'win32' && existsSync(process.execPath))('reads the icon of the running node.exe on Windows', async () => {
    const handle = await open(process.execPath, 'r');
    try {
      const { size } = await handle.stat();
      const result = await readPeIcon({
        size,
        read: async (offset, length) => {
          const buffer = Buffer.alloc(length);
          const { bytesRead } = await handle.read(buffer, 0, length, offset);
          return buffer.subarray(0, bytesRead);
        },
      }, OPTIONS);
      expect(result?.kind).toBe('image');
      expect(isPng((result as { png: Buffer }).png)).toBe(true);
    } finally {
      await handle.close();
    }
  });
});

describe('minimal PNG encoder', () => {
  it('writes valid chunks that decode back to the same pixels', async () => {
    const rgba = Buffer.from([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 1, 2, 3, 4]);
    const png = await encodeRgbaPng(2, 2, rgba);
    expect(isPng(png)).toBe(true);
    expect(png.subarray(-8, -4).toString('latin1')).toBe('IEND');
    expect(png.readUInt32BE(png.length - 4)).toBe(crc32(Buffer.from('IEND', 'latin1')));
    expect(crc32(Buffer.from('IEND', 'latin1'))).toBe(0xae426082);
    expect(decodeSimplePng(png)).toEqual({ width: 2, height: 2, rgba });
  });
});

describe('fixture sanity', () => {
  it('builds the resource types the reader looks for', () => {
    expect(iconResources([[]]).map((type) => type.id)).toEqual([RT_ICON, RT_GROUP_ICON]);
  });
});
