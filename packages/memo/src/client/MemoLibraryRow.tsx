import type { JSX } from 'react';
import type { MemoNote } from '../types.js';
import { IconListChecks, IconPaperclip, IconPin, IconShieldOff } from './icons.js';
import { highlight, previewText, relativeTime, taskProgress } from './listView.js';
import { memoTitle, type MemoText } from './ui.js';

function Marked({ text, q }: { text: string; q: string }): JSX.Element {
  return <>{highlight(text, q).map((part, index) => part.hit
    ? <mark key={index} className="rounded bg-amber-300/30 text-inherit">{part.text}</mark>
    : <span key={index}>{part.text}</span>)}</>;
}

interface MemoLibraryRowProps {
  tr: MemoText; note: MemoNote; q: string; now: number; locale: string | undefined; active: boolean;
  selecting: boolean; checked: boolean; selectionFull: boolean; toggle: (checked: boolean) => void; open: () => void;
}
export function MemoLibraryRow({ tr, note, q, now, locale, active, selecting, checked, selectionFull, toggle, open }: MemoLibraryRowProps): JSX.Element {
  const title = memoTitle(note, tr('untitled'));
  const preview = previewText(note, q);
  const progress = taskProgress(note.tasks);
  return <li className={`flex items-start gap-2 rounded-lg px-2.5 py-2 ${active ? 'bg-blue-500/15' : 'hover:bg-gray-800/60'}`}>
    {selecting && note.deletedAt === null && <input type="checkbox" className="mt-1" aria-label={tr('selectNote', { title })}
      checked={checked} disabled={note.aiExcluded || (!checked && selectionFull)} onChange={event => toggle(event.target.checked)} />}
    <button type="button" data-memo-row="" onClick={open} className="min-w-0 flex-1 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400">
      <span className="flex items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-100"><Marked text={title} q={q} /></span>
        {note.pinned && <IconPin className="h-3.5 w-3.5 shrink-0 text-amber-300" />}
      </span>
      {preview && <span className="mt-0.5 line-clamp-2 block break-words text-xs text-gray-400"><Marked text={preview} q={q} /></span>}
      <span className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-gray-500">
        <span>{relativeTime(note.updatedAt, now, locale)}</span>
        {note.tags.slice(0, 2).map(tag => <span key={tag} className="max-w-24 truncate">#{tag}</span>)}
        {note.attachments.length > 0 && <span className="flex items-center gap-0.5" aria-label={tr('attachmentCount', { count: note.attachments.length })}><IconPaperclip className="h-3 w-3" />{note.attachments.length}</span>}
        {progress.total > 0 && <span className="flex items-center gap-0.5"><IconListChecks className="h-3 w-3" />{progress.done}/{progress.total}</span>}
        {note.aiExcluded && <span title={tr('excluded')}><IconShieldOff className="h-3 w-3" /></span>}
      </span>
    </button>
  </li>;
}
