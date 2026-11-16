export interface TextEdit { value: string; start: number; end: number }

const LIST = /^(\s*)([-*+] \[[ xX]\] |[-*+] |\d+[.)] |> )/;
const LINE_PREFIX = /^(#{1,6} |[-*+] \[[ xX]\] |[-*+] |\d+[.)] |> )/;
const TASK_LINE = /^(\s*(?:[-*+]|\d{1,9}[.)])[ \t]+\[)([ xX])\]/;
const TASK_MARK = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+\[([ xX])\]/gm;
const ITEM_TASK = /^(?:[-*+]|\d{1,9}[.)])[ \t]+\[[ xX]\]/;
const URL_TEXT = /^(?:https?:\/\/|mailto:)\S+$/i;

export function lineStart(value: string, at: number): number { return value.lastIndexOf('\n', at - 1) + 1; }
export function lineEnd(value: string, at: number): number { const i = value.indexOf('\n', at); return i < 0 ? value.length : i; }

function nextMarker(marker: string): string {
  const num = /^(\d+)([.)] )$/.exec(marker);
  if (num) return `${Number(num[1]) + 1}${num[2]}`;
  if (/^[-*+] \[[ xX]\] $/.test(marker)) return `${marker[0]} [ ] `;
  return marker;
}

export function continueList(value: string, start: number, end: number): TextEdit | null {
  if (start !== end) return null;
  const ls = lineStart(value, start);
  const le = lineEnd(value, start);
  const m = LIST.exec(value.slice(ls, le));
  if (!m || start - ls < m[0].length) return null;
  const rest = value.slice(ls + m[0].length, le);
  if (!rest.trim()) return { value: value.slice(0, ls) + value.slice(le), start: ls, end: ls };
  const insert = `\n${m[1]}${nextMarker(m[2] ?? '')}`;
  const caret = start + insert.length;
  return { value: value.slice(0, start) + insert + value.slice(start), start: caret, end: caret };
}

/** 선택이 닿는 줄들의 [시작, 끝) — 선택이 줄바꿈 직후에서 끝나면 그 줄은 제외한다. */
function lineSpan(value: string, start: number, end: number): [number, number] {
  const last = end > start && value[end - 1] === '\n' ? end - 1 : end;
  return [lineStart(value, start), lineEnd(value, last)];
}

export function indentLines(value: string, start: number, end: number, outdent: boolean): TextEdit | null {
  const [ls, le] = lineSpan(value, start, end);
  const lines = value.slice(ls, le).split('\n');
  if (lines.length < 2 && !LIST.test(lines[0] ?? '')) return null;
  let firstDelta = 0;
  let total = 0;
  const next = lines.map((line, i) => {
    let delta = 2;
    let out = `  ${line}`;
    if (outdent) {
      const cut = line.startsWith('\t') ? 1 : /^ {1,2}/.exec(line)?.[0].length ?? 0;
      delta = -cut;
      out = line.slice(cut);
    }
    if (i === 0) firstDelta = delta;
    total += delta;
    return out;
  });
  const ns = start === ls && start !== end ? start : Math.max(ls, start + firstDelta);
  return { value: value.slice(0, ls) + next.join('\n') + value.slice(le), start: ns, end: Math.max(ns, end + total) };
}

export function wrapSelection(value: string, start: number, end: number, marker: string): TextEdit {
  const m = marker.length;
  const selected = value.slice(start, end);
  if (selected.length >= 2 * m && selected.startsWith(marker) && selected.endsWith(marker)) {
    return { value: value.slice(0, start) + selected.slice(m, selected.length - m) + value.slice(end), start, end: end - 2 * m };
  }
  // 한 글자 표식('*')은 '**' 굵게의 일부일 수 있어 바깥 글자가 같은 표식이면 벗기지 않는다.
  const nested = m === 1 && (value[start - 2] === marker || value[end + 1] === marker);
  if (!nested && start >= m && value.slice(start - m, start) === marker && value.slice(end, end + m) === marker) {
    return { value: value.slice(0, start - m) + selected + value.slice(end + m), start: start - m, end: end - m };
  }
  return { value: value.slice(0, start) + marker + selected + marker + value.slice(end), start: start + m, end: end + m };
}

/** keep 이면 이미 붙어 있어도 벗기지 않는다(삽입 목록은 뒤집기가 아니라 지정이다). */
export function toggleLinePrefix(value: string, start: number, end: number, prefix: string, keep = false): TextEdit {
  const [ls, le] = lineSpan(value, start, end);
  const lines = value.slice(ls, le).split('\n');
  const split = (line: string): [string, string, string] => {
    const indent = /^\s*/.exec(line)?.[0] ?? '';
    const rest = line.slice(indent.length);
    const marker = LINE_PREFIX.exec(rest)?.[0] ?? '';
    return [indent, marker, rest.slice(marker.length)];
  };
  const targets = lines.length > 1 ? lines.filter(line => line.trim()) : lines;
  const remove = !keep && targets.length > 0 && targets.every(line => split(line)[1] === prefix);
  let firstDelta = 0;
  let total = 0;
  const next = lines.map((line, i) => {
    let out = line;
    if (lines.length === 1 || line.trim()) {
      const [indent, , text] = split(line);
      out = indent + (remove ? '' : prefix) + text;
    }
    if (i === 0) firstDelta = out.length - line.length;
    total += out.length - line.length;
    return out;
  });
  const ns = Math.max(ls, start + firstDelta);
  return { value: value.slice(0, ls) + next.join('\n') + value.slice(le), start: ns, end: Math.max(ns, end + total) };
}

