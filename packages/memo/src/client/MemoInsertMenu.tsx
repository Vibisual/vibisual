import { useEffect, useRef, useState, type ComponentType, type JSX, type ReactNode } from 'react';
import { MEMO } from '../config.js';
import { IconCalendar, IconClock, IconCode, IconHeading, IconLink, IconList, IconListChecks, IconListOrdered, IconMinus, IconQuote, IconTable } from './icons.js';
import type { InsertId } from './insertMenu.js';
import { MemoIconButton, type MemoText } from './ui.js';

const ICONS: Record<InsertId, ComponentType<{ className?: string }>> = {
  todo: IconListChecks, bullet: IconList, number: IconListOrdered, table: IconTable, h1: IconHeading, h2: IconHeading, h3: IconHeading,
  quote: IconQuote, code: IconCode, divider: IconMinus, link: IconLink, date: IconCalendar, time: IconClock,
};
const PANEL = 'rounded-xl border border-gray-700 bg-gray-900 shadow-xl';

interface MemoInsertMenuProps {
  tr: MemoText; items: readonly InsertId[]; pick: (id: InsertId) => void;
  /** 글 쓰는 칸이 화살표로 고르는 항목. 주면 단추는 Tab 순서에서 빠진다(포커스는 글 쓰는 칸에 남는다). */
  active?: number; hover?: (index: number) => void; className?: string;
}
export function MemoInsertMenu({ tr, items, pick, active, hover, className = '' }: MemoInsertMenuProps): JSX.Element {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' }); }, [active]);
  return <div ref={list} role="listbox" aria-label={tr('insert.open')}
    className={`scrollbar-thin max-h-72 w-56 max-w-[calc(100vw-2rem)] overflow-y-auto whitespace-normal p-1 text-sm leading-normal ${PANEL} ${className}`}>
    {items.map((id, index) => {
      const Icon = ICONS[id];
      return <button key={id} type="button" role="option" aria-selected={index === active} tabIndex={active === undefined ? 0 : -1}
        onMouseDown={event => event.preventDefault()} onMouseEnter={() => hover?.(index)} onClick={() => pick(id)}
        className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400 pointer-coarse:py-2.5 ${index === active ? 'bg-gray-800 text-gray-100' : 'text-gray-300 hover:bg-gray-800 hover:text-gray-100'}`}>
        <Icon className="h-4 w-4 shrink-0 text-gray-400" /><span className="min-w-0 flex-1 truncate">{tr(`insert.${id}`)}</span>
      </button>;
    })}
  </div>;
}

interface MemoPopoverProps { label: string; icon: ReactNode; children: (close: () => void) => ReactNode }
/** 도구 줄 단추 아래로 펴지는 칸. 포커스가 밖으로 나가거나 Esc 를 누르면 닫힌다. */
export function MemoPopover({ label, icon, children }: MemoPopoverProps): JSX.Element {
  const [open, setOpen] = useState(false);
  return <div className="relative"
    onBlur={event => { if (!event.relatedTarget || !event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
    onKeyDown={event => { if (event.key === 'Escape' && open) { event.stopPropagation(); setOpen(false); } }}>
    <MemoIconButton label={label} pressed={open} aria-expanded={open} onClick={() => setOpen(value => !value)}>{icon}</MemoIconButton>
    {open && <div className="absolute left-0 top-full z-20 mt-1">{children(() => setOpen(false))}</div>}
  </div>;
}

interface MemoTablePickerProps { tr: MemoText; pick: (rows: number, cols: number) => void }
/** 칸 위로 지나가며 줄·열 수를 고른다. 줄 수는 머리 행을 포함한다. */
export function MemoTablePicker({ tr, pick }: MemoTablePickerProps): JSX.Element {
  const [size, setSize] = useState<{ rows: number; cols: number }>({ rows: MEMO.tableDefaultRows, cols: MEMO.tableDefaultCols });
  return <div className={`p-2 ${PANEL}`}>
    <div role="group" aria-label={tr('table.insert')} className="flex flex-col gap-0.5">
      {Array.from({ length: MEMO.tablePickRows }, (_, row) => <div key={row} className="flex gap-0.5">
        {Array.from({ length: MEMO.tablePickCols }, (_, col) => {
          const on = row < size.rows && col < size.cols;
          return <button key={col} type="button" aria-label={tr('table.size', { rows: row + 1, cols: col + 1 })}
            onMouseDown={event => event.preventDefault()} onMouseEnter={() => setSize({ rows: row + 1, cols: col + 1 })} onFocus={() => setSize({ rows: row + 1, cols: col + 1 })}
            onClick={() => pick(row + 1, col + 1)}
            className={`h-5 w-5 shrink-0 rounded-sm border focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400 pointer-coarse:h-7 pointer-coarse:w-7 ${on ? 'border-blue-400/70 bg-blue-500/30' : 'border-gray-700 bg-gray-800'}`} />;
        })}
      </div>)}
    </div>
    <p className="mt-2 whitespace-nowrap text-center text-xs text-gray-400">{tr('table.size', size)}</p>
  </div>;
}
