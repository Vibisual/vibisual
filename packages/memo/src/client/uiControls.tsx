import type { JSX } from 'react';

interface MemoSwitchProps { checked: boolean; onChange: (checked: boolean) => void; label: string; disabled?: boolean }
export function MemoSwitch({ checked, onChange, label, disabled }: MemoSwitchProps): JSX.Element {
  return (
    <button
      type="button" role="switch" aria-checked={checked} disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex min-w-0 items-center gap-2 text-sm text-gray-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? 'bg-blue-500' : 'bg-gray-700'}`}>
        <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-gray-50 transition-transform ${checked ? 'translate-x-4' : 'translate-x-0'}`} />
      </span>
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}

interface MemoSegmentedProps<T extends string> {
  value: T; options: readonly { value: T; label: string }[]; onChange: (value: T) => void; label: string; disabled?: boolean;
}
export function MemoSegmented<T extends string>({ value, options, onChange, label, disabled }: MemoSegmentedProps<T>): JSX.Element {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1">
      {options.map(option => (
        <button
          key={option.value} type="button" disabled={disabled}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={`rounded-md px-2.5 py-1 text-xs transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400 disabled:cursor-not-allowed disabled:opacity-40 ${option.value === value ? 'bg-gray-800 text-gray-100' : 'text-gray-400 hover:bg-gray-800/60 hover:text-gray-200'}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
