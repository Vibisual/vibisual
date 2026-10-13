import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { effectivePick, type ChapterVariant, type ResolvedChapter, type VideoDoc } from '@vibisual/video';
import type { MediaProvider } from '@vibisual/video/render';

import { useBackdropDismiss } from '../../hooks/usePopupDismiss.js';
import { DARK_THEME_LOCK } from '../../theme/themeLock.js';
import { StudioIcon } from './studioIcons.js';
import { formatClock } from './PreviewControls.js';
import { useStagePreview } from './useStagePreview.js';

/**
 * §5.13 (V) 37-14 — **비교 판**: 같은 장면의 두 갈래(엔진마다 하나)를 같은 시각에 나란히 — 재생하면 둘이 함께 흐르고, 막대를
 * 끌면 둘이 함께 간다. 무대는 미리보기와 같은 DOM 무대(같은 문서에서 고른 갈래만 바꾼 사본)다. [이걸로] → 장면 `pick`.
 * 고르지 않은 쪽은 [안 고른 쪽 지우기]를 누를 때까지 문서에 남는다(그리지 않을 뿐).
 */
export interface VariantCompareProps {
  readonly project: string;
  readonly doc: VideoDoc;
  readonly chapter: ResolvedChapter;
  readonly media: MediaProvider | null;
  readonly disabled: boolean;
  readonly onPick: (variantId: string) => void;
  readonly onDropUnpicked: () => void;
  readonly onClose: () => void;
}

/** 그 장면만 다른 갈래를 고른 사본. */
function withPick(doc: VideoDoc, chapterId: string, variantId: string): VideoDoc {
  return { ...doc, chapters: (doc.chapters ?? []).map((c) => (c.id === chapterId ? { ...c, pick: variantId } : c)) };
}

function VariantPane(p: {
  readonly project: string;
  readonly doc: VideoDoc;
  readonly media: MediaProvider | null;
  readonly t: number;
  readonly variant: ChapterVariant;
  readonly picked: boolean;
  readonly disabled: boolean;
  readonly onPick: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const host = useRef<HTMLDivElement>(null);
  const { seek } = useStagePreview({ enabled: true, project: p.project, doc: p.doc, media: p.media, host });
  useEffect(() => { seek(p.t); }, [seek, p.t]);
  const ratio = p.doc.size.height > 0 ? p.doc.size.width / p.doc.size.height : 16 / 9;
  return (
    <figure className="flex min-w-0 flex-1 flex-col gap-1.5">
      <div ref={host} {...DARK_THEME_LOCK} style={{ aspectRatio: String(ratio) }}
        className={`relative max-h-[52vh] overflow-hidden rounded-lg border bg-black ${p.picked ? 'border-transparent ring-2 ring-[var(--vs-accent)]' : 'border-white/10'}`} />
      <figcaption className="flex items-center gap-2 text-[12px] text-slate-300">
        <span className="font-semibold">{t(`panel.videoStudio.engines.${p.variant.engine}`, { defaultValue: p.variant.engine })}</span>
        <span className="text-slate-500">· {t(`panel.videoStudio.variants.status_${p.variant.status}`)}</span>
        <span className="flex-1" />
        <button type="button" disabled={p.disabled || p.picked} onClick={p.onPick}
          className="flex items-center gap-1 rounded-md border border-white/15 px-2 py-0.5 text-[12px] text-slate-100 hover:bg-white/10 disabled:opacity-40">
          <StudioIcon name="check" className="h-3.5 w-3.5" />{p.picked ? t('panel.videoStudio.variants.picked') : t('panel.videoStudio.variants.pick')}
        </button>
      </figcaption>
    </figure>
  );
}

export function VariantCompare(p: VariantCompareProps): React.JSX.Element {
  const { t } = useTranslation();
  const backdrop = useBackdropDismiss(p.onClose);
  const variants = useMemo(() => (p.chapter.chapter.variants ?? []).slice(0, 2), [p.chapter.chapter.variants]);
  const pick = effectivePick(p.chapter.chapter);
  const explicitPick = p.chapter.chapter.pick !== undefined && variants.some((v) => v.id === p.chapter.chapter.pick);
  const [time, setTime] = useState(p.chapter.start);
  const [playing, setPlaying] = useState(false);
  const docs = useMemo(() => variants.map((v) => withPick(p.doc, p.chapter.id, v.id)), [p.doc, p.chapter.id, variants]);

  // 재생 — 장면 구간을 되풀이한다(두 화면이 같은 시각을 받는다).
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const span = Math.max(0.01, p.chapter.end - p.chapter.start);
    const tick = (now: number): void => {
      const dt = (now - last) / 1000;
      last = now;
      setTime((prev) => p.chapter.start + ((prev - p.chapter.start + dt) % span));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, p.chapter.start, p.chapter.end]);

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 p-6" {...backdrop}>
      <div role="dialog" aria-modal="true" aria-label={t('panel.videoStudio.variants.title', { title: p.chapter.chapter.title })}
        className="flex max-h-full w-full max-w-6xl animate-[vs-pop_160ms_ease-out] flex-col gap-3 rounded-xl border border-white/10 bg-vb-card p-4 shadow-2xl shadow-black/60">
        <header className="flex items-center gap-2">
          <StudioIcon name="compare" className="h-4 w-4 text-slate-400" />
          <span className="flex-1 truncate text-[14px] font-semibold text-slate-100">{t('panel.videoStudio.variants.title', { title: p.chapter.chapter.title })}</span>
          <button type="button" onClick={p.onClose} aria-label={t('common.close', { defaultValue: 'Close' })} className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-slate-100"><StudioIcon name="close" /></button>
        </header>
        {variants.length < 2 ? <p className="text-[12px] text-slate-400">{t('panel.videoStudio.variants.missing')}</p> : (
          <div className="flex gap-3">
            {variants.map((v, i) => (
              <VariantPane key={v.id} project={p.project} doc={docs[i] ?? p.doc} media={p.media} t={time} variant={v}
                picked={explicitPick && v.id === pick} disabled={p.disabled} onPick={() => p.onPick(v.id)} />
            ))}
          </div>
        )}
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => setPlaying((v) => !v)} aria-label={playing ? t('panel.videoStudio.pause') : t('panel.videoStudio.play')}
            className="rounded-full p-1.5 text-slate-200 hover:bg-white/10"><StudioIcon name={playing ? 'pause' : 'play'} /></button>
          <input type="range" min={p.chapter.start} max={Math.max(p.chapter.start + 0.01, p.chapter.end)} step={0.01} value={time}
            aria-label={t('panel.videoStudio.seek')} onChange={(e) => { setPlaying(false); setTime(Number(e.target.value)); }}
            className="flex-1 accent-[var(--vs-accent)]" />
          <span className="text-[12px] tabular-nums text-slate-400">{formatClock(time)}</span>
        </div>
        <footer className="flex items-center gap-2">
          <p className="flex-1 text-[12px] text-slate-500">{t('panel.videoStudio.variants.hint')}</p>
          <button type="button" disabled={p.disabled || !explicitPick || variants.length < 2} onClick={p.onDropUnpicked}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-slate-400 hover:bg-white/10 hover:text-slate-100 disabled:opacity-40">
            <StudioIcon name="trash" className="h-3.5 w-3.5" />{t('panel.videoStudio.variants.dropUnpicked')}
          </button>
        </footer>
      </div>
    </div>
  );
}
