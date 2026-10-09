import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { resolveTimeline, type VideoDoc, type VideoDocOp, type VideoItem } from '@vibisual/video';
import { ScrollFade } from '../ScrollFade.js';
import { StudioNumberField, StudioTextField, STUDIO_INPUT_CLASS } from './StudioField.js';
import { VideoInspectorContent, VideoInspectorTransform } from './VideoInspectorContent.js';
import { isCompatibleTrack } from './videoEditor.js';

export interface VideoInspectorProps {
  doc: VideoDoc;
  selectedItemId: string | null;
  disabled?: boolean;
  onApplyOps: (ops: readonly VideoDocOp[]) => void;
}

const OUTPUT_PRESETS = {
  landscape: { width: 1920, height: 1080 },
  portrait: { width: 1080, height: 1920 },
  square: { width: 1080, height: 1080 },
};
const OUTPUT_LABELS = { landscape: 'Landscape · 1920 × 1080', portrait: 'Portrait · 1080 × 1920', square: 'Square · 1080 × 1080' };
const MIN_DURATION = 0.001;

/** All edits use document operations, so autosave, conflicts and undo share one path. */
export function VideoInspector({ doc, selectedItemId, disabled, onApplyOps }: VideoInspectorProps): React.JSX.Element {
  const { t } = useTranslation();
  const timeline = useMemo(() => resolveTimeline(doc), [doc]);
  const track = doc.tracks.find((entry) => entry.items.some((item) => item.id === selectedItemId));
  const item = track?.items.find((entry) => entry.id === selectedItemId);
  const resolved = timeline.items.find((entry) => entry.id === selectedItemId);
  const apply = (ops: readonly VideoDocOp[]): void => { if (!disabled) onApplyOps(ops); };
  const update = (patch: Partial<Omit<VideoItem, 'id'>>): void => {
    if (item) apply([{ op: 'updateItem', itemId: item.id, patch }]);
  };
  const preset = Object.entries(OUTPUT_PRESETS).find(([, size]) => size.width === doc.size.width && size.height === doc.size.height)?.[0] ?? 'custom';
  const compatibleTracks = doc.tracks.filter((entry) => item && isCompatibleTrack(item.kind, entry.kind));
  const asset = item?.assetId ? doc.assets[item.assetId] : undefined;
  const sourceDuration = asset?.duration;
  const duration = resolved?.duration ?? (typeof item?.duration === 'number' ? item.duration : 0);
  const canAuto = item?.kind === 'caption' ? !!item.cues?.length : sourceDuration !== undefined && sourceDuration > (item?.trimStart ?? 0);
  const trimMax = sourceDuration === undefined ? undefined : Math.max(0, sourceDuration - MIN_DURATION);
  const durationMax = sourceDuration === undefined ? undefined : Math.max(MIN_DURATION, sourceDuration - (item?.trimStart ?? 0));
  return (
    <aside className="flex h-full min-h-0 w-64 shrink-0 flex-col rounded-lg border border-white/10 bg-gray-900/60" aria-label={t('panel.videoStudio.editor.inspector', { defaultValue: 'Inspector' })}>
      <h2 className="shrink-0 border-b border-white/10 px-3 py-2.5 text-xs font-semibold text-white/80">{t('panel.videoStudio.editor.inspector', { defaultValue: 'Inspector' })}</h2>
      <ScrollFade fill className="flex-1">
        <div className="space-y-4 p-3" key={`${doc.id}:${selectedItemId ?? ''}`}>
          <section className="space-y-3">
            <h3 className="text-xs font-semibold text-white/80">{t('panel.videoStudio.editor.composition', { defaultValue: 'Composition' })}</h3>
            <StudioTextField label={t('panel.videoStudio.editor.documentTitle', { defaultValue: 'Video title' })} value={doc.title} disabled={disabled} onCommit={(title) => apply([{ op: 'setDoc', patch: { title } }])} />
            <label className="block space-y-1 text-xs text-white/60">
              <span>{t('panel.videoStudio.editor.outputSize', { defaultValue: 'Output size' })}</span>
              <select aria-label={t('panel.videoStudio.editor.outputSize', { defaultValue: 'Output size' })} className={STUDIO_INPUT_CLASS} value={preset} disabled={disabled} onChange={(event) => {
                const size = Object.entries(OUTPUT_PRESETS).find(([key]) => key === event.target.value)?.[1];
                if (size) apply([{ op: 'setDoc', patch: { size } }]);
              }}>
                {preset === 'custom' ? <option value="custom">{t('panel.videoStudio.editor.customSize', { defaultValue: 'Custom · {{width}} × {{height}}', ...doc.size })}</option> : null}
                {Object.entries(OUTPUT_LABELS).map(([key, label]) => <option key={key} value={key}>{t(`panel.videoStudio.editor.outputPresets.${key}`, { defaultValue: label })}</option>)}
              </select>
            </label>
            <StudioNumberField label={t('panel.videoStudio.editor.fps', { defaultValue: 'Frame rate (fps)' })} value={doc.fps} min={1} max={120} disabled={disabled} onCommit={(fps) => apply([{ op: 'setDoc', patch: { fps } }])} />
          </section>
          {item && track ? <>
            <section className="space-y-3 border-t border-white/10 pt-3">
              <h3 className="text-xs font-semibold text-white/80">{t('panel.videoStudio.editor.selectedClip', { defaultValue: 'Selected clip' })}</h3>
              <StudioTextField label={t('panel.videoStudio.editor.clipLabel', { defaultValue: 'Clip name' })} value={item.label ?? ''} disabled={disabled} onCommit={(label) => update({ label })} />
              <label className="block space-y-1 text-xs text-white/60">
                <span>{t('panel.videoStudio.editor.track', { defaultValue: 'Track' })}</span>
                <select aria-label={t('panel.videoStudio.editor.track', { defaultValue: 'Track' })} className={STUDIO_INPUT_CLASS} value={track.id} disabled={disabled} onChange={(event) => {
                  const target = compatibleTracks.find((entry) => entry.id === event.target.value);
                  if (target && target.id !== track.id) apply([{ op: 'moveItem', itemId: item.id, toTrackId: target.id }]);
                }}>
                  {!compatibleTracks.some((entry) => entry.id === track.id) ? <option value={track.id} disabled>{track.label ?? track.id}</option> : null}
                  {compatibleTracks.map((entry) => <option key={entry.id} value={entry.id}>{entry.label ?? entry.id}</option>)}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <StudioNumberField label={t('panel.videoStudio.editor.start', { defaultValue: 'Start (s)' })} value={resolved?.start ?? (typeof item.at === 'number' ? item.at : 0)} min={0} disabled={disabled || !resolved}
                  onCommit={(start) => {
                    if (!resolved) return;
                    update({ at: typeof item.at === 'number' ? start : { ...item.at, offset: (item.at.offset ?? 0) + start - resolved.start } });
                  }} />
                <StudioNumberField label={t('panel.videoStudio.editor.duration', { defaultValue: 'Duration (s)' })} value={duration} min={MIN_DURATION} max={durationMax} disabled={disabled} onCommit={(next) => update({ duration: next })} />
              </div>
              {typeof item.at !== 'number' ? <p className="text-xs text-white/40">{t('panel.videoStudio.editor.linkedStart', { defaultValue: 'Timing stays linked to {{item}}.', item: 'after' in item.at ? item.at.after : item.at.start })}</p> : null}
              {canAuto || item.duration === 'auto' ? <label className="flex items-center gap-2 text-xs text-white/60">
                <input type="checkbox" checked={item.duration === 'auto'} disabled={disabled || (!canAuto && item.duration !== 'auto')} onChange={(event) => update({ duration: event.target.checked && canAuto ? 'auto' : Math.max(duration, MIN_DURATION) })} />
                {t('panel.videoStudio.editor.autoDuration', { defaultValue: 'Follow source duration' })}
              </label> : null}
              {item.kind === 'footage' || item.kind === 'audio' ? <StudioNumberField label={t('panel.videoStudio.editor.trimStart', { defaultValue: 'Source in (s)' })} value={item.trimStart ?? 0} min={0} max={trimMax} disabled={disabled}
                onCommit={(trimStart) => update({ trimStart, ...(sourceDuration !== undefined && typeof item.duration === 'number' ? { duration: Math.min(item.duration, Math.max(MIN_DURATION, sourceDuration - trimStart)) } : {}) })} /> : null}
              {asset ? <p className="break-all text-xs text-white/40">{asset.source.kind === 'file' ? asset.source.path : asset.source.output}</p> : null}
            </section>
            <VideoInspectorContent item={item} size={doc.size} disabled={disabled} hasAudio={asset?.hasAudio} onUpdate={update} />
            {item.kind !== 'audio' ? <VideoInspectorTransform item={item} size={doc.size} disabled={disabled} onUpdate={update} /> : null}
          </> : <p className="border-t border-white/10 pt-3 text-xs text-white/40">{t('panel.videoStudio.editor.selectClip', { defaultValue: 'Select a timeline clip to edit its content, timing and appearance.' })}</p>}
        </div>
      </ScrollFade>
    </aside>
  );
}
