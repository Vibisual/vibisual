import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { SAFE_AREAS, formatOfSize, type HitRect, type VideoDoc } from '@vibisual/video';

import { DARK_THEME_LOCK } from '../../theme/themeLock.js';
import { StudioIcon } from './studioIcons.js';

/**
 * §5.13 (V) 37-1·37-6·37-7 — 가운데 **큰 미리보기**. 맞춤(기본)·100%, 안전 영역 겹쳐 보기, 가리키기 테(실버), 메모 핀(번호 원),
 * 글자 제자리 고치기 칸이 같은 문서 좌표로 겹친다. 그림 자체는 셸이 캔버스(기본 씬) 또는 DOM 무대(컴포지션)로 그린다 —
 * 이 부품은 그 둘의 자리와 위에 얹는 것만 맡는다. 무대 안(그림)은 테마와 무관하게 검다 — 그래서 이 칸만 어두운 판에 묶는다
 * (`DARK_THEME_LOCK` — 라이트 테마에서도 영상 위의 핀·테·글자 칸이 영상 위 색 그대로).
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

export function StudioPreview(p: StudioPreviewProps): React.JSX.Element {
  const { t } = useTranslation();
  const boxRef = useRef<HTMLDivElement>(null);
  const box = useBox(boxRef);
  const W = p.doc.size.width;
  const H = p.doc.size.height;
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
  return (
    <div ref={boxRef} {...DARK_THEME_LOCK} className={`relative min-h-0 flex-1 rounded-lg border border-white/10 bg-black ${fit ? 'overflow-hidden' : 'scrollbar-thin overflow-auto'}`}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }}
      onDrop={(e) => { e.preventDefault(); p.onDropFiles(Array.from(e.dataTransfer.files)); }}>
      <div className="absolute" style={fit ? { inset: 0 } : { left: frame.left, top: frame.top, width: W, height: H }}>
        <canvas ref={p.canvasRef} width={W} height={H} aria-label={t('panel.videoStudio.preview.label')}
          className={p.mode === 'stage' ? 'hidden' : 'absolute'} style={fit ? frameStyle : { left: 0, top: 0, width: W, height: H }} />
        {/* 컴포지션 문서의 DOM 무대가 서는 자리(무대가 자기 크기를 이 칸에 맞춰 줄인다). */}
        <div ref={p.stageHostRef} className={p.mode === 'stage' ? 'absolute inset-0 overflow-hidden' : 'hidden'} />
      </div>
      <div className={`absolute ${cursor}`} style={fit ? frameStyle : { left: frame.left, top: frame.top, width: W, height: H }}
        onMouseMove={(e) => { if (p.interaction !== 'none') { const d = toDoc(e); p.onHover(d.x, d.y); } }}
        onMouseLeave={p.onLeave}
        onClick={(e) => { const d = toDoc(e); p.onPress(d.x, d.y); }}
        onDoubleClick={(e) => { const d = toDoc(e); p.onDoublePress(d.x, d.y); }}>
        {p.safeArea ? (
          <div className="pointer-events-none absolute border border-dashed border-amber-300/80"
            style={{ left: `${safe.left * 100}%`, top: `${safe.top * 100}%`, width: `${(safe.right - safe.left) * 100}%`, height: `${(safe.bottom - safe.top) * 100}%` }}
            aria-label={t('panel.videoStudio.preview.safeArea')} />
        ) : null}
        {p.rings.map((ring) => (
          <div key={ring.id} className={`pointer-events-none absolute rounded-sm ${ring.tone === 'hover' ? 'ring-1 ring-slate-200/70' : ring.tone === 'pointed' ? 'ring-2 ring-slate-100' : 'ring-1 ring-[var(--vs-accent)]'}`} style={px(ring.rect)} />
        ))}
        {p.pins.map((pin) => (
          <button key={pin.id} type="button" onClick={(e) => { e.stopPropagation(); p.onPin(pin.id); }}
            title={t('panel.videoStudio.notes.pinTitle', { n: pin.n })}
            className={`absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border text-[12px] font-semibold tabular-nums shadow-md shadow-black/50 ${pin.status === 'fixed' ? 'border-slate-200 bg-vb-card text-slate-100' : 'border-white/80 bg-black/70 text-white'} ${pin.active ? 'ring-2 ring-[var(--vs-accent)]' : ''}`}
            style={{ left: pin.x * W * frame.scale, top: pin.y * H * frame.scale }}>
            {pin.status === 'fixed' ? <StudioIcon name="check" className="h-3.5 w-3.5" /> : pin.n}
          </button>
        ))}
        {p.edit ? <InlineEditor edit={p.edit} scale={frame.scale} /> : null}
        {p.noteDraft ? (
          <NoteEditor draft={p.noteDraft} left={p.noteDraft.x * W * frame.scale} top={p.noteDraft.y * H * frame.scale}
            flip={p.noteDraft.x > 0.6} onCommit={p.onNoteCommit} onCancel={p.onNoteCancel} />
        ) : null}
      </div>
      {p.empty ? <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">{p.empty}</div> : null}
    </div>
  );
}

