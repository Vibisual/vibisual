import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
interface SoundNumberFieldProps {
  label: string; value: number; version: number; min?: number; max?: number; disabled?: boolean;
  onCommit: (value: number, baseVersion: number) => void;
}
export function SoundNumberField({ label, value, version, min = 0, max, disabled, onCommit }: SoundNumberFieldProps): React.JSX.Element {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(String(value));
  const [error, setError] = useState('');
  const focused = useRef(false);
  const base = useRef({ value, version });
  useEffect(() => { if (!focused.current) { setDraft(String(value)); base.current = { value, version }; } }, [value, version]);
  const commit = (): void => {
    focused.current = false;
    const next = Number(draft);
    if (draft.trim() === '' || !Number.isFinite(next) || next < min || (max !== undefined && next > max)) {
      setError(t('panel.vibisound.workbench.invalidNumber')); setDraft(String(value)); return;
    }
    if (next === base.current.value) { setDraft(String(value)); return; }
    if (base.current.version !== version) {
      setError(t('panel.vibisound.workbench.reloadedDraft')); setDraft(String(value)); return;
    }
    setError(''); onCommit(next, base.current.version);
  };
  return <label className="block text-xs text-slate-400">
    <span>{label}</span>
    <input type="number" step="0.01" min={min} max={max} disabled={disabled} value={draft}
      onFocus={() => { focused.current = true; base.current = { value, version }; setError(''); }}
      onChange={event => setDraft(event.target.value)} onBlur={commit}
      onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { setDraft(String(value)); focused.current = false; base.current = { value, version }; } }}
      className="mt-1 w-full rounded border border-white/10 bg-black/25 px-2 py-1.5 text-xs text-slate-200 outline-none focus:border-teal-400/50 disabled:opacity-40" />
    {error && <span role="alert" className="mt-1 block text-xs text-amber-300">{error}</span>}
  </label>;
}
