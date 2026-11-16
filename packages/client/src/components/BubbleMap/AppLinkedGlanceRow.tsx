import { memo, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppLinkedSatellitesProps } from './AppLinkedSatellites.js';
import { useLinkedHover } from './AppLinkedHoverSurface.js';
import { AppLinkedGlanceTile } from './AppLinkedGlanceTile.js';
import { linkedGlancePage, type LinkedGlanceGroup } from './linkedGlancePage.js';

const CONTROL = 'nodrag nopan flex min-w-0 items-center justify-center gap-1 rounded px-1.5 py-1 text-[12px] leading-4 transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-1 focus-visible:outline-white/70 disabled:opacity-30';
const stop = (e: React.SyntheticEvent): void => e.stopPropagation();

export const AppLinkedGlanceRow = memo(function AppLinkedGlanceRow(p: AppLinkedSatellitesProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const { open, toggle } = useLinkedHover();
  const panelId = useId();
  const [group, setGroup] = useState<LinkedGlanceGroup>('scene');
  const [page, setPage] = useState(0);
  const model = linkedGlancePage(p.items, p.pastFiles, group, page);
  const [selected, setSelected] = useState<string | null>(null);
  if (model.total === 0) return null;
  const groupLabel = (kind: LinkedGlanceGroup, count: number): string => kind === 'scene'
    ? `${t('canvas.linkedItems.kind.scene')} ${count}`
    : t(kind === 'part' ? 'canvas.linkedItems.partsChip' : 'canvas.linkedItems.pastChip', { count });
  return (
    <div className="nodrag nopan absolute left-0 z-30 w-full pt-1.5 text-slate-200"
      onPointerDown={stop} onClick={stop} onDoubleClick={stop} onContextMenu={p.onContextMenu}
      style={{ top: p.nodeHeight }}>
      <button type="button" aria-label={t('canvas.linkedItems.rowLabel')} aria-expanded={open} aria-controls={panelId}
        title={t('canvas.linkedItems.rowLabel')} onClick={toggle}
        className={`${CONTROL} mx-auto border border-slate-500/40 bg-slate-950/95 text-slate-300`}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-3 w-3" aria-hidden="true"><path d="m3 6 9-4 9 4-9 4Zm0 6 9 4 9-4M3 18l9 4 9-4" /></svg>
        <span className="tabular-nums">{model.total}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3 w-3" aria-hidden="true"><path d={open ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'} /></svg>
      </button>
      {open ? (
        <div id={panelId} role="group" aria-label={t('canvas.linkedItems.rowLabel')}
          className="mt-1 w-full rounded-lg border border-slate-500/40 bg-slate-950/95 p-2 shadow-xl backdrop-blur-sm">
          <div className="mb-2 flex min-w-0 flex-wrap gap-0.5" role="group" aria-label={t('canvas.linkedItems.rowLabel')}>
            {model.groups.map((entry) => (
              <button key={entry.group} type="button" aria-pressed={entry.group === model.group}
                title={groupLabel(entry.group, entry.count)}
                className={`${CONTROL} flex-1 ${entry.group === model.group ? 'bg-white/15 text-white' : 'text-slate-400'}`}
                onClick={() => { setGroup(entry.group); setPage(0); }}>
                <span className="truncate">{groupLabel(entry.group, entry.count)}</span>
              </button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {model.items.map((item) => <AppLinkedGlanceTile key={item.id} item={item} owner={p} selected={selected === item.id}
              onSelect={() => { setSelected(item.id); if (item.stageFocus) p.onFocusItem?.(item.id); }} />)}
            {model.past.map((past) => <AppLinkedGlanceTile key={past.file} past={past} owner={p} />)}
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-1">
            <button type="button" className={CONTROL} disabled={model.page === 0} aria-label={t('canvas.bundle.previousPage')}
              onClick={() => setPage(model.page - 1)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg></button>
            <span className="text-[12px] tabular-nums text-slate-400" aria-live="polite">{model.page + 1} / {model.pages}</span>
            <button type="button" className={CONTROL} disabled={model.page + 1 >= model.pages} aria-label={t('canvas.bundle.nextPage')}
              onClick={() => setPage(model.page + 1)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg></button>
          </div>
        </div>
      ) : null}
    </div>
  );
});
