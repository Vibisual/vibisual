import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { SAFE_AREAS, formatOfSize, type HitRect, type VideoDoc } from '@vibisual/video';

import { runEnterKey } from '../../hooks/useEnterSubmit.js';
import { useInspectorPicker } from '../../hooks/useInspectorPicker.js';
import { DARK_THEME_LOCK } from '../../theme/themeLock.js';
import { IME_ENTER_OWNER, isImeConsumedKey } from '../../utils/inputComposition.js';
import { previewInspectPicker, type PreviewInspect } from './previewInspect.js';
import { usePlayheadSampled, type PlayheadClock } from './playheadClock.js';
import { StudioIcon } from './studioIcons.js';
import { memoLatest } from './studioMemo.js';
import { clampSpan, noteEditorPlacement, type PreviewBounds } from './studioFit.js';

/**
 * §5.13 (V) 37-1·37-6·37-7 — 큰 미리보기: 겹표시(안전 영역·테·핀·글자 칸)가 같은 문서 좌표다. 그림 자체는 셸이 그린다.
 * 무대는 테마와 무관하게 검어 이 칸만 `DARK_THEME_LOCK`.
 */
export interface PreviewRing { readonly id: string; readonly rect: HitRect; readonly tone: 'hover' | 'selected' | 'pointed' }
export interface PreviewPin { readonly id: string; readonly n: number; readonly x: number; readonly y: number; readonly status: string; readonly active?: boolean }
export interface PreviewEdit { readonly rect: HitRect; readonly value: string; readonly fontSize: number; readonly onCommit: (value: string) => void; readonly onCancel: () => void }

export interface StudioPreviewProps {
  readonly doc: VideoDoc;
  readonly mode: 'canvas' | 'stage';
  readonly canvasRef: RefObject<HTMLCanvasElement>;
  readonly stageHostRef: RefObject<HTMLDivElement>;
  readonly zoom: 'fit' | 'actual';
  readonly safeArea: boolean;
  readonly interaction: 'none' | 'point' | 'note';
  readonly rings: readonly PreviewRing[];
  readonly pins: readonly PreviewPin[];
  readonly edit: PreviewEdit | null;
  readonly onHover: (x: number, y: number) => void;
  readonly onLeave: () => void;
  readonly onPress: (x: number, y: number) => void;
  readonly onDoublePress: (x: number, y: number) => void;
  readonly onPin: (id: string) => void;
  readonly onDropFiles: (files: readonly File[]) => void;
  readonly empty: ReactNode | null;
  /** §5.13 (V) 37-7 — 방금 꽂은 메모 핀의 글 칸(화면 비율 자리). */
  readonly noteDraft: { readonly x: number; readonly y: number; readonly n: number } | null;
  readonly onNoteCommit: (text: string) => void;
  readonly onNoteCancel: () => void;
  /** §5.13 (X) 39-3 — 무대가 첫 그림을 세우기 전의 포스터(대표 프레임 — 샌드박스 문서 로딩 중엔 검은 칸이다). `ready` 면 흐려지며 걷힌다. */
  readonly poster?: string | null;
  readonly ready?: boolean;
  /**
   * §5.13 (Z) 41-5 ② — 재생 중 보여야 할 컴포지션이 아직 첫 그림을 못 냈다(처음 여는 장면 · 다시 연 장면). 그동안 그 시각 장면의
   * 대표 프레임(`posterAt` — 가벼운 판)을 깔았다가 첫 그림이 서면 같은 흐려짐으로 걷는다. 재생·소리는 멈추지 않는다.
   */
  readonly cold?: boolean;
  readonly posterAt?: (t: number) => string | null;
  /** §5.4 #15 (C) — Alt 인스펙터의 그림 안(문서 픽셀) 답. 없으면 프레임 전체가 집힌다(캔버스·무대라). */
  readonly inspect?: PreviewInspect;
  /**
   * §5.13 (Y) 40-5 — 재생 중에도 테·핀이 시각을 따라가게: 시계를 굵게 구독해(`usePlayheadSampled`) 그 시각의 테·핀을 묻는다(셸은
   * 재생 중 다시 그려지지 않는다). 주지 않으면 `rings`·`pins` 그대로.
   */
  readonly clock?: PlayheadClock;
  readonly playhead?: number;
  readonly overlaysAt?: (t: number) => { readonly rings: readonly PreviewRing[]; readonly pins: readonly PreviewPin[] };
  /** §5.13 (Y) 40-3 ⑤ — 문서 픽셀 → 화면 실제 픽셀 배율(맞춤 배율 × devicePixelRatio). 실사를 그 폭만큼만 풀어 옮긴다. */
  readonly onDisplayScale?: (scale: number) => void;
}

