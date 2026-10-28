/** §5.13 (R-9) · §5.1 #2-1 (G) ⑧ — 그림 머리 판정(shared `previewPolicy.ts`): JPEG EXIF 회전(두 엔디언, 없으면 1) · 5~8 은 가로세로 교환 · GIF·APNG·WebP 움직임은 줄여 풀지 않는다(첫 장만 남는다). */
import { describe, it, expect } from 'vitest';
import { imageHeaderAnimated, imageHeaderOrientation, imageHeaderSize, orientedImageSize } from '@vibisual/shared';

function bytes(...parts: Array<number | number[]>): Uint8Array {
  const out: number[] = [];
  for (const p of parts) {
    if (Array.isArray(p)) out.push(...p);
    else out.push(p);
  }
  while (out.length < 64) out.push(0);
  return Uint8Array.from(out);
}
const be16 = (v: number): number[] => [(v >>> 8) & 255, v & 255];
const le16 = (v: number): number[] => [v & 255, (v >>> 8) & 255];
const be32 = (v: number): number[] => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
const le32 = (v: number): number[] => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));

/** EXIF(APP1) 하나 + SOF 하나짜리 JPEG 머리. `little` 이면 TIFF 리틀 엔디언. */
function jpegWithOrientation(orientation: number, little: boolean, width = 4000, height = 3000): Uint8Array {
  const r16 = little ? le16 : be16;
  const r32 = little ? le32 : be32;
  const tiff = [
    ...(little ? [0x49, 0x49] : [0x4d, 0x4d]), ...r16(42), ...r32(8),
    ...r16(1),
    ...r16(0x0112), ...r16(3), ...r32(1), ...r16(orientation), 0, 0,
    ...r32(0),
  ];
  const app1 = [...ascii('Exif'), 0, 0, ...tiff];
  return bytes([0xff, 0xd8], [0xff, 0xe1], be16(app1.length + 2), app1, [0xff, 0xc0], be16(17), 8, be16(height), be16(width));
}

describe('imageHeaderOrientation — JPEG EXIF 회전', () => {
  it('리틀 · 빅 엔디언 둘 다 읽는다', () => {
    expect(imageHeaderOrientation(jpegWithOrientation(6, true))).toBe(6);
    expect(imageHeaderOrientation(jpegWithOrientation(8, false))).toBe(8);
    expect(imageHeaderOrientation(jpegWithOrientation(1, true))).toBe(1);
  });

  it('회전 태그가 없거나 값이 범위 밖 · JPEG 가 아니면 1', () => {
    const noExif = bytes([0xff, 0xd8], [0xff, 0xe0], be16(16), Array(14).fill(0), [0xff, 0xc0], be16(17), 8, be16(30), be16(40));
    expect(imageHeaderOrientation(noExif)).toBe(1);
    expect(imageHeaderOrientation(jpegWithOrientation(9, true))).toBe(1);
    expect(imageHeaderOrientation(jpegWithOrientation(0, false))).toBe(1);
    const png = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], be32(13), ascii('IHDR'), be32(64), be32(32));
    expect(imageHeaderOrientation(png)).toBe(1);
    expect(imageHeaderOrientation(new Uint8Array([0xff, 0xd8]))).toBe(1);
  });

  it('머리가 잘려 있어도 던지지 않는다', () => {
    const full = jpegWithOrientation(6, true);
    for (let n = 0; n < 40; n += 1) expect(() => imageHeaderOrientation(full.subarray(0, n))).not.toThrow();
  });

  it('회전이 있어도 크기 판정(SOF)은 그대로다', () => {
    expect(imageHeaderSize(jpegWithOrientation(6, true, 6000, 4000))).toEqual({ width: 6000, height: 4000 });
  });
});

describe('orientedImageSize — 세운 뒤의 가로×세로', () => {
  it('5~8 은 가로·세로가 바뀌고 나머지는 그대로다', () => {
    for (const o of [5, 6, 7, 8]) expect(orientedImageSize({ width: 6000, height: 4000 }, o)).toEqual({ width: 4000, height: 6000 });
    for (const o of [1, 2, 3, 4]) expect(orientedImageSize({ width: 6000, height: 4000 }, o)).toEqual({ width: 6000, height: 4000 });
  });
});

describe('imageHeaderAnimated — 움직이는 그림일 수 있는가', () => {
  it('GIF 는 그렇다고 본다', () => {
    expect(imageHeaderAnimated(bytes(ascii('GIF89a'), le16(320), le16(200)))).toBe(true);
  });

  it('PNG 는 IDAT 앞에 acTL 이 있을 때만(APNG)', () => {
    const ihdr = [...be32(13), ...ascii('IHDR'), ...be32(64), ...be32(32), 8, 6, 0, 0, 0, ...be32(0)];
    const actl = [...be32(8), ...ascii('acTL'), ...be32(4), ...be32(0), ...be32(0)];
    const idat = [...be32(0), ...ascii('IDAT'), ...be32(0)];
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    expect(imageHeaderAnimated(bytes(sig, ihdr, actl, idat))).toBe(true);
    expect(imageHeaderAnimated(bytes(sig, ihdr, idat))).toBe(false);
  });

  it('WebP 는 VP8X 의 애니메이션 깃발로', () => {
    const vp8x = (flags: number): Uint8Array => bytes(ascii('RIFF'), le32(0), ascii('WEBP'), ascii('VP8X'), le32(10), flags, 0, 0, 0);
    expect(imageHeaderAnimated(vp8x(0x02))).toBe(true);
    expect(imageHeaderAnimated(vp8x(0x10))).toBe(false);
    const lossy = bytes(ascii('RIFF'), le32(0), ascii('WEBP'), ascii('VP8 '), le32(0), 0, 0, 0, 0x9d, 0x01, 0x2a);
    expect(imageHeaderAnimated(lossy)).toBe(false);
  });

  it('JPEG · 모르는 형식 · 짧은 머리는 아니다', () => {
    expect(imageHeaderAnimated(jpegWithOrientation(1, true))).toBe(false);
    expect(imageHeaderAnimated(bytes(ascii('<svg')))).toBe(false);
    expect(imageHeaderAnimated(new Uint8Array([0x47, 0x49]))).toBe(false);
  });
});
