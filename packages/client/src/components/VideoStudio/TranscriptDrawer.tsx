import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { buildCutOps, buildTranscript, sentenceCutRanges, type ResolvedTimeline, type VideoDoc, type VideoDocOp } from '@vibisual/video';

import { ScrollFade } from '../ScrollFade.js';
import { formatClock } from './PreviewControls.js';
import { StudioIcon } from './studioIcons.js';
import { usePlayheadSampled, type PlayheadClock } from './playheadClock.js';

/** §5.13 (V) 37-13 — 대본 서랍. 줄 그은 문장을 [자르기] 한 번에 자른다 — 길이 계산은 `buildCutOps`(에이전트 `POST /transcript/cut` 과 같은 함수). */
export interface TranscriptDrawerProps {
  readonly doc: VideoDoc;
  readonly timeline: ResolvedTimeline;
  readonly playhead: number;
  /** §5.13 (Y) 40-5 ① — 재생 중 지금 줄을 따라 비춘다(굵은 구독 — 서랍만 깨운다). 없으면 `playhead` 그대로. */
  readonly clock?: PlayheadClock;
  readonly disabled: boolean;
  readonly onSeek: (t: number) => void;
  readonly onCut: (ops: readonly VideoDocOp[]) => Promise<boolean>;
}

export function TranscriptDrawer(p: TranscriptDrawerProps): React.JSX.Element {
  const { t } = useTranslation();
  const sentences = useMemo(() => buildTranscript(p.doc, p.timeline), [p.doc, p.timeline]);
  const at = usePlayheadSampled(p.clock, p.playhead);
  const [marked, setMarked] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  // 문서가 바뀌어 사라진 문장의 표시는 걷는다.
  useEffect(() => {
    setMarked((prev) => {
      const alive = new Set([...prev].filter((id) => sentences.some((s) => s.id === id)));
      return alive.size === prev.size ? prev : alive;
    });
  }, [sentences]);
  const plan = useMemo(
    () => (marked.size === 0 ? null : buildCutOps(p.doc, p.timeline, sentenceCutRanges(sentences, marked))),
    [marked, p.doc, p.timeline, sentences],
  );
  const toggle = (id: string): void => setMarked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const cut = (): void => {
    if (!plan || plan.ops.length === 0 || busy) return;
    setBusy(true);
    void p.onCut(plan.ops).then((ok) => { if (ok) setMarked(new Set()); }).finally(() => setBusy(false));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScrollFade fill className="flex-1">
        <div className="flex flex-col gap-2 p-3">
          <p className="text-[12px] leading-relaxed text-slate-500">{t('panel.videoStudio.transcript.hint')}</p>
          {sentences.length === 0 ? <p className="text-[12px] text-slate-500">{t('panel.videoStudio.transcript.empty')}</p> : null}
          <ol className="flex flex-col gap-0.5">
            {sentences.map((s) => {
              const on = marked.has(s.id);
              const playing = at >= s.start && at < s.end;
              return (
                <li key={s.id} className={`group flex items-start gap-2 rounded-lg px-2 py-1.5 ${playing ? 'bg-white/[0.06] ring-1 ring-[var(--vs-accent)]' : 'hover:bg-white/[0.04]'}`}>
                  <button type="button" onClick={() => p.onSeek(s.start)} className="shrink-0 pt-px text-[12px] tabular-nums text-slate-500 hover:text-slate-100"
                    title={t('panel.videoStudio.transcript.seek')}>
                    {formatClock(s.start)}
                  </button>
                  <button type="button" onClick={() => p.onSeek(s.start)}
                    className={`min-w-0 flex-1 text-left text-[12px] leading-relaxed ${on ? 'text-slate-500 line-through decoration-slate-400' : 'text-slate-200'}`}>
                    {s.text}
                  </button>
                  {/* 터치에는 hover 가 없다 — 빼기 단추를 늘 보인다(마우스에서는 종전대로 줄에 올렸을 때만). */}
                  <button type="button" disabled={p.disabled} aria-pressed={on} onClick={() => toggle(s.id)}
                    aria-label={on ? t('panel.videoStudio.transcript.keep') : t('panel.videoStudio.transcript.strike')}
                    title={on ? t('panel.videoStudio.transcript.keep') : t('panel.videoStudio.transcript.strike')}
                    className={`shrink-0 rounded p-0.5 hover:bg-white/10 disabled:opacity-40 pointer-coarse:p-2 ${on ? 'text-slate-100' : 'text-slate-500 opacity-0 focus:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100'}`}>
                    <StudioIcon name={on ? 'restore' : 'trash'} className="h-3.5 w-3.5" />
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      </ScrollFade>
      {plan ? (
        <div className="flex shrink-0 flex-col gap-1.5 border-t border-white/10 p-3">
          <p className="text-[12px] tabular-nums text-slate-300">
            {t('panel.videoStudio.transcript.summary', {
              count: marked.size,
              removed: plan.removed.toFixed(2),
              after: plan.durationAfter === null ? '—' : formatClock(plan.durationAfter),
              before: formatClock(plan.durationBefore),
            })}
          </p>
          <div className="flex gap-1.5">
            <button type="button" disabled={p.disabled || busy || plan.ops.length === 0} onClick={cut}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-white/15 bg-white/10 px-2 py-1 text-[12px] font-semibold text-slate-100 hover:bg-white/15 disabled:opacity-40 pointer-coarse:py-2">
              <StudioIcon name="split" className="h-3.5 w-3.5" />{t('panel.videoStudio.transcript.cut')}
            </button>
            <button type="button" disabled={busy} onClick={() => setMarked(new Set())}
              className="rounded-md px-2 py-1 text-[12px] text-slate-400 hover:bg-white/10 hover:text-slate-100 disabled:opacity-40 pointer-coarse:py-2">
              {t('panel.videoStudio.transcript.clear')}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