interface Frame { readonly left: number; readonly top: number; readonly scale: number }

function useBox(ref: RefObject<HTMLDivElement>): { w: number; h: number } {
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = (): void => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return box;
}

/**
 * §5.13 (Y) 40-5 ③ — 값이 같으면 다시 그리지 않는다(손잡이는 늘 최신을 부른다 — `studioMemo.ts`). 겹표시(`overlaysAt`)는 렌더 중에
 * 불러 그리는 함수라 정체로 비교한다(고른 것·메모·가리킨 것이 바뀔 때만 새로 만들어진다).
 */
export const StudioPreview = memoLatest(function StudioPreview(p: StudioPreviewProps): React.JSX.Element {
  const { t } = useTranslation();
  const boxRef = useRef<HTMLDivElement>(null);
  /** 조작 판(프레임과 같은 상자) — Alt 인스펙터가 판이 아니라 그 자리에 그려진 것을 집도록 공급자를 단다. */
  const layerRef = useRef<HTMLDivElement>(null);
  const box = useBox(boxRef);
  const W = p.doc.size.width;
  const H = p.doc.size.height;
  useInspectorPicker(layerRef, p.inspect ? previewInspectPicker(p.doc.size, p.inspect) : null);
  const fit = p.zoom === 'fit';
  const scale = fit ? (box.w > 0 && box.h > 0 ? Math.min(box.w / W, box.h / H) : 0) : 1;
  const frame: Frame = fit
    ? { left: (box.w - W * scale) / 2, top: (box.h - H * scale) / 2, scale }
    : { left: Math.max(0, (box.w - W) / 2), top: Math.max(0, (box.h - H) / 2), scale: 1 };
  const toDoc = (e: React.MouseEvent<HTMLDivElement>): { x: number; y: number } => {
    const r = e.currentTarget.getBoundingClientRect();
    const s = frame.scale > 0 ? frame.scale : 1;
    return { x: (e.clientX - r.left) / s, y: (e.clientY - r.top) / s };
  };
  const px = (r: HitRect): React.CSSProperties => ({ left: r.x * frame.scale, top: r.y * frame.scale, width: r.width * frame.scale, height: r.height * frame.scale });
  const safe = SAFE_AREAS[formatOfSize(p.doc.size)];
  const cursor = p.interaction === 'point' ? 'cursor-crosshair' : p.interaction === 'note' ? 'cursor-copy' : 'cursor-default';
  const frameStyle: React.CSSProperties = { left: frame.left, top: frame.top, width: W * frame.scale, height: H * frame.scale };
  const sampledAt = usePlayheadSampled(p.overlaysAt ? p.clock : undefined, p.playhead ?? 0);
  const overlay = p.overlaysAt ? p.overlaysAt(sampledAt) : { rings: p.rings, pins: p.pins };
  // §5.13 (Z) 41-5 ② — 첫 그림을 못 낸 장면 자리에는 그 시각 장면의 대표 프레임(재생 중에도 굵게만 따라간다).
  const coldAt = usePlayheadSampled(p.cold ? p.clock : undefined, p.playhead ?? 0);
  const standIn = p.ready === false ? p.poster ?? null : p.cold === true ? p.posterAt?.(coldAt) ?? p.poster ?? null : null;
  const showStandIn = p.ready === false || (p.cold === true && standIn !== null);
  /** 걷을 때 흐려지는 그림 = 마지막으로 깔았던 그 그림(다른 장면 그림으로 바뀌어 사라지지 않게). */
  const lastStandIn = useRef<string | null>(null);
  if (showStandIn && standIn) lastStandIn.current = standIn;
  const fadeSrc = lastStandIn.current ?? p.poster ?? null;
  const onDisplayScale = p.onDisplayScale;
  const ratio = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  useEffect(() => { if (frame.scale > 0) onDisplayScale?.(frame.scale * ratio); }, [frame.scale, ratio, onDisplayScale]);
  // 반응형 — 메모 글 칸을 미리보기 상자 안으로 맞출 기준(맞춤 배율일 때만 — 100% 는 상자가 스크롤하므로 종전 자리 그대로).
  //   폭은 이미 재고 있는 상자 크기(`useBox`)를 쓴다 — 새로 재지 않는다.
  const noteBounds: PreviewBounds | null = fit && box.w > 0 && box.h > 0 ? { width: box.w, height: box.h, frameLeft: frame.left, frameTop: frame.top } : null;
  return (
    <div ref={boxRef} {...DARK_THEME_LOCK} className={`relative min-h-0 flex-1 rounded-lg border border-white/10 bg-black ${fit ? 'overflow-hidden' : 'scrollbar-thin overflow-auto'}`}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }}
      onDrop={(e) => { e.preventDefault(); p.onDropFiles(Array.from(e.dataTransfer.files)); }}>
      <div className="absolute" style={fit ? { inset: 0 } : { left: frame.left, top: frame.top, width: W, height: H }}>
        <canvas ref={p.canvasRef} width={W} height={H} aria-label={t('panel.videoStudio.preview.label')}
          className={p.mode === 'stage' ? 'hidden' : 'absolute'} style={fit ? frameStyle : { left: 0, top: 0, width: W, height: H }} />
        {/* 컴포지션 문서의 DOM 무대가 서는 자리(무대가 자기 크기를 이 칸에 맞춰 줄인다). */}
        <div ref={p.stageHostRef} className={p.mode === 'stage' ? 'absolute inset-0 overflow-hidden' : 'hidden'} />
        {/* 39-3 — 그림이 서기 전의 포스터(없으면 은은한 숨쉬기). 그림이 서면 흐려지며 걷힌다 — 손짓은 그대로 아래로 지나간다.
            41-5 ② — 재생 중 첫 그림을 못 낸 장면도 같은 자리에 그 장면의 대표 프레임을 깔았다가 같은 흐려짐으로 걷는다. */}
        {showStandIn ? (standIn ? (
          <img src={standIn} alt="" aria-hidden="true" decoding="async" draggable={false}
            className="pointer-events-none absolute object-contain" style={fit ? frameStyle : { left: 0, top: 0, width: W, height: H }} />
        ) : (
          <div aria-hidden="true" className="pointer-events-none absolute bg-white/[0.03] motion-safe:animate-pulse" style={fit ? frameStyle : { left: 0, top: 0, width: W, height: H }} />
        )) : fadeSrc ? (
          <img src={fadeSrc} alt="" aria-hidden="true" decoding="async" draggable={false}
            className="pointer-events-none absolute animate-[vs-fade-out_200ms_ease-out] object-contain opacity-0" style={fit ? frameStyle : { left: 0, top: 0, width: W, height: H }} />
        ) : null}
      </div>
      <div ref={layerRef} className={`absolute ${cursor}`} style={fit ? frameStyle : { left: frame.left, top: frame.top, width: W, height: H }}
        onMouseMove={(e) => { if (p.interaction !== 'none') { const d = toDoc(e); p.onHover(d.x, d.y); } }}
        onMouseLeave={p.onLeave}
        onClick={(e) => { const d = toDoc(e); p.onPress(d.x, d.y); }}
        onDoubleClick={(e) => { const d = toDoc(e); p.onDoublePress(d.x, d.y); }}>
        {p.safeArea ? (
          <div className="pointer-events-none absolute border border-dashed border-amber-300/80"
            style={{ left: `${safe.left * 100}%`, top: `${safe.top * 100}%`, width: `${(safe.right - safe.left) * 100}%`, height: `${(safe.bottom - safe.top) * 100}%` }}
            aria-label={t('panel.videoStudio.preview.safeArea')} />
        ) : null}
        {overlay.rings.map((ring) => (
          <div key={ring.id} className={`pointer-events-none absolute rounded-sm ${ring.tone === 'hover' ? 'ring-1 ring-slate-200/70' : ring.tone === 'pointed' ? 'ring-2 ring-slate-100' : 'ring-1 ring-[var(--vs-accent)]'}`} style={px(ring.rect)} />
        ))}
        {overlay.pins.map((pin) => (
          <button key={pin.id} type="button" onClick={(e) => { e.stopPropagation(); p.onPin(pin.id); }}
            title={t('panel.videoStudio.notes.pinTitle', { n: pin.n })}
            className={`absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border text-[12px] font-semibold tabular-nums shadow-md shadow-black/50 pointer-coarse:h-9 pointer-coarse:w-9 ${pin.status === 'fixed' ? 'border-slate-200 bg-vb-card text-slate-100' : 'border-white/80 bg-black/70 text-white'} ${pin.active ? 'ring-2 ring-[var(--vs-accent)]' : ''}`}
            style={{ left: pin.x * W * frame.scale, top: pin.y * H * frame.scale }}>
            {pin.status === 'fixed' ? <StudioIcon name="check" className="h-3.5 w-3.5" /> : pin.n}
          </button>
        ))}
        {p.edit ? <InlineEditor edit={p.edit} scale={frame.scale} frameW={W * frame.scale} frameH={H * frame.scale} /> : null}
        {p.noteDraft ? (
          <NoteEditor draft={p.noteDraft} left={p.noteDraft.x * W * frame.scale} top={p.noteDraft.y * H * frame.scale}
            flip={p.noteDraft.x > 0.6} bounds={noteBounds} onCommit={p.onNoteCommit} onCancel={p.onNoteCancel} />
        ) : null}
      </div>
      {p.empty ? <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6 box-narrow:p-3">{p.empty}</div> : null}
    </div>
  );
}, { fresh: ['overlaysAt', 'posterAt'] });

