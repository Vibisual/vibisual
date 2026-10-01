import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { shortcutLabel } from '../../utils/platform.js';
import { toImagePoint, type Box, type Point, type Size } from './imageAnnotate.js';
import {
  CROP_ASPECTS,
  CROP_HANDLES,
  dragCropBox,
  isFullBox,
  rgbToHex,
  type CropAspect,
  type CropEdgeHandle,
  type CropField,
  type CropHandle,
  type CropShape,
  type Rgb,
} from './imageEdit.js';

// §5.5 #17-25 ⑦ — 자르기·알파 빼기의 옵션 줄과 자르기 상자.
//
// 옵션 줄은 도구 막대 바로 아래 한 줄로, 그 도구를 고른 동안만 뜬다. 상태는 전부 ImageAnnotator 가
// 들고 있고 여기 컴포넌트는 값과 콜백만 받는다. 계산은 imageEdit.ts(순수 함수)에 있다.

/** 상자 밖을 누르고 이만큼(화면 px) 움직여야 새 상자를 긋는다 — 가벼운 클릭이 상자를 1px 로 줄이지 않게. */
const NEW_BOX_SLOP_PX = 3;

export type AlphaMode = 'key' | 'fill';

/**
 * 막대 버튼이 초점을 가져가지 않게 한다. 초점 받은 버튼 위의 Enter 는 그 버튼을 한 번 더 누를 뿐이라
 * 창의 Enter(적용)가 닿지 않는다. 대신 지금 초점을 가진 입력은 **놓게** 한다 — 숫자 칸·글자 표시 칸은
 * 초점을 잃을 때 값을 확정하므로, 막대를 누르는 순간 쓰던 값이 버려지지 않는다.
 */
export function holdFocus(e: React.MouseEvent): void {
  e.preventDefault();
  const active = document.activeElement;
  if (active instanceof HTMLElement && active !== document.body) active.blur();
}

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y) [x, y] = [y, x % y];
  return x || 1;
}

/** 지금 바탕의 비율을 가장 작은 정수비로 — [원본] 칩의 풀이(1920×1080 → 16:9). */
function reducedRatio(natural: Size): string {
  const g = gcd(natural.w, natural.h);
  return `${Math.round(natural.w / g)}:${Math.round(natural.h / g)}`;
}

function pct(value: number, total: number): string {
  return `${total > 0 ? (value / total) * 100 : 0}%`;
}

// ─── 옵션 줄 부속 ───

function Sep(): React.JSX.Element {
  return <span className="mx-0.5 h-4 w-px flex-shrink-0 bg-gray-700" />;
}

interface ChipProps {
  /** 켜고 끄는 칩만 준다 — 주면 aria-pressed 로 읽힌다. */
  active?: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
  children: React.ReactNode;
}

function Chip({ active, disabled, title, onClick, children }: ChipProps): React.JSX.Element {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      disabled={disabled ?? false}
      onMouseDown={holdFocus}
      onClick={onClick}
      className={`flex h-6 flex-shrink-0 items-center gap-1 rounded px-1.5 text-[12px] transition-colors ${
        active ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'
      } disabled:cursor-not-allowed disabled:text-gray-600 disabled:hover:bg-transparent`}
    >
      {children}
    </button>
  );
}

interface NumberFieldProps {
  label: string;
  value: number;
  disabled: boolean;
  onCommit: (value: number) => void;
}

/**
 * 정수 칸 하나. 초점이 없을 때는 늘 지금 값(끌기 중에도 따라 바뀐다)을, 치는 동안만 친 글자를 보여 준다.
 * 확정은 초점을 잃을 때 — Enter 는 확정만 하고(적용은 한 번 더 Enter), Esc 는 친 글자를 버린다.
 * ↑↓ 는 1씩(Shift 는 10씩) 바로 바꾼다.
 */
