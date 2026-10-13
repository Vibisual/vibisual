import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { StudioIcon } from './studioIcons.js';

/**
 * §5.13 (V) 37-8 — **장면 구슬 줄**: 장면마다 길이에 비례한 알약 구슬(안에 대표 프레임, 아래 제목). 끌어서 순서를 바꾸면 상대
 * 앵커라 뒤 장면이 따라온다(셸이 `moveChapter` 하나를 적는다). 구슬 사이 이음매 점은 전환 고르기, 위쪽 점은 검수 표시(37-9)와
 * 메모 번호(37-7), 아래 점은 강한 비트(37-12). AI 가 만지는 장면에는 작은 위성이 돌고, 끝나면 한 번 빛나고 사라진다.
 * 이음매 점을 **끌면** 장면 경계가 옮겨 가고, 끄는 동안 문턱 안의 강한 비트에 자석처럼 붙는다(Alt 를 누르면 붙지 않는다 — 37-12).
 * 끌지 않고 누르면 전환 고르기다.
 */
export interface StripChapter {
  readonly id: string;
  readonly index: number;
  readonly title: string;
  readonly start: number;
  readonly end: number;
  readonly status: string;
  readonly thumb: string | null;
  readonly transition: string | null;
  /** 들어오는 이음매의 가운데(초 — 전환이 있으면 겹침의 가운데). */
  readonly seam: number;
}
export interface StripMarker { readonly id: string; readonly t: number; readonly level: string; readonly label: string }
export interface StripNoteDot { readonly id: string; readonly n: number; readonly t: number; readonly status: string }

export interface SceneStripProps {
  readonly duration: number;
  readonly playhead: number;
  readonly chapters: readonly StripChapter[];
  readonly selectedChapterId: string | null;
  readonly glow: ReadonlySet<string>;
  readonly workingChapterId: string | null;
  readonly markers: readonly StripMarker[];
  readonly noteDots: readonly StripNoteDot[];
  readonly beats: readonly number[];
  readonly disabled: boolean;
  readonly canDerive: boolean;
  readonly onSeek: (t: number) => void;
  readonly onSelectChapter: (id: string) => void;
  readonly onReorder: (chapterId: string, beforeChapterId: string | undefined) => void;
  readonly onChapterMenu: (chapterId: string, anchor: HTMLElement) => void;
  readonly onSeam: (chapterId: string, anchor: HTMLElement) => void;
  /** 이음매를 끌어 놓았다 — 그 이음매(장면 경계)를 `delta` 초 옮긴다. */
  readonly onSeamMove: (chapterId: string, delta: number) => void;
  readonly onMarker: (id: string, anchor: HTMLElement) => void;
  readonly onNoteDot: (id: string) => void;
  readonly onDerive: () => void;
}

const DRAG_PX = 4;
/** 이음매 끌기가 강한 비트에 붙는 문턱(px). */
const SNAP_PX = 10;

