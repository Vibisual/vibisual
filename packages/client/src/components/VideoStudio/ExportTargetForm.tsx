import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { VIDEO_FORMAT_IDS, formatRatioLabel, type AudibleTrack, type ExportSettings, type VideoFormatId } from '@vibisual/video';

import { ExportCheck, ExportField, Segmented, SmallButton } from './exportControls.js';
import { formatClock } from './PreviewControls.js';
import type { ExportTarget } from './exportTarget.js';

/** §5.13 (AA) 42-3·42-4 — 내보내기 "무엇을"(대상·범위·판형·소리). 구간·장면·트랙은 그 렌더 한 번의 값이라 저장하지 않는다. */
export interface ExportTargetFormProps {
  readonly target: ExportTarget;
  readonly onTarget: (next: ExportTarget) => void;
  readonly settings: ExportSettings;
  readonly onSettings: (patch: Partial<ExportSettings>) => void;
  readonly currentDocId: string;
  readonly currentFormat: VideoFormatId;
  readonly docs: readonly { readonly id: string; readonly title: string }[];
  readonly chapters: readonly { readonly id: string; readonly index: number; readonly title: string; readonly start: number; readonly end: number }[];
  readonly tracks: readonly AudibleTrack[];
  readonly duration: number;
  readonly fps: number;
  readonly readPlayhead: () => number;
}

/** 초 칸 — 치는 동안의 글자(`1.`)를 그대로 두고, 읽히는 값만 바로 넘긴다(손을 떼면 프레임에 맞춘 값으로 돌아온다). */
function SecondsInput({ value, max, step, label, onCommit }: {
  readonly value: number;
  readonly max: number;
  readonly step: number;
  readonly label: string;
  readonly onCommit: (seconds: number) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input type="number" min={0} max={max} step={step} aria-label={label} value={draft ?? String(Number(value.toFixed(3)))}
      onChange={(e) => {
        setDraft(e.target.value);
        const v = Number(e.target.value);
        if (e.target.value.trim() !== '' && Number.isFinite(v)) onCommit(v);
      }}
      onBlur={() => setDraft(null)}
      className="h-7 w-20 rounded-md border border-white/15 bg-vb-sunken px-1.5 tabular-nums text-slate-100 outline-none focus:ring-1 focus:ring-[var(--vs-accent)] pointer-coarse:h-9" />
  );
}

