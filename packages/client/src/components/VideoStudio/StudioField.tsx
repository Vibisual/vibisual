import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

/** 인스펙터 칸 — 넓을 때 256px · 폰 폭에서는 전폭이라 폭은 부모가 정한다(`w-full min-w-0`). 터치에서는 누름 자리를 키운다. */
export const STUDIO_INPUT_CLASS = 'w-full min-w-0 rounded border border-white/10 bg-vb-sunken px-2 py-1.5 text-[12px] text-slate-100 outline-none focus:ring-1 focus:ring-[var(--vs-accent)] disabled:opacity-40 pointer-coarse:py-2';

interface FieldProps {
  label: string;
  disabled?: boolean;
  hint?: string;
}

interface DraftFieldProps extends FieldProps {
  value: string;
  multiline?: boolean;
  numeric?: boolean;
  validate?: (value: string) => string | undefined;
  onCommit: (value: string) => void;
}

/** Local drafts keep partial numbers and IME input out of the persisted document. */
function DraftField({ label, value, disabled, hint, multiline, numeric, validate, onCommit }: DraftFieldProps): React.JSX.Element {
  const id = useId();
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string>();
  const dirty = useRef(false);
  useEffect(() => { setDraft(value); setError(undefined); dirty.current = false; }, [value]);
  const commit = (): void => {
    if (disabled || !dirty.current) return;
    const invalid = validate?.(draft);
    setError(invalid);
    if (invalid) return;
    dirty.current = false;
    // The document prop is authoritative. A rejected async save must not leave a
    // submitted draft looking persisted when the server keeps the previous value.
    setDraft(value);
    if (draft !== value) onCommit(draft);
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
    event.stopPropagation();
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      dirty.current = false;
      setDraft(value);
      setError(undefined);
    } else if (event.key === 'Enter' && (!multiline || event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      commit();
    }
  };
  const shared = {
    id, disabled, value: draft, className: STUDIO_INPUT_CLASS,
    'aria-invalid': error ? true as const : undefined,
    'aria-describedby': error || hint ? `${id}-hint` : undefined,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
      dirty.current = true;
      setDraft(event.target.value);
      setError(undefined);
    },
    onKeyDown, onBlur: commit,
  };
  return (
    <div className="min-w-0 space-y-1">
      <label htmlFor={id} className="block text-xs text-white/60">{label}</label>
      {multiline ? <textarea {...shared} rows={3} className={`${STUDIO_INPUT_CLASS} resize-y`} /> : <input {...shared} type="text" inputMode={numeric ? 'decimal' : undefined} />}
      {error || hint ? <p id={`${id}-hint`} role={error ? 'alert' : undefined} className={`text-xs ${error ? 'text-amber-300' : 'text-white/40'}`}>{error ?? hint}</p> : null}
    </div>
  );
}

export interface StudioTextFieldProps extends FieldProps {
  value: string;
  multiline?: boolean;
  /** 틀린 값이면 이유 한 줄(번역문)을 돌려준다 — 그때는 저장하지 않는다. */
  validate?: (value: string) => string | undefined;
  onCommit: (value: string) => void;
}

export function StudioTextField(props: StudioTextFieldProps): React.JSX.Element {
  return <DraftField {...props} />;
}

export interface StudioNumberFieldProps extends FieldProps {
  value: number;
  min?: number;
  max?: number;
  integer?: boolean;
  onCommit: (value: number) => void;
}

export function StudioNumberField({ value, min, max, integer, onCommit, ...props }: StudioNumberFieldProps): React.JSX.Element {
  const { t } = useTranslation();
  const validate = (text: string): string | undefined => {
    const number = Number(text);
    if (text.trim() === '' || !Number.isFinite(number)) return t('panel.videoStudio.editor.invalidNumber', { defaultValue: 'Enter a finite number.' });
    if (integer && !Number.isInteger(number)) return t('panel.videoStudio.editor.integerNumber', { defaultValue: 'Enter a whole number.' });
    if (min !== undefined && number < min) return t('panel.videoStudio.editor.minimumNumber', { defaultValue: 'Minimum: {{min}}', min });
    if (max !== undefined && number > max) return t('panel.videoStudio.editor.maximumNumber', { defaultValue: 'Maximum: {{max}}', max });
    return undefined;
  };
  return <DraftField {...props} value={String(value)} numeric validate={validate} onCommit={(next) => onCommit(Number(next))} />;
}
