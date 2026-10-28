import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChapterStatus, ResolvedChapter, VideoChapter } from '@vibisual/video';

import { formatClock } from './PreviewControls.js';
import { StudioIcon } from './studioIcons.js';
import { ValueControl } from './StudioValueControls.js';
import { memoLatest } from './studioMemo.js';

/**
 * §5.13 (V) 37-4 — 기획 카드: AI 의 첫 바퀴는 기획이다. [이대로 만들기]면 전부 승인되고 '짓기' 바퀴가 나간다. 글은 칸을 떠날 때 한 번 적는다(글자마다 패치 ❌).
 * §5.13 (W) 38-7 — `chapter.frame` 이 있으면 카드에 '정지 화면' 으로 선다. 판은 가운데 칸 높이 45% 이하, 넘치면 카드 안에서 스크롤.
 * HTML5 끌기는 터치에서 안 되므로 터치에선 [앞으로]·[뒤로] 단추(같은 `onMove`).
 */
export interface PlanCardsProps {
  readonly chapters: readonly ResolvedChapter[];
  readonly thumbs: Readonly<Record<string, string | null>>;
  /** 소재 id → 이름('쓸 소재' 칩). §5.13 (Y) 40-5 ③ — 함수가 아니라 값으로 받는다(함수면 판이 다시 안 그려지는 동안 낡은 이름이 남는다). 없는 id 는 id 그대로. */
  readonly mediaNames: Readonly<Record<string, string>>;
  readonly workingChapterId: string | null;
  readonly fps: number;
  readonly disabled: boolean;
  readonly busy: boolean;
  readonly onUpdate: (chapterId: string, patch: Partial<Omit<VideoChapter, 'id'>>) => void;
  readonly onMove: (chapterId: string, beforeChapterId: string | undefined) => void;
  readonly onAdd: (afterChapterId: string | undefined) => void;
  readonly onRemove: (chapterId: string) => void;
  readonly onSeek: (t: number) => void;
  readonly onApprove: () => void;
  readonly onCollapse: () => void;
}

const DRAG_TYPE = 'application/x-vibistudio-chapter';

const STATUS_TONE: Readonly<Record<ChapterStatus, string>> = {
  plan: 'border-dashed border-white/20',
  approved: 'border-white/20',
  building: 'border-white/25',
  done: 'border-white/15',
};

/** 칸을 떠날 때 한 번 적는 글 칸. 바깥 값이 바뀌면(에이전트가 고쳤다) 손대지 않은 칸은 따라간다. */
function DraftText({ value, label, multiline, disabled, onCommit, placeholder, className }: {
  readonly value: string;
  readonly label: string;
  readonly multiline?: boolean;
  readonly disabled: boolean;
  readonly onCommit: (v: string) => void;
  readonly placeholder?: string;
  readonly className?: string;
}): React.JSX.Element {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);
  const commit = (): void => { setEditing(false); if (draft !== value) onCommit(draft); };
  const common = {
    value: draft,
    disabled,
    'aria-label': label,
    placeholder,
    spellCheck: false,
    onFocus: () => setEditing(true),
    onBlur: commit,
    className: `w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 text-slate-100 outline-none placeholder:text-slate-600 hover:border-white/10 focus:border-white/15 focus:bg-vb-sunken focus:ring-1 focus:ring-[var(--vs-accent)] disabled:opacity-50 pointer-coarse:py-2 ${className ?? ''}`,
  };
  return multiline ? (
    <textarea {...common} rows={2} onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') { setDraft(value); setEditing(false); e.currentTarget.blur(); } }}
      style={{ resize: 'none' }} />
  ) : (
    <input {...common} onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.nativeEvent.isComposing) return;
        if (e.key === 'Enter') e.currentTarget.blur();
        else if (e.key === 'Escape') { setDraft(value); setEditing(false); e.currentTarget.blur(); }
      }} />
  );
}