/** 방금 꽂은 핀 + 글 칸(Enter 로 꽂고, Esc·빈 글로 바깥을 누르면 거둔다). `bounds` 가 있으면 상자 밖으로 안 잘리게 맞추고(`noteEditorPlacement`), 높으면 안에서 스크롤. */
function NoteEditor({ draft, left, top, flip, bounds, onCommit, onCancel }: {
  readonly draft: { readonly n: number };
  readonly left: number;
  readonly top: number;
  readonly flip: boolean;
  readonly bounds: PreviewBounds | null;
  readonly onCommit: (text: string) => void;
  readonly onCancel: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const place = bounds ? noteEditorPlacement(left, top, flip, bounds) : null;
  return (
    <div className="absolute" style={{ left, top }} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <span className="absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/80 bg-black/70 text-[12px] font-semibold tabular-nums text-white ring-2 ring-[var(--vs-accent)] pointer-coarse:h-9 pointer-coarse:w-9">{draft.n}</span>
      <div className={`absolute animate-[vs-pop_140ms_ease-out] rounded-lg border border-white/15 bg-vb-raised p-2 shadow-xl shadow-black/60 ${place ? 'scrollbar-thin overflow-y-auto' : `top-3 w-64 ${flip ? 'right-3' : 'left-3'}`}`}
        style={place ? { left: place.left, top: place.top, width: place.width, maxHeight: place.maxHeight } : undefined}>
        <textarea
          {...IME_ENTER_OWNER}
          autoFocus
          rows={3}
          value={value}
          placeholder={t('panel.videoStudio.notes.placeholder')}
          aria-label={t('panel.videoStudio.notes.newNote', { n: draft.n })}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => { if (value.trim() === '') onCancel(); }}
          onKeyDown={(e) => {
            e.stopPropagation();
            // §6 조합 입력 보호 — Enter 꽂기 · Shift+Enter 줄(한글 확정 Enter 도 한 번에). 판정은 runEnterKey 하나.
            if (runEnterKey(e, (live) => { if (live.trim() !== '') onCommit(live); })) return;
            if (isImeConsumedKey(e.nativeEvent)) return;
            if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
          }}
          className="w-full resize-none rounded-md border border-white/10 bg-vb-sunken px-2 py-1.5 text-[12px] leading-relaxed text-slate-100 outline-none placeholder:text-slate-500 focus:ring-1 focus:ring-[var(--vs-accent)]"
        />
        <div className="mt-1.5 flex justify-end gap-1.5">
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onCancel} className="rounded-md px-2 py-1 text-[12px] text-slate-400 hover:bg-white/10 hover:text-slate-100 pointer-coarse:py-2">{t('common.cancel')}</button>
          <button type="button" disabled={value.trim() === ''} onMouseDown={(e) => e.preventDefault()} onClick={() => onCommit(value)}
            className="rounded-md border border-white/15 bg-white/10 px-2 py-1 text-[12px] font-semibold text-slate-50 hover:bg-white/15 disabled:opacity-40 pointer-coarse:py-2">{t('panel.videoStudio.notes.pin')}</button>
        </div>
      </div>
    </div>
  );
}

