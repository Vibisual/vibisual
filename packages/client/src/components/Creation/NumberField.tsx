import { useEffect, useRef, useState } from 'react';

/** Accepts what people type on the way to a number: '0.', '-', '.5', '1e3'. Only the committed value must be finite. */
const DRAFT = /^[-+]?(\d+\.?\d*|\.\d*)?(e[-+]?\d*)?$/i;
function format(n: number): string { return String(Number(n.toFixed(4))); }

export interface NumberFieldProps {
  label: string;
  /** Visible text; defaults to the accessible label. */
  caption?: string;
  value: number;
  disabled?: boolean;
  min?: number;
  max?: number;
  className?: string;
  inputClassName?: string;
  onCommit: (value: number) => void;
}

/**
 * §5.13 (R-10) — a draft while typing; the document changes once, on Enter or blur (one undo step). Empty keeps the old
 * value (never 0), values clamp to min/max, Escape restores.
 */
export function NumberField({ label, caption, value, disabled = false, min, max, className, inputClassName, onCommit }: NumberFieldProps): React.JSX.Element {
  const [draft, setDraft] = useState(format(value));
  const editing = useRef(false);
  useEffect(() => { if (!editing.current) setDraft(format(value)); }, [value]);
  const commit = (): void => {
    editing.current = false;
    const text = draft.trim();
    const parsed = Number(text);
    if (text && Number.isFinite(parsed)) {
      const next = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, parsed));
      if (next !== value) onCommit(next);
    }
    // A rejected or unchanged edit shows the current value again, even if no new value arrives.
    setDraft(format(value));
  };
  return <label className={className ?? 'flex min-w-0 items-center gap-1 text-xs text-gray-400'}>
    {caption ?? label}
    <input aria-label={label} type="text" inputMode="decimal" value={draft} disabled={disabled}
      className={inputClassName ?? 'w-full min-w-0 rounded border border-white/10 bg-gray-950 px-1 py-1 text-gray-100 disabled:opacity-40 pointer-coarse:py-2'}
      onFocus={() => { editing.current = true; }}
      onChange={(event) => { if (DRAFT.test(event.target.value)) setDraft(event.target.value); }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') { editing.current = false; setDraft(format(value)); event.currentTarget.blur(); event.stopPropagation(); }
      }}
      onBlur={commit} />
  </label>;
}
