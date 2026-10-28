import { deflate } from 'node:zlib';
import { promisify } from 'node:util';

/**
 * Windows app icons read from the PE file itself.
 * Not only `app.getFileIcon`: on Electron 31 / Windows 11 it returns the generic program picture for executables whose icon frames
 * are PNG-compressed (UnrealEditor.exe, git-bash.exe — measured 2026-10-20). This walks the documented PE/COFF resource tree
 * (RT_GROUP_ICON → RT_ICON) — the picture Explorer shows; it is not string extraction from a binary.
 * Every offset comes from an untrusted file, so each read is range-checked and the walk is bounded.
 */

const RT_ICON = 3;
const RT_GROUP_ICON = 14;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const deflateAsync = promisify(deflate);

export interface IconFileReader {
  readonly size: number;
  /** At most `length` bytes; fewer at the end of the file. */
  read(offset: number, length: number): Promise<Buffer>;
}

export interface PeIconOptions {
  targetPx: number;
  maxImageBytes: number;
  maxFrameBytes: number;
  maxEntries: number;
  maxFrameAttempts: number;
}

export type PeIconResult =
  /** The best frame of the first icon group, as PNG bytes. */
  | { kind: 'image'; png: Buffer }
  /** A valid image without an icon group: Explorer shows only the generic program picture. */
  | { kind: 'none' }
  /** Icon frames exist, but only in encodings left to the OS shell (palette DIBs etc.). */
  | { kind: 'unsupported' };

interface ResourceEntry { id: number | null; isDirectory: boolean; offset: number }

export function isPng(data: Buffer): boolean {
  return data.length >= 8 && data.subarray(0, 8).equals(PNG_SIGNATURE);
}

/** Nearest square frame at or above the target first, then the largest below; deeper colour first. */
export function rankIconFrames<T extends { size: number; bitCount: number }>(frames: readonly T[], target: number): T[] {
  return [...frames].sort((a, b) => {
    const aAbove = a.size >= target;
    if (aAbove !== b.size >= target) return aAbove ? -1 : 1;
    if (a.size !== b.size) return aAbove ? a.size - b.size : b.size - a.size;
    return b.bitCount - a.bitCount;
  });
}

/** `null` when the file is not a PE image. Throws on a structurally broken resource tree. */
export async function readPeIcon(file: IconFileReader, options: PeIconOptions): Promise<PeIconResult | null> {
  const exact = async (offset: number, length: number): Promise<Buffer> => {
    if (!Number.isSafeInteger(offset) || offset < 0 || length < 0 || offset + length > file.size) throw new Error('PE read out of range');
    const data = await file.read(offset, length);
    if (data.length !== length) throw new Error('PE read truncated');
    return data;
  };
  if (file.size < 64) return null;
  const dos = await exact(0, 64);
  if (dos.readUInt16LE(0) !== 0x5a4d) return null;
  const peOffset = dos.readUInt32LE(0x3c);
  if (peOffset < 64 || peOffset > 0x10000 || peOffset + 24 > file.size) return null;
  const coff = await exact(peOffset, 24);
  if (coff.readUInt32LE(0) !== 0x00004550) return null;
  const sectionCount = coff.readUInt16LE(6);
  const optionalSize = coff.readUInt16LE(20);
  if (sectionCount < 1 || sectionCount > 96 || optionalSize < 2 || optionalSize > 0x1000) return null;
  const optional = await exact(peOffset + 24, optionalSize);
  const magic = optional.readUInt16LE(0);
  const directories = magic === 0x10b ? 96 : magic === 0x20b ? 112 : -1;
  if (directories < 0) return null;
  // DataDirectory[2] is the resource table; an image without one simply has no icon.
  if (optional.length < directories + 24 || optional.readUInt32LE(directories - 4) < 3) return { kind: 'none' };
  const resourceRva = optional.readUInt32LE(directories + 16);
  const resourceSize = optional.readUInt32LE(directories + 20);
  if (!resourceRva || !resourceSize) return { kind: 'none' };

  const table = await exact(peOffset + 24 + optionalSize, sectionCount * 40);
  const sections = Array.from({ length: sectionCount }, (_, i) => ({
    va: table.readUInt32LE(i * 40 + 12),
    virtualSize: table.readUInt32LE(i * 40 + 8),
    rawSize: table.readUInt32LE(i * 40 + 16),
    raw: table.readUInt32LE(i * 40 + 20),
  }));
  /** RVA → file offset, only inside the bytes a section actually stores on disk. */
  const fileOffset = (rva: number, length: number): number => {
    const section = sections.find((s) => rva >= s.va && rva - s.va < Math.max(s.virtualSize, s.rawSize));
    if (!section || rva - section.va + length > section.rawSize) throw new Error('RVA outside stored section data');
    return section.raw + (rva - section.va);
  };
  const root = fileOffset(resourceRva, 16);

  let budget = options.maxEntries;
  const directory = async (offset: number): Promise<ResourceEntry[]> => {
    if (offset + 16 > resourceSize) throw new Error('resource directory out of range');
    const head = await exact(root + offset, 16);
    const count = head.readUInt16LE(12) + head.readUInt16LE(14);
    if (count > budget || offset + 16 + count * 8 > resourceSize) throw new Error('resource directory too large');
    budget -= count;
    const raw = count ? await exact(root + offset + 16, count * 8) : Buffer.alloc(0);
    // Named entries sort before numeric ones, so "the first group" is the shell's icon index 0.
    return Array.from({ length: count }, (_, i) => {
      const name = raw.readUInt32LE(i * 8);
      const target = raw.readUInt32LE(i * 8 + 4);
      return { id: name & 0x80000000 ? null : name & 0xffff, isDirectory: (target & 0x80000000) !== 0, offset: target & 0x7fffffff };
    });
  };
  /** Name entry → first language → data entry. */
  const leaf = async (entry: ResourceEntry): Promise<{ rva: number; size: number }> => {
    let node = entry;
    for (let depth = 0; node.isDirectory; depth += 1) {
      if (depth >= 2) throw new Error('resource tree too deep');
      const children = await directory(node.offset);
      if (!children[0]) throw new Error('empty resource directory');
      node = children[0];
    }
    if (node.offset + 16 > resourceSize) throw new Error('resource data entry out of range');
    const data = await exact(root + node.offset, 16);
    return { rva: data.readUInt32LE(0), size: data.readUInt32LE(4) };
  };

  const types = await directory(0);
  const groupType = types.find((entry) => entry.id === RT_GROUP_ICON && entry.isDirectory);
  const iconType = types.find((entry) => entry.id === RT_ICON && entry.isDirectory);
  if (!groupType || !iconType) return { kind: 'none' };
  const groups = await directory(groupType.offset);
  if (!groups[0]) return { kind: 'none' };
  const groupData = await leaf(groups[0]);
  if (groupData.size < 6 || groupData.size > 6 + 14 * 255) throw new Error('icon group size');
  const group = await exact(fileOffset(groupData.rva, groupData.size), groupData.size);
  if (group.readUInt16LE(0) !== 0 || group.readUInt16LE(2) !== 1) throw new Error('not an icon group');
  const declared = Math.min(group.readUInt16LE(4), Math.floor((group.length - 6) / 14));
  const frames: Array<{ size: number; bitCount: number; id: number }> = [];
  for (let i = 0; i < declared; i += 1) {
    const at = 6 + i * 14;
    const width = group[at] || 256;
    if (width === (group[at + 1] || 256)) frames.push({ size: width, bitCount: group.readUInt16LE(at + 6), id: group.readUInt16LE(at + 12) });
  }
  if (!frames.length) return declared ? { kind: 'unsupported' } : { kind: 'none' };
  const icons = new Map<number, ResourceEntry>();
  for (const entry of await directory(iconType.offset)) if (entry.id !== null) icons.set(entry.id, entry);
  for (const frame of rankIconFrames(frames, options.targetPx).slice(0, options.maxFrameAttempts)) {
    const entry = icons.get(frame.id);
    if (!entry) continue;
    const data = await leaf(entry);
    if (data.size < 40 || data.size > options.maxFrameBytes) continue;
    const bytes = await exact(fileOffset(data.rva, data.size), data.size);
    const png = isPng(bytes) ? bytes : await iconDibToPng(bytes);
    if (png && png.length <= options.maxImageBytes) return { kind: 'image', png };
  }
  return { kind: 'unsupported' };
}

