import { useCallback, useEffect, useRef, useState } from 'react';
import { resolveTimeline, type VideoDoc } from '@vibisual/video';
import { mixAudio } from '@vibisual/video/render';
import { assetUrl } from './videoApi.js';

const PREVIEW_SYNC_TOLERANCE = 0.15;
interface MixedAudio { buffer: AudioBuffer | null; warnings: readonly string[] }
interface MixCache { key: string; promise: Promise<MixedAudio>; abort: AbortController }
interface Playback { source: AudioBufferSourceNode; offset: number; startedAt: number; duration: number }

/** Uses the export mixer, so preview shares trim, volume, fade and mute semantics. */
export function useVideoAudio(
  project: string, doc: VideoDoc | null, playing: boolean, playhead: number, loop: boolean, onError: (message: string) => void,
): { resume: () => void } {
  const context = useRef<AudioContext | null>(null);
  const playback = useRef<Playback | null>(null);
  const cache = useRef<MixCache | null>(null);
  const alive = useRef(true);
  const [contextGeneration, setContextGeneration] = useState(0);
  const latest = useRef({ project, doc, playing, playhead, loop, onError });
  latest.current = { project, doc, playing, playhead, loop, onError };
  const key = doc ? JSON.stringify([project, doc.id, doc.version]) : '';

  const stop = useCallback((): void => {
    const previous = playback.current;
    playback.current = null;
    if (!previous) return;
    previous.source.onended = null;
    previous.source.stop();
    previous.source.disconnect();
  }, []);
  const start = useCallback((buffer: AudioBuffer, position: number): void => {
    const ctx = context.current;
    if (!ctx || !latest.current.playing || buffer.duration <= 0) return;
    const offset = Math.max(0, Number.isFinite(position) ? position : 0);
    stop();
    if (offset >= buffer.duration && !latest.current.loop) return;
    const source = ctx.createBufferSource();
    source.buffer = buffer; source.loop = latest.current.loop;
    source.loopStart = 0; source.loopEnd = buffer.duration;
    source.connect(ctx.destination);
    const actualOffset = latest.current.loop ? offset % buffer.duration : offset;
    const state = { source, offset: actualOffset, startedAt: ctx.currentTime, duration: buffer.duration };
    playback.current = state;
    source.onended = (): void => {
      source.disconnect();
      if (playback.current === state) playback.current = null;
    };
    try { source.start(0, actualOffset); }
    catch (error) { source.disconnect(); if (playback.current === state) playback.current = null; throw error; }
  }, [stop]);

  // This method must run synchronously inside the user's play gesture to unlock Web Audio.
  const resume = useCallback((): void => {
    if (!alive.current || typeof AudioContext === 'undefined') return;
    try {
      if (!context.current || context.current.state === 'closed') {
        context.current = new AudioContext();
        setContextGeneration(value => value + 1);
      }
      const current = context.current;
      const request = latest.current;
      void current.resume().catch(error => {
        if (alive.current && context.current === current && latest.current.project === request.project && latest.current.doc === request.doc) latest.current.onError(String(error));
      });
    } catch (error) { if (alive.current) latest.current.onError(String(error)); }
  }, []);

  useEffect(() => {
    // A document/project boundary invalidates pending bytes as well as the decoded mix.
    if (cache.current?.key !== key) { cache.current?.abort.abort(); cache.current = null; }
    stop();
    let current = true;
    if (!doc || !playing || !context.current || typeof OfflineAudioContext === 'undefined') return;
    if (!cache.current) {
      const abort = new AbortController();
      const warnings: string[] = [];
      const promise = mixAudio({ doc, timeline: resolveTimeline(doc), onWarn: warning => warnings.push(warning), loader: {
        async fetchBytes(asset): Promise<ArrayBuffer | null> {
          const path = asset.source.kind === 'file' ? asset.source.path : asset.source.output;
          const response = await fetch(assetUrl(project, path), { signal: abort.signal });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.arrayBuffer();
        },
      } }).then(buffer => ({ buffer, warnings }));
      cache.current = { key, promise, abort };
    }
    const mixed = cache.current;
    const isCurrent = (): boolean => {
      const activeDoc = latest.current.doc;
      const activeKey = activeDoc ? JSON.stringify([latest.current.project, activeDoc.id, activeDoc.version]) : '';
      return current && alive.current && latest.current.playing && cache.current === mixed && activeKey === mixed.key;
    };
    void mixed.promise.then(result => {
      if (!isCurrent()) return;
      for (const warning of result.warnings) latest.current.onError(warning);
      if (result.buffer) start(result.buffer, latest.current.playhead);
      // A failed/partial decode can be retried on the next play without changing the document.
      if (result.warnings.length > 0 && cache.current === mixed) cache.current = null;
    }).catch(error => {
      const report = isCurrent();
      if (cache.current === mixed) cache.current = null;
      if (report) latest.current.onError(String(error));
    });
    return () => { current = false; stop(); };
    // A version uniquely identifies the immutable document; playhead advances every frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, playing, loop, contextGeneration, start, stop]);

  useEffect(() => {
    const active = playback.current;
    const ctx = context.current;
    if (!playing || !active || !ctx || ctx.state !== 'running') return;
    const elapsed = active.offset + ctx.currentTime - active.startedAt;
    const expected = loop ? elapsed % active.duration : elapsed;
    const distance = Math.abs(playhead - expected);
    const drift = loop ? Math.min(distance, Math.abs(active.duration - distance)) : distance;
    if (drift <= PREVIEW_SYNC_TOLERANCE || !active.source.buffer) return;
    try { start(active.source.buffer, playhead); }
    catch (error) { latest.current.onError(String(error)); }
  }, [playhead, playing, loop, start]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false; stop(); cache.current?.abort.abort(); cache.current = null;
      const previous = context.current; context.current = null;
      // Teardown failures cannot affect a mounted player or be shown in a different document.
      if (previous && previous.state !== 'closed') void previous.close().catch(() => undefined);
    };
  }, [stop]);
  return { resume };
}
