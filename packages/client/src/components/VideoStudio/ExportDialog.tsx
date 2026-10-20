import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { normalizeRange, planExportJobs, type AudibleTrack, type ExportPreset, type ExportSettings, type VideoFormatId } from '@vibisual/video';

import { useBackdropDismiss } from '../../hooks/usePopupDismiss.js';
import { ScrollFade } from '../ScrollFade.js';
import { ExportSettingsForm } from './ExportSettingsForm.js';
import { ExportTargetForm } from './ExportTargetForm.js';
import { RenderQueueList } from './RenderQueueList.js';
import { SmallButton } from './exportControls.js';
import { StudioIcon } from './studioIcons.js';
import { fromLocalInput, toLocalInput } from './exportLabels.js';
import type { ExportMode, ExportTarget } from './exportTarget.js';
import type { RenderJobAction, RenderQueueAction, VideoJob } from './videoApi.js';

/**
 * §5.13 (AA) 42-8 — **내보내기 설정 창**(늦은 판 — 39-2). [설정] 탭: 무엇을(대상·범위·판형·소리) + 어떻게(형식·화질·해상도·프레임·
 * 자막·저장 위치·이름·끝난 뒤·내 프리셋). [대기열] 탭: 줄 전체(모두 시작·대기열 멈춤·모두 취소·끝난 것 지우기)와 줄마다의 조작.
 * 아래 줄: [예약…] [대기열에 추가] [지금 렌더 (n개)].
 *
 * 반응형 — 창은 스튜디오 상자 안에 갇히고(높이 상한 = 상자), 넘치는 칸은 가운데 목록 안에서 스크롤한다(머리줄·아래 줄은 늘 보인다).
 * 폰 폭 창에서는 바깥 여백을 줄이고 [무엇을]·[어떻게] 두 열을 한 열로 쌓으며, 탭은 머리줄 아랫줄로 내린다([닫기]는 오른쪽 위 그대로).
 * 큰 창(`box-wide`)에서는 폭·목록 높이 상한을 넓힌다.
 */
export interface ExportDialogProps {
  readonly tab: 'settings' | 'queue';
  readonly onTab: (tab: 'settings' | 'queue') => void;
  readonly settings: ExportSettings;
  readonly onSettings: (patch: Partial<ExportSettings>) => void;
  readonly presets: readonly ExportPreset[];
  readonly onSavePreset: (name: string) => void;
  readonly onDeletePreset: (id: string) => void;
  readonly onApplyPreset: (id: string) => void;
  readonly doc: { readonly id: string; readonly title: string; readonly format: VideoFormatId; readonly size: { readonly width: number; readonly height: number }; readonly fps: number; readonly duration: number };
  readonly docs: readonly { readonly id: string; readonly title: string; readonly format: VideoFormatId }[];
  readonly chapters: readonly { readonly id: string; readonly index: number; readonly title: string; readonly start: number; readonly end: number }[];
  readonly tracks: readonly AudibleTrack[];
  readonly hasCaptions: boolean;
  readonly readPlayhead: () => number;
  readonly initialTarget: ExportTarget;
  readonly host: boolean;
  readonly onPickFolder: () => void;
  readonly onOpenFolder: (dir: string) => void;
  readonly jobs: readonly VideoJob[];
  readonly onControl: (jobId: string, action: RenderJobAction) => void;
  readonly onControlAll: (action: RenderQueueAction) => void;
  readonly onReveal: (job: VideoJob) => void;
  readonly onOpen: (job: VideoJob) => void;
  readonly onRetry: (job: VideoJob) => void;
  readonly onSubmit: (target: ExportTarget, mode: ExportMode, at?: number) => Promise<number>;
  readonly onClose: () => void;
}

/** 예약 빠른 칩(분). */
const SCHEDULE_CHIPS_MIN: readonly number[] = [30, 60, 180];

