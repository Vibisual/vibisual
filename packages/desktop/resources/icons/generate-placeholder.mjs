// Vibisual app-icon generator (pure Node, no image deps).
//
// Rasterizes the brand bubble — same blue→purple linear gradient as
// packages/client/public/favicon.svg — into:
//   - icon.png  (256×256, single image)
//   - icon.ico  (16/32/48/64/128/256, multi-image; Windows picks per-DPI)
//
// Run:  node packages/desktop/resources/icons/generate-placeholder.mjs

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, crc32 } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));

// favicon.svg gradient stops.
const C0 = { r: 0x60, g: 0xA5, b: 0xFA }; // #60A5FA — top-left
const C1 = { r: 0x8B, g: 0x5C, b: 0xF6 }; // #8B5CF6 — bottom-right

// 2×2 supersample offsets for circle-edge AA.
const SS = [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]];

function lerp(a, b, t) { return a + (b - a) * t; }

function sampleColor(t) {
  return {
    r: Math.round(lerp(C0.r, C1.r, t)),
    g: Math.round(lerp(C0.g, C1.g, t)),
    b: Math.round(lerp(C0.b, C1.b, t)),
  };
}

// Render a size×size RGBA Buffer of the gradient bubble (circle filling the canvas).
function renderBubble(size) {
  const px = Buffer.alloc(size * size * 4);
  const cx = size / 2, cy = size / 2;
  const r = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let aSum = 0, rSum = 0, gSum = 0, bSum = 0;
      for (const [dx, dy] of SS) {
        const sx = x + dx, sy = y + dy;
        const d = Math.hypot(sx - cx, sy - cy);
        if (d > r) continue;
        // Gradient progress along (0,0)→(1,1) in normalized coords = (u+v)/2.
        const t = ((sx / size) + (sy / size)) / 2;
        const c = sampleColor(t);
        aSum += 1; rSum += c.r; gSum += c.g; bSum += c.b;
      }
      const o = (y * size + x) * 4;
      if (aSum === 0) {
        px[o] = 0; px[o + 1] = 0; px[o + 2] = 0; px[o + 3] = 0;
      } else {
        const alpha = aSum / SS.length;
        // Pre-blended average over covered subpixels; uncovered subpixels are transparent
        // and contribute 0 to color sums, so divide color by covered count for true color.
        px[o]     = Math.round(rSum / aSum);
        px[o + 1] = Math.round(gSum / aSum);
        px[o + 2] = Math.round(bSum / aSum);
        px[o + 3] = Math.round(alpha * 255);
      }
    }
  }
  return px;
}

function encodePng(size, rgba) {
  // Add PNG filter byte (0 = None) at the start of each scanline.
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(raw);

  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const t = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
    return Buffer.concat([len, t, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  // ihdr[10..12] = 0  (compression/filter/interlace defaults)
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// Multi-image ICO: ICONDIR(6) + N × ICONDIRENTRY(16) + concatenated PNG payloads.
// Vista+ supports PNG-encoded images inside ICO at any size; we ship sub-256 sizes
// as PNG too so the file stays compact and Windows still picks per-DPI correctly.
function wrapMultiIco(images /* [{ size, png }] */) {
  const dir = Buffer.alloc(6 + 16 * images.length);
  dir.writeUInt16LE(0, 0);                 // reserved
  dir.writeUInt16LE(1, 2);                 // type=1 (icon)
  dir.writeUInt16LE(images.length, 4);     // count
  let offset = 6 + 16 * images.length;
  const payloads = [];
  for (let i = 0; i < images.length; i++) {
    const { size, png } = images[i];
    const eo = 6 + 16 * i;
    dir[eo]     = size >= 256 ? 0 : size;  // width (0 means 256)
    dir[eo + 1] = size >= 256 ? 0 : size;  // height
    dir[eo + 2] = 0;                       // colors (truecolor)
    dir[eo + 3] = 0;                       // reserved
    dir.writeUInt16LE(1, eo + 4);          // planes
    dir.writeUInt16LE(32, eo + 6);         // bit count
    dir.writeUInt32LE(png.length, eo + 8); // bytes in res
    dir.writeUInt32LE(offset, eo + 12);    // image offset
    payloads.push(png);
    offset += png.length;
  }
  return Buffer.concat([dir, ...payloads]);
}

const SIZES = [16, 32, 48, 64, 128, 256];
const renders = SIZES.map((size) => ({ size, png: encodePng(size, renderBubble(size)) }));

const png256 = renders.find((r) => r.size === 256).png;
const ico = wrapMultiIco(renders);

writeFileSync(join(HERE, 'icon.png'), png256);
writeFileSync(join(HERE, 'icon.ico'), ico);
console.log(`wrote icon.png (${png256.length} B, 256×256) + icon.ico (${ico.length} B, sizes ${SIZES.join('/')})`);