/**
 * A 32-bit BI_RGB icon frame (bottom-up XOR bitmap + 1-bit AND mask, height declared twice) → PNG.
 * Palette and 24-bit frames return null — the OS shell draws those correctly.
 */
export async function iconDibToPng(dib: Buffer): Promise<Buffer | null> {
  if (dib.length < 40) return null;
  const header = dib.readUInt32LE(0);
  const width = dib.readInt32LE(4);
  const declaredHeight = dib.readInt32LE(8);
  if (header < 40 || header > 124 || dib.readUInt16LE(14) !== 32 || dib.readUInt32LE(16) !== 0) return null;
  const height = declaredHeight / 2;
  if (width < 1 || width > 256 || height !== width) return null;
  const stride = width * 4;
  const maskStride = Math.ceil(width / 32) * 4;
  const mask = header + stride * height;
  if (dib.length < mask) return null;
  const hasMask = dib.length >= mask + maskStride * height;
  const rgba = Buffer.alloc(width * height * 4);
  let hasAlpha = false;
  for (let y = 0; y < height; y += 1) {
    const row = header + (height - 1 - y) * stride;
    for (let x = 0; x < width; x += 1) {
      const from = row + x * 4;
      const to = (y * width + x) * 4;
      rgba[to] = dib[from + 2]!;
      rgba[to + 1] = dib[from + 1]!;
      rgba[to + 2] = dib[from]!;
      rgba[to + 3] = dib[from + 3]!;
      if (dib[from + 3]) hasAlpha = true;
    }
  }
  // Pre-XP 32-bit frames leave alpha at zero and keep transparency in the AND mask only.
  if (!hasAlpha) {
    for (let y = 0; y < height; y += 1) {
      const row = mask + (height - 1 - y) * maskStride;
      for (let x = 0; x < width; x += 1) {
        const hidden = hasMask && (dib[row + (x >> 3)]! & (0x80 >> (x & 7))) !== 0;
        rgba[(y * width + x) * 4 + 3] = hidden ? 0 : 255;
      }
    }
  }
  return encodeRgbaPng(width, height, rgba);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed), 0);
  return Buffer.concat([length, typed, crc]);
}

/** Minimal 8-bit RGBA PNG (filter 0 on every row) — no native image codec is needed in the main process. */
export async function encodeRgbaPng(width: number, height: number, rgba: Buffer): Promise<Buffer> {
  const line = width * 4 + 1;
  const raw = Buffer.alloc(line * height);
  for (let y = 0; y < height; y += 1) rgba.copy(raw, y * line + 1, y * width * 4, (y + 1) * width * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([PNG_SIGNATURE, pngChunk('IHDR', ihdr), pngChunk('IDAT', await deflateAsync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
}