export function ExportDialog(p: ExportDialogProps): React.JSX.Element {
  const { t } = useTranslation();
  const backdrop = useBackdropDismiss(p.onClose);
  const [target, setTarget] = useState<ExportTarget>(p.initialTarget);
  const [scheduling, setScheduling] = useState(false);
  const [when, setWhen] = useState(() => toLocalInput(Date.now() + 60 * 60_000));
  const [busy, setBusy] = useState(false);

  const count = useMemo(() => {
    const pieces = target.rangeMode === 'scenes'
      ? p.chapters.filter((c) => target.sceneIds.includes(c.id)).map((c) => ({ range: { start: c.start, end: c.end }, scene: c.title }))
      : target.rangeMode === 'range' ? [{ range: target.range, scene: null }] : [];
    const docs = target.docIds.map((id) => (id === p.doc.id ? { id, title: p.doc.title, format: p.doc.format } : p.docs.find((d) => d.id === id))).filter((d): d is { id: string; title: string; format: VideoFormatId } => !!d);
    return planExportJobs({ docs, currentDocId: p.doc.id, ownFormat: target.ownFormat, extraFormats: target.extraFormats, pieces }).entries.length;
  }, [target, p.chapters, p.docs, p.doc]);
  const scenesEmpty = target.rangeMode === 'scenes' && target.sceneIds.length === 0;
  // 구간을 골랐는데 쓸 수 없는 구간이면 걸지 않는다(조용히 전체를 렌더하지 않게).
  const rangeBad = target.rangeMode === 'range' && normalizeRange(target.range, p.doc.duration) === null;
  const blocked = count === 0 || scenesEmpty || rangeBad || busy;
  const atMs = fromLocalInput(when);
  const atValid = atMs !== null && atMs > Date.now();

  const go = (mode: ExportMode, at?: number): void => {
    if (busy) return;
    setBusy(true);
    void p.onSubmit(target, mode, at).then((made) => {
      setBusy(false);
      if (made > 0) { setScheduling(false); p.onTab('queue'); }
    });
  };

  const active = p.jobs.filter((j) => j.status === 'running' || j.status === 'queued').length;
  const tabButton = (tab: 'settings' | 'queue', label: string): React.JSX.Element => (
    <button type="button" role="tab" aria-selected={p.tab === tab} onClick={() => p.onTab(tab)}
      className={`rounded-md px-2.5 py-1 text-[13px] font-medium transition-colors duration-150 ease-out pointer-coarse:py-2 ${p.tab === tab ? 'bg-white/10 text-slate-50 ring-1 ring-[var(--vs-accent)]' : 'text-slate-400 hover:bg-white/10 hover:text-slate-100'}`}>
      {label}
    </button>
  );

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 p-6 box-narrow:p-2" {...backdrop}>
      <div role="dialog" aria-modal="true" aria-label={t('panel.videoStudio.export.dialogTitle')}
        // 창 안에서 누른 키는 스튜디오 단축키(재생 Space · 음소거 M …)로 새지 않는다. Esc 는 이 창을 닫는다.
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') p.onClose(); }}
        className="flex max-h-full w-full max-w-4xl animate-[vs-pop_160ms_ease-out] flex-col gap-3 rounded-xl border border-white/10 bg-vb-card p-4 shadow-2xl shadow-black/60 box-narrow:p-3 box-wide:max-w-5xl">
        <header className="flex shrink-0 flex-wrap items-center gap-2">
          <StudioIcon name="export" className="h-4 w-4 shrink-0 text-slate-300" />
          <span className="min-w-0 truncate text-[14px] font-semibold text-slate-100">{t('panel.videoStudio.export.dialogTitle')}</span>
          <div className="ml-3 flex gap-1 box-narrow:order-last box-narrow:ml-0 box-narrow:basis-full" role="tablist">
            {tabButton('settings', t('panel.videoStudio.export.tabSettings'))}
            {tabButton('queue', active > 0 ? `${t('panel.videoStudio.export.queue.title')} · ${active}` : t('panel.videoStudio.export.queue.title'))}
          </div>
          <span className="flex-1" />
          <button type="button" onClick={p.onClose} aria-label={t('common.close', { defaultValue: 'Close' })} className="shrink-0 rounded p-1 text-slate-400 hover:bg-white/10 hover:text-slate-100 pointer-coarse:p-2"><StudioIcon name="close" /></button>
        </header>

        {p.tab === 'settings' ? (
          <>
            {/* 가운데 목록이 남은 높이를 받아 스크롤한다(`fill` — 창이 낮으면 520px 보다 줄어든다). 종전 고정 높이 판은 낮은 창에서 판째
                줄어들며 목록 아래쪽을 잘라 그 칸에 닿을 수 없었다. */}
            <ScrollFade fill className="max-h-[520px] box-wide:max-h-[720px]">
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-6 pr-1 box-narrow:grid-cols-1 box-narrow:gap-4">
                <section aria-label={t('panel.videoStudio.export.whatTitle')} className="flex flex-col gap-2">
                  <h3 className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">{t('panel.videoStudio.export.whatTitle')}</h3>
                  <ExportTargetForm target={target} onTarget={setTarget} settings={p.settings} onSettings={p.onSettings}
                    currentDocId={p.doc.id} currentFormat={p.doc.format} docs={[{ id: p.doc.id, title: p.doc.title }, ...p.docs.filter((d) => d.id !== p.doc.id)]}
                    chapters={p.chapters} tracks={p.tracks} duration={p.doc.duration} fps={p.doc.fps} readPlayhead={p.readPlayhead} />
                </section>
                <section aria-label={t('panel.videoStudio.export.howTitle')} className="flex flex-col gap-2">
                  <h3 className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">{t('panel.videoStudio.export.howTitle')}</h3>
                  <ExportSettingsForm settings={p.settings} onSettings={p.onSettings} presets={p.presets} onSavePreset={p.onSavePreset}
                    onDeletePreset={p.onDeletePreset} onApplyPreset={p.onApplyPreset} doc={p.doc} hasCaptions={p.hasCaptions}
                    host={p.host} onPickFolder={p.onPickFolder} onOpenFolder={p.onOpenFolder} />
                </section>
              </div>
            </ScrollFade>
            {scheduling ? (
              <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
                <StudioIcon name="clock" className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} aria-label={t('panel.videoStudio.export.scheduleAt')}
                  onKeyDown={(e) => e.stopPropagation()}
                  className="h-7 min-w-0 rounded-md border border-white/15 bg-vb-sunken px-1.5 text-[12px] text-slate-100 outline-none focus:ring-1 focus:ring-[var(--vs-accent)] pointer-coarse:h-9" />
                {SCHEDULE_CHIPS_MIN.map((min) => (
                  <SmallButton key={min} onClick={() => setWhen(toLocalInput(Date.now() + min * 60_000))}>
                    {min < 60 ? t('panel.videoStudio.export.inMinutes', { count: min }) : t('panel.videoStudio.export.inHours', { count: min / 60 })}
                  </SmallButton>
                ))}
                <span className="flex-1" />
                <span className="min-w-0 text-[12px] text-slate-500">{t('panel.videoStudio.export.scheduleNote')}</span>
                <SmallButton tone="primary" disabled={!atValid || blocked} onClick={() => { if (atMs !== null) go('schedule', atMs); }}>
                  {t('panel.videoStudio.export.scheduleConfirm', { count })}
                </SmallButton>
              </div>
            ) : null}
            {/* 좁으면 단추가 아랫줄로 접힌다(오른쪽 끝 정렬) — 셋 다 늘 보인다. */}
            <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-white/[0.06] pt-3">
              <span className={`min-w-0 text-[12px] ${rangeBad ? 'text-amber-300' : 'text-slate-400'}`}>
                {scenesEmpty ? t('panel.videoStudio.export.pickScenes') : rangeBad ? t('panel.videoStudio.export.badRange') : t('panel.videoStudio.export.fileCount', { count })}
              </span>
              <span className="flex-1" />
              <SmallButton onClick={() => setScheduling((v) => !v)} disabled={busy}>
                <StudioIcon name="clock" className="h-3.5 w-3.5" />{t('panel.videoStudio.export.schedule')}
              </SmallButton>
              <SmallButton onClick={() => go('queue')} disabled={blocked} title={t('panel.videoStudio.export.addToQueueHint')}>
                <StudioIcon name="queue" className="h-3.5 w-3.5" />{t('panel.videoStudio.export.addToQueue')}
              </SmallButton>
              <SmallButton tone="primary" onClick={() => go('now')} disabled={blocked}>
                <StudioIcon name="export" className="h-3.5 w-3.5" />{t('panel.videoStudio.export.renderNowCount', { count })}
              </SmallButton>
            </footer>
          </>
        ) : (
          <>
            <div className="flex shrink-0 flex-wrap items-center gap-1.5">
              <SmallButton onClick={() => p.onControlAll('start-all')}><StudioIcon name="play" className="h-3.5 w-3.5" />{t('panel.videoStudio.export.queue.startAll')}</SmallButton>
              <SmallButton onClick={() => p.onControlAll('hold-all')}><StudioIcon name="pause" className="h-3.5 w-3.5" />{t('panel.videoStudio.export.queue.holdAll')}</SmallButton>
              <SmallButton onClick={() => p.onControlAll('cancel-all')}><StudioIcon name="close" className="h-3.5 w-3.5" />{t('panel.videoStudio.export.queue.cancelAll')}</SmallButton>
              <span className="flex-1" />
              <SmallButton onClick={() => p.onControlAll('clear-finished')}><StudioIcon name="trash" className="h-3.5 w-3.5" />{t('panel.videoStudio.export.queue.clearFinished')}</SmallButton>
            </div>
            <p className="shrink-0 text-[12px] text-slate-500">{t('panel.videoStudio.export.queue.latestDocNote')}</p>
            <ScrollFade fill className="max-h-[480px] box-wide:max-h-[680px]">
              <RenderQueueList jobs={p.jobs} host={p.host} onControl={p.onControl} onReveal={p.onReveal} onOpen={p.onOpen} onRetry={p.onRetry} />
            </ScrollFade>
          </>
        )}
      </div>
    </div>
  );
}