/** 선택한 줄을 체크박스로 만들고, 이미 전부 체크박스면 체크를 뒤집는다(하나라도 비었으면 전부 채운다). */
export function toggleTask(value: string, start: number, end: number): TextEdit {
  const [ls, le] = lineSpan(value, start, end);
  const lines = value.slice(ls, le).split('\n');
  const targets = lines.length > 1 ? lines.filter(line => line.trim()) : lines;
  if (targets.every(line => TASK_LINE.test(line))) {
    const mark = targets.every(line => TASK_LINE.exec(line)?.[2] !== ' ') ? ' ' : 'x';
    const next = lines.map(line => line.replace(TASK_LINE, `$1${mark}]`));
    return { value: value.slice(0, ls) + next.join('\n') + value.slice(le), start, end };
  }
  let firstDelta = 0;
  let total = 0;
  const next = lines.map((line, i) => {
    let out = line;
    if (!TASK_LINE.test(line) && (lines.length === 1 || line.trim())) {
      const indent = /^\s*/.exec(line)?.[0] ?? '';
      const rest = line.slice(indent.length);
      out = `${indent}- [ ] ${rest.slice(LINE_PREFIX.exec(rest)?.[0].length ?? 0)}`;
    }
    if (i === 0) firstDelta = out.length - line.length;
    total += out.length - line.length;
    return out;
  });
  const ns = Math.max(ls, start + firstDelta);
  return { value: value.slice(0, ls) + next.join('\n') + value.slice(le), start: ns, end: Math.max(ns, end + total) };
}

/** at 은 대괄호 안 글자의 자리다. 체크박스 표식이 아니면 null. */
export function flipTask(value: string, at: number): string | null {
  const mark = value[at];
  if (value[at - 1] !== '[' || value[at + 1] !== ']' || (mark !== ' ' && mark !== 'x' && mark !== 'X')) return null;
  return value.slice(0, at) + (mark === ' ' ? 'x' : ' ') + value.slice(at + 1);
}

/** offset 은 목록 항목 표식('-'·'1.')이 시작하는 자리다(Markdown 해석기가 주는 항목 위치). */
export function toggleTaskAt(value: string, offset: number): string | null {
  const m = ITEM_TASK.exec(value.slice(offset, offset + 32));
  return m ? flipTask(value, offset + m[0].length - 2) : null;
}

export function taskMarks(value: string): { at: number; checked: boolean }[] {
  const marks: { at: number; checked: boolean }[] = [];
  for (const m of value.matchAll(TASK_MARK)) marks.push({ at: m.index + m[0].length - 2, checked: m[1] !== ' ' });
  return marks;
}

export function moveLines(value: string, start: number, end: number, up: boolean): TextEdit | null {
  const [ls, le] = lineSpan(value, start, end);
  const block = value.slice(ls, le);
  if (up) {
    if (ls === 0) return null;
    const ps = lineStart(value, ls - 1);
    const shift = ps - ls;
    return { value: `${value.slice(0, ps)}${block}\n${value.slice(ps, ls - 1)}${value.slice(le)}`, start: start + shift, end: end + shift };
  }
  if (le >= value.length) return null;
  const ne = lineEnd(value, le + 1);
  const shift = ne - le;
  return { value: `${value.slice(0, ls)}${value.slice(le + 1, ne)}\n${block}${value.slice(ne)}`, start: start + shift, end: end + shift };
}

/**
 * 블록(표·코드·구분선)을 앞뒤 빈 줄과 함께 넣는다 — 앞 문단에 붙으면 '---' 는 제목 밑줄로, 표는 문단으로 읽힌다.
 * select 는 블록 시작 기준 선택 범위이고, 없으면 블록 다음 줄에 커서를 둔다.
 */
export function insertBlock(value: string, start: number, end: number, block: string, select?: readonly [number, number]): TextEdit {
  const before = value.slice(0, start);
  const after = value.slice(end);
  const lead = !before || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const trail = !after ? '\n' : after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
  const at = start + lead.length;
  const [from, to] = select ?? [block.length + 1, block.length + 1];
  return { value: before + lead + block + trail + after, start: at + from, end: at + to };
}

export function isUrl(text: string): boolean { return URL_TEXT.test(text); }

/** 선택을 링크로 감싼다. 주소를 모르면 채울 자리에 커서를 둔다. */
export function linkSelection(value: string, start: number, end: number, url = ''): TextEdit {
  const selected = value.slice(start, end);
  const bare = !url && isUrl(selected);
  const label = bare ? '' : selected;
  const href = bare ? selected : url;
  const text = `[${label}](${href})`;
  const caret = !label ? start + 1 : !href ? start + label.length + 3 : start + text.length;
  return { value: value.slice(0, start) + text + value.slice(end), start: caret, end: caret };
}

export function diffRange(before: string, after: string): { from: number; to: number; insert: string } {
  const limit = Math.min(before.length, after.length);
  let from = 0;
  while (from < limit && before[from] === after[from]) from++;
  // 서로게이트 쌍을 가르지 않도록 물러선다.
  if (from > 0 && /[\uD800-\uDBFF]/.test(before[from - 1] ?? '')) from--;
  let tail = 0;
  while (tail < limit - from && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++;
  if (tail > 0 && /[\uDC00-\uDFFF]/.test(before[before.length - tail] ?? '')) tail--;
  return { from, to: before.length - tail, insert: after.slice(from, after.length - tail) };
}
