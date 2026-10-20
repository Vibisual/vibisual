import { creationStableJson, escapeCreationPointer, parseCreationBlobRef } from '@vibisual/shared';
import { IMAGE_LINE_HEIGHT, imageFont, wrapTextToWidth, type TextMeasure } from './imageText.js';

/**
 * §5.13 (R-9)(R-10) — the editable image source schema (Vibimage owns the editor; other apps read and render it).
 * Raster imports remain a single image layer.
 */
export interface ImageLayer {
  id: string;
  kind: 'text' | 'shape' | 'image';
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  opacity: number;
  locked: boolean;
  visible: boolean;
  anchor: 'start' | 'center' | 'end';
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  align?: 'left' | 'center' | 'right';
  shape?: 'rect' | 'ellipse';
  source?: string;
  /** How a picture fills its box: whole picture (default) or cropped to fill. */
  fit?: 'contain' | 'cover';
  /** Provenance only. The renderer uses source, whose bytes are snapshotted on import. */
  sourceOriginal?: string;
}

export interface ImageDocument {
  format: 'vibimage';
  version: 1;
  width: number;
  height: number;
  background: string;
  style: { fontFamily: string; foreground: string; accent: string; margin: number };
  layers: ImageLayer[];
}

export const IMAGE_LIMITS = { minSize: 16, maxSize: 8192, maxLayers: 250, history: 50, fileBytes: 4 * 1024 * 1024 };
export const IMAGE_RATIOS = { landscape: [1920, 1080], square: [1080, 1080], portrait: [1080, 1920] } as const;
export const IMAGE_DEFAULT_STYLE = { fontFamily: 'Arial, sans-serif', foreground: '#172033', accent: '#e9b45e', margin: 64 };
export function newImageDocument(): ImageDocument {
  return { format: 'vibimage', version: 1, width: 1080, height: 1080, background: '#ffffff', style: { ...IMAGE_DEFAULT_STYLE }, layers: [] };
}
export function imageId(): string { return crypto.randomUUID(); }
const color = (v: unknown): v is string => typeof v === 'string' && /^(#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})|transparent)$/i.test(v);
const number = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function validLayer(layer: unknown, ids: Set<string>): boolean {
  if (!object(layer) || typeof layer.id !== 'string' || !layer.id || ids.has(layer.id)) return false;
  ids.add(layer.id);
  if (!['text', 'shape', 'image'].includes(String(layer.kind)) || typeof layer.name !== 'string'
    || !['start', 'center', 'end'].includes(String(layer.anchor)) || !color(layer.fill)
    || typeof layer.locked !== 'boolean' || typeof layer.visible !== 'boolean') return false;
  if (![layer.x, layer.y, layer.width, layer.height, layer.opacity].every(number)
    || (layer.width as number) <= 0 || (layer.height as number) <= 0
    || (layer.opacity as number) < 0 || (layer.opacity as number) > 1) return false;
  if (layer.fit !== undefined && layer.fit !== 'contain' && layer.fit !== 'cover') return false;
  if (layer.kind === 'text') {
    return typeof layer.text === 'string' && layer.text.length <= 20_000
      && number(layer.fontSize) && layer.fontSize > 0 && layer.fontSize <= IMAGE_LIMITS.maxSize
      && typeof layer.fontFamily === 'string' && ['left', 'center', 'right'].includes(String(layer.align));
  }
  if (layer.kind === 'shape') return layer.shape === 'rect' || layer.shape === 'ellipse';
  return typeof layer.source === 'string' && safeImageSource(layer.source);
}

/** Validate loaded/agent data before rendering; never execute source strings as code. */
export function isImageDocument(value: unknown): value is ImageDocument {
  if (!object(value) || value.format !== 'vibimage' || value.version !== 1) return false;
  const size = (v: unknown): boolean => number(v) && Number.isInteger(v) && v >= IMAGE_LIMITS.minSize && v <= IMAGE_LIMITS.maxSize;
  if (!size(value.width) || !size(value.height)) return false;
  if (!color(value.background) || !object(value.style) || typeof value.style.fontFamily !== 'string'
    || !color(value.style.foreground) || !color(value.style.accent) || !number(value.style.margin) || value.style.margin < 0) return false;
  if (!Array.isArray(value.layers) || value.layers.length > IMAGE_LIMITS.maxLayers) return false;
  const ids = new Set<string>();
  return value.layers.every((layer: unknown) => validLayer(layer, ids));
}

/** Embedded raster, a stored blob reference, or a project-relative path (never absolute, never escaping). */
export function safeImageSource(source: string): boolean {
  if (/^data:image\/(png|jpeg|webp|gif|avif|bmp);base64,[a-z0-9+/=\r\n]+$/i.test(source)) return true;
  const blob = parseCreationBlobRef(source);
  if (blob) return ['png', 'jpg', 'webp', 'gif', 'avif', 'bmp', 'svg'].includes(blob.ext);
  return !!source && !/^(?:[a-z][a-z0-9+.-]*:|[\\/])/i.test(source) && !source.replace(/\\/g, '/').split('/').includes('..');
}

export function newImageLayer(doc: ImageDocument, kind: ImageLayer['kind'], name: string): ImageLayer {
  const width = Math.max(100, doc.width - doc.style.margin * 2);
  return {
    id: imageId(), kind, name, x: doc.style.margin, y: doc.style.margin,
    width, height: kind === 'text' ? 120 : 300, fill: kind === 'text' ? doc.style.foreground : doc.style.accent,
    opacity: 1, locked: false, visible: true, anchor: 'center',
    ...(kind === 'text' ? { text: name, fontSize: 64, fontFamily: doc.style.fontFamily, align: 'left' as const } : {}),
    ...(kind === 'shape' ? { shape: 'rect' as const } : {}),
  };
}
export function patchImageLayer(doc: ImageDocument, id: string, patch: Partial<ImageLayer>): ImageDocument {
  return { ...doc, layers: doc.layers.map((layer) => layer.id !== id || (layer.locked && patch.locked !== false)
    ? layer : { ...layer, ...patch, id: layer.id, kind: layer.kind }) };
}
export function reorderImageLayer(doc: ImageDocument, id: string, direction: number): ImageDocument {
  const index = doc.layers.findIndex((layer) => layer.id === id);
  if (index < 0 || doc.layers[index]?.locked) return doc;
  const layers = [...doc.layers];
  const [layer] = layers.splice(index, 1);
  layers.splice(Math.max(0, Math.min(layers.length, index + direction)), 0, layer!);
  return { ...doc, layers };
}

/** Project style applied to what already exists: text takes the font and foreground, shapes the accent. Locked layers stay. */
export function applyImageStyle(doc: ImageDocument, style: ImageDocument['style']): ImageDocument {
  return {
    ...doc, style: { ...style },
    layers: doc.layers.map((layer) => {
      if (layer.locked) return layer;
      if (layer.kind === 'text') return { ...layer, fontFamily: style.fontFamily, fill: style.foreground };
      if (layer.kind === 'shape') return { ...layer, fill: style.accent };
      return layer;
    }),
  };
}

const EDGE = 1;
/** A layer covering the whole canvas is a background: it fills the new format instead of shrinking into it. */
export function isFullBleed(doc: ImageDocument, layer: ImageLayer): boolean {
  return layer.x <= EDGE && layer.y <= EDGE && layer.x + layer.width >= doc.width - EDGE && layer.y + layer.height >= doc.height - EDGE;
}

/**
 * Derived formats (§5.13 (R-10) 2026-10-15): text boxes take their share of the new safe width and the text flows
 * again; full-canvas backgrounds fill the new canvas (photos crop to fill); other layers keep anchor + uniform scale.
 */
export function imageVariant(doc: ImageDocument, width: number, height: number, measure: TextMeasure): ImageDocument {
  const factor = Math.min(width / doc.width, height / doc.height);
  const margin = Math.min(doc.style.margin * factor, Math.min(width, height) / 4);
  const safeWidth = Math.max(1, width - margin * 2);
  const safeHeight = Math.max(1, height - margin * 2);
  const oldSafeWidth = Math.max(1, doc.width - doc.style.margin * 2);
  const place = (layer: ImageLayer, w: number, h: number): { x: number; y: number } => {
    const center = (layer.x + layer.width / 2) / doc.width;
    const x = layer.anchor === 'start' ? margin : layer.anchor === 'end' ? width - margin - w : center * width - w / 2;
    const y = (layer.y + layer.height / 2) / doc.height * height - h / 2;
    return { x: Math.max(margin, Math.min(width - margin - w, x)), y: Math.max(margin, Math.min(height - margin - h, y)) };
  };
  return {
    ...doc, width, height, style: { ...doc.style, margin },
    layers: doc.layers.map((layer) => {
      if (isFullBleed(doc, layer)) return { ...layer, x: 0, y: 0, width, height, ...(layer.kind === 'image' ? { fit: 'cover' as const } : {}) };
      if (layer.kind === 'text') {
        const fontSize = Math.max(1, (layer.fontSize ?? 64) * factor);
        const share = Math.min(1, layer.width / oldSafeWidth);
        const w = Math.min(safeWidth, Math.max(fontSize * 2, share * safeWidth));
        const lines = wrapTextToWidth(layer.text ?? '', w, imageFont(fontSize, layer.fontFamily ?? doc.style.fontFamily), measure);
        const h = Math.min(safeHeight, Math.max(layer.height * factor, lines.length * fontSize * IMAGE_LINE_HEIGHT + fontSize * 0.3));
        return { ...layer, ...place(layer, w, h), width: w, height: h, fontSize };
      }
      const scale = Math.min(factor, safeWidth / layer.width, safeHeight / layer.height);
      const w = layer.width * scale;
      const h = layer.height * scale;
      return { ...layer, ...place(layer, w, h), width: w, height: h };
    }),
  };
}

export function changedImageLayers(before: ImageDocument, after: ImageDocument): string[] {
  const previous = new Map(before.layers.map((layer) => [layer.id, creationStableJson(layer)]));
  const changes = after.layers.filter((layer) => previous.get(layer.id) !== creationStableJson(layer)).map((layer) => layer.id);
  return [...changes, ...before.layers.filter((layer) => !after.layers.some((next) => next.id === layer.id)).map((layer) => layer.id)];
}

export function imageLayerPointer(id: string): string {
  return `/layers/@${escapeCreationPointer(id)}`;
}
export function imageLockedPaths(doc: ImageDocument): string[] {
  return doc.layers.flatMap((layer) => layer.locked ? [imageLayerPointer(layer.id)] : []);
}
