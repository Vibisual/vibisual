import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { HistoryEntry } from '@vibisual/video';

import { ScrollFade } from '../ScrollFade.js';
import { StudioIcon } from './studioIcons.js';
import { StudioIconButton } from './StudioIconButton.js';

/**
 * §5.13 (V) 37-3 — **판 기록** 서랍: 세로 구슬 줄(나 = 실버 테, AI = 앱 색 테). 판마다 정지 화면·누가·요약·시각, [이 판으로
 * 돌아가기](되돌림도 새 판) · [나란히 보기](둘을 고르면 비교) · [지우기](사람만 — 자동 삭제는 없다). 맨 위 [저장점 찍기].
 */
export interface HistoryPanelProps {
  readonly entries: readonly HistoryEntry[];
  readonly stills: Readonly<Record<string, string | null>>;
  readonly onNeedStill: (revId: string) => void;
  readonly onCheckpoint: () => void;
  readonly onRestore: (revId: string) => void;
  readonly onDelete: (revId: string) => void;
  readonly compare: readonly string[];
  readonly onToggleCompare: (revId: string) => void;
  readonly onOpenCompare: () => void;
  readonly onClose: () => void;
  readonly busy: boolean;
}

/** 목록에서 한 번에 정지 화면을 구울 판 수(맨 위 몇 개 — 나머지는 아이콘). */
const STILLS_FIRST = 12;

export function HistoryPanel(p: HistoryPanelProps): React.JSX.Element {
  const { t } = useTranslation();
  const list = [...p.entries].reverse();
  useEffect(() => {
    for (const e of list.slice(0, STILLS_FIRST)) if (p.stills[e.id] === undefined) p.onNeedStill(e.id);
    // 목록이 바뀔 때만 — 정지 화면이 차오를 때마다 다시 묻지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.entries]);
  return (
    // AI 칸과 같은 자리·같은 폭 규칙(StudioAiPanel) — 창 폭의 %, 1024px 미만은 하한 260px, 640px 미만은 미리보기 아래로 쌓인다.
    <aside className="flex w-[clamp(300px,27%,380px)] shrink-0 animate-[vs-in-right_160ms_ease-out] flex-col border-l border-white/10 bg-vb-card box-compact:w-[clamp(260px,34%,340px)] box-narrow:h-[45%] box-narrow:min-h-40 box-narrow:w-full box-narrow:animate-[vs-in-up_160ms_ease-out] box-narrow:border-l-0 box-narrow:border-t" aria-label={t('panel.videoStudio.history.title')}>
      <header className="flex h-10 shrink-0 items-center gap-1 border-b border-white/10 px-3">
        <span className="flex-1 text-[13px] font-semibold text-slate-200">{t('panel.videoStudio.history.title')}</span>
        <StudioIconButton icon="checkpoint" label={t('panel.videoStudio.history.checkpoint')} text={t('panel.videoStudio.history.checkpoint')} onClick={p.onCheckpoint} disabled={p.busy} size="sm" />
        <StudioIconButton icon="close" label={t('common.close', { defaultValue: 'Close' })} onClick={p.onClose} size="sm" />
      </header>
      {p.compare.length > 0 ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-white/10 px-3 py-2 text-[12px] text-slate-400">
          <span className="flex-1">{t('panel.videoStudio.history.compareCount', { count: p.compare.length })}</span>
          <button type="button" disabled={p.compare.length !== 2} onClick={p.onOpenCompare}
            className="flex items-center gap-1 rounded-md border border-white/15 px-2 py-1 text-slate-200 hover:bg-white/10 disabled:opacity-40 pointer-coarse:py-2">
            <StudioIcon name="compare" className="h-3.5 w-3.5" />{t('panel.videoStudio.history.compare')}
          </button>
        </div>
      ) : null}
      <ScrollFade fill className="flex-1">
        {list.length === 0 ? <p className="p-4 text-[13px] leading-relaxed text-slate-500">{t('panel.videoStudio.history.empty')}</p> : null}
        <ol className="flex flex-col p-3">
          {list.map((e, i) => {
            const still = p.stills[e.id];
            const ai = e.by === 'ai';
            const picked = p.compare.includes(e.id);
            return (
              <li key={e.id} className="group relative flex gap-3 pb-4">
                {i < list.length - 1 ? <span className="absolute left-[21px] top-11 h-[calc(100%-36px)] border-l border-white/15" aria-hidden="true" /> : null}
                <button type="button" onClick={() => p.onToggleCompare(e.id)} aria-pressed={picked} title={t('panel.videoStudio.history.pick')}
                  className={`relative h-11 w-11 shrink-0 overflow-hidden rounded-full border-2 bg-black ${ai ? 'border-[var(--vs-accent)]' : 'border-slate-300'} ${picked ? 'ring-2 ring-offset-2 ring-offset-vb-card ring-slate-100' : ''}`}>
                  {still ? <img src={still} alt="" className="h-full w-full object-cover" /> : <span className="absolute inset-0 flex items-center justify-center text-slate-500"><StudioIcon name={ai ? 'sparkle' : 'checkpoint'} className="h-4 w-4" /></span>}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] font-semibold text-slate-100">{t(`panel.videoStudio.history.kind_${e.kind}`)}</span>
                    <span className="shrink-0 text-[12px] text-slate-500">{ai ? t('panel.videoStudio.history.byAi') : t('panel.videoStudio.history.byMe')}</span>
                    {e.render ? <span className="shrink-0 rounded-full border border-white/15 px-1.5 text-[12px] text-slate-300">{t('panel.videoStudio.history.rendered')}</span> : null}
                  </div>
                  <p className="line-clamp-2 text-[12px] leading-snug text-slate-400">
                    {e.label === 'before-restore' ? t('panel.videoStudio.history.beforeRestore') : e.summary ?? e.label ?? e.request ?? ''}
                  </p>
                  <p className="text-[12px] tabular-nums text-slate-500">{new Date(e.createdAt).toLocaleString()} · v{e.docVersion}</p>
                  <div className="mt-1 flex flex-wrap gap-1 opacity-70 group-hover:opacity-100 pointer-coarse:opacity-100">
                    <button type="button" disabled={p.busy} onClick={() => p.onRestore(e.id)} className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] text-slate-300 hover:bg-white/10 disabled:opacity-40 pointer-coarse:px-2.5 pointer-coarse:py-1.5">
                      <StudioIcon name="restore" className="h-3.5 w-3.5" />{t('panel.videoStudio.history.restore')}
                    </button>
                    <button type="button" disabled={p.busy} onClick={() => p.onDelete(e.id)} className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] text-slate-500 hover:bg-white/10 hover:text-slate-200 disabled:opacity-40 pointer-coarse:px-2.5 pointer-coarse:py-1.5">
                      <StudioIcon name="trash" className="h-3.5 w-3.5" />{t('common.delete')}
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </ScrollFade>
    </aside>
  );
}
