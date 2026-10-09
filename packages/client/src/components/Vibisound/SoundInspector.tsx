import { useTranslation } from 'react-i18next';
import type { AudioDoc, AudioDocOp, AudioTimelineClip } from '@vibisual/audio';
import { SoundNumberField } from './SoundNumberField.js';
import { SoundButton } from './SoundButton.js';
import { clipLocalRange } from './soundModel.js';
import type { SoundRange } from './soundConfig.js';

interface SoundInspectorProps {
  doc: AudioDoc; clip?: AudioTimelineClip; sourceDuration?: number; selection: SoundRange | null; playhead: number; busy: boolean;
  patch: (ops: readonly AudioDocOp[], version?: number) => Promise<void>;
}
export function SoundInspector({ doc, clip, sourceDuration, selection, playhead, busy, patch }: SoundInspectorProps): React.JSX.Element {
  const { t } = useTranslation();
  const tr = (key: string): string => t(`panel.vibisound.workbench.${key}`);
  if (!clip) return <p className="p-4 text-xs leading-relaxed text-slate-400">{tr('selectClip')}</p>;
  const disabled = busy || clip.locked;
  const asset = doc.assets[clip.assetId];
  const available = Math.min(asset?.duration ?? clip.duration, sourceDuration ?? Infinity);
  const range = clipLocalRange(clip, selection);
  const track = doc.tracks.find(value => value.clips.some(item => item.id === clip.id));
  const update = (key: 'at' | 'sourceStart' | 'duration' | 'gainDb' | 'fadeIn' | 'fadeOut', value: number, version: number): void => {
    void patch([{ op: 'updateClip', clipId: clip.id, patch: { [key]: value } }], version);
  };
  const localHead = playhead - clip.at;
  const fields = [
    { key: 'at' as const, label: 'position', value: clip.at, min: 0 },
    { key: 'sourceStart' as const, label: 'sourceStart', value: clip.sourceStart, min: 0, max: Math.max(0, available - clip.duration) },
    { key: 'duration' as const, label: 'duration', value: clip.duration, min: 0.001, max: available - clip.sourceStart },
    { key: 'gainDb' as const, label: 'gain', value: clip.gainDb ?? 0, min: -96, max: 24 },
    { key: 'fadeIn' as const, label: 'fadeIn', value: clip.fadeIn ?? 0, min: 0, max: clip.duration },
    { key: 'fadeOut' as const, label: 'fadeOut', value: clip.fadeOut ?? 0, min: 0, max: clip.duration },
  ];
  return <div className="space-y-3 p-3">
    <p className="truncate text-sm font-medium text-teal-100" title={clip.label ?? asset?.name}>{clip.label ?? asset?.name}</p>
    <div className="grid grid-cols-2 gap-3">
      {fields.map(field => <SoundNumberField key={`${clip.id}-${field.key}`} label={tr(field.label)} value={field.value} version={doc.version} min={field.min} max={field.max} disabled={disabled} onCommit={(value, version) => update(field.key, value, version)} />)}
    </div>
    {clip.gainEnvelope && <p className="text-xs leading-relaxed text-slate-400">{tr('fadeEnvelope')}</p>}
    <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={clip.locked ?? false} disabled={busy} onChange={event => void patch([{ op: 'updateClip', clipId: clip.id, patch: { locked: event.target.checked } }], doc.version)} />{tr('lock')}</label>
    <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={clip.enabled !== false} disabled={disabled} onChange={event => void patch([{ op: 'updateClip', clipId: clip.id, patch: { enabled: event.target.checked } }], doc.version)} />{tr('enabled')}</label>
    <label className="block text-xs text-slate-400">{tr('track')}
      <select value={track?.id} disabled={disabled} onChange={event => void patch([{ op: 'moveClip', clipId: clip.id, toTrackId: event.target.value, at: clip.at }], doc.version)} className="mt-1 w-full rounded border border-white/10 bg-slate-900 p-2 text-xs text-slate-200">
        {doc.tracks.map(item => <option key={item.id} value={item.id}>{item.label ?? tr('track')}</option>)}
      </select>
    </label>
    <div className="flex flex-wrap gap-2">
      <SoundButton disabled={disabled || localHead <= 0 || localHead >= clip.duration} onClick={() => void patch([{ op: 'splitClip', clipId: clip.id, at: localHead, newClipId: crypto.randomUUID() }], doc.version)}>{tr('split')}</SoundButton>
      <SoundButton disabled={busy || !track} onClick={() => { if (track) void patch([{ op: 'addClip', trackId: track.id, clip: { ...clip, id: crypto.randomUUID(), at: clip.at + clip.duration } }], doc.version); }}>{tr('duplicate')}</SoundButton>
      <SoundButton disabled={disabled || !range} onClick={() => { if (range) void patch([{ op: 'cropClip', clipId: clip.id, ...range }], doc.version); }}>{tr('crop')}</SoundButton>
      <SoundButton disabled={disabled || !range} onClick={() => { if (range) void patch([{ op: 'deleteClipRange', clipId: clip.id, ...range, newClipId: crypto.randomUUID() }], doc.version); }}>{tr('deleteRange')}</SoundButton>
      <SoundButton disabled={disabled} onClick={() => void patch([{ op: 'removeClip', clipId: clip.id }], doc.version)}>{tr('remove')}</SoundButton>
    </div>
    <p className="text-xs leading-relaxed text-slate-500">{tr('trimHint')}</p>
  </div>;
}
