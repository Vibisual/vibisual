import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { formatClock } from './PreviewControls.js';
import { StudioIcon } from './studioIcons.js';
import type { ValueField, ValueOption } from './valueFields.js';

/**
 * §5.13 (V) 37-5 — **값 손잡이**: 종류별 컨트롤. JSON 칸 없이 글자·숫자·색·글꼴·그림·시각·고르기를 고친다.
 *
 * 바꾸는 즉시 `onChange` 가 불린다 — 셸은 화면을 낙관적으로 먼저 바꾸고 저장은 뒤에서 묶어 한 번 한다(`useLocalProps`).
 * 숫자·시각은 이름표를 가로로 끌면 `step` 씩 바뀐다(Shift 면 10배) — 직접 쳐 넣어도 된다. 색은 원형 견본(누르면 색 고르기) + 16진
 * 칸. 키 입력은 스튜디오 단축키로 새지 않게 막는다.
 *
 * 반응형 — 칸은 `min-w-0` 이라 좁은 판(기획 카드 240px · 인스펙터 256px)에서 줄어들 뿐 넘치지 않는다(줄을 접을 일이 없다). 터치에서는
 * 칸·견본·끌기 이름표가 커지고, 끌기 이름표는 손가락 끌기가 밀기 손짓으로 넘어가지 않게 한다(`touch-none`).
 */

const INPUT = 'h-7 min-w-0 rounded-md border border-white/10 bg-vb-sunken px-2 text-[12px] text-slate-100 outline-none focus:ring-1 focus:ring-[var(--vs-accent)] disabled:opacity-40 pointer-coarse:h-9';
/** 끌기 한 칸의 화면 거리(px). */
const DRAG_PX_PER_STEP = 4;

function decimalsOf(step: number): number {
  const s = String(step);
  const dot = s.indexOf('.');
  return dot < 0 ? 0 : Math.min(4, s.length - dot - 1);
}

function roundTo(value: number, step: number): number {
  const d = decimalsOf(step);
  return Number(value.toFixed(d));
}

/** 이름표를 끌어 바꾸는 숫자(시각이면 `00:01.20` 으로 보인다). */
function NumberScrub({ field, onChange, disabled }: { readonly field: ValueField; readonly onChange: (v: number) => void; readonly disabled: boolean }): React.JSX.Element {
  const value = typeof field.value === 'number' ? field.value : Number(field.value) || 0;
  const step = field.step ?? (field.type === 'time' ? 0.05 : Number.isInteger(value) ? 1 : 0.1);
  const clamp = (n: number): number => Math.min(field.max ?? Infinity, Math.max(field.min ?? -Infinity, n));
  const [draft, setDraft] = useState<string | null>(null);
  const drag = useRef<{ x0: number; v0: number; pointer: number } | null>(null);
  const shown = field.type === 'time' ? formatClock(value) : String(roundTo(value, step));
  const commit = (text: string): void => {
    setDraft(null);
    let n: number;
    const clock = /^(\d+):(\d{1,2}(?:\.\d+)?)$/.exec(text.trim());
    if (clock) n = Number(clock[1]) * 60 + Number(clock[2]);
    else n = Number(text.trim().replace(/s$/i, ''));
    if (Number.isFinite(n)) onChange(roundTo(clamp(n), step));
  };
  return (
    <div className="flex items-center gap-1.5">
      <span
        role="slider"
        aria-label={field.label}
        aria-valuenow={value}
        aria-valuemin={field.min}
        aria-valuemax={field.max}
        tabIndex={disabled ? -1 : 0}
        onKeyDown={(e) => {
          if (disabled) return;
          const k = e.key;
          if (k !== 'ArrowLeft' && k !== 'ArrowRight' && k !== 'ArrowUp' && k !== 'ArrowDown') return;
          e.preventDefault();
          e.stopPropagation();
          const dir = k === 'ArrowLeft' || k === 'ArrowDown' ? -1 : 1;
          onChange(roundTo(clamp(value + dir * step * (e.shiftKey ? 10 : 1)), step));
        }}
        onPointerDown={(e) => {
          if (disabled || e.button !== 0) return;
          drag.current = { x0: e.clientX, v0: value, pointer: e.pointerId };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || d.pointer !== e.pointerId) return;
          const steps = Math.round((e.clientX - d.x0) / DRAG_PX_PER_STEP);
          if (steps === 0) return;
          onChange(roundTo(clamp(d.v0 + steps * step * (e.shiftKey ? 10 : 1)), step));
        }}
        onPointerUp={() => { drag.current = null; }}
        onPointerCancel={() => { drag.current = null; }}
        className={`flex h-7 w-6 shrink-0 cursor-ew-resize touch-none select-none items-center justify-center rounded-md text-slate-500 hover:bg-white/10 hover:text-slate-200 pointer-coarse:h-9 pointer-coarse:w-8 ${disabled ? 'pointer-events-none opacity-40' : ''}`}
        title={field.label}
      >
        <StudioIcon name="grip" className="h-3.5 w-3.5 rotate-90" />
      </span>
      <input
        value={draft ?? shown}
        disabled={disabled}
        inputMode="decimal"
        aria-label={field.label}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => { if (draft !== null) commit(e.target.value); }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.nativeEvent.isComposing) return;
          if (e.key === 'Enter') commit(e.currentTarget.value);
          else if (e.key === 'Escape') setDraft(null);
        }}
        className={`${INPUT} w-24 text-right tabular-nums`}
      />
    </div>
  );
}

