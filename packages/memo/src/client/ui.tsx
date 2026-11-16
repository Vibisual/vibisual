import type { ButtonHTMLAttributes, JSX } from 'react';
import type { MemoNote } from '../types.js';

export { MemoSwitch, MemoSegmented } from './uiControls.js';

export type MemoText = (key: string, vars?: Record<string, string | number>) => string;
export const INPUT = 'min-w-0 rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 outline-none focus:border-blue-500 disabled:opacity-50';
export const FIELD = 'min-w-0 bg-transparent text-sm text-gray-100 placeholder:text-gray-600 outline-none disabled:opacity-50';

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400 disabled:cursor-not-allowed disabled:opacity-40';
const VARIANT = {
  default: 'border border-gray-700 text-gray-100 hover:bg-gray-800',
  primary: 'border border-blue-500/30 bg-blue-500/15 text-blue-200 hover:bg-blue-500/25',
  ghost: 'text-gray-200 hover:bg-gray-800',
} as const;

interface MemoButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> { variant?: keyof typeof VARIANT }
export function MemoButton({ className = '', variant = 'default', ...props }: MemoButtonProps): JSX.Element {
  return <button type="button" {...props} className={`rounded-md px-3 py-2 text-sm transition-colors ${VARIANT[variant]} ${FOCUS} ${className}`} />;
}

interface MemoIconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> { label: string; pressed?: boolean; tone?: 'default' | 'danger' }
export function MemoIconButton({ label, pressed, tone = 'default', className = '', ...props }: MemoIconButtonProps): JSX.Element {
  const color = pressed ? 'bg-blue-500/15 text-blue-300' : `text-gray-400 hover:bg-gray-800 ${tone === 'danger' ? 'hover:text-rose-300' : 'hover:text-gray-100'}`;
  return (
    <button
      type="button" {...props} title={label} aria-label={label} aria-pressed={pressed}
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors pointer-coarse:h-10 pointer-coarse:w-10 ${color} ${FOCUS} ${className}`}
    />
  );
}

export function memoTitle(note: Pick<MemoNote, 'title' | 'body'>, fallback: string): string {
  return note.title || note.body.split('\n').find(line => line.trim())?.slice(0, 80) || fallback;
}
export function memoDate(at: number): string { return new Date(at).toLocaleString(); }
