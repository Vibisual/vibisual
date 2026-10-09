/** Allocation and document limits are shared by validation, rendering, and hosts. */
export const AUDIO_LIMITS = {
  minSampleRate: 8_000,
  maxSampleRate: 192_000,
  defaultSampleRate: 48_000,
  defaultChannels: 2,
  minGainDb: -96,
  maxGainDb: 24,
  maxTracks: 64,
  maxClips: 4_096,
  maxAssets: 1_024,
  maxOps: 256,
  maxTimelineSeconds: 86_400,
  maxRenderSamples: 32_000_000,
  maxDecodedSamples: 64_000_000,
  maxPeakColumns: 65_536,
  maxTextLength: 4_096,
  timeEpsilon: 1e-8,
} as const;