export function ExportTargetForm(p: ExportTargetFormProps): React.JSX.Element {
  const { t } = useTranslation();
  const tg = p.target;
  const set = (patch: Partial<ExportTarget>): void => p.onTarget({ ...tg, ...patch });
  const many = tg.docIds.length > 1;
  const step = 1 / Math.max(1, p.fps);
  const snap = (sec: number): number => Math.max(0, Math.min(p.duration, Math.round(sec / step) * step));
  const toggle = <T,>(list: readonly T[], value: T, on: boolean): T[] => (on ? [...list.filter((x) => x !== value), value] : list.filter((x) => x !== value));
  const sceneName = (c: ExportTargetFormProps['chapters'][number]): string => c.title.trim() || t('panel.videoStudio.strip.chapterN', { n: c.index + 1 });
  const audioOff = p.settings.format !== 'wav' && !p.settings.audio;

  return (
    <div className="flex flex-col gap-4">
      <ExportField label={t('panel.videoStudio.export.target.docs')}>
        <Segmented value={many ? 'many' : 'one'} label={t('panel.videoStudio.export.target.docs')}
          options={[{ value: 'one', label: t('panel.videoStudio.export.target.thisDoc') }, { value: 'many', label: t('panel.videoStudio.export.target.manyDocs') }]}
          onChange={(v) => set({ docIds: v === 'one' ? [p.currentDocId] : [p.currentDocId, ...p.docs.filter((d) => d.id !== p.currentDocId).map((d) => d.id)] })} />
        {many ? (
          <div className="flex max-h-32 flex-col gap-1 overflow-y-auto rounded-md border border-white/10 p-1.5">
            {p.docs.map((d) => (
              <ExportCheck key={d.id} checked={tg.docIds.includes(d.id)} disabled={d.id === p.currentDocId}
                onChange={(on) => set({ docIds: toggle(tg.docIds, d.id, on) })}>
                {d.title || d.id}{d.id === p.currentDocId ? ` · ${t('panel.videoStudio.export.target.current')}` : ''}
              </ExportCheck>
            ))}
          </div>
        ) : null}
      </ExportField>

      <ExportField label={t('panel.videoStudio.export.target.range')} hint={many ? t('panel.videoStudio.export.target.rangeCurrentOnly') : undefined}>
        <Segmented value={tg.rangeMode} label={t('panel.videoStudio.export.target.range')}
          options={[
            { value: 'all', label: t('panel.videoStudio.export.target.all') },
            { value: 'range', label: t('panel.videoStudio.export.target.inOut') },
            { value: 'scenes', label: t('panel.videoStudio.export.target.scenes'), ...(p.chapters.length === 0 ? { hint: t('panel.videoStudio.export.target.noScenes') } : {}) },
          ]}
          onChange={(v) => set({ rangeMode: v })} />
        {tg.rangeMode === 'range' ? (
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-slate-300">
            {(['start', 'end'] as const).map((edge) => (
              <span key={edge} className="flex items-center gap-1">
                <span className="text-slate-500">{t(`panel.videoStudio.export.target.${edge}`)}</span>
                <SecondsInput value={tg.range[edge]} max={p.duration} step={step} label={t(`panel.videoStudio.export.target.${edge}`)}
                  onCommit={(v) => set({ range: { ...tg.range, [edge]: snap(v) } })} />
                <SmallButton onClick={() => set({ range: { ...tg.range, [edge]: snap(p.readPlayhead()) } })} title={t('panel.videoStudio.export.target.fromPlayhead')}>
                  {t('panel.videoStudio.export.target.fromPlayhead')}
                </SmallButton>
              </span>
            ))}
            <span className="tabular-nums text-slate-500">{formatClock(Math.min(tg.range.start, tg.range.end))} – {formatClock(Math.max(tg.range.start, tg.range.end))}</span>
          </div>
        ) : tg.rangeMode === 'scenes' ? (
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap gap-1">
              <SmallButton onClick={() => set({ sceneIds: p.chapters.map((c) => c.id) })}>{t('panel.videoStudio.export.target.selectAll')}</SmallButton>
              <SmallButton onClick={() => set({ sceneIds: [] })}>{t('panel.videoStudio.export.target.selectNone')}</SmallButton>
            </div>
            <div className="flex max-h-36 flex-col gap-1 overflow-y-auto rounded-md border border-white/10 p-1.5">
              {p.chapters.length === 0 ? <span className="text-[12px] text-slate-500">{t('panel.videoStudio.export.target.noScenes')}</span> : p.chapters.map((c) => (
                <ExportCheck key={c.id} checked={tg.sceneIds.includes(c.id)} onChange={(on) => set({ sceneIds: toggle(tg.sceneIds, c.id, on) })}>
                  {sceneName(c)} <span className="tabular-nums text-slate-500">· {formatClock(c.start)}–{formatClock(c.end)}</span>
                </ExportCheck>
              ))}
            </div>
            <span className="text-[12px] text-slate-500">{t('panel.videoStudio.export.target.scenesHint')}</span>
          </div>
        ) : null}
      </ExportField>

      <ExportField label={t('panel.videoStudio.export.target.formats')}>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          <ExportCheck checked={tg.ownFormat} onChange={(on) => set({ ownFormat: on })}>
            {t('panel.videoStudio.export.target.ownFormat', { ratio: formatRatioLabel(p.currentFormat) })}
          </ExportCheck>
          {VIDEO_FORMAT_IDS.map((id) => (
            <ExportCheck key={id} checked={tg.extraFormats.includes(id)} onChange={(on) => set({ extraFormats: toggle(tg.extraFormats, id, on) })}>
              {t(`panel.videoStudio.export.preset_${id}`)} · {formatRatioLabel(id)}
            </ExportCheck>
          ))}
        </div>
      </ExportField>

      <ExportField label={t('panel.videoStudio.export.target.sound')}>
        <ExportCheck checked={p.settings.audio || p.settings.format === 'wav'} disabled={p.settings.format === 'wav'} onChange={(on) => p.onSettings({ audio: on })}>
          {t('panel.videoStudio.export.target.includeSound')}
        </ExportCheck>
        {p.tracks.length > 0 ? (
          <div className={`flex flex-col gap-1 rounded-md border border-white/10 p-1.5 ${audioOff ? 'opacity-40' : ''}`}>
            {p.tracks.map((track) => (
              <ExportCheck key={track.id} disabled={audioOff || track.muted} checked={!track.muted && !tg.mutedTracks.includes(track.id)}
                onChange={(on) => set({ mutedTracks: toggle(tg.mutedTracks, track.id, !on) })}>
                {track.label ?? t('panel.videoStudio.export.target.trackN', { n: track.index + 1 })}
                <span className="text-slate-500"> · {t(`panel.videoStudio.export.target.track_${track.kind}`)}{track.muted ? ` · ${t('panel.videoStudio.export.target.mutedInDoc')}` : ''}</span>
              </ExportCheck>
            ))}
          </div>
        ) : <span className="text-[12px] text-slate-500">{t('panel.videoStudio.export.target.noSound')}</span>}
      </ExportField>
    </div>
  );
}
