import { MEMO } from './config.js';

type CellReader = (cell: Element) => string;

function span(cell: Element, name: string): number {
  const value = Number(cell.getAttribute(name));
  return Number.isSafeInteger(value) && value > 0 ? Math.min(value, MEMO.tableMaxCols) : 1;
}

function alignment(cell: Element): string {
  const align = cell.getAttribute('align') ?? /(?:^|;)\s*text-align\s*:\s*(left|center|right)\b/i.exec(cell.getAttribute('style') ?? '')?.[1];
  return align?.toLowerCase() === 'left' ? ':---' : align?.toLowerCase() === 'center' ? ':---:' : align?.toLowerCase() === 'right' ? '---:' : '---';
}

/** 병합된 칸은 첫 칸에 내용을 두고 나머지를 비워 행·열의 위치를 유지한다. */
export function clipboardTable(table: Element, read: CellReader): string {
  const rows: string[][] = [];
  const aligns: string[] = [];
  const remaining: number[] = [];
  for (const row of Array.from(table.querySelectorAll('tr')).filter(row => row.closest('table') === table)) {
    const values: string[] = [];
    let col = 0;
    const skip = (): void => { while ((remaining[col] ?? 0) > 0) { values[col] = ''; remaining[col]!--; col++; } };
    for (const cell of Array.from(row.children).filter(cell => /^(TH|TD)$/.test(cell.tagName))) {
      skip();
      const cols = span(cell, 'colspan'); const height = span(cell, 'rowspan');
      for (let offset = 0; offset < cols; offset++) {
        values[col] = offset === 0 ? read(cell).trim().replace(/\n+/g, '<br>') : '';
        aligns[col] ??= alignment(cell);
        remaining[col] = height - 1;
        col++;
      }
    }
    while (col < remaining.length) { if ((remaining[col] ?? 0) > 0) remaining[col]!--; values[col] ??= ''; col++; }
    if (values.length) rows.push(values);
  }
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  if (!width) return '';
  const line = (row: string[]): string => `| ${Array.from({ length: width }, (_, col) => row[col] ?? '').join(' | ')} |`;
  return [line(rows[0] ?? []), line(aligns), ...rows.slice(1).map(line)].join('\n');
}