export function NumberField({ label, value, disabled, onCommit }: NumberFieldProps): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null);
  // Esc 로 놓은 blur 는 확정하지 않는다 — blur 가 keydown 안에서 동기로 불려 state 로는 알 수 없다.
  const discardRef = useRef(false);

  const parsed = (text: string | null): number | null => {
    if (text === null || text.trim() === '') return null;
    const n = Number(text.trim());
    return Number.isFinite(n) ? n : null;
  };

  const commit = (): void => {
    const skip = discardRef.current;
    discardRef.current = false;
    const n = skip ? null : parsed(draft);
    setDraft(null);
    if (n !== null && Math.round(n) !== value) onCommit(n);
  };

  return (
    <label className="flex items-center gap-1 text-[12px] text-gray-400">
      {label}
      <input
        type="text"
        inputMode="numeric"
        aria-label={label}
        value={draft ?? String(value)}
        disabled={disabled}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.currentTarget.blur();
          } else if (e.key === 'Escape') {
            // 창의 Esc(도구 나가기)까지 가지 않는다 — 이 Esc 는 친 글자만 버린다.
            e.preventDefault();
            e.stopPropagation();
            discardRef.current = true;
            e.currentTarget.blur();
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            e.stopPropagation();
            const step = (e.shiftKey ? 10 : 1) * (e.key === 'ArrowUp' ? 1 : -1);
            onCommit(Math.round(parsed(draft) ?? value) + step);
            setDraft(null);
          }
        }}
        className="h-6 w-14 rounded border border-gray-700 bg-gray-950 px-1 text-right text-[12px] tabular-nums text-gray-100 outline-none focus:border-blue-500 disabled:text-gray-600"
      />
    </label>
  );
}

interface ApplyCancelProps {
  pending: boolean;
  busy: boolean;
  onApply: () => void;
  onCancel: () => void;
}

function ApplyCancel({ pending, busy, onApply, onCancel }: ApplyCancelProps): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <>
      <button
        type="button"
        disabled={!pending || busy}
        onMouseDown={holdFocus}
        onClick={onApply}
        title={t('ide.imageAnnotate.edit.applyHint', { shortcut: shortcutLabel('Enter') })}
        className="flex h-6 flex-shrink-0 items-center gap-1 rounded bg-blue-600 px-2 text-[12px] font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-500"
      >
        {busy ? (
          <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-white border-t-transparent" />
        ) : (
          <CheckGlyph />
        )}
        {t('panel.options.apply')}
      </button>
      <button
        type="button"
        onMouseDown={holdFocus}
        onClick={onCancel}
        title={t('ide.imageAnnotate.edit.cancelHint', { shortcut: shortcutLabel('Esc') })}
        className="flex h-6 flex-shrink-0 items-center rounded px-2 text-[12px] text-gray-300 transition-colors hover:bg-gray-800 hover:text-white"
      >
        {t('common.cancel')}
      </button>
    </>
  );
}

function Notice({ text }: { text: string | null }): React.JSX.Element | null {
  if (!text) return null;
  return (
    <span role="status" className="text-[12px] text-amber-300">
      {text}
    </span>
  );
}

const STRIP_CLASS =
  'flex max-w-[92vw] flex-wrap items-center justify-center gap-1.5 rounded-xl border border-gray-700 bg-gray-900/95 px-2 py-1 shadow-2xl';

// ─── 자르기 옵션 줄 ───

export interface CropOptionsBarProps {
  box: Box | null;
  natural: Size;
  aspect: CropAspect;
  shape: CropShape;
  busy: boolean;
  /** 적용할 자르기가 있는가([적용] 활성). */
  pending: boolean;
  notice: string | null;
  onAspect: (aspect: CropAspect) => void;
  onShape: (shape: CropShape) => void;
  onField: (field: CropField, value: number) => void;
  onTrim: () => void;
  onApply: () => void;
  onCancel: () => void;
}

