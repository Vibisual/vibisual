import { bytesBase64, parseCreationBlobRef } from '@vibisual/shared';
import { fetchWorkspaceMediaBlob } from '../../utils/workspaceMedia.js';
import { creationBlobObject } from './creationBlobs.js';
import type { ImageDocument, ImageLayer } from './imageSource.js';
import {
  IMAGE_LINE_HEIGHT,
  defaultTextMeasure,
  ensureImageFonts,
  imageFont,
  imageFontStack,
  resetImageTextMeasure,
  wrapTextToWidth,
  type TextMeasure,
} from './imageText.js';

/**
 * §5.13 (R-9)(R-10) — one renderer for editable images: the editor stage, SVG export, PNG export, Vibi3D textures and
 * Vibistudio's image items all draw the same layers through these functions.
 */

/** XML 1.0 forbids most C0 controls even when escaped; they are dropped rather than producing an unreadable SVG. */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g;
export function svgEscape(v: string | number): string {
  return String(v).replace(CONTROL, '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
}

export function wrapImageText(layer: ImageLayer, measure: TextMeasure = defaultTextMeasure(), fallbackFamily = 'sans-serif'): string[] {
  const size = layer.fontSize ?? 64;
  return wrapTextToWidth(layer.text ?? '', layer.width, imageFont(size, layer.fontFamily || fallbackFamily), measure);
}

function textLayer(doc: ImageDocument, layer: ImageLayer, base: string, box: string, measure: TextMeasure): string {
  const size = layer.fontSize ?? 64;
  const x = layer.align === 'center' ? layer.x + layer.width / 2 : layer.align === 'right' ? layer.x + layer.width : layer.x;
  const anchor = layer.align === 'center' ? 'middle' : layer.align === 'right' ? 'end' : 'start';
  const lines = wrapImageText(layer, measure, doc.style.fontFamily)
    .map((line, i) => `<tspan x="${x}" y="${layer.y + size + i * size * IMAGE_LINE_HEIGHT}">${svgEscape(line)}</tspan>`).join('');
  const family = svgEscape(imageFontStack(layer.fontFamily || doc.style.fontFamily));
  return `<g ${base}><rect ${box} fill="transparent"/><text xml:space="preserve" style="white-space:pre" fill="${svgEscape(layer.fill)}"`
    + ` font-family="${family}" font-size="${size}" text-anchor="${anchor}">${lines}</text></g>`;
}

export function imageSvgBody(doc: ImageDocument, sources: Record<string, string> = {}, measure: TextMeasure = defaultTextMeasure()): string {
  const layers = doc.layers.filter((layer) => layer.visible).map((layer) => {
    const base = `data-layer-id="${svgEscape(layer.id)}" opacity="${layer.opacity}"`;
    const box = `x="${layer.x}" y="${layer.y}" width="${layer.width}" height="${layer.height}"`;
    if (layer.kind === 'shape') {
      return layer.shape === 'ellipse'
        ? `<ellipse ${base} cx="${layer.x + layer.width / 2}" cy="${layer.y + layer.height / 2}" rx="${layer.width / 2}" ry="${layer.height / 2}" fill="${svgEscape(layer.fill)}"/>`
        : `<rect ${base} ${box} fill="${svgEscape(layer.fill)}"/>`;
    }
    if (layer.kind === 'image') {
      const source = sources[layer.source ?? ''] ?? (layer.source?.startsWith('data:image/') ? layer.source : '');
      const ratio = layer.fit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet';
      // Both href forms: SVG 2 readers use href, older SVG 1.1 tools only understand xlink:href.
      return source
        ? `<image ${base} ${box} href="${svgEscape(source)}" xlink:href="${svgEscape(source)}" preserveAspectRatio="${ratio}"/>`
        : `<rect ${base} ${box} fill="none" stroke="#999999" stroke-dasharray="8 8"/>`;
    }
    return textLayer(doc, layer, base, box, measure);
  }).join('');
  return `<rect width="${doc.width}" height="${doc.height}" fill="${svgEscape(doc.background)}"/>${layers}`;
}

export function imageSvg(doc: ImageDocument, sources: Record<string, string> = {}, measure: TextMeasure = defaultTextMeasure()): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${doc.width}" height="${doc.height}"`
    + ` viewBox="0 0 ${doc.width} ${doc.height}">${imageSvgBody(doc, sources, measure)}</svg>`;
}

export async function blobDataUrl(blob: Blob): Promise<string> {
  let bytes: Uint8Array;
  try { bytes = new Uint8Array(await blob.arrayBuffer()); } catch { throw new Error('image-read-failed'); }
  return `data:${blob.type || 'application/octet-stream'};base64,${bytesBase64(bytes)}`;
}
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('image-decode-failed'));
    image.src = src;
  });
}

