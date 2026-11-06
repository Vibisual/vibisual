/** §5.19 (J) — 끝까지 돕기 패널의 손잡이 부품(고르기 칩 · 켜고 끄기 · 한 줄 설명). 좁은 사이드바라 칩은 넘치면 줄을 바꾼다. */

interface ChoiceChipsProps<T extends string | number> {
  label: string;
  hint?: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
  disabled?: boolean;
}

export function ChoiceChips<T extends string | number>({ label, hint, value, options, onChange, disabled }: ChoiceChipsProps<T>): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[12px] font-semibold text-gray-300">{label}</span>
      <div className="flex flex-wrap gap-1" role="group" aria-label={label}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <button
              key={String(o.value)}
              type="button"
              disabled={disabled}
              aria-pressed={on}
              onClick={() => onChange(o.value)}
              className={`min-w-0 max-w-full truncate rounded border px-1.5 py-0.5 text-[12px] transition-colors disabled:opacity-50 pointer-coarse:py-1.5 ${
                on ? 'border-teal-400/70 bg-teal-500/15 text-teal-200' : 'border-gray-700 bg-gray-900 text-gray-400 hover:border-gray-500 hover:text-gray-200'
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      {hint && <span className="text-[12px] leading-relaxed text-gray-500">{hint}</span>}
    </div>
  );
}

interface ToggleRowProps {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}

export function ToggleRow({ label, hint, checked, onChange, disabled }: ToggleRowProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className="flex min-w-0 items-center gap-2 text-left disabled:opacity-50"
      >
        <span className={`relative h-4 w-7 flex-shrink-0 rounded-full transition-colors ${checked ? 'bg-teal-500/80' : 'bg-gray-700'}`}>
          <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${checked ? 'left-3.5' : 'left-0.5'}`} />
        </span>
        <span className="min-w-0 flex-1 text-[12px] font-semibold text-gray-300">{label}</span>
      </button>
      {hint && <span className="text-[12px] leading-relaxed text-gray-500">{hint}</span>}
    </div>
  );
}

/** 묶음 제목 — 사이드바의 다른 뷰와 같은 결(작은 대문자). */
export function SectionTitle({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <span className="pt-1 text-[12px] font-semibold uppercase tracking-wider text-gray-500">{children}</span>;
}