/** 16진 색인가(색 고르기 창이 받을 수 있는 모양). */
function asHex(value: string): string | null {
  const v = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(v);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase();
  return null;
}

/** 원형 색 견본(누르면 색 고르기) + 16진 칸. 16진이 아닌 값(rgba·변수)도 칸에서 그대로 고친다. */
function ColorSwatch({ field, onChange, disabled }: { readonly field: ValueField; readonly onChange: (v: string) => void; readonly disabled: boolean }): React.JSX.Element {
  const value = String(field.value);
  const picker = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const hex = asHex(value);
  return (
    <div className="flex items-center gap-1.5">
      <button type="button" disabled={disabled} onClick={() => picker.current?.click()} aria-label={field.label} title={field.label}
        className="relative h-6 w-6 shrink-0 overflow-hidden rounded-full border border-white/20 shadow-inner disabled:opacity-40 pointer-coarse:h-8 pointer-coarse:w-8"
        style={{ background: value === '' ? 'transparent' : value }}>
        {value === '' ? <span className="absolute inset-0 flex items-center justify-center text-slate-500"><StudioIcon name="close" className="h-3 w-3" /></span> : null}
      </button>
      <input ref={picker} type="color" tabIndex={-1} aria-hidden="true" className="pointer-events-none absolute h-0 w-0 opacity-0"
        value={hex ?? '#ffffff'} onChange={(e) => onChange(e.target.value)} />
      <input
        value={draft ?? value}
        disabled={disabled}
        aria-label={field.label}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => { if (draft !== null) { setDraft(null); onChange(e.target.value.trim()); } }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.nativeEvent.isComposing) return;
          if (e.key === 'Enter') { setDraft(null); onChange(e.currentTarget.value.trim()); }
          else if (e.key === 'Escape') setDraft(null);
        }}
        className={`${INPUT} w-28 font-mono`}
      />
    </div>
  );
}

function SelectControl({ field, options, onChange, disabled, fontPreview }: {
  readonly field: ValueField;
  readonly options: readonly ValueOption[];
  readonly onChange: (v: string) => void;
  readonly disabled: boolean;
  readonly fontPreview?: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const value = String(field.value);
  const known = options.some((o) => o.value === value);
  return (
    <select value={value} disabled={disabled} aria-label={field.label} onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => e.stopPropagation()}
      className={`${INPUT} w-full`} style={fontPreview && value ? { fontFamily: value } : undefined}>
      {!known ? <option value={value}>{value === '' ? t('panel.videoStudio.editor.options.none') : value}</option> : null}
      {options.map((o) => <option key={o.value} value={o.value} style={fontPreview ? { fontFamily: o.value } : undefined}>{o.label}</option>)}
    </select>
  );
}