/** 방금 꽂은 핀(번호 원) + 그 옆의 글 칸. Enter 로 꽂고, Esc·빈 글로 바깥을 누르면 거둔다. */
function NoteEditor({ draft, left, top, flip, onCommit, onCancel }: {
  readonly draft: { readonly n: number };
  readonly left: number;
  readonly top: number;
  readonly flip: boolean;
  readonly onCommit: (text: string) => void;
  readonly onCancel: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  return (
    <div className="absolute" style={{ left, top }} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <span className="absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/80 bg-black/70 text-[12px] font-semibold tabular-nums text-white ring-2 ring-[var(--vs-accent)]">{draft.n}</span>
      <div className={`absolute top-3 w-64 animate-[vs-pop_140ms_ease-out] rounded-lg border border-white/15 bg-vb-raised p-2 shadow-xl shadow-black/60 ${flip ? 'right-3' : 'left-3'}`}>
        <textarea
          autoFocus
          rows={3}
          value={value}
          placeholder={t('panel.videoStudio.notes.placeholder')}
          aria-label={t('panel.videoStudio.notes.newNote', { n: draft.n })}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => { if (value.trim() === '') onCancel(); }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.nativeEvent.isComposing) return;
            if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
            else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (value.trim() !== '') onCommit(value); }
          }}
          className="w-full resize-none rounded-md border border-white/10 bg-vb-sunken px-2 py-1.5 text-[12px] leading-relaxed text-slate-100 outline-none placeholder:text-slate-500 focus:ring-1 focus:ring-[var(--vs-accent)]"
        />
        <div className="mt-1.5 flex justify-end gap-1.5">
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onCancel} className="rounded-md px-2 py-1 text-[12px] text-slate-400 hover:bg-white/10 hover:text-slate-100">{t('common.cancel')}</button>
          <button type="button" disabled={value.trim() === ''} onMouseDown={(e) => e.preventDefault()} onClick={() => onCommit(value)}
            className="rounded-md border border-white/15 bg-white/10 px-2 py-1 text-[12px] font-semibold text-slate-50 hover:bg-white/15 disabled:opacity-40">{t('panel.videoStudio.notes.pin')}</button>
        </div>
      </div>
    </div>
  );
}

function InlineEditor({ edit, scale }: { readonly edit: PreviewEdit; readonly scale: number }): React.JSX.Element {
  const [value, setValue] = useState(edit.value);
  return (
    <textarea
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={() => edit.onCommit(value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.nativeEvent.isComposing) return;
        if (e.key === 'Escape') { e.preventDefault(); edit.onCancel(); }
        else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); edit.onCommit(value); }
      }}
      className="absolute resize-none rounded-sm bg-black/70 p-1 text-center text-white outline-none ring-2 ring-[var(--vs-accent)]"
      style={{ left: edit.rect.x * scale, top: edit.rect.y * scale, width: Math.max(80, edit.rect.width * scale), height: Math.max(28, edit.rect.height * scale), fontSize: Math.max(12, edit.fontSize * scale) }}
    />
  );
}
