import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatClipTime, type AudioDoc, type AudioDocOp } from '@vibisual/audio';
import { SoundButton } from './SoundButton.js';
import { SoundNumberField } from './SoundNumberField.js';

interface Props {
  doc: AudioDoc; selected: string | null; playhead: number; busy: boolean;
  onSelect: (id: string) => void; onSeek: (time: number) => void;
  patch: (ops: readonly AudioDocOp[], version?: number) => Promise<void>;
}
interface Drag { id: string; trackId: string; at: number; x: number; width: number; version: number; pointer: number }
const WIDTH = 1000;
export function SoundTracks({ doc, selected, playhead, busy, onSelect, onSeek, patch }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const tr = (key: string): string => t(`panel.vibisound.workbench.${key}`);
  const drag = useRef<Drag | null>(null);
  const [preview, setPreview] = useState<{ id: string; at: number } | null>(null);
  const duration = Math.max(1, ...doc.tracks.flatMap(track => track.clips.map(clip => clip.at + clip.duration)));
  return <section className="space-y-2">
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">{tr('timeline')}</h2>
      <SoundButton disabled={busy} onClick={() => void patch([{ op: 'addTrack', track: { id: crypto.randomUUID(), label: `${tr('track')} ${doc.tracks.length + 1}`, clips: [] } }], doc.version)}>{tr('addTrack')}</SoundButton>
    </div>
    {doc.tracks.map(track => <div key={track.id} className="rounded border border-white/10 bg-slate-950/40 p-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-xs text-slate-200" title={track.label}>{track.label ?? tr('track')}</span>
        <SoundButton disabled={busy} aria-pressed={track.muted ?? false} accent={track.muted} onClick={() => void patch([{ op: 'updateTrack', trackId: track.id, patch: { muted: !track.muted } }], doc.version)}>{tr('mute')}</SoundButton>
        <SoundButton disabled={busy} aria-pressed={track.solo ?? false} accent={track.solo} onClick={() => void patch([{ op: 'updateTrack', trackId: track.id, patch: { solo: !track.solo } }], doc.version)}>{tr('solo')}</SoundButton>
        <div className="w-24"><SoundNumberField label={tr('gain')} value={track.gainDb ?? 0} min={-96} max={24} version={doc.version} disabled={busy} onCommit={(value, version) => void patch([{ op: 'updateTrack', trackId: track.id, patch: { gainDb: value } }], version)} /></div>
        <SoundButton disabled={busy || track.clips.some(clip => clip.locked)} onClick={() => void patch([{ op: 'removeTrack', trackId: track.id }], doc.version)}>{tr('removeTrack')}</SoundButton>
      </div>
      <svg viewBox={`0 0 ${WIDTH} 42`} preserveAspectRatio="none" className="mt-2 h-12 w-full touch-none rounded bg-slate-900" aria-label={track.label ?? tr('track')}
        onPointerMove={event => {
          const value = drag.current;
          if (value && event.pointerId === value.pointer) setPreview({ id: value.id, at: Math.max(0, value.at + (event.clientX - value.x) / value.width * duration) });
        }}
        onPointerUp={event => {
          const value = drag.current; drag.current = null; setPreview(null);
          if (value && event.pointerId === value.pointer && Math.abs(event.clientX - value.x) > 3) {
            void patch([{ op: 'moveClip', clipId: value.id, toTrackId: value.trackId, at: Math.max(0, value.at + (event.clientX - value.x) / value.width * duration) }], value.version);
          }
        }} onPointerCancel={() => { drag.current = null; setPreview(null); }}>
        <rect width={WIDTH} height={42} fill="transparent" onPointerDown={event => { const rect = event.currentTarget.getBoundingClientRect(); onSeek((event.clientX - rect.left) / rect.width * duration); }} />
        {track.clips.map(clip => {
          const at = preview?.id === clip.id ? preview.at : clip.at;
          const name = clip.label ?? doc.assets[clip.assetId]?.name ?? tr('selectClip');
          return <g key={clip.id} role="button" tabIndex={0} aria-label={`${name}, ${formatClipTime(clip.at)}`} aria-pressed={selected === clip.id} className={clip.locked || busy ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'}
            onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); onSelect(clip.id); } }}
            onPointerDown={event => {
              event.stopPropagation(); onSelect(clip.id);
              if (clip.locked || busy || event.button !== 0) return;
              const svg = event.currentTarget.ownerSVGElement; if (!svg) return;
              drag.current = { id: clip.id, trackId: track.id, at: clip.at, x: event.clientX, width: svg.getBoundingClientRect().width, version: doc.version, pointer: event.pointerId };
              svg.setPointerCapture(event.pointerId);
            }}>
            <title>{name} · {formatClipTime(clip.at)}–{formatClipTime(clip.at + clip.duration)}</title>
            <rect x={at / duration * WIDTH} y={5} width={Math.max(4, clip.duration / duration * WIDTH)} height={32} rx={4} fill={selected === clip.id ? '#0f766e' : '#1e3a42'} stroke={selected === clip.id ? '#5eead4' : '#315862'} opacity={clip.enabled === false || track.muted ? 0.4 : 1} />
          </g>;
        })}
        <line x1={playhead / duration * WIDTH} x2={playhead / duration * WIDTH} y1={0} y2={42} stroke="#fde68a" pointerEvents="none" />
      </svg>
      <div className="mt-2 flex flex-wrap gap-1">{track.clips.map(clip => <SoundButton key={clip.id} accent={selected === clip.id} aria-pressed={selected === clip.id} onClick={() => onSelect(clip.id)}>{clip.label ?? doc.assets[clip.assetId]?.name ?? tr('selectClip')}</SoundButton>)}</div>
    </div>)}
  </section>;
}
