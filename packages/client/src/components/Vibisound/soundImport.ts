import { AUDIO_LIMITS, type AudioAsset } from '@vibisual/audio';
import { soundAssetUrl } from './soundApi.js';
import { SoundEngine } from './soundEngine.js';

/** Packet duration can include codec padding. Edit the measured decoded PCM, retain original metadata. */
export async function measureSoundImport(project: string, asset: AudioAsset): Promise<number> {
  if (asset.duration * AUDIO_LIMITS.defaultSampleRate * asset.channels > AUDIO_LIMITS.maxDecodedSamples) throw new Error('memoryLimit');
  const engine = new SoundEngine();
  try {
    const response = await fetch(soundAssetUrl(project, asset.path));
    if (!response.ok) throw new Error('decodeError');
    const pcm = await engine.decode(await response.arrayBuffer());
    const samples = pcm.channels[0]?.length ?? 0;
    if (!samples || !Number.isFinite(pcm.sampleRate) || pcm.sampleRate <= 0) throw new Error('decodeError');
    if (samples * pcm.channels.length > AUDIO_LIMITS.maxDecodedSamples) throw new Error('memoryLimit');
    return Math.min(asset.duration, samples / pcm.sampleRate);
  } catch (error) {
    if (error instanceof Error && error.message === 'memoryLimit') throw error;
    throw new Error('decodeError');
  } finally { engine.close(); }
}
