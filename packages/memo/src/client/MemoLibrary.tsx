import { useMemo, useState, type JSX, type KeyboardEvent, type RefObject } from 'react';
import { MEMO } from '../config.js';
import type { MemoClientHost } from '../host.js';
import type { MemoNote } from '../types.js';
import { groupNotes, type MemoGroupKey, type MemoQuery } from './listView.js';
import { MemoLibraryEmpty } from './MemoLibraryEmpty.js';
import { MemoLibraryFilters } from './MemoLibraryFilters.js';
import { MemoLibraryRow } from './MemoLibraryRow.js';
import type { MemoText } from './ui.js';

export interface MemoLibraryProps {
  tr: MemoText; locale: string | undefined; now: number;
  notes: MemoNote[]; active: string | null;
  selecting: boolean; selected: string[]; select: (ids: string[]) => void;
  query: MemoQuery; queryChange: (query: MemoQuery) => void;
  open: (id: string) => void;
  searchRef: RefObject<HTMLInputElement>;
  Scroll: MemoClientHost['Scroll'];
  className?: string;
}

interface Section { key: MemoGroupKey | null; notes: MemoNote[] }

function moveFocus(event: KeyboardEvent<HTMLUListElement>): void {
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
  const rows = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[data-memo-row]'));
  const at = rows.indexOf(document.activeElement as HTMLElement);
  if (at < 0) return;
  event.preventDefault();
  rows[Math.max(0, Math.min(rows.length - 1, at + (event.key === 'ArrowDown' ? 1 : -1)))]?.focus();
}

export function MemoLibrary(props: MemoLibraryProps): JSX.Element {
  const { tr, locale, now, notes, active, selecting, selected, select, query, queryChange, open, searchRef, Scroll, className = '' } = props;
  const [tag, setTag] = useState<string | null>(null);
  const shown = useMemo(() => tag ? notes.filter(note => note.tags.includes(tag)) : notes, [notes, tag]);
  const trash = query.view === 'trash';
  const sections = useMemo<Section[]>(() => trash ? [{ key: null, notes: shown }] : groupNotes(shown, now), [trash, shown, now]);
  const fresh = !query.q && !query.from && !query.until && !tag && query.view === 'recent';
  return <aside aria-label={tr('library')} className={`min-h-0 min-w-0 flex-col border-r border-gray-800 box-narrow:border-r-0 ${className}`}>
    <MemoLibraryFilters tr={tr} notes={notes} query={query} queryChange={queryChange} tag={tag} tagChange={setTag} searchRef={searchRef} />
    <Scroll fill className="min-h-0 flex-1">
      {shown.length === 0 ? <MemoLibraryEmpty tr={tr} fresh={fresh} /> : <ul data-select-scope="library" className="px-2 pb-2" onKeyDown={moveFocus}>
        {sections.map(section => <li key={section.key ?? 'all'} className="list-none">
          {section.key && <h3 className="px-2.5 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-gray-500">{tr(section.key === 'pinned' || section.key === 'today' ? section.key : `group.${section.key}`)}</h3>}
          <ul className="space-y-0.5">{section.notes.map(note => <MemoLibraryRow key={note.id} tr={tr} note={note} q={query.q} now={now} locale={locale}
            active={active === note.id} selecting={selecting} checked={selected.includes(note.id)} selectionFull={selected.length >= MEMO.selectionMax}
            toggle={on => select(on ? [...selected, note.id] : selected.filter(id => id !== note.id))} open={() => open(note.id)} />)}</ul>
        </li>)}
      </ul>}
    </Scroll>
    <div className="flex items-center justify-between gap-2 border-t border-gray-800 px-3 py-1.5 text-xs text-gray-500">
      <span>{tr('count', { count: shown.length })}</span>
      {selecting && <span>{tr('selected', { count: selected.length, max: MEMO.selectionMax })}</span>}
    </div>
  </aside>;
}
