import { useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Vibi3DSnapshot } from '@vibisual/shared';
import { ScrollFade } from '../ScrollFade.js';

const ROW_HEIGHT = 44, VIEW_HEIGHT = 264, OVERSCAN = 3;
export function modelListRange(count: number, scrollTop: number, height = VIEW_HEIGHT): { start: number; end: number } {
  const start = Math.min(Math.max(0, count - 1), Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN));
  return { start, end: Math.min(count, start + Math.ceil(height / ROW_HEIGHT) + OVERSCAN * 2) };
}

/** Logical objects only; DOM rows remain bounded even when a kit has thousands of placements. */
export function Vibi3DObjectList({ nodes, selectedId, selectedIds, label: suppliedLabel, disabled, onSelect }: {
  nodes: Vibi3DSnapshot['nodes']; selectedId: string | null; disabled: boolean; onSelect: (id: string | null) => void;
  selectedIds?: string[]; label?: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const listId = useId();
  const [query, setQuery] = useState(''); const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(VIEW_HEIGHT); const rowsRef = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const selected = useMemo(() => new Set(selectedIds ?? (selectedId ? [selectedId] : [])), [selectedIds, selectedId]);
  const filtered = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return search ? nodes.filter(node => `${node.name} ${node.type} ${node.id}`.toLocaleLowerCase().includes(search)) : nodes;
  }, [nodes, query]);
  const { start, end } = modelListRange(filtered.length, scrollTop, height);
  const activeId = selectedIds ? cursor : selectedId;
  const activeVisible = filtered.slice(start, end).some(node => node.id === activeId);
  const label = suppliedLabel ?? t('panel.vibi3d.objects', { defaultValue: 'Objects' });
  const choose = (index: number, activate = true): void => {
    const node = filtered[index]; if (!node || disabled) return;
    setCursor(node.id); if (activate) onSelect(node.id);
    const scroll = rowsRef.current?.parentElement;
    if (scroll) {
      const top = index * ROW_HEIGHT;
      if (top < scroll.scrollTop) scroll.scrollTop = top;
      else if (top + ROW_HEIGHT > scroll.scrollTop + scroll.clientHeight) scroll.scrollTop = top + ROW_HEIGHT - scroll.clientHeight;
      setScrollTop(scroll.scrollTop);
    }
  };
  return <section className="mb-3 min-w-0 space-y-1 text-xs text-vb-code-fg" aria-label={label}>
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-1"><span className="truncate">{label}</span>
      <button type="button" disabled={disabled || !selected.size} className="rounded px-1 py-1 opacity-70 hover:bg-vb-sunken pointer-coarse:min-h-8" onClick={() => onSelect(null)}>
        {t('panel.vibi3d.scale.clearSelection')}</button></div>
    <input type="search" value={query} disabled={disabled} aria-label={t('panel.vibi3d.scale.searchObjects')}
      className="min-w-0 w-full rounded border border-vb-code-border bg-vb-sunken px-2 py-1 text-xs pointer-coarse:min-h-10"
      placeholder={t('panel.vibi3d.scale.searchObjects')} onChange={event => {
        setQuery(event.target.value); setScrollTop(0);
        if (rowsRef.current?.parentElement) rowsRef.current.parentElement.scrollTop = 0;
      }} />
    <div role="listbox" aria-label={label} aria-disabled={disabled} aria-multiselectable={selectedIds ? true : undefined} tabIndex={disabled ? -1 : 0}
      aria-activedescendant={activeVisible ? `${listId}-${activeId}` : undefined}
      className="min-w-0 rounded border border-vb-code-border bg-vb-sunken focus-visible:outline focus-visible:outline-1"
      onKeyDown={event => {
        const current = filtered.findIndex(node => node.id === (selectedIds ? cursor : selectedId));
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? filtered.length - 1
          : event.key === 'ArrowDown' ? Math.min(filtered.length - 1, current + 1)
            : event.key === 'ArrowUp' ? Math.max(0, current - 1) : null;
        if (next !== null) { event.preventDefault(); choose(next, !selectedIds); }
        else if (selectedIds && (event.key === ' ' || event.key === 'Enter')) { event.preventDefault(); choose(Math.max(0, current)); }
      }}>
      <ScrollFade maxHeight={VIEW_HEIGHT} onViewport={viewport => { setScrollTop(viewport.scrollTop); setHeight(viewport.clientHeight || VIEW_HEIGHT); }}>
        <div ref={rowsRef} className="relative min-w-0" style={{ height: filtered.length * ROW_HEIGHT }}>
          {filtered.slice(start, end).map((node, offset) => <button key={node.id} id={`${listId}-${node.id}`} type="button" role="option" aria-selected={selected.has(node.id)}
            aria-posinset={start + offset + 1} aria-setsize={filtered.length} disabled={disabled} tabIndex={-1} title={`${node.name || node.type} · ${node.id}`}
            className={`absolute left-0 flex w-full min-w-0 items-center gap-1 px-2 text-left text-xs pointer-coarse:min-h-11 ${selected.has(node.id) ? 'bg-vb-code-border font-medium' : 'hover:bg-vb-code-border'} ${selectedIds && cursor === node.id ? 'outline outline-1 -outline-offset-1' : ''}`}
            style={{ top: (start + offset) * ROW_HEIGHT, height: ROW_HEIGHT }} onClick={() => choose(start + offset)}>
            <span className="min-w-0 flex-1 truncate">{node.name || node.type}</span>
            <span className="shrink-0 truncate text-xs opacity-60 box-narrow:max-w-16">{node.type}</span>
          </button>)}
        </div>
      </ScrollFade>
    </div>
    {!filtered.length && <p className="opacity-70">{t('panel.vibi3d.scale.noObjects')}</p>}
    <p className="truncate opacity-70">{t('panel.vibi3d.scale.objectCount', { count: filtered.length })}</p>
  </section>;
}