/** §5.13 (Y) 40-5 ③ — 값이 같으면 다시 그리지 않는다(손잡이는 늘 최신을 부른다 — `studioMemo.ts`). */
export const PlanCards = memoLatest(PlanCardsView);

function PlanCardsView(p: PlanCardsProps): React.JSX.Element {
  const { t } = useTranslation();
  const [dropBefore, setDropBefore] = useState<string | null | undefined>(undefined);
  const plan = p.chapters.filter((c) => c.chapter.status === 'plan');
  const total = p.chapters.reduce((s, c) => Math.max(s, c.end), 0);
  const building = p.chapters.some((c) => c.chapter.status === 'approved' || c.chapter.status === 'building');
  return (
    <section className="flex max-h-[45%] min-h-0 animate-[vs-in-up_160ms_ease-out] flex-col gap-2 rounded-lg border border-white/10 bg-vb-card p-2.5" aria-label={t('panel.videoStudio.plan.title')}>
      {/* 왼쪽 묶음만 접힌다 — [숨기기]는 묶음 밖이라 줄이 몇 번 접혀도 오른쪽 끝에 남는다. */}
      <header className="flex shrink-0 items-center gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <span className="shrink-0 text-[13px] font-semibold text-slate-100">{t('panel.videoStudio.plan.title')}</span>
          <span className="min-w-0 truncate text-[12px] tabular-nums text-slate-500">{t('panel.videoStudio.plan.summary', { count: p.chapters.length, length: formatClock(total) })}</span>
          <span className="flex-1" />
          <button type="button" disabled={p.disabled} onClick={() => p.onAdd(p.chapters[p.chapters.length - 1]?.id)}
            className="flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-[12px] text-slate-300 hover:bg-white/10 disabled:opacity-40 pointer-coarse:h-9">
            <StudioIcon name="plus" className="h-3.5 w-3.5" />{t('panel.videoStudio.plan.add')}
          </button>
          {plan.length > 0 ? (
            <button type="button" disabled={p.disabled || p.busy} onClick={p.onApprove}
              className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-white/15 bg-white/10 px-3 text-[12px] font-semibold text-slate-50 ring-1 ring-[var(--vs-accent)] hover:bg-white/15 disabled:opacity-40 pointer-coarse:h-10">
              <StudioIcon name="sparkle" className="h-3.5 w-3.5" />{t('panel.videoStudio.plan.approve')}
            </button>
          ) : building ? (
            <span className="flex shrink-0 items-center gap-1.5 text-[12px] text-slate-400">
              <span className="h-1.5 w-1.5 animate-[vs-breathe_1.2s_ease-in-out_infinite] rounded-full bg-[var(--vs-accent)]" />{t('panel.videoStudio.plan.building')}
            </span>
          ) : null}
        </div>
        <button type="button" onClick={p.onCollapse} aria-label={t('panel.videoStudio.plan.collapse')} title={t('panel.videoStudio.plan.collapse')}
          className="shrink-0 rounded p-1 text-slate-500 hover:bg-white/10 hover:text-slate-100 pointer-coarse:p-2.5"><StudioIcon name="chevronDown" className="h-3.5 w-3.5" /></button>
      </header>
      {/* 높이 상한 300px 은 그대로이고, 판이 줄어들면 줄도 그만큼 줄어든다(줄은 이 칸을 채운다). 카드는 줄 높이까지 늘어 카드 안에서
          세로로 스크롤한다. */}
      <div className="flex max-h-[300px] min-h-0 flex-col">
        <ol className="scrollbar-thin flex min-h-0 gap-2 overflow-x-auto overflow-y-hidden pb-1" onDragOver={(e) => { if (e.dataTransfer.types.includes(DRAG_TYPE)) e.preventDefault(); }}>
          {p.chapters.map((c) => {
            const ch = c.chapter;
            const thumb = p.thumbs[c.id] ?? null;
            const working = c.id === p.workingChapterId || ch.status === 'building';
            const prev = p.chapters[c.index - 1];
            const last = c.index >= p.chapters.length - 1;
            return (
              <li key={c.id} draggable={!p.disabled}
                onDragStart={(e) => { e.dataTransfer.setData(DRAG_TYPE, c.id); e.dataTransfer.effectAllowed = 'move'; }}
                onDragOver={(e) => { if (!e.dataTransfer.types.includes(DRAG_TYPE)) return; e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); setDropBefore(e.clientX < r.left + r.width / 2 ? c.id : p.chapters[c.index + 1]?.id ?? null); }}
                onDragLeave={() => setDropBefore(undefined)}
                onDrop={(e) => {
                  const id = e.dataTransfer.getData(DRAG_TYPE);
                  const before = dropBefore;
                  setDropBefore(undefined);
                  if (!id || before === undefined || before === id) return;
                  e.preventDefault();
                  p.onMove(id, before ?? undefined);
                }}
                onDragEnd={() => setDropBefore(undefined)}
                className={`scrollbar-thin relative flex w-60 shrink-0 flex-col gap-1.5 overflow-y-auto rounded-lg border bg-vb-sunken p-2 ${STATUS_TONE[ch.status]} ${dropBefore === c.id ? 'shadow-[-3px_0_0_0_var(--vs-accent)]' : ''}`}>
                <div className="flex items-center gap-1.5">
                  <span className="flex h-5 min-w-5 shrink-0 cursor-grab items-center justify-center rounded-full bg-white/10 px-1 text-[12px] font-semibold tabular-nums text-slate-200" title={t('panel.videoStudio.plan.drag')}>{c.index + 1}</span>
                  <DraftText value={ch.title} label={t('panel.videoStudio.plan.chapterTitle')} placeholder={t('panel.videoStudio.plan.chapterTitle')} disabled={p.disabled}
                    className="min-w-0 text-[13px] font-semibold" onCommit={(title) => p.onUpdate(c.id, { title })} />
                  {/* 터치의 순서 바꾸기 — 끌기와 같은 `onMove`(앞 장면 앞으로 · 다음 장면 뒤로). 마우스에서는 끌기가 있어 서지 않는다. */}
                  <button type="button" disabled={p.disabled || !prev} onClick={() => { if (prev) p.onMove(c.id, prev.id); }}
                    aria-label={t('panel.videoStudio.plan.moveEarlier', { defaultValue: 'Move earlier' })} title={t('panel.videoStudio.plan.moveEarlier', { defaultValue: 'Move earlier' })}
                    className="hidden shrink-0 rounded p-2 text-slate-500 hover:bg-white/10 hover:text-slate-100 disabled:opacity-40 pointer-coarse:flex"><StudioIcon name="chevronDown" className="h-3.5 w-3.5 rotate-90" /></button>
                  <button type="button" disabled={p.disabled || last} onClick={() => { if (!last) p.onMove(c.id, p.chapters[c.index + 2]?.id); }}
                    aria-label={t('panel.videoStudio.plan.moveLater', { defaultValue: 'Move later' })} title={t('panel.videoStudio.plan.moveLater', { defaultValue: 'Move later' })}
                    className="hidden shrink-0 rounded p-2 text-slate-500 hover:bg-white/10 hover:text-slate-100 disabled:opacity-40 pointer-coarse:flex"><StudioIcon name="chevronDown" className="h-3.5 w-3.5 -rotate-90" /></button>
                  <button type="button" disabled={p.disabled} onClick={() => p.onRemove(c.id)} aria-label={t('panel.videoStudio.plan.remove')} title={t('panel.videoStudio.plan.remove')}
                    className="shrink-0 rounded p-0.5 text-slate-500 hover:bg-white/10 hover:text-slate-100 disabled:opacity-40 pointer-coarse:p-2"><StudioIcon name="trash" className="h-3.5 w-3.5" /></button>
                </div>
                <button type="button" onClick={() => p.onSeek(c.start)} className="relative aspect-video w-full shrink-0 overflow-hidden rounded-md border border-white/10 bg-black" aria-label={t('panel.videoStudio.plan.seek', { n: c.index + 1 })}>
                  {thumb ? <img src={thumb} alt="" draggable={false} className="h-full w-full object-cover" /> : (
                    <span className="absolute inset-0 flex items-center justify-center px-3 text-center text-[12px] leading-snug text-slate-500">
                      {ch.status === 'plan' ? (ch.text?.trim() || t('panel.videoStudio.plan.noFrameYet')) : working ? t('panel.videoStudio.plan.buildingThis') : t('panel.videoStudio.plan.noFrameYet')}
                    </span>
                  )}
                  {working ? (
                    <span className="pointer-events-none absolute right-1.5 top-1.5 h-5 w-5 animate-[vs-orbit_2.4s_linear_infinite]">
                      <span className="absolute left-1/2 top-0 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-[var(--vs-accent)] shadow-[0_0_6px_var(--vs-accent)]" />
                    </span>
                  ) : null}
                  <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[12px] tabular-nums text-white/80">{formatClock(c.start)}</span>
                  {/* §5.13 (W) 38-7 — 기획 장면의 그림은 움직이기 전에 승인받는 정지 화면이다. */}
                  {ch.status === 'plan' && thumb ? (
                    <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[12px] text-white/80">{t('panel.videoStudio.plan.styleFrame')}</span>
                  ) : null}
                </button>
                <div className="flex items-center gap-1.5">
                  <span className="shrink-0 text-[12px] text-slate-500">{t('panel.videoStudio.plan.length')}</span>
                  <ValueControl disabled={p.disabled}
                    field={{ key: 'duration', type: 'time', label: t('panel.videoStudio.plan.length'), value: ch.duration, min: 1 / Math.max(1, p.fps), step: 0.25 }}
                    onChange={(v) => { const n = typeof v === 'number' ? v : Number(v); if (Number.isFinite(n) && n > 0) p.onUpdate(c.id, { duration: n }); }} />
                </div>
                <label className="flex flex-col gap-0.5">
                  <span className="px-1.5 text-[12px] text-slate-500">{t('panel.videoStudio.plan.text')}</span>
                  <DraftText value={ch.text ?? ''} label={t('panel.videoStudio.plan.text')} multiline disabled={p.disabled} className="text-[12px]" onCommit={(text) => p.onUpdate(c.id, { text })} />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="px-1.5 text-[12px] text-slate-500">{t('panel.videoStudio.plan.brief')}</span>
                  <DraftText value={ch.brief ?? ''} label={t('panel.videoStudio.plan.brief')} multiline disabled={p.disabled} className="text-[12px] text-slate-300" onCommit={(brief) => p.onUpdate(c.id, { brief })} />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="px-1.5 text-[12px] text-slate-500">{t('panel.videoStudio.plan.sound')}</span>
                  <DraftText value={ch.sound ?? ''} label={t('panel.videoStudio.plan.sound')} disabled={p.disabled} className="text-[12px] text-slate-300" onCommit={(sound) => p.onUpdate(c.id, { sound })} />
                </label>
                {(ch.media ?? []).length > 0 ? (
                  <div className="flex flex-wrap gap-1 px-1">
                    {(ch.media ?? []).map((id) => (
                      <span key={id} className="max-w-full truncate rounded-full border border-white/10 px-1.5 text-[12px] text-slate-400" title={id}>{p.mediaNames[id] ?? id}</span>
                    ))}
                  </div>
                ) : null}
              </li>
            );
          })}
          {dropBefore === null ? <li className="w-0.5 shrink-0 rounded-full bg-[var(--vs-accent)]" aria-hidden="true" /> : null}
        </ol>
      </div>
    </section>
  );
}
