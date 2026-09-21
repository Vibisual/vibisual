import { describe, expect, it } from 'vitest';
import { bitmapDifference, boundedImageSize, comparisonRegion, normalizedPoint, verificationKey, verificationUrl } from './verificationAutomationPolicy';
import { isVerificationWindow, registerVerificationWindow, unregisterVerificationWindow } from './verificationWindows';

describe('verification target and coordinate boundaries', () => {
  it.each(['file:///etc/passwd', 'javascript:alert(1)', 'https://name:secret@example.com'])('rejects %s', (url) => expect(() => verificationUrl(url)).toThrow());
  it('allows target paths but rejects an origin hop', () => {
    expect(verificationUrl('http://localhost:3000/result', 'http://localhost:3000').pathname).toBe('/result');
    expect(() => verificationUrl('http://localhost:4000', 'http://localhost:3000')).toThrow();
    expect(() => verificationUrl('https://example.com', 'http://example.com')).toThrow();
  });
  it.each([[NaN, 0], [0, Infinity], [-0.1, 0], [0, 1.01]])('rejects invalid coordinate %s,%s', (x, y) => expect(() => normalizedPoint(x, y)).toThrow());
  it('accepts viewport edges', () => expect(normalizedPoint(0, 1)).toEqual({ x: 0, y: 1 }));
  it('resizes within the bound without changing aspect ratio or enlarging', () => {
    expect(boundedImageSize(3840, 2160)).toEqual({ width: 1280, height: 720 });
    expect(boundedImageSize(1080, 1920)).toEqual({ width: 405, height: 720 });
    expect(boundedImageSize(240, 120)).toEqual({ width: 240, height: 120 });
    expect(() => boundedImageSize(0, 0)).toThrow();
  });
});

describe('real screenshot comparison math', () => {
  it('is zero for matching RGB and independent of bitmap channel order', () => {
    expect(bitmapDifference(new Uint8Array([1, 2, 3, 255]), new Uint8Array([1, 2, 3, 255]))).toBe(0);
    expect(bitmapDifference(new Uint8Array([0, 0, 0, 255]), new Uint8Array([255, 255, 255, 255]))).toBe(1);
  });
  it('rejects empty/incompatible evidence', () => {
    expect(() => bitmapDifference(new Uint8Array(), new Uint8Array())).toThrow();
    expect(() => bitmapDifference(new Uint8Array(4), new Uint8Array(8))).toThrow();
  });
  it('maps a normalized region to valid pixel bounds', () => {
    expect(comparisonRegion(1280, 720, { x: 0.25, y: 0.5, width: 0.5, height: 0.5 })).toEqual({ x: 320, y: 360, width: 640, height: 360 });
    expect(() => comparisonRegion(1280, 720, { x: 0.9, y: 0, width: 0.2, height: 1 })).toThrow();
    expect(() => comparisonRegion(1280, 720, { x: 0, y: 0, width: NaN, height: 1 })).toThrow();
  });
});

describe('cross-platform key chords and target window isolation', () => {
  it.each(['win32', 'linux'])('uses control for Mod on %s', (platform) => expect(verificationKey('Mod+A', platform)).toMatchObject({ ctrl: true, meta: false, code: 'KeyA' }));
  it('uses command on macOS and supports exact special keys', () => {
    expect(verificationKey('Mod+Shift+A', 'darwin')).toMatchObject({ meta: true, shift: true, modifiers: 12 });
    expect(verificationKey('Enter', 'win32').virtualKey).toBe(13);
    expect(() => verificationKey('Hyper+F13', 'win32')).toThrow();
  });
  it('unregisters dead webContents ids so later reuse is not excluded', () => {
    registerVerificationWindow(9023); expect(isVerificationWindow(9023)).toBe(true);
    unregisterVerificationWindow(9023); expect(isVerificationWindow(9023)).toBe(false);
  });
});
