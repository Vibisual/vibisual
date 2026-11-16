import { useEffect, useRef, useState } from 'react';
import { ColorField, type ColorPhase } from '../Creation/ColorField.js';

/**
 * §5.13 (R-9) 레이어 편집기 ⑤ — 속성 패널의 숫자·색 칸. 입력은 초안으로 두고 Enter·포커스 해제 때 한 번 반영한다((R-10) 규칙).
 * 숫자칸 이름표를 좌우로 끌면 값이 바뀌고(끄는 동안 `onPreview` — 실행 취소 한 단계로 묶인다), ↑↓ 는 1·Shift 10 씩.
 */

const DRAFT = /^[-+]?(\d+\.?\d*|\.\d*)?(e[-+]?\d*)?$/i;
const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;
export const FIELD_BOX = 'flex h-7 min-w-0 items-center rounded-md border border-gray-800 bg-gray-950 focus-within:border-blue-500 pointer-coarse:h-9';
const INPUT = 'h-full w-full min-w-0 bg-transparent px-1.5 text-xs tabular-nums text-gray-100 outline-none disabled:text-gray-500';

interface InspectorNumberProps {
  label: string;
  /** 칸 앞 짧은 표시(X·W 또는 글리프) — 끌어 조절하는 손잡이. */
  caption: React.ReactNode;
  value: number;
  min?: number;
  max?: number;
  /** ↑↓·끌기 한 칸. */
  step?: number;
  /** 보이는 소수 자리. */
  digits?: number;
  unit?: string;
  disabled?: boolean;
  onCommit: (value: number) => void;
  /** 끄는 동안의 값 — 없으면 놓을 때 한 번만 `onCommit`. */
  onPreview?: (value: number) => void;
  /** 끌기가 끝났다(묶음 실행 취소를 닫는다). */
  onEnd?: () => void;
}

export function InspectorNumber({ label, caption, value, min, max, step = 1, digits = 2, unit, disabled, onCommit, onPreview, onEnd }: InspectorNumberProps): React.JSX.Element {
  const format = (n: number): string => String(Number(n.toFixed(digits)));
  const clamp = (n: number): number => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, Number(n.toFixed(digits))));
  const [draft, setDraft] = useState(format(value));
  const editing = useRef(false);
  // Esc 는 흐림(blur)이 다시 그리기 전에 돌아 옛 초안을 반영해 버린다 — 이 표시로 그 한 번을 건너뛴다.
  const cancelled = useRef(false);
  // 이름표를 끈 뒤의 click 은 label 이 입력칸에 초점을 주는 일이라 막는다(초점이 남으면 단축키가 그 칸으로 간다).
  const scrubbed = useRef(false);
  const scrub = useRef<{ x: number; start: number; last: number; moved: boolean } | null>(null);
  useEffect(() => { if (!editing.current) setDraft(format(value)); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = (): void => {
    editing.current = false;
    const skip = cancelled.current; cancelled.current = false;
    const parsed = Number(draft.trim());
    // 보이는 값 그대로면(반올림해 보인 412.74 ≠ 412.7384) 손대지 않은 것이다 — 값을 다시 쓰지 않는다.
    if (!skip && draft !== format(value) && draft.trim() && Number.isFinite(parsed)) { const next = clamp(parsed); if (next !== value) onCommit(next); }
    setDraft(format(value));
  };
  return (
    <label className={`${FIELD_BOX} ${disabled ? 'opacity-50' : ''}`} title={label}>
      <span aria-hidden="true" className={`flex h-full w-6 shrink-0 select-none items-center justify-center text-xs text-gray-500 ${disabled ? '' : 'cursor-ew-resize hover:text-gray-200'}`}
        onPointerDown={(e) => {
          if (disabled || e.button !== 0) return;
          e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId);
          scrub.current = { x: e.clientX, start: value, last: value, moved: false };
        }}
        onPointerMove={(e) => {
          const s = scrub.current; if (!s) return;
          const next = clamp(s.start + Math.round((e.clientX - s.x) / 2) * step * (e.shiftKey ? 10 : 1));
          if (next === s.last) return;
          s.last = next; s.moved = true; setDraft(format(next));
          if (onPreview) onPreview(next);
        }}
        onPointerUp={() => {
          const s = scrub.current; scrub.current = null;
          if (!s?.moved) return;
          scrubbed.current = true;
          if (!onPreview) onCommit(s.last);
          onEnd?.();
        }}
        onPointerCancel={() => { scrub.current = null; onEnd?.(); }}
        onClick={(e) => { if (scrubbed.current) { scrubbed.current = false; e.preventDefault(); } }}>
        {caption}
      </span>
      <input aria-label={label} type="text" inputMode="decimal" value={draft} disabled={disabled} className={INPUT}
        onFocus={(e) => { editing.current = true; e.currentTarget.select(); }}
        onChange={(e) => { if (DRAFT.test(e.target.value)) setDraft(e.target.value); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          else if (e.key === 'Escape') { cancelled.current = true; setDraft(format(value)); e.currentTarget.blur(); e.stopPropagation(); }
          else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const base = Number.isFinite(Number(draft)) && draft.trim() ? Number(draft) : value;
            const next = clamp(base + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1));
            setDraft(format(next)); if (next !== value) onCommit(next);
          }
        }}
        onBlur={commit} />
      {unit && <span aria-hidden="true" className="shrink-0 pr-1.5 text-xs text-gray-500">{unit}</span>}
    </label>
  );
}

