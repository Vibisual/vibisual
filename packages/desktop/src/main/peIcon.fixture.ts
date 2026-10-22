/**
 * Test fixture only (imported by *.test.ts): builds minimal PE32+/PE32 images with a resource section,
 * so the icon reader is exercised against the real on-disk layout on every OS's test runner.
 */
import { inflateSync } from 'node:zlib';
import { encodeRgbaPng } from './peIcon';

export const RT_ICON = 3;
export const RT_GROUP_ICON = 14;
const RESOURCE_RVA = 0x1000;
const RESOURCE_RAW = 0x200;

export interface ResourceItem { id: number; data: Buffer }
export interface ResourceType { id: number; items: ResourceItem[] }
export interface FixtureFrame { size: number; bitCount: number; data: Buffer }

/** RT_GROUP_ICON payload pointing at RT_ICON ids `firstId…`. */
export function iconGroup(frames: readonly FixtureFrame[], firstId: number): Buffer {
  const group = Buffer.alloc(6 + frames.length * 14);
  group.writeUInt16LE(1, 2);
  group.writeUInt16LE(frames.length, 4);
  frames.forEach((frame, i) => {
    const at = 6 + i * 14;
    group[at] = frame.size >= 256 ? 0 : frame.size;
    group[at + 1] = frame.size >= 256 ? 0 : frame.size;
    group.writeUInt16LE(1, at + 4);
    group.writeUInt16LE(frame.bitCount, at + 6);
    group.writeUInt32LE(frame.data.length, at + 8);
    group.writeUInt16LE(firstId + i, at + 12);
  });
  return group;
}

/** Icon groups → the RT_ICON / RT_GROUP_ICON resource types (ids numbered across all groups). */
export function iconResources(groups: readonly (readonly FixtureFrame[])[]): ResourceType[] {
  const icons: ResourceItem[] = [];
  const groupItems: ResourceItem[] = [];
  groups.forEach((frames, g) => {
    const firstId = icons.length + 1;
    frames.forEach((frame, i) => icons.push({ id: firstId + i, data: frame.data }));
    groupItems.push({ id: 100 + g, data: iconGroup(frames, firstId) });
  });
  return [{ id: RT_ICON, items: icons }, { id: RT_GROUP_ICON, items: groupItems }];
}

function resourceSection(types: readonly ResourceType[]): Buffer {
  let size = 0;
  const reserve = (bytes: number): number => {
    const at = size;
    size += bytes;
    size = (size + 3) & ~3;
    return at;
  };
  const dir = (count: number): number => reserve(16 + count * 8);
  const root = dir(types.length);
  const typeDirs = types.map((type) => dir(type.items.length));
  const langDirs = types.map((type) => type.items.map(() => dir(1)));
  const dataEntries = types.map((type) => type.items.map(() => reserve(16)));
  const blobs = types.map((type) => type.items.map((item) => reserve(item.data.length)));
  const section = Buffer.alloc(size);
  const writeDir = (at: number, entries: Array<{ id: number; offset: number; isDirectory: boolean }>): void => {
    section.writeUInt16LE(entries.length, at + 14);
    entries.forEach((entry, i) => {
      section.writeUInt32LE(entry.id, at + 16 + i * 8);
      section.writeUInt32LE(((entry.isDirectory ? 0x80000000 : 0) | entry.offset) >>> 0, at + 20 + i * 8);
    });
  };
  writeDir(root, types.map((type, t) => ({ id: type.id, offset: typeDirs[t]!, isDirectory: true })));
  types.forEach((type, t) => {
    writeDir(typeDirs[t]!, type.items.map((item, i) => ({ id: item.id, offset: langDirs[t]![i]!, isDirectory: true })));
    type.items.forEach((item, i) => {
      writeDir(langDirs[t]![i]!, [{ id: 0x409, offset: dataEntries[t]![i]!, isDirectory: false }]);
      section.writeUInt32LE(RESOURCE_RVA + blobs[t]![i]!, dataEntries[t]![i]!);
      section.writeUInt32LE(item.data.length, dataEntries[t]![i]! + 4);
      item.data.copy(section, blobs[t]![i]!);
    });
  });
  return section;
}