export function CropOptionsBar({
  box,
  natural,
  aspect,
  shape,
  busy,
  pending,
  notice,
  onAspect,
  onShape,
  onField,
  onTrim,
  onApply,
  onCancel,
}: CropOptionsBarProps): React.JSX.Element {
  const { t } = useTranslation();
  const noBox = !box || busy;
  return (
    <div onClick={(e) => e.stopPropagation()} className={STRIP_CLASS}>
      {CROP_ASPECTS.map((item) => {
        const label =
          item === 'free'
            ? t('ide.imageAnnotate.crop.aspectFree')
            : item === 'original'
              ? t('ide.imageAnnotate.crop.aspectOriginal')
              : item;
        const ratio = item === 'free' ? null : item === 'original' ? reducedRatio(natural) : item;
        return (
          <Chip
            key={item}
            active={aspect === item}
            title={ratio ? t('ide.imageAnnotate.crop.aspectTitle', { ratio }) : undefined}
            onClick={() => onAspect(item)}
          >
            <span className={item === 'free' || item === 'original' ? '' : 'tabular-nums'}>{label}</span>
          </Chip>
        );
      })}
      <Sep />
      <Chip
        active={shape === 'ellipse'}
        title={t('ide.imageAnnotate.crop.roundHint')}
        onClick={() => onShape(shape === 'ellipse' ? 'rect' : 'ellipse')}
      >
        <RoundGlyph />
        {t('ide.imageAnnotate.crop.round')}
      </Chip>
      <Sep />
      <div className="flex flex-wrap items-center gap-1.5" title={t('ide.imageAnnotate.crop.fieldHint')}>
        <NumberField label="X" value={box?.x ?? 0} disabled={noBox} onCommit={(v) => onField('x', v)} />
        <NumberField label="Y" value={box?.y ?? 0} disabled={noBox} onCommit={(v) => onField('y', v)} />
        <NumberField
          label={t('ide.imageAnnotate.crop.width')}
          value={box?.w ?? 0}
          disabled={noBox}
          onCommit={(v) => onField('w', v)}
        />
        <NumberField
          label={t('ide.imageAnnotate.crop.height')}
          value={box?.h ?? 0}
          disabled={noBox}
          onCommit={(v) => onField('h', v)}
        />
      </div>
      <Sep />
      <Chip disabled={busy} title={t('ide.imageAnnotate.crop.trimHint')} onClick={onTrim}>
        <TrimGlyph />
        {t('ide.imageAnnotate.crop.trim')}
      </Chip>
      <Sep />
      <ApplyCancel pending={pending} busy={busy} onApply={onApply} onCancel={onCancel} />
      <Notice text={notice} />
    </div>
  );
}

// ─── 알파 옵션 줄 ───

export interface AlphaOptionsBarProps {
  mode: AlphaMode;
  /** [색 빼기]로 고른 색 — 아직 안 골랐으면 null. */
  keyColor: Rgb | null;
  tolerancePct: number;
  contiguous: boolean;
  /** [투명 채우기] 색(#rrggbb). */
  fillColor: string;
  /** 바탕에 투명이 있는가 — 아직 모르면 null. */
  baseTransparent: boolean | null;
  busy: boolean;
  pending: boolean;
  notice: string | null;
  onMode: (mode: AlphaMode) => void;
  onAuto: () => void;
  onTolerance: (percent: number) => void;
  onContiguous: (on: boolean) => void;
  onFillColor: (hex: string) => void;
  onApply: () => void;
  onCancel: () => void;
}

const FILL_PRESETS = [
  { hex: '#ffffff', key: 'fillWhite' },
  { hex: '#000000', key: 'fillBlack' },
] as const;

