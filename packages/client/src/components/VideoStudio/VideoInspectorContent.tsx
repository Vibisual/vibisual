import { useTranslation } from 'react-i18next';
import { wantsWordHighlight, type VideoDoc, type VideoItem, type VideoTransform } from '@vibisual/video';
import { StudioNumberField, StudioTextField, STUDIO_INPUT_CLASS } from './StudioField.js';
import { inspectorFields, INSPECTOR_OPTION_LABELS } from './videoInspectorFields.js';

export interface VideoInspectorContentProps {
  item: VideoItem;
  size: VideoDoc['size'];
  disabled?: boolean;
  hasAudio?: boolean;
  onUpdate: (patch: Partial<Omit<VideoItem, 'id'>>) => void;
}

export function VideoInspectorContent({ item, size, disabled, hasAudio, onUpdate }: VideoInspectorContentProps): React.JSX.Element {
  const { t } = useTranslation();
  const setProp = (key: string, value: unknown): void => onUpdate({ props: { ...item.props, [key]: value } });
  return (
    <section className="space-y-3 border-t border-white/10 pt-3">
      <h3 className="text-xs font-semibold text-white/80">{t('panel.videoStudio.editor.content', { defaultValue: 'Content & style' })}</h3>
      {item.kind === 'caption' ? (
        <div className="space-y-3">
          {(item.cues ?? []).map((cue, index) => <StudioTextField
            key={index}
            label={t('panel.videoStudio.editor.captionText', { defaultValue: 'Caption {{number}}', number: index + 1 })}
            hint={`${cue.start.toFixed(2)} – ${cue.end.toFixed(2)} s`}
            value={cue.text} multiline disabled={disabled}
            onCommit={(text) => onUpdate({ cues: item.cues?.map((entry, at) => {
              if (at !== index) return entry;
              // Old word timing no longer describes edited wording; cue timing remains intact.
              const { words: _words, ...timing } = entry;
              return { ...timing, text };
            }) })}
          />)}
          {!item.cues?.length ? <p className="text-xs text-white/40">{t('panel.videoStudio.editor.noCues', { defaultValue: 'This clip has no caption cues.' })}</p> : null}
          {/* §5.13 (V) 37-12 — 낱말 시각이 없는 큐는 글자 길이 비례로 추정한다 — 그 사실을 적는다. */}
          {wantsWordHighlight(item.props) && (item.cues ?? []).some((cue) => !cue.words?.length)
            ? <p className="text-[12px] text-amber-200/80">{t('panel.videoStudio.editor.wordsEstimated')}</p> : null}
        </div>
      ) : null}
      {inspectorFields(item, size.height, hasAudio).map((field) => {
        const raw = item.props?.[field.key];
        const label = t(`panel.videoStudio.editor.props.${field.labelKey ?? field.key}`, { defaultValue: field.label });
        if (typeof field.defaultValue === 'number') {
          const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : field.defaultValue;
          return <StudioNumberField key={field.key} label={label} value={value} min={field.min} max={field.max} disabled={disabled} onCommit={(next) => setProp(field.key, next)} />;
        }
        const value = field.list ? (Array.isArray(raw) ? raw.filter((entry): entry is string => typeof entry === 'string').join('\n') : '') : typeof raw === 'string' ? raw : field.defaultValue;
        if (field.options) return (
          <label key={field.key} className="block space-y-1 text-xs text-white/60">
            <span>{label}</span>
            <select aria-label={label} className={STUDIO_INPUT_CLASS} value={value} disabled={disabled} onChange={(event) => {
              if (!disabled && field.options?.includes(event.target.value)) setProp(field.key, event.target.value);
            }}>
              {!field.options.includes(value) ? <option value={value}>{value}</option> : null}
              {field.options.map((option) => <option key={option} value={option}>{INSPECTOR_OPTION_LABELS[option] ? t(`panel.videoStudio.editor.options.${option}`, { defaultValue: INSPECTOR_OPTION_LABELS[option] }) : option}</option>)}
            </select>
          </label>
        );
        return <StudioTextField key={field.key} label={label} value={value} multiline={field.multiline} disabled={disabled} onCommit={(next) => setProp(field.key, field.list ? next.split('\n') : next)} />;
      })}
    </section>
  );
}

interface TransformField { key: keyof VideoTransform; label: string; value: number; min?: number; max?: number }

export function VideoInspectorTransform({ item, size, disabled, onUpdate }: VideoInspectorContentProps): React.JSX.Element {
  const { t } = useTranslation();
  const fields: readonly TransformField[] = [
    { key: 'x', label: 'X (px)', value: 0 }, { key: 'y', label: 'Y (px)', value: 0 },
    { key: 'width', label: 'Width (px)', value: size.width, min: 1 }, { key: 'height', label: 'Height (px)', value: size.height, min: 1 },
    { key: 'rotation', label: 'Rotation (°)', value: 0 }, { key: 'scale', label: 'Scale', value: 1, min: 0.01 },
    { key: 'opacity', label: 'Opacity', value: 1, min: 0, max: 1 },
  ];
  return (
    <section className="space-y-3 border-t border-white/10 pt-3">
      <h3 className="text-xs font-semibold text-white/80">{t('panel.videoStudio.editor.transform', { defaultValue: 'Transform' })}</h3>
      <div className="grid grid-cols-2 gap-2">
        {fields.map((field) => <StudioNumberField
          key={field.key} label={t(`panel.videoStudio.editor.transformFields.${field.key}`, { defaultValue: field.label })}
          value={item.transform?.[field.key] ?? field.value} min={field.min} max={field.max} disabled={disabled}
          onCommit={(value) => onUpdate({ transform: { ...item.transform, [field.key]: value } })}
        />)}
      </div>
    </section>
  );
}
