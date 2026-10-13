import { useTranslation } from 'react-i18next';
import { VIDEO_FORMAT_IDS, VIDEO_FORMATS, formatRatioLabel, type VideoFormatId } from '@vibisual/video';

import { PopoverItem } from './StudioPopover.js';
import { StudioIcon } from './studioIcons.js';

/**
 * §5.13 (V) 37-15 — **내보내기 단추 하나** 아래: MP4 · PNG(재생 머리) · SRT / 출력 프리셋(쇼츠·가로·정사각 — 다른 판형이면 파생
 * 문서로 렌더) / 자막 굽기·따로 내기 / (실측이 되면) 모션만 투명 배경. 렌더 진행률은 단추 안에 채워진다(여기서 따로 ❌).
 * 렌더는 사용자가 누를 때만 건다((T-15)).
 */
export interface ExportMenuProps {
  readonly format: VideoFormatId;
  readonly busy: boolean;
  readonly canExport: boolean;
  readonly hasCaptions: boolean;
  readonly captions: 'burn' | 'separate';
  readonly onCaptions: (mode: 'burn' | 'separate') => void;
  readonly download: { readonly url: string; readonly name: string } | null;
  readonly transparent: { readonly onExport: () => void } | null;
  readonly onMp4: () => void;
  readonly onPng: () => void;
  readonly onSrt: () => void;
  readonly onPreset: (format: VideoFormatId) => void;
  readonly close: () => void;
}

export function ExportMenu(p: ExportMenuProps): React.JSX.Element {
  const { t } = useTranslation();
  const run = (fn: () => void) => (): void => { p.close(); fn(); };
  return (
    <div className="flex flex-col gap-0.5">
      {p.download ? (
        <a href={p.download.url} download={p.download.name} onClick={p.close}
          className="mb-1 flex items-center gap-2 rounded-md border border-white/15 px-2.5 py-1.5 text-[13px] text-slate-100 hover:bg-white/10">
          <StudioIcon name="export" />{t('panel.videoStudio.export.download')}
        </a>
      ) : null}
      <PopoverItem disabled={!p.canExport || p.busy} onClick={run(p.onMp4)} hint="MP4">{t('panel.videoStudio.export.mp4')}</PopoverItem>
      <PopoverItem disabled={!p.canExport} onClick={run(p.onPng)} hint="PNG">{t('panel.videoStudio.export.png')}</PopoverItem>
      <PopoverItem disabled={!p.hasCaptions} onClick={run(p.onSrt)} hint="SRT">{t('panel.videoStudio.export.srt')}</PopoverItem>
      {p.transparent ? (
        <PopoverItem disabled={!p.canExport || p.busy} onClick={run(p.transparent.onExport)} hint="WebM">{t('panel.videoStudio.export.transparent')}</PopoverItem>
      ) : null}
      <p className="px-2.5 pb-1 pt-2 text-[12px] font-semibold text-slate-500">{t('panel.videoStudio.export.presets')}</p>
      {VIDEO_FORMAT_IDS.map((id) => (
        <PopoverItem key={id} disabled={!p.canExport || p.busy} onClick={run(() => p.onPreset(id))}
          hint={`${VIDEO_FORMATS[id].width}×${VIDEO_FORMATS[id].height}`} active={id === p.format}>
          {t(`panel.videoStudio.export.preset_${id}`)} <span className="text-slate-500">· {formatRatioLabel(id)}</span>
        </PopoverItem>
      ))}
      {p.hasCaptions ? (
        <>
          <p className="px-2.5 pb-1 pt-2 text-[12px] font-semibold text-slate-500">{t('panel.videoStudio.export.captions')}</p>
          <div className="flex gap-1 px-1.5 pb-1" role="radiogroup" aria-label={t('panel.videoStudio.export.captions')}>
            {(['burn', 'separate'] as const).map((mode) => (
              <button key={mode} type="button" role="radio" aria-checked={p.captions === mode} onClick={() => p.onCaptions(mode)}
                className={`flex-1 rounded-md px-2 py-1 text-[12px] ${p.captions === mode ? 'bg-white/10 text-slate-50 ring-1 ring-[var(--vs-accent)]' : 'text-slate-400 hover:bg-white/10'}`}>
                {t(`panel.videoStudio.export.captions_${mode}`)}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
