import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { diffDoc, resolveTimeline, summarizeDiff, type HistoryEntry, type VideoDoc } from '@vibisual/video';

import { useBackdropDismiss } from '../../hooks/usePopupDismiss.js';
import { DARK_THEME_LOCK } from '../../theme/themeLock.js';
import { ScrollFade } from '../ScrollFade.js';
import { StudioIcon } from './studioIcons.js';
import { formatClock } from './PreviewControls.js';
import { diffLineText } from './diffText.js';
import { historyStill, readHistoryDoc } from './studioApi.js';

/** §5.13 (V) 37-3 — 두 판 나란히(같은 시각 정지 화면 둘 + 차이 줄 — 일꾼이 그 판의 문서·코드로 찍는다). 폰 폭은 위아래로 쌓는다. */
export interface HistoryCompareProps {
  readonly project: string;
  readonly docId: string;
  readonly a: HistoryEntry;
  readonly b: HistoryEntry;
  readonly onClose: () => void;
}

export function HistoryCompare(p: HistoryCompareProps): React.JSX.Element {
  const { t } = useTranslation();
  const backdrop = useBackdropDismiss(p.onClose);
  const [docs, setDocs] = useState<{ a: VideoDoc; b: VideoDoc } | null>(null);
  const [time, setTime] = useState(0);
  const [shot, setShot] = useState(0);
  const [images, setImages] = useState<{ a: string | null; b: string | null }>({ a: null, b: null });
  // 시간 순서대로 — 앞 판이 왼쪽.
  const [older, newer] = p.a.createdAt <= p.b.createdAt ? [p.a, p.b] : [p.b, p.a];

  useEffect(() => {
    let alive = true;
    Promise.all([readHistoryDoc(p.project, p.docId, older.id), readHistoryDoc(p.project, p.docId, newer.id)])
      .then(([a, b]) => { if (alive) setDocs({ a, b }); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [p.project, p.docId, older.id, newer.id]);

  useEffect(() => {
    let alive = true;
    setImages({ a: null, b: null });
    void historyStill(p.project, p.docId, older.id, shot).then((img) => { if (alive) setImages((s) => ({ ...s, a: img })); }).catch(() => undefined);
    void historyStill(p.project, p.docId, newer.id, shot).then((img) => { if (alive) setImages((s) => ({ ...s, b: img })); }).catch(() => undefined);
    return () => { alive = false; };
  }, [p.project, p.docId, older.id, newer.id, shot]);

  const duration = useMemo(() => (docs ? Math.max(resolveTimeline(docs.a).duration, resolveTimeline(docs.b).duration) : 0), [docs]);
  const lines = useMemo(() => (docs ? summarizeDiff(diffDoc(docs.a, docs.b), docs.a, docs.b) : []), [docs]);
  const pane = (entry: HistoryEntry, image: string | null): React.JSX.Element => (
    <figure className="flex min-w-0 flex-1 flex-col gap-1.5">
      <div {...DARK_THEME_LOCK} className="relative aspect-video overflow-hidden rounded-lg border border-white/10 bg-black">
        {image ? <img src={image} alt="" className="h-full w-full object-contain" /> : <span className="absolute inset-0 flex items-center justify-center"><span className="h-2 w-2 animate-[vs-breathe_1.2s_ease-in-out_infinite] rounded-full bg-white/40" /></span>}
      </div>
      <figcaption className="flex items-center gap-1.5 text-[12px] text-slate-400">
        <span className={`h-2 w-2 rounded-full ${entry.by === 'ai' ? 'bg-[var(--vs-accent)]' : 'bg-slate-300'}`} />
        <span className="truncate">{t(`panel.videoStudio.history.kind_${entry.kind}`)} · v{entry.docVersion} · {new Date(entry.createdAt).toLocaleTimeString()}</span>
      </figcaption>
    </figure>
  );

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 p-6 box-narrow:p-2" {...backdrop}>
      <div role="dialog" aria-modal="true" aria-label={t('panel.videoStudio.history.compare')}
        className="scrollbar-thin flex max-h-full w-full max-w-5xl animate-[vs-pop_160ms_ease-out] flex-col gap-3 overflow-y-auto rounded-xl border border-white/10 bg-vb-card p-4 shadow-2xl shadow-black/60 box-narrow:p-3">
        <header className="flex shrink-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-slate-100">{t('panel.videoStudio.history.compare')}</span>
          <button type="button" onClick={p.onClose} aria-label={t('common.close', { defaultValue: 'Close' })} className="shrink-0 rounded p-1 text-slate-400 hover:bg-white/10 hover:text-slate-100 pointer-coarse:p-2"><StudioIcon name="close" /></button>
        </header>
        <div className="flex shrink-0 gap-3 box-narrow:flex-col">{pane(older, images.a)}{pane(newer, images.b)}</div>
        <div className="flex shrink-0 items-center gap-3">
          <input type="range" min={0} max={Math.max(0.01, duration)} step={0.01} value={time} aria-label={t('panel.videoStudio.seek')}
            onChange={(e) => setTime(Number(e.target.value))} onPointerUp={() => setShot(time)} onKeyUp={() => setShot(time)}
            className="min-w-0 flex-1 accent-[var(--vs-accent)] pointer-coarse:h-8" />
          <span className="shrink-0 text-[12px] tabular-nums text-slate-400">{formatClock(time)}</span>
        </div>
        {/* 낮은 창에서는 창이 스크롤한다 — 차이 줄 칸이 0 으로 짓눌리지 않게 줄지 않는 상자로 감싼다(ScrollFade 겉은 overflow 를 숨겨 줄어든다). */}
        <div className="shrink-0">
          <ScrollFade maxHeight={160}>
            <ul className="flex flex-col gap-0.5">
              {lines.length === 0 ? <li className="text-[12px] text-slate-500">{t('panel.videoStudio.history.noDiff')}</li> : null}
              {lines.map((line, i) => <li key={`${line.kind}-${i}`} className="break-words text-[13px] text-slate-300">{diffLineText(t, line)}</li>)}
            </ul>
          </ScrollFade>
        </div>
      </div>
    </div>
  );
}
