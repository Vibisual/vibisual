import type * as THREE from 'three';

/** PMREM restores these only on success. A lost-context throw must not poison the next direct render/capture. */
export function preserveEnvironmentRenderer(renderer: THREE.WebGLRenderer): () => void {
  if (typeof renderer.getRenderTarget !== 'function' || typeof renderer.setRenderTarget !== 'function') return () => undefined;
  const target = renderer.getRenderTarget(), face = renderer.getActiveCubeFace?.() ?? 0, mip = renderer.getActiveMipmapLevel?.() ?? 0;
  const tone = renderer.toneMapping, autoClear = renderer.autoClear, xr = renderer.xr?.enabled;
  return () => {
    renderer.toneMapping = tone; renderer.autoClear = autoClear;
    if (renderer.xr && xr !== undefined) renderer.xr.enabled = xr;
    renderer.setRenderTarget(target, face, mip);
  };
}
