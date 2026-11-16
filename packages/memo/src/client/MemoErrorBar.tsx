import type { JSX } from 'react';
import { IconAlert } from './icons.js';
import { MemoButton, type MemoText } from './ui.js';

interface MemoErrorBarProps { tr: MemoText; code: string; saveError: string; max: string; retry: () => void; keepCopy: () => void }
export function MemoErrorBar({ tr, code, saveError, max, retry, keepCopy }: MemoErrorBarProps): JSX.Element {
  return <div role="alert" className="flex shrink-0 flex-wrap items-center gap-2 border-b border-gray-800 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
    <IconAlert className="h-4 w-4 shrink-0 text-rose-300" />
    <p className="min-w-0 flex-1">{tr(`errors.${code}`, { max })}</p>
    {saveError && <MemoButton onClick={retry}>{tr('retry')}</MemoButton>}
    {saveError === 'version-conflict' && <MemoButton onClick={keepCopy}>{tr('keepCopy')}</MemoButton>}
  </div>;
}
