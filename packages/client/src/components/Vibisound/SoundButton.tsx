import type { ButtonHTMLAttributes } from 'react';
interface SoundButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> { accent?: boolean }
export function SoundButton({ accent, className = '', ...props }: SoundButtonProps): React.JSX.Element {
  return <button type="button" {...props} className={`max-w-full truncate rounded-md border px-3 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${accent ? 'border-teal-400/30 bg-teal-400/15 text-teal-200 hover:bg-teal-400/25' : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'} ${className}`} />;
}
