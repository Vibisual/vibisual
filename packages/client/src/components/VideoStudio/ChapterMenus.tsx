import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  TRANSITION_DEFAULT_SECONDS,
  TRANSITION_DIRECTIONS,
  TRANSITION_KINDS,
  TRANSITION_MAX_SECONDS,
  TRANSITION_MIN_SECONDS,
  transitionDirection,
  transitionHasDirection,
  type ResolvedChapter,
  type TransitionDirection,
  type TransitionKind,
} from '@vibisual/video';

import { StudioPopover, PopoverItem } from './StudioPopover.js';
import { StudioIcon, type StudioIconName } from './studioIcons.js';
import { ValueControl } from './StudioValueControls.js';

/** §5.13 (V) 37-8 — 장면 구슬 메뉴와 이음매(전환) 고르기 — 전환 표(`TRANSITION_KINDS`) · 방향(있는 전환만) · 길이 0.2~1.5초 · [비트에 붙이기](음악이 있을 때). */
export interface ChapterMenuProps {
  readonly anchor: HTMLElement;
  readonly chapter: ResolvedChapter;
  readonly hasNext: boolean;
  readonly canSplit: boolean;
  readonly otherEngine: string;
  readonly busy: boolean;
  readonly onRedo: () => void;
  readonly onOtherEngine: () => void;
  readonly onVariants: () => void;
  readonly onSavePart: () => void;
  readonly onSplit: () => void;
  readonly onMerge: () => void;
  readonly onRemove: () => void;
  readonly onClose: () => void;
}

export function ChapterMenu(p: ChapterMenuProps): React.JSX.Element {
  const { t } = useTranslation();
  const anchor = useMemo(() => ({ current: p.anchor }), [p.anchor]);
  const run = (fn: () => void) => (): void => { p.onClose(); fn(); };
  return (
    <StudioPopover anchor={anchor} open onClose={p.onClose} side="above" label={t('panel.videoStudio.strip.menu')} className="w-64">
      <p className="truncate px-2.5 pb-1 pt-0.5 text-[12px] font-semibold text-slate-500">{t('panel.videoStudio.strip.chapter', { n: p.chapter.index + 1, title: p.chapter.chapter.title })}</p>
      <PopoverItem disabled={p.busy} onClick={run(p.onRedo)}><span className="flex items-center gap-2"><StudioIcon name="sparkle" />{t('panel.videoStudio.chapterMenu.redo')}</span></PopoverItem>
      <PopoverItem disabled={p.busy} onClick={run(p.onOtherEngine)}><span className="flex items-center gap-2"><StudioIcon name="restore" />{t('panel.videoStudio.chapterMenu.otherEngine', { engine: p.otherEngine })}</span></PopoverItem>
      <PopoverItem disabled={p.busy} onClick={run(p.onVariants)}><span className="flex items-center gap-2"><StudioIcon name="compare" />{t('panel.videoStudio.chapterMenu.variants')}</span></PopoverItem>
      <PopoverItem onClick={run(p.onSavePart)}><span className="flex items-center gap-2"><StudioIcon name="parts" />{t('panel.videoStudio.chapterMenu.savePart')}</span></PopoverItem>
      <div className="my-1 border-t border-white/10" />
      <PopoverItem disabled={!p.canSplit} onClick={run(p.onSplit)}><span className="flex items-center gap-2"><StudioIcon name="split" />{t('panel.videoStudio.chapterMenu.split')}</span></PopoverItem>
      <PopoverItem disabled={!p.hasNext} onClick={run(p.onMerge)}><span className="flex items-center gap-2"><StudioIcon name="link" />{t('panel.videoStudio.chapterMenu.merge')}</span></PopoverItem>
      <PopoverItem onClick={run(p.onRemove)}><span className="flex items-center gap-2"><StudioIcon name="trash" />{t('panel.videoStudio.chapterMenu.remove')}</span></PopoverItem>
    </StudioPopover>
  );
}

export interface SeamMenuProps {
  readonly anchor: HTMLElement;
  readonly chapter: ResolvedChapter;
  readonly fps: number;
  readonly canSnap: boolean;
  /** `direction` 은 방향이 있는 전환에서 사용자가 고른 쪽(안 고르면 undefined — 그 전환의 기본 쪽). */
  readonly onSet: (kind: TransitionKind, duration: number, direction?: TransitionDirection) => void;
  readonly onSnap: () => void;
  readonly onClose: () => void;
}

const DIRECTION_ICON: Readonly<Record<TransitionDirection, StudioIconName>> = { left: 'arrowLeft', right: 'arrowRight', up: 'arrowUp', down: 'arrowDown' };
/** 전환 길이를 끈 뒤 이만큼 잠잠하면 적는다(ms). */
const SEAM_SAVE_MS = 350;

