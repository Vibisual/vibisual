import { useMemo, type Dispatch, type SetStateAction } from 'react';
import type { TFunction } from 'i18next';
import { audibleTracks, formatOfSize, scaledSize, type ExportSettings, type ResolvedTimeline, type VideoDoc } from '@vibisual/video';

import type { ExportDialogProps } from './ExportDialog.js';
import { exportHostAvailable, openExport, openExportFolder, pickExportFolder, revealExport } from './exportHost.js';
import type { StudioExport } from './useStudioExport.js';
import type { StudioRender } from './useStudioRender.js';
import type { StudioToasts } from './useStudioToasts.js';
import type { StudioUiState } from './studioViewProps.js';
import type { DocSummary, RenderJobAction, RenderQueueAction, VideoJob } from './videoApi.js';

/**
 * §5.13 (AA) 42-8 — 스튜디오 셸이 내보내기 판·설정 창·대기열에 넘기는 손잡이 묶음(셸을 묶기 전용으로 두려고 뗐다 — 37-1).
 */

/** 형식 이름의 번역 키 꼬리. */
export function formatKey(format: ExportSettings['format']): string {
  return format === 'webm-alpha' ? 'webmAlpha' : format;
}

/** 판의 [지금 렌더] 옆 요약 — 형식 · 크기 · 화질(소리만이면 형식만). */
export function exportSummaryText(t: TFunction, settings: ExportSettings, doc: VideoDoc | null): string {
  const format = t(`panel.videoStudio.export.how.format_${formatKey(settings.format)}`);
  if (settings.format === 'wav' || !doc) return format;
  const size = scaledSize(doc.size, settings.scale);
  const quality = t(`panel.videoStudio.export.how.quality_${settings.quality === 'very-high' ? 'veryHigh' : settings.quality}`);
  return `${format} · ${size.width}×${size.height} · ${quality}`;
}

export interface ExportActions {
  /** OS 기능(폴더 창·폴더에서 보기·열기)을 쓸 수 있는가. */
  readonly host: boolean;
  readonly reveal: (job: VideoJob) => void;
  readonly open: (job: VideoJob) => void;
  /** 같은 설정으로 새 일감(끝난·실패·취소된 줄의 [다시 렌더]). */
  readonly retry: (job: VideoJob) => void;
  readonly control: (jobId: string, action: RenderJobAction) => void;
  readonly controlAll: (action: RenderQueueAction) => void;
  readonly openFolder: (dir: string) => void;
}

export function useExportActions(d: { readonly render: StudioRender; readonly toasts: StudioToasts; readonly projectName: string }): ExportActions {
  const host = exportHostAvailable();
  const { enqueue } = d.render;
  const { control, controlAll } = d.render.queue;
  const { info, error } = d.toasts;
  return useMemo(() => ({
    host,
    reveal: (job) => {
      const file = job.exported ?? job.result;
      if (file) void revealExport(file).then((ok) => { if (!ok) info('panel.videoStudio.export.missingFile'); }).catch(error);
    },
    open: (job) => {
      const file = job.exported ?? job.result;
      if (file) void openExport(file).then((ok) => { if (!ok) info('panel.videoStudio.export.missingFile'); }).catch(error);
    },
    retry: (job) => {
      void enqueue(job.docId, {
        ...(job.spec ? { spec: job.spec } : { ...(job.hideCaptions ? { captions: 'separate' as const } : {}), ...(job.transparent ? { transparent: true } : {}) }),
        ...(job.output ? { output: job.output } : {}),
        ...(job.label ? { label: job.label } : {}),
      });
    },
    control: (jobId, action) => { void control(jobId, action); },
    controlAll: (action) => { void controlAll(action); },
    openFolder: (dir) => { void openExportFolder(dir).then((ok) => { if (!ok) info('panel.videoStudio.export.missingFolder'); }).catch(error); },
  }), [host, enqueue, control, controlAll, info, error]);
}

/** 설정 창 props(창이 열린 동안만 만든다). */
export function exportDialogProps(a: {
  readonly t: TFunction;
  readonly tab: 'settings' | 'queue';
  readonly setUi: Dispatch<SetStateAction<StudioUiState>>;
  readonly exporter: StudioExport;
  readonly render: StudioRender;
  readonly actions: ExportActions;
  readonly doc: VideoDoc;
  readonly docs: readonly DocSummary[];
  readonly timeline: ResolvedTimeline | null;
  readonly hasCaptions: boolean;
  readonly readPlayhead: () => number;
  readonly toasts: StudioToasts;
}): ExportDialogProps {
  const { doc, exporter } = a;
  const format = formatOfSize(doc.size);
  return {
    tab: a.tab,
    onTab: (tab) => a.setUi((u) => ({ ...u, exportDialog: tab })),
    settings: exporter.settings,
    onSettings: exporter.setSettings,
    presets: exporter.presets,
    onSavePreset: exporter.savePreset,
    onDeletePreset: exporter.deletePreset,
    onApplyPreset: exporter.applyPreset,
    doc: { id: doc.id, title: doc.title, format, size: doc.size, fps: doc.fps, duration: a.timeline?.duration ?? 0 },
    docs: a.docs.filter((x) => x.id !== doc.id).map((x) => ({
      id: x.id, title: x.title, format: x.width && x.height ? formatOfSize({ width: x.width, height: x.height }) : format,
    })),
    chapters: (a.timeline?.chapters ?? []).map((c) => ({
      id: c.id, index: c.index, title: c.chapter.title.trim() || a.t('panel.videoStudio.strip.chapterN', { n: c.index + 1 }), start: c.start, end: c.end,
    })),
    tracks: audibleTracks(doc),
    hasCaptions: a.hasCaptions,
    readPlayhead: a.readPlayhead,
    initialTarget: exporter.defaultTarget(),
    host: a.actions.host,
    onPickFolder: () => {
      void pickExportFolder(exporter.settings.outputDir, a.t('panel.videoStudio.export.how.pickFolder'))
        .then((dir) => { if (dir) exporter.setSettings({ outputDir: dir }); })
        .catch(a.toasts.error);
    },
    onOpenFolder: a.actions.openFolder,
    jobs: a.render.queue.jobs,
    onControl: a.actions.control,
    onControlAll: a.actions.controlAll,
    onReveal: a.actions.reveal,
    onOpen: a.actions.open,
    onRetry: a.actions.retry,
    onSubmit: exporter.submit,
    onClose: () => a.setUi((u) => ({ ...u, exportDialog: null })),
  };
}
