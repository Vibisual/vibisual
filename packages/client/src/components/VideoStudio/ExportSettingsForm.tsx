import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  EXPORT_FORMATS,
  EXPORT_FPS_CHOICES,
  EXPORT_QUALITIES,
  EXPORT_SCALES,
  RENDER_NAME_TOKENS,
  buildRenderFileName,
  renderExtension,
  sanitizeFileName,
  scaledSize,
  type ExportPreset,
  type ExportSettings,
  type VideoFormatId,
} from '@vibisual/video';

import { ExportCheck, ExportField, Segmented, SmallButton } from './exportControls.js';
import { StudioIcon } from './studioIcons.js';

/** §5.13 (AA) 42-1·42-2·42-7 — 내보내기 "어떻게". 저장 위치는 OS 폴더 창으로만, 바꾸는 즉시 이 프로젝트의 마지막 설정이 된다. 폰 폭은 짝 칸을 한 열로. */
export interface ExportSettingsFormProps {
  readonly settings: ExportSettings;
  readonly onSettings: (patch: Partial<ExportSettings>) => void;
  readonly presets: readonly ExportPreset[];
  readonly onSavePreset: (name: string) => void;
  readonly onDeletePreset: (id: string) => void;
  readonly onApplyPreset: (id: string) => void;
  readonly doc: { readonly id: string; readonly title: string; readonly format: VideoFormatId; readonly size: { readonly width: number; readonly height: number }; readonly fps: number };
  readonly hasCaptions: boolean;
  /** OS 기능(폴더 창·폴더 열기)을 쓸 수 있는가. */
  readonly host: boolean;
  readonly onPickFolder: () => void;
  readonly onOpenFolder: (dir: string) => void;
}