/** 고르기 — 넷 이하면 조각 단추, 많으면 목록. */
function ChoiceControl({ field, onChange, disabled }: { readonly field: ValueField; readonly onChange: (v: string) => void; readonly disabled: boolean }): React.JSX.Element {
  const options = field.options ?? [];
  if (options.length > 4) return <SelectControl field={field} options={options} onChange={onChange} disabled={disabled} />;
  return (
    <div className="flex w-full rounded-md border border-white/10 p-0.5" role="radiogroup" aria-label={field.label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === field.value} disabled={disabled} onClick={() => onChange(o.value)}
          className={`min-w-0 flex-1 truncate rounded px-1.5 py-1 text-[12px] transition-colors duration-150 ease-out disabled:opacity-40 pointer-coarse:py-2 ${o.value === field.value ? 'bg-white/10 text-slate-50 ring-1 ring-[var(--vs-accent)]' : 'text-slate-400 hover:text-slate-100'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function TextControl({ field, onChange, disabled }: { readonly field: ValueField; readonly onChange: (v: string) => void; readonly disabled: boolean }): React.JSX.Element {
  const value = String(field.value);
  // 낙관 갱신이라 글자마다 화면이 따라온다. 바깥에서 값이 바뀌면(에이전트) 칸도 따라간다 — 입력 중에는 내 글이 이긴다.
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setDraft(value); }, [value]);
  const common = {
    value: draft,
    disabled,
    'aria-label': field.label,
    spellCheck: false,
    onFocus: () => { focused.current = true; },
    onBlur: () => { focused.current = false; if (draft !== value) onChange(draft); },
    onKeyDown: (e: React.KeyboardEvent) => { e.stopPropagation(); },
  };
  if (field.multiline) {
    return <textarea {...common} rows={3} onChange={(e) => { setDraft(e.target.value); onChange(e.target.value); }}
      className={`${INPUT} h-auto w-full resize-y py-1.5 leading-relaxed pointer-coarse:h-auto`} />;
  }
  return <input {...common} onChange={(e) => { setDraft(e.target.value); onChange(e.target.value); }} className={`${INPUT} w-full`} />;
}

export function ValueControl({ field, onChange, disabled }: { readonly field: ValueField; readonly onChange: (v: string | number) => void; readonly disabled: boolean }): React.JSX.Element {
  switch (field.type) {
    case 'number':
    case 'time':
      return <NumberScrub field={field} onChange={onChange} disabled={disabled} />;
    case 'color':
      return <ColorSwatch field={field} onChange={onChange} disabled={disabled} />;
    case 'font':
      return <SelectControl field={field} options={field.options ?? []} onChange={onChange} disabled={disabled} fontPreview />;
    case 'image':
      return <SelectControl field={field} options={field.options ?? []} onChange={onChange} disabled={disabled} />;
    case 'choice':
      return <ChoiceControl field={field} onChange={onChange} disabled={disabled} />;
    default:
      return <TextControl field={field} onChange={onChange} disabled={disabled} />;
  }
}

/** 값 목록 — 이름표 위, 손잡이 아래(좁은 패널에서도 한 줄이 한 값). */
export function ValueFieldList({ fields, onChange, disabled }: {
  readonly fields: readonly ValueField[];
  readonly onChange: (field: ValueField, value: string | number) => void;
  readonly disabled: boolean;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2.5">
      {fields.map((field) => (
        <div key={field.key} className="flex flex-col gap-1">
          <span className="truncate text-[12px] text-slate-400" title={field.description ?? field.label}>{field.label}</span>
          <ValueControl field={field} onChange={(v) => onChange(field, v)} disabled={disabled} />
        </div>
      ))}
    </div>
  );
}