export function SceneStrip(p: SceneStripProps): React.JSX.Element {
  const { t } = useTranslation();
  const trackRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; x0: number; moved: boolean; pointer: number } | null>(null);
  const [dropBefore, setDropBefore] = useState<string | null | undefined>(undefined);
  const seamDrag = useRef<{ id: string; x0: number; from: number; moved: boolean; pointer: number } | null>(null);
  const [seamPreview, setSeamPreview] = useState<{ id: string; t: number; snapped: boolean } | null>(null);
  const total = Math.max(p.duration, ...p.chapters.map((c) => c.end), 0.001);
  const pct = (s: number): string => `${(Math.max(0, Math.min(total, s)) / total) * 100}%`;
  const timeAt = (clientX: number): number => {
    const r = trackRef.current?.getBoundingClientRect();
    return r && r.width > 0 ? ((clientX - r.left) / r.width) * total : 0;
  };
  /** 이음매를 끌던 자리의 시각 — 문턱 안의 강한 비트가 있으면 거기(Alt 면 끈다). */
  const seamAt = (clientX: number, from: number, x0: number, altKey: boolean): { t: number; snapped: boolean } => {
    const r = trackRef.current?.getBoundingClientRect();
    const perPx = r && r.width > 0 ? total / r.width : 0;
    const raw = Math.max(0, from + (clientX - x0) * perPx);
    if (altKey || perPx <= 0) return { t: raw, snapped: false };
    let best: number | null = null;
    for (const b of p.beats) if (Math.abs(b - raw) <= SNAP_PX * perPx && (best === null || Math.abs(b - raw) < Math.abs(best - raw))) best = b;
    return best === null ? { t: raw, snapped: false } : { t: best, snapped: true };
  };
  const dropTarget = (clientX: number, id: string): string | null => {
    const t0 = timeAt(clientX);
    const next = p.chapters.find((c) => c.id !== id && (c.start + c.end) / 2 > t0);
    return next ? next.id : null;
  };

  return (
    <div className="flex shrink-0 flex-col gap-1 px-1 pb-1">
      <div ref={trackRef} className="relative h-[86px] select-none" onClick={(e) => { if (e.target === e.currentTarget) p.onSeek(timeAt(e.clientX)); }}>
        {/* 검수 표시·메모 번호 — 구슬 위 */}
        {p.markers.map((m) => (
          <button key={m.id} type="button" title={m.label} aria-label={m.label} onClick={(e) => p.onMarker(m.id, e.currentTarget)}
            className={`absolute top-0 h-2.5 w-2.5 -translate-x-1/2 rounded-full border ${m.level === 'error' ? 'border-rose-300 bg-rose-400/60' : m.level === 'warn' ? 'border-amber-300 bg-amber-300/50' : 'border-slate-300 bg-slate-300/40'}`}
            style={{ left: pct(m.t) }} />
        ))}
        {p.noteDots.map((n) => (
          <button key={n.id} type="button" onClick={() => p.onNoteDot(n.id)} title={t('panel.videoStudio.notes.pinTitle', { n: n.n })}
            className={`absolute top-3 flex h-4 min-w-4 -translate-x-1/2 items-center justify-center rounded-full border px-0.5 text-[12px] font-semibold leading-none tabular-nums ${n.status === 'fixed' ? 'border-slate-300 text-slate-200' : 'border-white/70 bg-vb-raised text-slate-100'}`}
            style={{ left: pct(n.t) }}>
            {n.n}
          </button>
        ))}
        {/* 구슬 */}
        {p.chapters.length === 0 ? (
          <div className="absolute inset-x-0 top-[22px] flex h-11 items-center justify-center gap-2 rounded-full border border-dashed border-white/15 text-[12px] text-slate-500">
            {p.canDerive ? (
              <button type="button" disabled={p.disabled} onClick={p.onDerive} className="flex items-center gap-1.5 rounded-full px-3 py-1 text-slate-300 hover:bg-white/10 disabled:opacity-40">
                <StudioIcon name="split" className="h-3.5 w-3.5" />{t('panel.videoStudio.strip.derive')}
              </button>
            ) : t('panel.videoStudio.strip.empty')}
          </div>
        ) : null}
        {p.chapters.map((c, i) => {
          const selected = c.id === p.selectedChapterId;
          const working = c.id === p.workingChapterId;
          return (
            <div key={c.id} className="absolute top-[22px] flex flex-col items-stretch gap-1" style={{ left: pct(c.start), width: `calc(${pct(c.end - c.start)} - 4px)`, minWidth: 28 }}>
              {dropBefore === c.id ? <span className="absolute -left-1.5 top-0 h-11 w-0.5 rounded-full bg-[var(--vs-accent)]" aria-hidden="true" /> : null}
              <button
                type="button"
                disabled={p.disabled}
                aria-pressed={selected}
                aria-label={t('panel.videoStudio.strip.chapter', { n: c.index + 1, title: c.title })}
                onPointerDown={(e) => { if (e.button === 0) { drag.current = { id: c.id, x0: e.clientX, moved: false, pointer: e.pointerId }; e.currentTarget.setPointerCapture(e.pointerId); } }}
                onPointerMove={(e) => {
                  const d = drag.current;
                  if (!d || d.pointer !== e.pointerId) return;
                  if (!d.moved && Math.abs(e.clientX - d.x0) < DRAG_PX) return;
                  d.moved = true;
                  setDropBefore(dropTarget(e.clientX, d.id));
                }}
                onPointerUp={(e) => {
                  const d = drag.current;
                  drag.current = null;
                  setDropBefore(undefined);
                  if (!d) return;
                  if (d.moved) {
                    const before = dropTarget(e.clientX, d.id);
                    p.onReorder(d.id, before ?? undefined);
                  } else {
                    p.onSelectChapter(c.id);
                  }
                }}
                onPointerCancel={() => { drag.current = null; setDropBefore(undefined); }}
                onContextMenu={(e) => { e.preventDefault(); p.onChapterMenu(c.id, e.currentTarget); }}
                className={`relative h-11 overflow-hidden rounded-full border bg-vb-sunken transition-shadow duration-150 ease-out ${selected ? 'border-transparent ring-2 ring-[var(--vs-accent)]' : 'border-white/15 hover:border-white/30'} ${p.glow.has(c.id) ? 'animate-[vs-glow-once_900ms_ease-out]' : ''} ${c.status === 'plan' ? 'border-dashed' : ''}`}
              >
                {c.thumb ? <img src={c.thumb} alt="" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-80" /> : null}
                <span className="pointer-events-none absolute left-2 top-1 rounded-full bg-black/60 px-1.5 text-[12px] font-semibold tabular-nums text-white">{c.index + 1}</span>
              </button>
              {working ? (
                <span className="pointer-events-none absolute -right-1 top-[-6px] h-5 w-5 animate-[vs-orbit_2.4s_linear_infinite]" aria-label={t('panel.videoStudio.strip.working')}>
                  <span className="absolute left-1/2 top-0 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-[var(--vs-accent)] shadow-[0_0_6px_var(--vs-accent)]" />
                </span>
              ) : null}
              <div className="flex min-w-0 items-center gap-1">
                <span className="min-w-0 flex-1 truncate text-[12px] text-slate-300" title={c.title}>{c.title}</span>
                <button type="button" onClick={(e) => p.onChapterMenu(c.id, e.currentTarget)} aria-label={t('panel.videoStudio.strip.menu')}
                  className="shrink-0 rounded p-0.5 text-slate-500 hover:bg-white/10 hover:text-slate-100"><StudioIcon name="more" className="h-3.5 w-3.5" /></button>
              </div>
              {i > 0 ? (
                <button type="button" disabled={p.disabled}
                  title={`${t('panel.videoStudio.strip.seam', { transition: t(`panel.videoStudio.transitions.${c.transition ?? 'cut'}`) })} · ${t('panel.videoStudio.strip.seamDrag')}`}
                  onPointerDown={(e) => { if (e.button === 0) { seamDrag.current = { id: c.id, x0: e.clientX, from: c.seam, moved: false, pointer: e.pointerId }; e.currentTarget.setPointerCapture(e.pointerId); } }}
                  onPointerMove={(e) => {
                    const d = seamDrag.current;
                    if (!d || d.pointer !== e.pointerId) return;
                    if (!d.moved && Math.abs(e.clientX - d.x0) < DRAG_PX) return;
                    d.moved = true;
                    setSeamPreview({ id: d.id, ...seamAt(e.clientX, d.from, d.x0, e.altKey) });
                  }}
                  onPointerUp={(e) => {
                    const d = seamDrag.current;
                    seamDrag.current = null;
                    setSeamPreview(null);
                    if (!d) return;
                    if (!d.moved) { p.onSeam(c.id, e.currentTarget); return; }
                    const next = seamAt(e.clientX, d.from, d.x0, e.altKey);
                    if (Math.abs(next.t - d.from) > 1e-3) p.onSeamMove(d.id, next.t - d.from);
                  }}
                  onPointerCancel={() => { seamDrag.current = null; setSeamPreview(null); }}
                  // 키보드(Enter·Space)로 누르면 포인터 사건이 없다 — 그때만 여기서 연다(e.detail === 0).
                  onClick={(e) => { if (e.detail === 0) p.onSeam(c.id, e.currentTarget); }}
                  className={`absolute -left-[9px] top-[17px] h-2.5 w-2.5 cursor-ew-resize touch-none rounded-full border ${c.transition && c.transition !== 'cut' ? 'border-[var(--vs-accent)] bg-[var(--vs-accent)]' : 'border-white/40 bg-vb-card'} hover:scale-125`} />
              ) : null}
            </div>
          );
        })}
        {/* 강한 비트 — 구슬 아래 */}
        {p.beats.map((b) => <span key={b} className="pointer-events-none absolute bottom-0 h-1 w-1 -translate-x-1/2 rounded-full bg-slate-400/70" style={{ left: pct(b) }} />)}
        {/* 이음매를 끄는 자리 — 비트에 붙었으면 진하게 */}
        {seamPreview ? (
          <span className={`pointer-events-none absolute inset-y-0 w-px ${seamPreview.snapped ? 'bg-amber-300' : 'bg-slate-300/70'}`} style={{ left: pct(seamPreview.t) }} aria-hidden="true" />
        ) : null}
        {/* 재생 머리 */}
        <span className="pointer-events-none absolute inset-y-0 w-px bg-slate-100/80" style={{ left: pct(p.playhead) }} aria-hidden="true" />
      </div>
    </div>
  );
}
