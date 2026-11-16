import { useEffect, useRef, useState, type JSX, type KeyboardEvent } from 'react';
import { MEMO } from '../config.js';
import { MemoDialog } from './MemoDialog.js';
import { IconAlignCenter, IconAlignLeft, IconAlignRight, IconColMinus, IconColPlus, IconRowMinus, IconRowPlus } from './icons.js';
import { cellSource, cellText, type TableAlign, type TableModel } from './tableEditing.js';
import { MemoButton, MemoIconButton, type MemoText } from './ui.js';

const NEXT_ALIGN: Record<'none' | 'left' | 'center' | 'right', TableAlign> = { none: 'left', left: 'center', center: 'right', right: null };
const CELL = 'border border-gray-800 p-0';
const CELL_INPUT = 'w-full min-w-28 bg-transparent px-2 py-1.5 text-sm text-gray-100 outline-none focus:bg-gray-800 box-narrow:min-w-20';

interface MemoTableDialogProps { tr: MemoText; table: TableModel; close: () => void; apply: (table: TableModel) => void }
/** 표를 입력 칸 격자로 펼쳐 고친다. 칸은 화면에서는 보이는 글자, 저장할 때는 '|' 를 이스케이프한 원문이다. */
export function MemoTableDialog({ tr, table, close, apply }: MemoTableDialogProps): JSX.Element {
  const [head, setHead] = useState(() => table.head.map(cellText));
  const [align, setAlign] = useState<TableAlign[]>(() => [...table.align]);
  const [rows, setRows] = useState(() => table.rows.map(row => row.map(cellText)));
  const [focus, setFocus] = useState<string | null>(null);
  const grid = useRef<HTMLTableElement>(null);
  // 새로 더한 행은 다음 그리기에야 생기므로 포커스를 그 뒤로 미룬다.
  useEffect(() => {
    if (focus === null) return;
    grid.current?.querySelector<HTMLInputElement>(`[data-cell="${focus}"]`)?.focus(); setFocus(null);
  }, [focus]);
  const cols = head.length;
  const setCell = (row: number, col: number, value: string): void => {
    if (row === 0) setHead(cells => cells.map((cell, i) => i === col ? value : cell));
    else setRows(all => all.map((cells, i) => i === row - 1 ? cells.map((cell, j) => j === col ? value : cell) : cells));
  };
  const addRow = (): void => setRows(all => [...all, head.map(() => '')]);
  const addCol = (): void => { setHead(cells => [...cells, '']); setAlign(cells => [...cells, null]); setRows(all => all.map(cells => [...cells, ''])); };
  const dropCol = (col: number): void => {
    setHead(cells => cells.filter((_, i) => i !== col)); setAlign(cells => cells.filter((_, i) => i !== col));
    setRows(all => all.map(cells => cells.filter((_, i) => i !== col)));
  };
  const keyDown = (event: KeyboardEvent<HTMLInputElement>, row: number, col: number): void => {
    if (event.nativeEvent?.isComposing) return;
    const step = event.key === 'Enter' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    const next = row + step;
    if (!step || next < 0) return;
    event.preventDefault();
    if (next > rows.length) {
      if (event.key !== 'Enter' || rows.length >= MEMO.tableMaxRows) return;
      addRow();
    }
    setFocus(`${next}:${col}`);
  };
  const input = (row: number, col: number, value: string): JSX.Element => <input data-cell={`${row}:${col}`} value={value}
    aria-label={row === 0 ? tr('table.header', { col: col + 1 }) : tr('table.cell', { row, col: col + 1 })}
    className={`${CELL_INPUT} ${row === 0 ? 'font-semibold' : ''} ${align[col] === 'center' ? 'text-center' : align[col] === 'right' ? 'text-right' : ''}`}
    onChange={event => setCell(row, col, event.target.value)} onKeyDown={event => keyDown(event, row, col)} />;
  return <MemoDialog title={tr('table.edit')} closeLabel={tr('close')} close={close} wide>
    <p className="mb-3 text-xs text-gray-500">{tr('table.gridHint')}</p>
    <div className="scrollbar-thin max-h-[60vh] overflow-auto">
      <table ref={grid} className="border-collapse text-sm">
        <thead>
          <tr>
            {head.map((_, col) => <th key={col} className="pb-1 font-normal"><div className="flex items-center justify-center">
              <MemoIconButton label={tr('table.align')} pressed={align[col] != null} onClick={() => setAlign(cells => cells.map((cell, i) => i === col ? NEXT_ALIGN[cell ?? 'none'] : cell))}>
                {align[col] === 'center' ? <IconAlignCenter /> : align[col] === 'right' ? <IconAlignRight /> : <IconAlignLeft />}
              </MemoIconButton>
              <MemoIconButton label={tr('table.deleteCol')} tone="danger" disabled={cols <= 1} onClick={() => dropCol(col)}><IconColMinus /></MemoIconButton>
            </div></th>)}
            <th className="pb-1 pl-1"><MemoIconButton label={tr('table.addCol')} disabled={cols >= MEMO.tableMaxCols} onClick={addCol}><IconColPlus /></MemoIconButton></th>
          </tr>
          <tr>{head.map((value, col) => <th key={col} className={`${CELL} bg-gray-800/40`}>{input(0, col, value)}</th>)}<th /></tr>
        </thead>
        <tbody>{rows.map((cells, row) => <tr key={row}>
          {cells.map((value, col) => <td key={col} className={CELL}>{input(row + 1, col, value)}</td>)}
          <td className="pl-1"><MemoIconButton label={tr('table.deleteRow')} tone="danger" onClick={() => setRows(all => all.filter((_, i) => i !== row))}><IconRowMinus /></MemoIconButton></td>
        </tr>)}</tbody>
      </table>
    </div>
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <MemoButton variant="ghost" disabled={rows.length >= MEMO.tableMaxRows} onClick={addRow} className="flex items-center gap-1.5 px-2 py-1.5 text-xs">
        <IconRowPlus className="h-3.5 w-3.5 shrink-0" />{tr('table.addRow')}
      </MemoButton>
      <span className="flex-1" />
      <MemoButton onClick={close}>{tr('cancel')}</MemoButton>
      <MemoButton variant="primary" onClick={() => apply({ head: head.map(cellSource), align, rows: rows.map(cells => cells.map(cellSource)) })}>{tr('table.apply')}</MemoButton>
    </div>
  </MemoDialog>;
}
