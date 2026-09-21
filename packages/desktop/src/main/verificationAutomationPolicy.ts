import { VERIFICATION_AUTOMATION } from '@vibisual/shared';

/** Verification windows only navigate inside the target origin explicitly selected by the user. */
export function verificationUrl(raw: string, origin?: string): URL {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Use an HTTP(S) target without embedded credentials.');
  if (origin && url.origin !== origin) throw new Error('Navigation outside the selected target origin is not allowed.');
  return url;
}

export interface VerificationKey { key: string; code: string; virtualKey: number; modifiers: number; ctrl: boolean; alt: boolean; shift: boolean; meta: boolean }
const KEYS: Record<string, [string, string, number]> = {
  Enter: ['Enter', 'Enter', 13], Return: ['Enter', 'Enter', 13], Tab: ['Tab', 'Tab', 9], Escape: ['Escape', 'Escape', 27],
  Backspace: ['Backspace', 'Backspace', 8], Delete: ['Delete', 'Delete', 46], Space: [' ', 'Space', 32],
  ArrowLeft: ['ArrowLeft', 'ArrowLeft', 37], ArrowUp: ['ArrowUp', 'ArrowUp', 38], ArrowRight: ['ArrowRight', 'ArrowRight', 39], ArrowDown: ['ArrowDown', 'ArrowDown', 40],
  Home: ['Home', 'Home', 36], End: ['End', 'End', 35], PageUp: ['PageUp', 'PageUp', 33], PageDown: ['PageDown', 'PageDown', 34],
};

export function verificationKey(raw: string, platform: string): VerificationKey {
  const parts = raw.split('+');
  const last = parts.pop() ?? '';
  const mods = { ctrl: false, alt: false, shift: false, meta: false };
  for (const part of parts) {
    const value = part.toLowerCase();
    if (['control', 'ctrl'].includes(value)) mods.ctrl = true;
    else if (value === 'alt') mods.alt = true;
    else if (value === 'shift') mods.shift = true;
    else if (['meta', 'cmd', 'command'].includes(value)) mods.meta = true;
    else if (['mod', 'commandorcontrol'].includes(value)) mods[platform === 'darwin' ? 'meta' : 'ctrl'] = true;
    else throw new Error(`Unsupported modifier: ${part}`);
  }
  let key = KEYS[last];
  if (!key && /^[a-z]$/i.test(last)) key = [mods.shift ? last.toUpperCase() : last.toLowerCase(), `Key${last.toUpperCase()}`, last.toUpperCase().charCodeAt(0)];
  if (!key && /^[0-9]$/.test(last)) key = [last, `Digit${last}`, last.charCodeAt(0)];
  if (!key) throw new Error(`Unsupported key: ${last}`);
  return { key: key[0], code: key[1], virtualKey: key[2], modifiers: Number(mods.alt) + Number(mods.ctrl) * 2 + Number(mods.meta) * 4 + Number(mods.shift) * 8, ...mods };
}

export function normalizedPoint(x: number | undefined, y: number | undefined): { x: number; y: number } {
  if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) throw new Error('Coordinates must be finite fractions between 0 and 1.');
  return { x, y };
}

export function boundedImageSize(width: number, height: number): { width: number; height: number } {
  if (!(width > 0 && height > 0)) throw new Error('The target returned an empty screenshot.');
  const scale = Math.min(1, VERIFICATION_AUTOMATION.imageWidth / width, VERIFICATION_AUTOMATION.imageHeight / height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** NativeImage bitmaps have four bytes per pixel; channel order does not affect absolute difference. */
export function bitmapDifference(actual: Uint8Array, expected: Uint8Array): number {
  if (actual.length === 0 || actual.length !== expected.length || actual.length % 4 !== 0) throw new Error('Screenshots have incompatible pixel buffers.');
  let difference = 0;
  for (let i = 0; i < actual.length; i += 4) {
    for (let channel = 0; channel < 3; channel++) difference += Math.abs(actual[i + channel]! - expected[i + channel]!);
  }
  return difference / ((actual.length / 4) * 3 * 255);
}

export function comparisonRegion(width: number, height: number, region?: { x: number; y: number; width: number; height: number }): { x: number; y: number; width: number; height: number } {
  if (!region) return { x: 0, y: 0, width, height };
  normalizedPoint(region.x, region.y);
  if (!Number.isFinite(region.width) || !Number.isFinite(region.height) || region.width <= 0 || region.height <= 0 || region.x + region.width > 1 || region.y + region.height > 1) throw new Error('The comparison region must lie inside the screenshot.');
  const x = Math.floor(region.x * width), y = Math.floor(region.y * height);
  return { x, y, width: Math.max(1, Math.min(width - x, Math.round(region.width * width))), height: Math.max(1, Math.min(height - y, Math.round(region.height * height))) };
}
