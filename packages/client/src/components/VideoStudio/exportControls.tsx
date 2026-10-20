import type { ReactNode } from 'react';

/**
 * §5.13 (AA) 42-8 — 내보내기 설정 창의 작은 손잡이들(고르기 줄 · 체크 · 칸 묶음). 켬은 앱 색 링(`--vs-accent`) — 앱 색은 선택·진행
 * 표시에만 쓴다(37-1 톤).
 * 반응형 — 터치에서는 고르기 줄·체크·작은 단추의 누름 자리가 커진다. 칸 아래 안내(파일 이름 미리 보기 등)는 긴 낱말도 칸 안에서 접힌다.
 */

/** 칸 하나(이름 + 손잡이). */
export function ExportField({ label, hint, children }: { readonly label: string; readonly hint?: string | undefined; readonly children: ReactNode }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[12px] font-semibold text-slate-400">{label}</span>
      {children}
      {hint ? <span className="break-words text-[12px] text-slate-500">{hint}</span> : null}
    </div>
  );
}

/** 하나만 고르는 줄. */
export function Segmented<T extends string | number>({ value, options, onChange, label, disabled }: {
  readonly value: T;
  readonly options: readonly { readonly value: T; readonly label: string; readonly hint?: string }[];
  readonly onChange: (value: T) => void;
  readonly label: string;
  readonly disabled?: boolean;
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={value === o.value} disabled={disabled} title={o.hint} onClick={() => onChange(o.value)}
          className={`rounded-md px-2 py-1 text-[12px] transition-colors duration-150 ease-out disabled:opacity-40 pointer-coarse:py-2 ${value === o.value ? 'bg-white/10 text-slate-50 ring-1 ring-[var(--vs-accent)]' : 'text-slate-400 hover:bg-white/10 hover:text-slate-100'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** 켜고 끄는 한 줄. */
export function ExportCheck({ checked, onChange, children, disabled }: {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly children: ReactNode;
  readonly disabled?: boolean;
}): React.JSX.Element {
  return (
    <label className={`flex min-w-0 items-center gap-2 text-[12px] pointer-coarse:min-h-9 ${disabled ? 'text-slate-500' : 'text-slate-200'}`}>
      <input type="checkbox" className="shrink-0 accent-[var(--vs-accent)] pointer-coarse:h-5 pointer-coarse:w-5" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="min-w-0 truncate">{children}</span>
    </label>
  );
}

/** 작은 글자 단추(설정 창 안 — 툴팁은 OS `title`). */
export function SmallButton({ children, onClick, disabled, title, tone }: {
  readonly children: ReactNode;
  readonly onClick: () => void;
  readonly disabled?: boolean;
  readonly title?: string;
  readonly tone?: 'primary' | 'plain';
}): React.JSX.Element {
  const look = tone === 'primary'
    ? 'border-[var(--vs-accent)] bg-white/10 text-slate-50 hover:bg-white/15'
    : 'border-white/15 text-slate-200 hover:bg-white/10';
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title}
      className={`flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-[12px] font-medium transition-colors duration-150 ease-out disabled:opacity-40 pointer-coarse:h-9 ${look}`}>
      {children}
    </button>
  );
}
