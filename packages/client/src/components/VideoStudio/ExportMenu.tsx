import { useTranslation } from 'react-i18next';
import { VIDEO_FORMAT_IDS, VIDEO_FORMATS, formatRatioLabel, type VideoFormatId } from '@vibisual/video';

import { PopoverItem } from './StudioPopover.js';
import { StudioIcon } from './studioIcons.js';
import { RenderQueueList } from './RenderQueueList.js';
import type { RenderJobAction, VideoJob } from './videoApi.js';

/**
 * §5.13 (V) 37-15 · (AA) 42-8 — **내보내기 단추 하나** 아래의 판: ① 이 문서의 마지막 결과([받기]·[폴더에서 보기]) ② **지금 렌더**
 * (지금 설정 요약) ③ **내보내기 설정…** ④ 판형 프리셋 셋(지금 설정으로 — 다른 판형이면 파생 문서로) ⑤ PNG(재생 머리)·SRT
 * ⑥ 대기열 요약(일시정지·취소를 판 안에서 바로) + [대기열 전체 보기]. 렌더 진행률은 단추 안에 채워진다(여기서 따로 ❌).
 * 렌더는 사용자가 누를 때만 건다((T-15)). 종전 판의 '모션만 투명 배경'·자막 굽기/따로는 설정 창의 형식·자막으로 옮겼다(두 손잡이 ❌).
 */
export interface ExportMenuProps {
  readonly format: VideoFormatId;
  readonly canExport: boolean;
  readonly hasCaptions: boolean;
  /** 지금 설정 요약(형식 · 크기 · 화질). */
  readonly summary: string;
  readonly last: VideoJob | null;
  /** OS 기능(폴더에서 보기·열기)을 쓸 수 있는가. */
  readonly host: boolean;
  readonly queue: readonly VideoJob[];
  readonly onRenderNow: () => void;
  readonly onSettings: () => void;
  readonly onQueue: () => void;
  readonly onPreset: (format: VideoFormatId) => void;
  readonly onPng: () => void;
  readonly onSrt: () => void;
  readonly onDownload: () => void;
  readonly onReveal: (job: VideoJob) => void;
  readonly onOpen: (job: VideoJob) => void;
  readonly onRetry: (job: VideoJob) => void;
  readonly onControl: (jobId: string, action: RenderJobAction) => void;
  readonly close: () => void;
}

/** 판 안의 작은 제목 줄. */
function Heading({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
  return <p className="px-2.5 pb-1 pt-2 text-[12px] font-semibold text-slate-500">{children}</p>;
}

export function ExportMenu(p: ExportMenuProps): React.JSX.Element {
  const { t } = useTranslation();
  const run = (fn: () => void) => (): void => { p.close(); fn(); };
  const active = p.queue.filter((j) => j.status === 'running' || j.status === 'queued');
  return (
    <div className="flex flex-col gap-0.5">
      {p.last ? (
        <div className="mb-1 flex items-center gap-1">
          <button type="button" onClick={run(p.onDownload)}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-white/15 px-2.5 py-1.5 text-left text-[13px] text-slate-100 hover:bg-white/10 pointer-coarse:py-2.5">
            <StudioIcon name="export" /><span className="truncate">{t('panel.videoStudio.export.download')}</span>
          </button>
          {p.host ? (
            <button type="button" aria-label={t('panel.videoStudio.export.reveal')} title={t('panel.videoStudio.export.reveal')} onClick={() => { const last = p.last; if (last) p.onReveal(last); }}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-white/15 text-slate-300 hover:bg-white/10 hover:text-slate-100 pointer-coarse:h-10 pointer-coarse:w-10">
              <StudioIcon name="folder" />
            </button>
          ) : null}
        </div>
      ) : null}
      <PopoverItem disabled={!p.canExport} onClick={run(p.onRenderNow)} hint={p.summary}>
        <span className="flex items-center gap-2"><StudioIcon name="export" />{t('panel.videoStudio.export.renderNow')}</span>
      </PopoverItem>
      <PopoverItem onClick={run(p.onSettings)}>
        <span className="flex items-center gap-2"><StudioIcon name="sliders" />{t('panel.videoStudio.export.settings')}</span>
      </PopoverItem>
      <Heading>{t('panel.videoStudio.export.presets')}</Heading>
      {VIDEO_FORMAT_IDS.map((id) => (
        <PopoverItem key={id} disabled={!p.canExport} onClick={run(() => p.onPreset(id))}
          hint={`${VIDEO_FORMATS[id].width}×${VIDEO_FORMATS[id].height}`} active={id === p.format}>
          {t(`panel.videoStudio.export.preset_${id}`)} <span className="text-slate-500">· {formatRatioLabel(id)}</span>
        </PopoverItem>
      ))}
      <Heading>{t('panel.videoStudio.export.oneShot')}</Heading>
      <PopoverItem disabled={!p.canExport} onClick={run(p.onPng)} hint="PNG">{t('panel.videoStudio.export.png')}</PopoverItem>
      <PopoverItem disabled={!p.hasCaptions} onClick={run(p.onSrt)} hint="SRT">{t('panel.videoStudio.export.srt')}</PopoverItem>
      <div className="mt-1 flex items-center gap-2 border-t border-white/[0.06] px-2.5 pb-1 pt-2">
        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-slate-500">{t('panel.videoStudio.export.queue.title')}{active.length > 0 ? ` · ${active.length}` : ''}</span>
        <button type="button" onClick={run(p.onQueue)} className="shrink-0 rounded px-1.5 py-0.5 text-[12px] text-slate-300 hover:bg-white/10 hover:text-slate-100 pointer-coarse:py-2">
          {t('panel.videoStudio.export.queue.showAll')}
        </button>
      </div>
      <div className="px-1 pb-1">
        <RenderQueueList jobs={p.queue} compact limit={3} host={p.host} onControl={p.onControl} onReveal={p.onReveal} onOpen={p.onOpen} onRetry={p.onRetry} />
      </div>
    </div>
  );
}
