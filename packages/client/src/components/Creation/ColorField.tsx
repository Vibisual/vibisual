import { useEffect, useRef, useState } from 'react';

export type ColorPhase = 'preview' | 'commit';

/** §5.13 (R-10) — a drag is ONE edit: intermediate colours are `preview` (coalesced into one undo step), the final colour arrives once as `commit`. */
export function ColorField({ label, value, disabled = false, className, onChange }: {
  label: string; value: string; disabled?: boolean; className?: string; onChange: (value: string, phase: ColorPhase) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  const last = useRef(value);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => { setDraft(value); last.current = value; }, [value]);
  useEffect(() => {
    const input = ref.current;
    if (!input) return undefined;
    // React's onChange fires for every `input` event; the DOM `change` event marks the end of the pick.
    const done = (): void => onChangeRef.current(input.value, 'commit');
    input.addEventListener('change', done);
    return () => input.removeEventListener('change', done);
  }, []);
  return <input ref={ref} aria-label={label} type="color" value={draft} disabled={disabled}
    className={className ?? 'h-7 w-14 rounded bg-transparent pointer-coarse:h-9'}
    onChange={(event) => { setDraft(event.target.value); if (event.target.value !== last.current) onChange(event.target.value, 'preview'); }}
    onBlur={(event) => { if (event.target.value !== value) onChange(event.target.value, 'commit'); }} />;
}
