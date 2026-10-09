import { useCallback, useEffect, useRef, useState } from 'react';
import { AUDIO_LIMITS, renderAudioDoc, type AudioClip, type AudioDoc } from '@vibisual/audio';
import { useTranslation } from 'react-i18next';
import { SoundEngine } from './soundEngine.js';
import { soundAssetUrl } from './soundApi.js';
import type { SoundRange } from './soundConfig.js';
import { sourceAuditionDoc } from './soundModel.js';

export function useSoundAudio(project: string, doc: AudioDoc | null, sourceClipId: string | null) {
  const { t } = useTranslation();
  const engine = useRef<SoundEngine | null>(null);
  const [pcm, setPcm] = useState<AudioClip | null>(null);
  const [mix, setMix] = useState<AudioClip | null>(null);
  const [sourceDurations, setSourceDurations] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const raf = useRef(0);
  const request = useRef(0);
  const cache = useRef<Record<string, AudioClip>>({});
  const stop = useCallback((): void => { request.current += 1; engine.current?.stop(); cancelAnimationFrame(raf.current); setPlaying(false); }, []);
  useEffect(() => {
    const instance = new SoundEngine(); engine.current = instance; cache.current = {}; setPlayhead(0);
    return () => { stop(); instance.close(); if (engine.current === instance) engine.current = null; cache.current = {}; };
  }, [project, stop]);
  useEffect(() => {
    let alive = true;
    stop(); setPcm(null); setMix(null); setSourceDurations({}); setError('');
    if (!doc) { setLoading(false); return; }
    setLoading(true);
    const instance = engine.current;
    void (async () => {
      try {
        if (!instance) return;
        const ids = [...new Set(doc.tracks.flatMap(track => track.clips.map(clip => clip.assetId)))];
        let samples = 0;
        for (const id of ids) {
          const asset = doc.assets[id];
          if (!asset) throw new Error('Missing audio source');
          samples += asset.duration * Math.max(asset.sampleRate, 48000) * asset.channels;
        }
        if (samples > AUDIO_LIMITS.maxDecodedSamples) throw new Error(t('panel.vibisound.workbench.memoryLimit'));
        for (const id of Object.keys(cache.current)) if (!ids.includes(id)) delete cache.current[id];
        for (const id of ids) {
          if (!alive) return;
          if (cache.current[id]) continue;
          const asset = doc.assets[id];
          if (!asset) continue;
          const res = await fetch(soundAssetUrl(project, asset.path));
          if (!res.ok) throw new Error(`Audio source: HTTP ${res.status}`);
          let decoded: AudioClip;
          try { decoded = await instance.decode(await res.arrayBuffer()); }
          catch { throw new Error(t('panel.vibisound.workbench.decodeError')); }
          if (!alive) return;
          cache.current[id] = decoded;
        }
        if (!alive) return;
        setSourceDurations(Object.fromEntries(Object.entries(cache.current).map(([id, value]) => [id, (value.channels[0]?.length ?? 0) / value.sampleRate])));
        const rendered = renderAudioDoc(doc, cache.current);
        setMix(rendered);
        const clip = doc.tracks.flatMap(track => track.clips).find(value => value.id === sourceClipId);
        const audition = clip ? renderAudioDoc(sourceAuditionDoc(doc, clip.id), cache.current) : rendered;
        setPcm(audition);
        setPlayhead(value => Math.min(value, (audition.channels[0]?.length ?? 0) / audition.sampleRate));
      } catch (err) { if (alive) setError(err instanceof Error ? err.message : String(err)); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [doc, project, sourceClipId, stop, t]);
  const play = useCallback(async (range: SoundRange | null, loop: boolean): Promise<void> => {
    if (!pcm || !engine.current) return;
    const tag = ++request.current;
    try {
      const instance = engine.current;
      const state = await instance.play(pcm, playhead, range, loop, () => { cancelAnimationFrame(raf.current); setPlaying(false); setPlayhead(state.end); });
      if (tag !== request.current) return;
      setPlaying(true);
      const tick = (): void => {
        let position = state.offset + instance.currentTime - state.at;
        if (state.looping && position >= state.end) position = state.loopStart + ((position - state.loopStart) % (state.end - state.loopStart));
        setPlayhead(Math.min(position, state.end)); raf.current = requestAnimationFrame(tick);
      };
      raf.current = requestAnimationFrame(tick);
    } catch (err) { if (tag === request.current) setError(err instanceof Error ? err.message : String(err)); }
  }, [pcm, playhead]);
  const seek = useCallback((value: number): void => { stop(); setPlayhead(value); }, [stop]);
  return { pcm, mix, sourceDurations, loading, error, playing, playhead, play, stop, seek };
}