function InlineEditor({ edit, scale, frameW, frameH }: { readonly edit: PreviewEdit; readonly scale: number; readonly frameW: number; readonly frameH: number }): React.JSX.Element {
  const [value, setValue] = useState(edit.value);
  // 칸 하한(80×28)이 작은 배율의 글 자리보다 크면 판 밖으로 나가 잘린다 — 칸만 판 안으로 민다(글 자리·문서 좌표는 그대로).
  const width = Math.max(80, edit.rect.width * scale);
  const height = Math.max(28, edit.rect.height * scale);
  return (
    <textarea
      {...IME_ENTER_OWNER}
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={() => edit.onCommit(value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        // §6 조합 입력 보호 — Enter 확정 · Shift+Enter 줄(한글 확정 Enter 도 한 번에). 판정은 runEnterKey 하나.
        if (runEnterKey(e, (live) => edit.onCommit(live))) return;
        if (isImeConsumedKey(e.nativeEvent)) return;
        if (e.key === 'Escape') { e.preventDefault(); edit.onCancel(); }
      }}
      className="absolute resize-none rounded-sm bg-black/70 p-1 text-center text-white outline-none ring-2 ring-[var(--vs-accent)]"
      style={{ left: clampSpan(edit.rect.x * scale, width, frameW), top: clampSpan(edit.rect.y * scale, height, frameH), width, height, fontSize: Math.max(12, edit.fontSize * scale) }}
    />
  );
}