/** 6자리 16진으로 — 색 고르개는 #rrggbb 만 받는다. 알파는 떼고, 읽을 수 없는 값(`transparent`)은 검정으로 보인다. */
function swatchHex(value: string): string {
  const m = HEX.exec(value.length === 9 ? value.slice(0, 7) : value);
  if (!m) return '#000000';
  const hex = m[1]!;
  return `#${hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex}`.toLowerCase();
}

export function InspectorColor({ label, value, disabled, onChange }: {
  label: string; value: string; disabled?: boolean; onChange: (value: string, phase: ColorPhase) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  const commit = (): void => {
    const m = HEX.exec(draft.trim());
    if (m) { const next = swatchHex(`#${m[1]}`); if (next !== value.toLowerCase()) onChange(next, 'commit'); }
    setDraft(value);
  };
  return (
    <div className={`${FIELD_BOX} gap-1 pl-1 ${disabled ? 'opacity-50' : ''}`} title={label}>
      <ColorField label={label} value={swatchHex(value)} disabled={disabled} onChange={onChange}
        className="h-5 w-5 shrink-0 cursor-pointer rounded border border-gray-700 bg-transparent p-0 pointer-coarse:h-7 pointer-coarse:w-7" />
      <input aria-label={`${label} (hex)`} value={draft.replace(/^#/, '').toUpperCase()} disabled={disabled} maxLength={7} spellCheck={false}
        className={`${INPUT} uppercase`} onChange={(e) => setDraft(`#${e.target.value.replace(/^#/, '')}`)}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setDraft(value); e.stopPropagation(); } }}
        onBlur={commit} />
    </div>
  );
}

/** 0~1 값을 0~100% 막대로 — 끄는 동안은 미리보기(한 단계), 놓으면 끝. */
export function InspectorSlider({ label, value, disabled, onPreview, onEnd }: {
  label: string; value: number; disabled?: boolean; onPreview: (value: number) => void; onEnd: () => void;
}): React.JSX.Element {
  return (
    <input type="range" aria-label={label} title={label} min={0} max={100} step={1} value={Math.round(value * 100)} disabled={disabled}
      className="h-7 min-w-0 flex-1 cursor-pointer accent-blue-500 disabled:opacity-40"
      onChange={(e) => onPreview(Number(e.target.value) / 100)} onPointerUp={onEnd} onKeyUp={onEnd} onBlur={onEnd} />
  );
}

/** 속성 패널 한 묶음 — 묶음 이름은 작게·굵게, 묶음 사이는 선 하나. */
export function InspectorGroup({ title, actions, children }: { title?: string; actions?: React.ReactNode; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1.5 border-t border-gray-800 px-3 py-2.5 first:border-t-0">
      {(title || actions) && <div className="flex min-h-5 items-center gap-1">
        {title && <h3 className="min-w-0 flex-1 truncate text-xs font-semibold text-gray-400">{title}</h3>}
        {actions}
      </div>}
      {children}
    </div>
  );
}

export const SELECT = 'h-7 min-w-0 w-full cursor-pointer rounded-md border border-gray-800 bg-gray-950 px-1.5 text-xs text-gray-100 outline-none focus:border-blue-500 disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:h-9';

/** 이름표 + 칸 한 줄(좁은 패널에서도 이름표 폭이 같아 칸이 줄을 맞춘다). */
export function InspectorRow({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-1.5">
      <span className="truncate text-xs text-gray-400" title={label}>{label}</span>
      {children}
    </div>
  );
}
