import { useState, type JSX, type RefObject } from 'react';
import { MEMO } from '../config.js';
import type { MemoNote } from '../types.js';
import { IconCalendar, IconSearch, IconX } from './icons.js';
import { tagCounts, type MemoQuery } from './listView.js';
import { FIELD, INPUT, MemoButton, MemoIconButton, MemoSegmented, type MemoText } from './ui.js';

const VIEWS = ['today', 'recent', 'pinned', 'project', 'trash'] as const;

interface MemoLibraryFiltersProps {
  tr: MemoText; notes: readonly MemoNote[]; query: MemoQuery; queryChange: (query: MemoQuery) => void;
  tag: string | null; tagChange: (tag: string | null) => void; searchRef: RefObject<HTMLInputElement>;
}
export function MemoLibraryFilters({ tr, notes, query, queryChange, tag, tagChange, searchRef }: MemoLibraryFiltersProps): JSX.Element {
  const hasDates = Boolean(query.from || query.until);
  const [datesOpen, setDatesOpen] = useState(hasDates);
  const counts = tagCounts(notes).slice(0, MEMO.tagChipMax);
  // 고른 태그가 현재 목록에 없어도 해제할 칩은 남겨야 0건에 갇히지 않는다.
  const tags = tag && !counts.some(item => item.tag === tag) ? [{ tag, count: 0 }, ...counts] : counts;
  return <div className="space-y-2 p-2.5">
    <div className="flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-950/60 px-2.5 py-1 focus-within:border-blue-500">
      <IconSearch className="h-4 w-4 shrink-0 text-gray-500" />
      <input ref={searchRef} aria-label={tr('searchMemos')} placeholder={tr('search')} value={query.q} className={`${FIELD} flex-1`}
        onChange={event => queryChange({ ...query, q: event.target.value })}
        onKeyDown={event => { if (event.key === 'Escape' && query.q && !event.nativeEvent.isComposing) { event.stopPropagation(); queryChange({ ...query, q: '' }); } }} />
      {query.q && <MemoIconButton label={tr('clearSearch')} className="-mr-1.5 h-6 w-6" onClick={() => queryChange({ ...query, q: '' })}><IconX className="h-3.5 w-3.5" /></MemoIconButton>}
    </div>
    <div className="flex items-center gap-1">
      <div className="min-w-0 flex-1">
        <MemoSegmented value={query.view} label={tr('filter')} onChange={view => queryChange({ ...query, view })}
          options={VIEWS.map(view => ({ value: view, label: tr(view) }))} />
      </div>
      <MemoIconButton label={tr('dateFilter')} pressed={datesOpen} className={hasDates && !datesOpen ? 'text-blue-300' : ''} onClick={() => setDatesOpen(open => !open)}><IconCalendar /></MemoIconButton>
    </div>
    {datesOpen && <div className="flex flex-wrap items-end gap-2">
      <label className="min-w-0 flex-1 text-xs text-gray-400">{tr('from')}<input type="date" value={query.from} className={`${INPUT} mt-1 w-full`} onChange={event => queryChange({ ...query, from: event.target.value })} /></label>
      <label className="min-w-0 flex-1 text-xs text-gray-400">{tr('until')}<input type="date" value={query.until} className={`${INPUT} mt-1 w-full`} onChange={event => queryChange({ ...query, until: event.target.value })} /></label>
      {hasDates && <MemoButton variant="ghost" className="text-xs" onClick={() => queryChange({ ...query, from: '', until: '' })}>{tr('clearDates')}</MemoButton>}
    </div>}
    {tags.length > 0 && <div role="group" aria-label={tr('tagFilter')} className="flex flex-wrap gap-1">
      {tags.map(item => <button key={item.tag} type="button" aria-pressed={tag === item.tag} onClick={() => tagChange(tag === item.tag ? null : item.tag)}
        className={`max-w-full truncate rounded-full px-2 py-0.5 text-xs transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400 ${tag === item.tag ? 'bg-blue-500/15 text-blue-300' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}>#{item.tag}</button>)}
    </div>}
  </div>;
}
