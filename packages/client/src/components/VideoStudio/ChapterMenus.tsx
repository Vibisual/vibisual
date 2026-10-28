import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  TRANSITION_DEFAULT_SECONDS,
  TRANSITION_MAX_SECONDS,
  TRANSITION_MIN_SECONDS,
  type ResolvedChapter,
  type TransitionKind,
} from '@vibisual/video';

import { StudioPopover, PopoverItem } from './StudioPopover.js';
import { StudioIcon } from './studioIcons.js';
import { ValueControl } from './StudioValueControls.js';

/** §5.13 (V) 37-8 — 장면 구슬 메뉴와 이음매(전환) 고르기 — 전환 여섯 · 길이 0.2~1.5초 · [비트에 붙이기](음악이 있을 때). */
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
  readonly onSet: (kind: TransitionKind, duration: number) => void;
  readonly onSnap: () => void;
  readonly onClose: () => void;
}

const KINDS: readonly TransitionKind[] = ['cut', 'dissolve', 'push', 'zoom', 'flash', 'wipe'];
/** 전환 길이를 끈 뒤 이만큼 잠잠하면 적는다(ms). */
const SEAM_SAVE_MS = 350;

export function SeamMenu(p: SeamMenuProps): React.JSX.Element {
  const { t } = useTranslation();
  const anchor = useMemo(() => ({ current: p.anchor }), [p.anchor]);
  const current = p.chapter.chapter.transition;
  const kind = current?.kind ?? 'cut';
  const [duration, setDuration] = useState(current?.duration ?? TRANSITION_DEFAULT_SECONDS);
  // 길이는 끄는 동안 잠잠해지면 한 번 적는다(끌기마다 패치가 쏟아지지 않게).
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return (
    <StudioPopover anchor={anchor} open onClose={p.onClose} side="above" label={t('panel.videoStudio.seam.title')} className="w-64">
      <p className="px-2.5 pb-1 pt-0.5 text-[12px] font-semibold text-slate-500">{t('panel.videoStudio.seam.title')}</p>
      <div className="grid grid-cols-2 gap-1 px-1" role="radiogroup" aria-label={t('panel.videoStudio.seam.title')}>
        {KINDS.map((k) => (
          <button key={k} type="button" role="radio" aria-checked={k === kind}
            onClick={() => p.onSet(k, k === 'cut' ? 0 : duration)}
            className={`rounded-md px-2 py-1.5 text-left text-[12px] transition-colors duration-150 ease-out pointer-coarse:py-2.5 ${k === kind ? 'bg-white/10 text-slate-50 ring-1 ring-[var(--vs-accent)]' : 'text-slate-300 hover:bg-white/10'}`}>
            {t(`panel.videoStudio.transitions.${k}`)}
          </button>
        ))}
      </div>
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
              timer.current = setTimeout(() => { timer.current = null; p.onSet(kind, clamped); }, SEAM_SAVE_MS);
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
