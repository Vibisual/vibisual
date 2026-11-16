import type { JSX } from 'react';
import type { MemoClientHost } from '../host.js';
import type { MemoCitation, MemoNote } from '../types.js';
import { MemoDialog } from './MemoDialog.js';
import { memoDate, memoTitle, type MemoText } from './ui.js';

interface MemoSourceProps { citation: MemoCitation; note: MemoNote; tr: MemoText; close: () => void; Scroll: MemoClientHost['Scroll'] }
export function MemoSource({ citation, note, tr, close, Scroll }: MemoSourceProps): JSX.Element {
  return <MemoDialog title={tr('source')} closeLabel={tr('close')} close={close}>
    <h3 className="mb-1 break-words text-sm font-semibold text-gray-100">{memoTitle(note, tr('untitled'))}</h3>
    <p className="mb-2 text-xs text-gray-500">{tr('version', { version: note.version })} · {memoDate(note.updatedAt)}</p>
    <p className="mb-4 text-xs text-gray-500">{tr('sourceHint')}</p>
    <Scroll maxHeight={480}><p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
      {note.body.slice(0, citation.start)}<mark className="rounded bg-amber-300/30 px-0.5 text-inherit">{note.body.slice(citation.start, citation.end)}</mark>{note.body.slice(citation.end)}
    </p></Scroll>
  </MemoDialog>;
}
