import { useId, useState, type JSX, type KeyboardEvent } from 'react';
import { MEMO } from '../config.js';
import { IconX } from './icons.js';
import { FIELD, type MemoText } from './ui.js';

interface MemoTagsProps { tr: MemoText; tags: string[]; suggestions: string[]; locked: boolean; composing: () => boolean; change: (tags: string[]) => void }
export function MemoTags({ tr, tags, suggestions, locked, composing, change }: MemoTagsProps): JSX.Element {
  const [draft, setDraft] = useState('');
  // 같은 문서에 메모 창이 둘 뜨면 고정 id 는 서로의 후보 목록을 가리킨다.
  const listId = useId();
  const add = (raw: string): void => {
    if (tags.length >= MEMO.tagMax) return;
    const value = raw.trim().replace(/^#+/, '').slice(0, MEMO.tagLength);
    if (value && !tags.includes(value)) change([...tags, value]);
    setDraft('');
  };
  const keyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== 'Backspace' || draft || !tags.length || composing() || event.nativeEvent?.isComposing) return;
    change(tags.slice(0, -1));
  };
  const options = suggestions.filter(tag => !tags.includes(tag));
  return <section className="flex flex-wrap items-center gap-1.5" aria-label={tr('tags')}>
    {tags.map(tag => <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-gray-800 px-2.5 py-1 text-xs text-gray-200">
      #{tag}
      <button type="button" aria-label={tr('removeTag')} title={tr('removeTag')} disabled={locked} onClick={() => change(tags.filter(existing => existing !== tag))}
        className="rounded-full text-gray-400 hover:text-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400 disabled:opacity-50"><IconX className="h-3 w-3 shrink-0" /></button>
    </span>)}
    <form onSubmit={event => { event.preventDefault(); if (!locked) add(draft); }}>
      <input className={`${FIELD} w-32`} aria-label={tr('tags')} placeholder={tr('tagPlaceholder')} list={listId} value={draft} disabled={locked || tags.length >= MEMO.tagMax} onKeyDown={keyDown}
        onChange={event => { const value = event.target.value; if (value.endsWith(',')) add(value.slice(0, -1)); else setDraft(value); }} />
      <datalist id={listId}>{options.map(tag => <option key={tag} value={tag} />)}</datalist>
    </form>
  </section>;
}
