import * as THREE from 'three';
import type { Vibi3DSignRecipe } from '@vibisual/shared';
import { creationIntentId } from '../Creation/creationApi.js';
import { CreationUiError } from '../Creation/creationErrors.js';
import type { SignGlyphShape } from './signGlyphs.js';

function contour(context: CanvasRenderingContext2D, path: THREE.Path): void {
  const points = path.getPoints(8); points.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y)); context.closePath();
}
function drawShapes(context: CanvasRenderingContext2D, glyphs: SignGlyphShape[], recipe: Vibi3DSignRecipe): void {
  context.fillStyle = recipe.color ?? '#202020'; context.lineJoin = 'round';
  for (const glyph of glyphs) for (const shape of glyph.shapes) {
    context.beginPath(); contour(context, shape); for (const hole of shape.holes) contour(context, hole);
    if (recipe.outline && recipe.outline.width > 0) { context.strokeStyle = recipe.outline.color; context.lineWidth = recipe.outline.width * 2; context.stroke(); }
    context.fill('evenodd');
  }
}
function sourceCanvas(texture: THREE.Texture): CanvasImageSource {
  const image = texture.image as { data?: Uint8Array; width: number; height: number };
  if (!image?.data) return texture.image as CanvasImageSource;
  const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
  const context = canvas.getContext('2d'); if (!context) throw new CreationUiError('image-renderer-unavailable');
  const rgba = new Uint8ClampedArray(image.width * image.height * 4);
  if (image.data.length === rgba.length) rgba.set(image.data);
  else for (let i = 0; i < image.width * image.height; i++) { rgba[i * 4] = image.data[i * 3]!; rgba[i * 4 + 1] = image.data[i * 3 + 1]!; rgba[i * 4 + 2] = image.data[i * 3 + 2]!; rgba[i * 4 + 3] = 255; }
  context.putImageData(new ImageData(rgba, image.width, image.height), 0, 0); return canvas;
}

/** Canvas PNGs are embedded by Three.toJSON and then externalized through the existing creation blob store. */
export function bakeSignTexture(recipe: Vibi3DSignRecipe, glyphs: SignGlyphShape[], source?: THREE.Texture): THREE.CanvasTexture {
  if (typeof document === 'undefined') throw new CreationUiError('image-renderer-unavailable');
  const [width, height] = recipe.size ?? [3, 0.8], canvas = document.createElement('canvas');
  canvas.width = Math.max(64, Math.min(2048, Math.round(width * 512))); canvas.height = Math.max(64, Math.min(2048, Math.round(height * 512)));
  const context = canvas.getContext('2d'); if (!context) throw new CreationUiError('image-renderer-unavailable');
  if (recipe.background !== false) { context.fillStyle = recipe.background ?? '#f5f1e8'; context.fillRect(0, 0, canvas.width, canvas.height); }
  if (source) context.drawImage(sourceCanvas(source), 0, 0, canvas.width, canvas.height);
  context.translate(canvas.width / 2, canvas.height / 2); context.scale(canvas.width / width, -canvas.height / height);
  drawShapes(context, glyphs, recipe);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
  texture.uuid = creationIntentId('sign-texture-v1', recipe, source?.uuid ?? ''); texture.source.uuid = creationIntentId('sign-image-v1', texture.uuid);
  if (source?.userData['vibi3dSource']) texture.userData['vibi3dSource'] = structuredClone(source.userData['vibi3dSource']);
  texture.needsUpdate = true; return texture;
}
