import { vibi3DCameraAspectRatio, type Vibi3DCameraAspect } from '@vibisual/shared';

/** Fit the actual drawing surface so portrait optics are never stretched by the editor container. */
export function vibi3dViewSize(width: number, height: number, aspect?: Vibi3DCameraAspect): { width: number; height: number; left: number; top: number } {
  const ratio = vibi3DCameraAspectRatio(aspect, width / Math.max(1, height));
  const w = Math.max(1, Math.round(Math.min(width, height * ratio))), h = Math.max(1, Math.round(Math.min(height, width / ratio)));
  return { width: w, height: h, left: (width - w) / 2, top: (height - h) / 2 };
}