export function AlphaOptionsBar({
  mode,
  keyColor,
  tolerancePct,
  contiguous,
  fillColor,
  baseTransparent,
  busy,
  pending,
  notice,
  onMode,
  onAuto,
  onTolerance,
  onContiguous,
  onFillColor,
  onApply,
  onCancel,
}: AlphaOptionsBarProps): React.JSX.Element {
  const { t } = useTranslation();
  const keyHex = keyColor ? rgbToHex(keyColor) : null;
  return (
    <div onClick={(e) => e.stopPropagation()} className={STRIP_CLASS}>
      <Chip active={mode === 'key'} onClick={() => onMode('key')}>
        {t('ide.imageAnnotate.alpha.modeKey')}
      </Chip>
      <Chip active={mode === 'fill'} onClick={() => onMode('fill')}>
        {t('ide.imageAnnotate.alpha.modeFill')}
      </Chip>
      <Sep />
      {mode === 'key' ? (
        <>
          {keyHex ? (
            <span className="flex items-center gap-1 text-[12px] text-gray-200">
              <span className="h-4 w-4 flex-shrink-0 rounded border border-gray-500" style={{ backgroundColor: keyHex }} />
              {t('ide.imageAnnotate.alpha.pickedColor', { color: keyHex })}
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[12px] text-gray-400">
              <PipetteGlyph />
              {t('ide.imageAnnotate.alpha.pickEmpty')}
            </span>
          )}
          <Chip disabled={busy} title={t('ide.imageAnnotate.alpha.autoHint')} onClick={onAuto}>
            <WandGlyph />
            {t('ide.imageAnnotate.alpha.auto')}
          </Chip>
          <Sep />
          <label className="flex items-center gap-1.5 text-[12px] text-gray-400">
            {t('ide.imageAnnotate.alpha.tolerance')}
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={tolerancePct}
              onChange={(e) => onTolerance(Number(e.target.value))}
              className="h-1 w-24 cursor-pointer accent-blue-500"
            />
            <span className="w-8 text-right tabular-nums text-gray-200">{tolerancePct}%</span>
          </label>
          <Chip
            active={contiguous}
            title={t('ide.imageAnnotate.alpha.contiguousHint')}
            onClick={() => onContiguous(!contiguous)}
          >
            {t('ide.imageAnnotate.alpha.contiguous')}
          </Chip>
        </>
      ) : (
        <>
          {FILL_PRESETS.map((preset) => (
            <Chip key={preset.hex} active={fillColor === preset.hex} onClick={() => onFillColor(preset.hex)}>
              <span
                className="h-3.5 w-3.5 flex-shrink-0 rounded-sm border border-gray-500"
                style={{ backgroundColor: preset.hex }}
              />
              {t(`ide.imageAnnotate.alpha.${preset.key}`)}
            </Chip>
          ))}
          <label className="flex cursor-pointer items-center gap-1 text-[12px] text-gray-300">
            {/* 운영체제의 색 고르기 창이 뜬다(세 OS 공통 — Electron 이 각 OS 의 것을 띄운다). */}
            <input
              type="color"
              value={fillColor}
              onChange={(e) => onFillColor(e.target.value.toLowerCase())}
              className="h-5 w-7 cursor-pointer rounded border border-gray-600 bg-transparent p-0"
            />
            {t('ide.imageAnnotate.alpha.fillCustom')}
          </label>
          {baseTransparent === false && (
            <span className="text-[12px] text-gray-500">{t('ide.imageAnnotate.alpha.noTransparency')}</span>
          )}
        </>
      )}
      <Sep />
      <ApplyCancel pending={pending} busy={busy} onApply={onApply} onCancel={onCancel} />
      <Notice text={notice} />
    </div>
  );
}

// ─── 자르기 상자 ───

const HANDLE_CURSOR: Record<CropEdgeHandle, string> = {
  nw: 'cursor-nwse-resize',
  se: 'cursor-nwse-resize',
  ne: 'cursor-nesw-resize',
  sw: 'cursor-nesw-resize',
  n: 'cursor-ns-resize',
  s: 'cursor-ns-resize',
  e: 'cursor-ew-resize',
  w: 'cursor-ew-resize',
};

const HANDLE_MARK: Record<CropEdgeHandle, string> = {
  nw: 'h-2.5 w-2.5',
  ne: 'h-2.5 w-2.5',
  se: 'h-2.5 w-2.5',
  sw: 'h-2.5 w-2.5',
  n: 'h-1.5 w-4',
  s: 'h-1.5 w-4',
  e: 'h-4 w-1.5',
  w: 'h-4 w-1.5',
};

/** 변 손잡이를 먼저, 모서리를 나중에 그린다 — 작은 상자에서 겹치면 모서리가 위에 온다. */
const HANDLE_ORDER: readonly CropEdgeHandle[] = [...CROP_HANDLES].sort((a, b) => a.length - b.length);

interface CropDragState {
  handle: CropHandle;
  start: Point;
  startClient: Point;
  pointerId: number;
  /** 누를 때가 아니라 **처음 움직일 때** 잡는다 — 누르는 순간 숫자 칸이 blur 로 확정한 값을 쓰려고. */
  origin: Box | null;
  /** 포인터를 잡은 요소 — 손잡이를 잡으면 끄는 동안 그 손잡이의 커서가 유지된다. */
  captured: Element | null;
}

export interface CropOverlayProps {
  box: Box;
  natural: Size;
  shape: CropShape;
  /** 고정 비율(너비÷높이) — 자유면 null. */
  ratio: number | null;
  disabled: boolean;
  onChange: (box: Box) => void;
}