/** A PE image whose only section holds `types` as its resource table (`null` = no resource directory). */
export function buildPe(types: readonly ResourceType[] | null, options: { pe32?: boolean } = {}): Buffer {
  const rsrc = types ? resourceSection(types) : Buffer.alloc(16);
  const optionalSize = options.pe32 ? 224 : 240;
  const file = Buffer.alloc(RESOURCE_RAW + rsrc.length);
  file.write('MZ', 0, 'latin1');
  file.writeUInt32LE(0x40, 0x3c);
  file.writeUInt32LE(0x00004550, 0x40);
  file.writeUInt16LE(0x8664, 0x44);
  file.writeUInt16LE(1, 0x46);
  file.writeUInt16LE(optionalSize, 0x54);
  const optional = 0x58;
  file.writeUInt16LE(options.pe32 ? 0x10b : 0x20b, optional);
  const directories = optional + (options.pe32 ? 96 : 112);
  file.writeUInt32LE(16, directories - 4);
  if (types) {
    file.writeUInt32LE(RESOURCE_RVA, directories + 16);
    file.writeUInt32LE(rsrc.length, directories + 20);
  }
  const sectionHeader = optional + optionalSize;
  file.write('.rsrc', sectionHeader, 'latin1');
  file.writeUInt32LE(rsrc.length, sectionHeader + 8);
  file.writeUInt32LE(RESOURCE_RVA, sectionHeader + 12);
  file.writeUInt32LE(rsrc.length, sectionHeader + 16);
  file.writeUInt32LE(RESOURCE_RAW, sectionHeader + 20);
  rsrc.copy(file, RESOURCE_RAW);
  return file;
}

export function memoryReader(file: Buffer): { size: number; read(offset: number, length: number): Promise<Buffer> } {
  return { size: file.length, read: async (offset, length) => file.subarray(offset, offset + length) };
}

/** Solid-colour square PNG frame. */
export function pngFrame(size: number, rgba: readonly [number, number, number, number] = [255, 0, 0, 255]): Promise<Buffer> {
  const pixels = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i += 1) pixels.set(rgba, i * 4);
  return encodeRgbaPng(size, size, pixels);
}

/** Icon DIB frame: BITMAPINFOHEADER + bottom-up pixels (`pixel(x, y)` in top-down coordinates) + AND mask. */
export function dibFrame(size: number, bitCount: number, pixel: (x: number, y: number) => [number, number, number, number], masked: (x: number, y: number) => boolean = () => false): Buffer {
  const bytesPerPixel = bitCount / 8;
  const stride = Math.ceil((size * bitCount) / 32) * 4;
  const maskStride = Math.ceil(size / 32) * 4;
  const dib = Buffer.alloc(40 + stride * size + maskStride * size);
  dib.writeUInt32LE(40, 0);
  dib.writeInt32LE(size, 4);
  dib.writeInt32LE(size * 2, 8);
  dib.writeUInt16LE(1, 12);
  dib.writeUInt16LE(bitCount, 14);
  for (let y = 0; y < size; y += 1) {
    const row = 40 + (size - 1 - y) * stride;
    const maskRow = 40 + stride * size + (size - 1 - y) * maskStride;
    for (let x = 0; x < size; x += 1) {
      if (bytesPerPixel >= 3) {
        const [r, g, b, a] = pixel(x, y);
        dib[row + x * bytesPerPixel] = b;
        dib[row + x * bytesPerPixel + 1] = g;
        dib[row + x * bytesPerPixel + 2] = r;
        if (bytesPerPixel === 4) dib[row + x * 4 + 3] = a;
      }
      if (masked(x, y)) dib[maskRow + (x >> 3)] = (dib[maskRow + (x >> 3)] ?? 0) | (0x80 >> (x & 7));
    }
  }
  return dib;
}

/** Decode the PNGs this module writes (8-bit RGBA, filter 0) back to pixels. */
export function decodeSimplePng(png: Buffer): { width: number; height: number; rgba: Buffer } {
  let at = 8;
  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];
  while (at < png.length) {
    const length = png.readUInt32BE(at);
    const type = png.toString('latin1', at + 4, at + 8);
    const data = png.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); }
    if (type === 'IDAT') idat.push(data);
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) raw.copy(rgba, y * width * 4, y * (width * 4 + 1) + 1, (y + 1) * (width * 4 + 1));
  return { width, height, rgba };
}
