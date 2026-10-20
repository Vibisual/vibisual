import * as THREE from 'three';
import type { Vibi3DCaptureRaster } from '@vibisual/shared';

const rasters = new WeakMap<THREE.WebGLRenderer, Vibi3DCaptureRaster>();
export function recordSceneRaster(renderer: THREE.WebGLRenderer, raster: Vibi3DCaptureRaster): void { rasters.set(renderer, raster); }
export function clearSceneRaster(renderer: THREE.WebGLRenderer): void { rasters.delete(renderer); }
/** Read after a draw; never infer internal resolution from the encoded PNG dimensions. */
export function readStudioViewRaster(renderer: THREE.WebGLRenderer): Vibi3DCaptureRaster | undefined {
  const raster = rasters.get(renderer); return raster ? { ...raster } : undefined;
}
export function recordDirectSceneRaster(renderer: THREE.WebGLRenderer): void {
  if (typeof renderer.getDrawingBufferSize !== 'function') return;
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const samples = (renderer.capabilities as { samples?: number } | undefined)?.samples;
  recordSceneRaster(renderer, { width: size.x, height: size.y,
    ...(Number.isSafeInteger(samples) && samples! >= 0 ? { samples } : {}) });
}
