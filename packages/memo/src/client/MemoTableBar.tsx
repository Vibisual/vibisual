import type { JSX, MouseEvent, ReactNode } from 'react';
import { IconAlignCenter, IconAlignLeft, IconAlignRight, IconColMinus, IconColPlus, IconGrid, IconRowMinus, IconRowPlus, IconTable } from './icons.js';
import type { TableOp } from './tableEditing.js';
import { MemoButton, MemoIconButton, type MemoText } from './ui.js';

const OPS: readonly (readonly [TableOp, string, () => ReactNode, boolean])[] = [
  ['addRow', 'table.addRow', () => <IconRowPlus />, false], ['addCol', 'table.addCol', () => <IconColPlus />, false],
  ['deleteRow', 'table.deleteRow', () => <IconRowMinus />, true], ['deleteCol', 'table.deleteCol', () => <IconColMinus />, true],
  ['left', 'table.alignLeft', () => <IconAlignLeft />, false], ['center', 'table.alignCenter', () => <IconAlignCenter />, false], ['right', 'table.alignRight', () => <IconAlignRight />, false],
];
// 단추가 포커스를 가져가면 커서가 표를 떠나 이 줄이 사라진다.
const keepFocus = (event: MouseEvent): void => event.preventDefault();

interface MemoTableBarProps { tr: MemoText; run: (op: TableOp) => void; openGrid: () => void }
export function MemoTableBar({ tr, run, openGrid }: MemoTableBarProps): JSX.Element {
  return <div role="toolbar" aria-label={tr('table.tools')} className="flex flex-wrap items-center gap-1 border-t border-gray-800 px-3 py-1">
    <span className="mr-1 flex items-center gap-1.5 text-xs font-semibold text-gray-400"><IconTable className="h-3.5 w-3.5 shrink-0" />{tr('insert.table')}</span>
    <MemoButton variant="ghost" onMouseDown={keepFocus} onClick={openGrid} className="flex items-center gap-1.5 px-2 py-1 text-xs">
      <IconGrid className="h-3.5 w-3.5 shrink-0" />{tr('table.edit')}
    </MemoButton>
    {OPS.map(([op, label, icon, danger]) => <MemoIconButton key={op} label={tr(label)} tone={danger ? 'danger' : 'default'} onMouseDown={keepFocus} onClick={() => run(op)}
      className={op === 'left' ? 'ml-2' : ''}>{icon()}</MemoIconButton>)}
  </div>;
}
