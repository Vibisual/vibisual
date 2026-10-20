export type SceneLookQuality = 'draft' | 'final' | 'auto';
export interface SceneLookCapabilities { maxTextureSize: number; maxSamples: number }

/** Reduce only raster resolution/sampling; sunlight, exposure and material values never depend on the GPU or OS. */
export function sceneLookQuality(quality: SceneLookQuality, capabilities: SceneLookCapabilities): { scale: number; samples: number } {
  if (quality === 'final') return { scale: 1, samples: Math.min(4, capabilities.maxSamples) };
  const scale = quality === 'draft' || capabilities.maxTextureSize < 4096 ? 0.5
    : capabilities.maxTextureSize < 8192 ? 0.75 : 1;
  return { scale, samples: Math.min(quality === 'draft' ? 0 : 2, capabilities.maxSamples) };
}