export function SeamMenu(p: SeamMenuProps): React.JSX.Element {
  const { t } = useTranslation();
  const anchor = useMemo(() => ({ current: p.anchor }), [p.anchor]);
  const current = p.chapter.chapter.transition;
  const kind = current?.kind ?? 'cut';
  // 방향이 있는 전환끼리 바꿀 때는 고른 쪽을 지킨다(밀기 위쪽 → 닦아내기 위쪽).
  const kept = (k: TransitionKind): TransitionDirection | undefined => (transitionHasDirection(k) ? current?.direction : undefined);
  const direction = transitionDirection(kind, current?.direction);
  // 자르기(길이 0)에서 다른 전환으로 바꾸면 기본 길이로 — 0초로 적히면 겹침이 없어 고른 전환이 보이지 않는다.
  const [duration, setDuration] = useState(current && current.duration > 0 ? current.duration : TRANSITION_DEFAULT_SECONDS);
  // 길이는 끄는 동안 잠잠해지면 한 번 적는다(끌기마다 패치가 쏟아지지 않게).
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return (
    <StudioPopover anchor={anchor} open onClose={p.onClose} side="above" label={t('panel.videoStudio.seam.title')} className="w-64">
      <p className="px-2.5 pb-1 pt-0.5 text-[12px] font-semibold text-slate-500">{t('panel.videoStudio.seam.title')}</p>
      <div className="grid grid-cols-2 gap-1 px-1" role="radiogroup" aria-label={t('panel.videoStudio.seam.title')}>
        {TRANSITION_KINDS.map((k) => (
          <button key={k} type="button" role="radio" aria-checked={k === kind}
            onClick={() => p.onSet(k, k === 'cut' ? 0 : duration, kept(k))}
            className={`rounded-md px-2 py-1.5 text-left text-[12px] transition-colors duration-150 ease-out pointer-coarse:py-2.5 ${k === kind ? 'bg-white/10 text-slate-50 ring-1 ring-[var(--vs-accent)]' : 'text-slate-300 hover:bg-white/10'}`}>
            {t(`panel.videoStudio.transitions.${k}`)}
          </button>
        ))}
      </div>
      {direction !== null ? (
        <div className="mt-2 flex items-center justify-between gap-2 px-2.5">
          <span className="text-[12px] text-slate-400">{t('panel.videoStudio.seam.direction')}</span>
          <div className="flex gap-1" role="radiogroup" aria-label={t('panel.videoStudio.seam.direction')}>
            {TRANSITION_DIRECTIONS.map((d) => (
              <button key={d} type="button" role="radio" aria-checked={d === direction}
                aria-label={t(`panel.videoStudio.seam.dir_${d}`)} title={t(`panel.videoStudio.seam.dir_${d}`)}
                onClick={() => p.onSet(kind, duration, d)}
                className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors duration-150 ease-out pointer-coarse:h-9 pointer-coarse:w-9 ${d === direction ? 'bg-white/10 text-slate-50 ring-1 ring-[var(--vs-accent)]' : 'text-slate-300 hover:bg-white/10'}`}>
                <StudioIcon name={DIRECTION_ICON[d]} className="h-3.5 w-3.5 shrink-0" />
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {kind !== 'cut' ? (
        <div className="mt-2 flex flex-col gap-1 px-2.5 pb-1">
          <span className="text-[12px] text-slate-400">{t('panel.videoStudio.seam.length')}</span>
          <ValueControl disabled={false}
            field={{ key: 'transition', type: 'time', label: t('panel.videoStudio.seam.length'), value: duration, min: TRANSITION_MIN_SECONDS, max: TRANSITION_MAX_SECONDS, step: 0.05 }}
            onChange={(v) => {
              const n = typeof v === 'number' ? v : Number(v);
              if (!Number.isFinite(n)) return;
              const clamped = Math.min(TRANSITION_MAX_SECONDS, Math.max(TRANSITION_MIN_SECONDS, n));
              setDuration(clamped);
              if (timer.current) clearTimeout(timer.current);
              timer.current = setTimeout(() => { timer.current = null; p.onSet(kind, clamped, kept(kind)); }, SEAM_SAVE_MS);
            }} />
        </div>
      ) : null}
      {p.canSnap ? (
        <PopoverItem onClick={() => { p.onClose(); p.onSnap(); }}>
          <span className="flex items-center gap-2"><StudioIcon name="magnet" />{t('panel.videoStudio.seam.snapBeat')}</span>
        </PopoverItem>
      ) : null}
    </StudioPopover>
  );
}