/**
 * 자르기 상자 — 밖은 어둡게, 안은 3분할 안내선. 손잡이 8개로 크기를, 안쪽 끌기로 위치를 바꾸고
 * 상자 밖에서 끌면 새로 긋는다. 상자가 그림 전체일 때는 안쪽 끌기도 새로 긋기다(옮길 곳이 없다).
 * 좌표는 이미지 natural 픽셀 — 표시 크기가 달라도 저장본과 같은 자리다.
 */
export function CropOverlay({ box, natural, shape, ratio, disabled, onChange }: CropOverlayProps): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<CropDragState | null>(null);
  const boxRef = useRef(box);
  boxRef.current = box;
  const full = isFullBox(box, natural);

  const pointAt = (clientX: number, clientY: number): Point | null => {
    const el = rootRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return toImagePoint({ x: clientX, y: clientY }, { x: rect.left, y: rect.top, w: rect.width, h: rect.height }, natural);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (disabled || e.button !== 0) return;
    // 기본 동작은 막지 않는다 — 초점이 숫자 칸을 떠나며 값이 확정돼야 한다(글자 선택은 select-none 이 막는다).
    e.stopPropagation();
    const at = pointAt(e.clientX, e.clientY);
    if (!at) return;
    const handleEl = e.target instanceof Element ? e.target.closest('[data-crop-handle]') : null;
    let handle = (handleEl?.getAttribute('data-crop-handle') as CropHandle | null) ?? 'new';
    if (handle === 'move' && full) handle = 'new';
    const captured = handle === 'new' ? rootRef.current : handleEl;
    dragRef.current = {
      handle,
      start: at,
      startClient: { x: e.clientX, y: e.clientY },
      pointerId: e.pointerId,
      origin: null,
      captured,
    };
    // 그림 밖으로 끌어도 계속 따라오게. 포인터가 이미 사라진 드문 타이밍엔 던지므로 삼킨다.
    try { captured?.setPointerCapture(e.pointerId); } catch { /* 무시 */ }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    if (drag.handle === 'new' && drag.origin === null) {
      const moved = Math.hypot(e.clientX - drag.startClient.x, e.clientY - drag.startClient.y);
      if (moved < NEW_BOX_SLOP_PX) return;
    }
    const at = pointAt(e.clientX, e.clientY);
    if (!at) return;
    const origin = drag.origin ?? boxRef.current;
    drag.origin = origin;
    const next = dragCropBox({ handle: drag.handle, start: drag.start, origin }, at, ratio, natural);
    const cur = boxRef.current;
    if (next.x !== cur.x || next.y !== cur.y || next.w !== cur.w || next.h !== cur.h) onChange(next);
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    dragRef.current = null;
    try { drag.captured?.releasePointerCapture(e.pointerId); } catch { /* 이미 놓였으면 무시 */ }
  };

  const W = natural.w;
  const H = natural.h;
  const hole =
    shape === 'ellipse'
      ? `M${box.x} ${box.y + box.h / 2}a${box.w / 2} ${box.h / 2} 0 1 0 ${box.w} 0a${box.w / 2} ${box.h / 2} 0 1 0 ${-box.w} 0Z`
      : `M${box.x} ${box.y}h${box.w}v${box.h}h${-box.w}Z`;
  const x1 = box.x + box.w / 3;
  const x2 = box.x + (box.w * 2) / 3;
  const y1 = box.y + box.h / 3;
  const y2 = box.y + (box.h * 2) / 3;
  const thirds =
    `M${x1} ${box.y}V${box.y + box.h}M${x2} ${box.y}V${box.y + box.h}` +
    `M${box.x} ${y1}H${box.x + box.w}M${box.x} ${y2}H${box.x + box.w}`;

  return (
    <div
      ref={rootRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={() => { dragRef.current = null; }}
      className={`absolute inset-0 touch-none select-none ${disabled ? 'cursor-wait' : 'cursor-crosshair'}`}
    >
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
      >
        <path d={`M0 0H${W}V${H}H0Z${hole}`} fill="rgba(0, 0, 0, 0.55)" fillRule="evenodd" />
        <path d={thirds} fill="none" stroke="rgba(255, 255, 255, 0.35)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {shape === 'ellipse' ? (
          <>
            <rect
              x={box.x}
              y={box.y}
              width={box.w}
              height={box.h}
              fill="none"
              stroke="rgba(255, 255, 255, 0.6)"
              strokeWidth={1}
              strokeDasharray="4 4"
              vectorEffect="non-scaling-stroke"
            />
            <ellipse
              cx={box.x + box.w / 2}
              cy={box.y + box.h / 2}
              rx={box.w / 2}
              ry={box.h / 2}
              fill="none"
              stroke="#ffffff"
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
            />
          </>
        ) : (
          <rect
            x={box.x}
            y={box.y}
            width={box.w}
            height={box.h}
            fill="none"
            stroke="#ffffff"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      <div
        data-crop-handle="move"
        className={`absolute ${disabled ? 'cursor-wait' : full ? 'cursor-crosshair' : 'cursor-move'}`}
        style={{ left: pct(box.x, W), top: pct(box.y, H), width: pct(box.w, W), height: pct(box.h, H) }}
      />
      {!disabled &&
        HANDLE_ORDER.map((h) => {
          const hx = h.includes('w') ? box.x : h.includes('e') ? box.x + box.w : box.x + box.w / 2;
          const hy = h.includes('n') ? box.y : h.includes('s') ? box.y + box.h : box.y + box.h / 2;
          return (
            <div
              key={h}
              data-crop-handle={h}
              className={`absolute flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center ${HANDLE_CURSOR[h]}`}
              style={{ left: pct(hx, W), top: pct(hy, H) }}
            >
              <span className={`block rounded-sm border border-black/60 bg-white ${HANDLE_MARK[h]}`} />
            </div>
          );
        })}
    </div>
  );
}