/** Image bytes by signature when the server sent no (or a generic) type. */
async function sniffImage(blob: Blob): Promise<string | null> {
  const head = new Uint8Array(await blob.slice(0, 32).arrayBuffer());
  const starts = (...bytes: number[]): boolean => bytes.every((b, i) => head[i] === b);
  if (starts(0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (starts(0x47, 0x49, 0x46, 0x38)) return 'image/gif';
  if (starts(0x42, 0x4d)) return 'image/bmp';
  if (starts(0x52, 0x49, 0x46, 0x46) && head[8] === 0x57 && head[9] === 0x45) return 'image/webp';
  const text = new TextDecoder().decode(head).trimStart();
  if (text.startsWith('<svg') || text.startsWith('<?xml')) return 'image/svg+xml';
  if (head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70) return 'image/avif';
  return null;
}
export interface ResolvedImageSources {
  sources: Record<string, string>;
  /** Layers whose picture could not be read or is not a picture (drawn as a dashed placeholder). */
  failed: string[];
}
async function sourceBlob(layer: ImageLayer, root: string): Promise<Blob | null> {
  const source = layer.source ?? '';
  const ref = parseCreationBlobRef(source);
  if (ref) return creationBlobObject(root, ref);
  return fetchWorkspaceMediaBlob(root, source);
}
/**
 * Every picture is read on its own — one missing photo leaves only that layer empty. Bytes must really be an image
 * (by declared type or signature); SVG pictures are rasterized inside an image element, never run as a document.
 */
export async function resolveImageSources(doc: ImageDocument, root: string): Promise<ResolvedImageSources> {
  const sources: Record<string, string> = {};
  const failed: string[] = [];
  await Promise.all(doc.layers.filter((l) => l.kind === 'image' && l.source).map(async (layer) => {
    const key = layer.source!;
    if (key.startsWith('data:image/')) { sources[key] = key; return; }
    try {
      const blob = await sourceBlob(layer, root);
      if (!blob) throw new Error('image-source-unavailable');
      const type = blob.type.startsWith('image/') ? blob.type : await sniffImage(blob);
      if (!type) throw new Error('image-source-invalid');
      const typed = blob.type === type ? blob : new Blob([blob], { type });
      if (type === 'image/svg+xml') {
        const img = await loadImage(await blobDataUrl(typed));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, img.naturalWidth); canvas.height = Math.max(1, img.naturalHeight);
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('image-renderer-unavailable');
        ctx.drawImage(img, 0, 0);
        sources[key] = canvas.toDataURL('image/png');
      } else sources[key] = await blobDataUrl(typed);
    } catch { failed.push(layer.id); }
  }));
  return { sources, failed };
}

export function imageTextFonts(doc: ImageDocument): { text: string; font: string }[] {
  return doc.layers.filter((layer) => layer.kind === 'text' && layer.visible)
    .map((layer) => ({ text: layer.text ?? '', font: imageFont(layer.fontSize ?? 64, layer.fontFamily || doc.style.fontFamily) }));
}

export interface ImageRenderDeps {
  measure?: TextMeasure;
  /** Draws an SVG string into PNG bytes (replaced in tests; the default uses an image element and a canvas). */
  rasterize?: (svg: string, width: number, height: number) => Promise<Blob>;
  fonts?: (texts: { text: string; font: string }[]) => Promise<void>;
}
async function rasterizeSvg(svg: string, width: number, height: number): Promise<Blob> {
  const src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = await loadImage(src);
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('image-renderer-unavailable');
    ctx.drawImage(img, 0, 0);
    return await new Promise((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error('image-export-failed')), 'image/png'));
  } finally { URL.revokeObjectURL(src); }
}
/** SVG and PNG share one SVG string: the same layers, the same line breaks, fonts ready before measuring. */
export async function renderImageBlob(doc: ImageDocument, root: string, kind: 'png' | 'svg', deps: ImageRenderDeps = {}): Promise<Blob> {
  await (deps.fonts ?? ensureImageFonts)(imageTextFonts(doc));
  // Widths measured before a font finished loading belong to the fallback face.
  if (!deps.measure) resetImageTextMeasure();
  const { sources } = await resolveImageSources(doc, root);
  const svg = imageSvg(doc, sources, deps.measure ?? defaultTextMeasure());
  if (kind === 'svg') return new Blob([svg], { type: 'image/svg+xml' });
  return (deps.rasterize ?? rasterizeSvg)(svg, doc.width, doc.height);
}
