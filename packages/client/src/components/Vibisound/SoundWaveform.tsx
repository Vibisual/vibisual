import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { computePeaks, formatClipTime, type AudioClip } from '@vibisual/audio';
import { useInspectorPicker } from '../../hooks/useInspectorPicker.js';
import { SOUND_UI, type SoundRange } from './soundConfig.js';
import { SoundButton } from './SoundButton.js';
import { soundWaveLevels, type SoundInspectContext } from './soundInspect.js';
interface SoundWaveformProps {
  pcm: AudioClip | null; playhead: number; selection: SoundRange | null; onSeek: (at: number) => void; onSelect: (range: SoundRange | null) => void;
  /** §5.4 #15 (C) — Alt 인스펙터가 파형 안의 시각·클립을 집는다. */
  inspect?: SoundInspectContext | null;
}
export function SoundWaveform({ pcm, playhead, selection, onSeek, onSelect, inspect }: SoundWaveformProps): React.JSX.Element {
  const { t } = useTranslation();
  const tr = (key: string): string => t(`panel.vibisound.workbench.${key}`);
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const anchor = useRef<number | null>(null);
  // 0 = 아직 못 잼 — 재기 전엔 그리지 않는다(짐작 폭 800 으로 그리면 폰에서 첫 장면이 찌그러진다).
  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState(0);
  const duration = pcm ? (pcm.channels[0]?.length ?? 0) / pcm.sampleRate : 0;
  const span = duration / zoom;
  const start = Math.min(offset, Math.max(0, duration - span));
  useLayoutEffect(() => {
    const element = wrap.current; if (!element) return;
    const resize = (): void => setWidth(Math.max(SOUND_UI.minCanvasWidth, element.clientWidth));
    const observer = new ResizeObserver(resize); observer.observe(element); resize(); return () => observer.disconnect();
  }, []);
  const peaks = useMemo(() => pcm && width > 0 ? computePeaks({ sampleRate: pcm.sampleRate, channels: pcm.channels.map(ch => ch.subarray(Math.floor(start * pcm.sampleRate), Math.ceil((start + span) * pcm.sampleRate))) }, Math.ceil(width)) : new Float32Array(0), [pcm, start, span, width]);
  useEffect(() => {
    const element = canvas.current; if (!element || width <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    const height = SOUND_UI.waveformHeight;
    element.width = width * dpr; element.height = height * dpr;
    const g = element.getContext('2d'); if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = SOUND_UI.background; g.fillRect(0, 0, width, height);
    g.strokeStyle = SOUND_UI.grid; g.beginPath(); g.moveTo(0, height / 2); g.lineTo(width, height / 2); g.stroke();
    if (!span) return;
    if (selection) { g.fillStyle = SOUND_UI.selection; g.fillRect((selection.start - start) / span * width, 0, (selection.end - selection.start) / span * width, height); }
    g.strokeStyle = SOUND_UI.wave; g.beginPath();
    for (let x = 0; x < width; x++) { g.moveTo(x, height / 2 - (peaks[x * 2 + 1] ?? 0) * (height / 2 - 8)); g.lineTo(x, height / 2 - (peaks[x * 2] ?? 0) * (height / 2 - 8)); } g.stroke();
    const head = (playhead - start) / span * width;
    g.strokeStyle = SOUND_UI.playhead; g.beginPath(); g.moveTo(head, 0); g.lineTo(head, height); g.stroke();
  }, [peaks, width, span, start, selection, playhead]);
  useInspectorPicker(canvas, inspect && span > 0 ? (point) => soundWaveLevels(inspect, { start, span }, selection, {
    track: tr('track'), range: (from, to) => t('panel.vibisound.workbench.range', { start: from, end: to }),
  }, point) : null);
  const at = (clientX: number): number => {
    const rect = canvas.current?.getBoundingClientRect();
    return rect ? start + Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * span : 0;
  };
  return <div ref={wrap} className="min-w-0">
    <div className="flex flex-wrap items-center gap-3 pb-2 text-xs text-slate-400">
      <span className="font-medium text-slate-200">{tr('timeline')}</span><span className="ml-auto tabular-nums">{formatClipTime(start)} — {formatClipTime(start + span)}</span>
      <label className="flex items-center gap-2">{tr('zoom')}<input aria-label={tr('zoom')} type="range" min="1" max={SOUND_UI.maxZoom} step="1" value={zoom} onChange={event => setZoom(Number(event.target.value))} className="w-20 accent-teal-400" /></label>
      <SoundButton onClick={() => { setZoom(1); setOffset(0); }}>{tr('fit')}</SoundButton>
    </div>
    <canvas ref={canvas} aria-label={tr('timeline')} className="h-[200px] w-full touch-none rounded-lg border border-white/10"
      onPointerDown={event => { if (!duration) return; event.currentTarget.setPointerCapture(event.pointerId); anchor.current = at(event.clientX); onSeek(anchor.current); onSelect(null); }}
      onPointerMove={event => { if (anchor.current === null) return; const end = at(event.clientX); onSelect(Math.abs(end - anchor.current) > SOUND_UI.rangeThreshold ? { start: Math.min(anchor.current, end), end: Math.max(anchor.current, end) } : null); }}
      onPointerUp={event => { anchor.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={() => { anchor.current = null; }} />
    {zoom > 1 && <input aria-label={tr('viewStart')} type="range" min="0" max={Math.max(0, duration - span)} step="0.01" value={start} onChange={event => setOffset(Number(event.target.value))} className="mt-2 w-full accent-teal-400" />}
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
      {selection ? <><span>{t('panel.vibisound.workbench.range', { start: formatClipTime(selection.start), end: formatClipTime(selection.end) })}</span><SoundButton onClick={() => onSelect(null)}>{tr('clearRange')}</SoundButton></> : tr('selectHint')}
    </div>
  </div>;
}