// ─── 글리프 — lucide 톤 stroke SVG (이모지 ❌) ───

const GLYPH = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: '1.8',
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export function CropGlyph(): React.JSX.Element {
  return (
    <svg className="h-4 w-4" {...GLYPH}>
      <path d="M6 2v14a2 2 0 0 0 2 2h14" />
      <path d="M18 22V8a2 2 0 0 0-2-2H2" />
    </svg>
  );
}

/** 알파 빼기 — 반쪽이 빗금인 네모(투명한 자리). */
export function AlphaGlyph(): React.JSX.Element {
  return (
    <svg className="h-4 w-4" {...GLYPH}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 21 21 3" />
      <path d="M3 9 9 3" />
      <path d="M3 15 15 3" />
    </svg>
  );
}

function RoundGlyph(): React.JSX.Element {
  return (
    <svg className="h-3.5 w-3.5" {...GLYPH}>
      <rect x="3" y="3" width="18" height="18" rx="1" strokeDasharray="2.5 2.5" />
      <circle cx="12" cy="12" r="7" />
    </svg>
  );
}

function TrimGlyph(): React.JSX.Element {
  return (
    <svg className="h-3.5 w-3.5" {...GLYPH}>
      <path d="M3 7V5a2 2 0 0 1 2-2h2" />
      <path d="M17 3h2a2 2 0 0 1 2 2v2" />
      <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
      <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
      <rect x="8" y="8" width="8" height="8" rx="1" />
    </svg>
  );
}

function WandGlyph(): React.JSX.Element {
  return (
    <svg className="h-3.5 w-3.5" {...GLYPH}>
      <path d="M15 4V2" />
      <path d="M15 16v-2" />
      <path d="M8 9h2" />
      <path d="M20 9h2" />
      <path d="M17.8 11.8 19 13" />
      <path d="M15 9h.01" />
      <path d="M17.8 6.2 19 5" />
      <path d="m3 21 9-9" />
      <path d="M12.2 6.2 11 5" />
    </svg>
  );
}

function PipetteGlyph(): React.JSX.Element {
  return (
    <svg className="h-3.5 w-3.5" {...GLYPH}>
      <path d="m2 22 1-1h3l9-9" />
      <path d="M3 21v-3l9-9" />
      <path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z" />
    </svg>
  );
}

function CheckGlyph(): React.JSX.Element {
  return (
    <svg className="h-3.5 w-3.5" {...GLYPH} strokeWidth="2">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
