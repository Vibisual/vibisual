import type { JSX } from 'react';
import { IconPencil } from './icons.js';
import type { MemoText } from './ui.js';

interface MemoLibraryEmptyProps { tr: MemoText; fresh: boolean }
export function MemoLibraryEmpty({ tr, fresh }: MemoLibraryEmptyProps): JSX.Element {
  if (!fresh) return <p className="p-4 text-sm text-gray-400">{tr('empty')}</p>;
  return <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
    <IconPencil className="h-5 w-5 shrink-0 text-gray-600" />
    <p className="text-sm text-gray-300">{tr('emptyStart')}</p>
    <p className="text-xs text-gray-500">{tr('emptyStartHint')}</p>
  </div>;
}