export function ExportSettingsForm(p: ExportSettingsFormProps): React.JSX.Element {
  const { t } = useTranslation();
  const s = p.settings;
  const [presetName, setPresetName] = useState('');
  const [presetId, setPresetId] = useState('');
  const [nameDraft, setNameDraft] = useState(s.fileName);
  // 바깥에서 규칙이 바뀌면(프리셋 적용·칩) 칸도 따른다.
  useEffect(() => { setNameDraft(s.fileName); }, [s.fileName]);
  const wav = s.format === 'wav';
  const size = scaledSize(p.doc.size, s.scale);
  const previewName = `${sanitizeFileName(buildRenderFileName(s.fileName, {
    title: p.doc.title, docId: p.doc.id, format: p.doc.format, width: size.width, height: size.height, fps: s.fps ?? p.doc.fps,
    scene: t('panel.videoStudio.export.how.sampleScene'), index: 0, at: new Date(),
  }), p.doc.title)}.${renderExtension(s)}`;

  return (
    <div className="flex flex-col gap-4">
      <ExportField label={t('panel.videoStudio.export.how.format')}>
        <Segmented value={s.format} label={t('panel.videoStudio.export.how.format')}
          options={EXPORT_FORMATS.map((f) => ({ value: f, label: t(`panel.videoStudio.export.how.format_${f === 'webm-alpha' ? 'webmAlpha' : f}`) }))}
          onChange={(format) => p.onSettings({ format })} />
      </ExportField>

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4 box-narrow:grid-cols-1">
        <ExportField label={t('panel.videoStudio.export.how.quality')}>
          <Segmented value={s.quality} label={t('panel.videoStudio.export.how.quality')} disabled={wav}
            options={EXPORT_QUALITIES.map((q) => ({ value: q, label: t(`panel.videoStudio.export.how.quality_${q === 'very-high' ? 'veryHigh' : q}`) }))}
            onChange={(quality) => p.onSettings({ quality })} />
        </ExportField>
        <ExportField label={t('panel.videoStudio.export.how.resolution')}>
          <Segmented value={s.scale} label={t('panel.videoStudio.export.how.resolution')} disabled={wav}
            options={EXPORT_SCALES.map((scale) => { const z = scaledSize(p.doc.size, scale); return { value: scale, label: `${Math.round(scale * 100)}%`, hint: `${z.width}×${z.height}` }; })}
            onChange={(scale) => p.onSettings({ scale })} />
          <span className="text-[12px] tabular-nums text-slate-500">{size.width}×{size.height}</span>
        </ExportField>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4 box-narrow:grid-cols-1">
        <ExportField label={t('panel.videoStudio.export.how.fps')}>
          <Segmented value={s.fps ?? 0} label={t('panel.videoStudio.export.how.fps')} disabled={wav}
            options={[{ value: 0, label: t('panel.videoStudio.export.how.fpsDoc', { fps: p.doc.fps }) }, ...EXPORT_FPS_CHOICES.map((f) => ({ value: f, label: String(f) }))]}
            onChange={(fps) => p.onSettings({ fps: fps === 0 ? null : fps })} />
        </ExportField>
        <ExportField label={t('panel.videoStudio.export.captions')}>
          <Segmented value={s.captions} label={t('panel.videoStudio.export.captions')} disabled={wav || !p.hasCaptions}
            options={[
              { value: 'burn', label: t('panel.videoStudio.export.captions_burn') },
              { value: 'separate', label: t('panel.videoStudio.export.captions_separate') },
              { value: 'none', label: t('panel.videoStudio.export.captions_none') },
            ]}
            onChange={(captions) => p.onSettings({ captions })} />
        </ExportField>
      </div>

      <ExportField label={t('panel.videoStudio.export.how.folder')} hint={p.host ? undefined : t('panel.videoStudio.export.how.folderUnavailable')}>
        {/* 폰 폭에서는 경로 줄이 한 줄 전체를 쓰고(긴 경로는 줄바꿈 — 끝까지 보인다) 단추는 아랫줄로. 넓으면 종전처럼 한 줄(경로 말줄임). */}
        <div className="flex min-w-0 items-center gap-1.5 box-narrow:flex-wrap">
          <span className="flex min-w-0 flex-1 items-center gap-1.5 box-narrow:basis-full">
            <StudioIcon name="folder" className="h-3.5 w-3.5 shrink-0 text-slate-500" />
            <span className="min-w-0 flex-1 truncate text-[12px] text-slate-200 box-narrow:whitespace-normal box-narrow:break-all" title={s.outputDir ?? undefined}>
              {s.outputDir ?? t('panel.videoStudio.export.how.folderDefault')}
            </span>
          </span>
          {p.host ? <SmallButton onClick={p.onPickFolder}>{t('panel.videoStudio.export.how.pickFolder')}</SmallButton> : null}
          {s.outputDir ? <SmallButton onClick={() => p.onSettings({ outputDir: null })}>{t('panel.videoStudio.export.how.resetFolder')}</SmallButton> : null}
          {p.host && s.outputDir ? (
            <SmallButton onClick={() => { if (s.outputDir) p.onOpenFolder(s.outputDir); }} title={t('panel.videoStudio.export.how.openFolder')}>
              <StudioIcon name="folderOpen" className="h-3.5 w-3.5" />
            </SmallButton>
          ) : null}
        </div>
      </ExportField>

      <ExportField label={t('panel.videoStudio.export.how.fileName')} hint={t('panel.videoStudio.export.how.fileNamePreview', { name: previewName })}>
        <input value={nameDraft} aria-label={t('panel.videoStudio.export.how.fileName')}
          // 비운 채 다시 쓰는 동안 기본값으로 튀지 않게 — 빈 칸은 저장하지 않고, 손을 떼면 저장된 규칙으로 돌아온다.
          onChange={(e) => { setNameDraft(e.target.value); if (e.target.value.trim() !== '') p.onSettings({ fileName: e.target.value }); }}
          onBlur={() => setNameDraft(s.fileName)}
          onKeyDown={(e) => e.stopPropagation()}
          className="h-7 min-w-0 rounded-md border border-white/15 bg-vb-sunken px-2 text-[12px] text-slate-100 outline-none focus:ring-1 focus:ring-[var(--vs-accent)] pointer-coarse:h-9" />
        <div className="flex flex-wrap gap-1">
          {RENDER_NAME_TOKENS.map((token) => (
            <button key={token} type="button" onClick={() => p.onSettings({ fileName: `${s.fileName}${s.fileName.endsWith(' ') || s.fileName === '' ? '' : ' '}${token}` })}
              title={t(`panel.videoStudio.export.how.token_${token.slice(1, -1)}`)}
              className="rounded border border-white/10 px-1.5 py-0.5 font-mono text-[12px] text-slate-300 hover:bg-white/10 pointer-coarse:px-2.5 pointer-coarse:py-1.5">{token}</button>
          ))}
        </div>
      </ExportField>

      <ExportField label={t('panel.videoStudio.export.how.conflict')}>
        <Segmented value={s.conflict} label={t('panel.videoStudio.export.how.conflict')}
          options={[{ value: 'number', label: t('panel.videoStudio.export.how.conflict_number') }, { value: 'overwrite', label: t('panel.videoStudio.export.how.conflict_overwrite') }]}
          onChange={(conflict) => p.onSettings({ conflict })} />
      </ExportField>

      <ExportField label={t('panel.videoStudio.export.how.after')}>
        <div className="flex flex-col gap-1">
          <ExportCheck checked={s.after.reveal} disabled={!p.host} onChange={(reveal) => p.onSettings({ after: { ...s.after, reveal } })}>{t('panel.videoStudio.export.how.afterReveal')}</ExportCheck>
          <ExportCheck checked={s.after.notify} onChange={(notify) => p.onSettings({ after: { ...s.after, notify } })}>{t('panel.videoStudio.export.how.afterNotify')}</ExportCheck>
          <ExportCheck checked={s.after.deliver} onChange={(deliver) => p.onSettings({ after: { ...s.after, deliver } })}>{t('panel.videoStudio.export.how.afterDeliver')}</ExportCheck>
          <ExportCheck checked={s.keepAwake} onChange={(keepAwake) => p.onSettings({ keepAwake })}>{t('panel.videoStudio.export.how.keepAwake')}</ExportCheck>
        </div>
      </ExportField>

      <ExportField label={t('panel.videoStudio.export.how.presets')}>
        <div className="flex flex-wrap items-center gap-1.5">
          <select value={presetId} onChange={(e) => setPresetId(e.target.value)} aria-label={t('panel.videoStudio.export.how.presets')}
            className="h-7 min-w-0 max-w-48 rounded-md border border-white/15 bg-vb-sunken px-1.5 text-[12px] text-slate-100 outline-none pointer-coarse:h-9">
            <option value="">{p.presets.length === 0 ? t('panel.videoStudio.export.how.noPresets') : t('panel.videoStudio.export.how.choosePreset')}</option>
            {p.presets.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
          <SmallButton disabled={presetId === ''} onClick={() => p.onApplyPreset(presetId)}>{t('panel.videoStudio.export.how.applyPreset')}</SmallButton>
          <SmallButton disabled={presetId === ''} onClick={() => { p.onDeletePreset(presetId); setPresetId(''); }}>{t('panel.videoStudio.export.how.deletePreset')}</SmallButton>
        </div>
        <div className="flex items-center gap-1.5">
          <input value={presetName} placeholder={t('panel.videoStudio.export.how.presetName')} aria-label={t('panel.videoStudio.export.how.presetName')}
            onChange={(e) => setPresetName(e.target.value)} onKeyDown={(e) => e.stopPropagation()}
            className="h-7 min-w-0 flex-1 rounded-md border border-white/15 bg-vb-sunken px-2 text-[12px] text-slate-100 outline-none focus:ring-1 focus:ring-[var(--vs-accent)] pointer-coarse:h-9" />
          <SmallButton disabled={presetName.trim() === ''} onClick={() => { p.onSavePreset(presetName.trim()); setPresetName(''); }}>{t('panel.videoStudio.export.how.savePreset')}</SmallButton>
        </div>
      </ExportField>
    </div>
  );
}
