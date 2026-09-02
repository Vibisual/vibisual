/**
 * diffTool.ts — Edit 계열 도구(Edit/MultiEdit/Write/NotebookEdit) input(JSON) → 좌우 비교 diff 파생(순수 로직).
 *
 * StreamRenderer 의 ToolBlock 은 종전에 도구 input/output 을 raw `<pre>` 로만 보여줬다 → "이전 코드 vs 고친 코드"
 * 비교가 안 보여 답답했다. 여기서 old_string/new_string 을 라인 단위 LCS 로 정렬해(추가=초록·삭제=빨강),
 * 변경된 라인 쌍은 단어 단위 LCS 로 바뀐 토큰만 강조하는 side-by-side diff 행 배열을 만든다.
 *
 * React/DOM 의존 없는 순수 함수 → diffTool.test.ts 로 단독 검증. 렌더는 DiffView.tsx.
 */

// ─── 알고리즘 상한 (거대 diff 방어 — 초과 시 naive 전량-삭제+전량-추가 폴백) ───
const MAX_DP_CELLS = 1_200_000;

// ─── 타입 ───

// 도구 입력 모양은 **shared 가 안다**(§2.1 #3) — 종전에는 이 파일에만 있어서 서버 그래프가
// `MultiEdit`/`NotebookEdit` 를 아예 모르는 채로 살았다(버블·쓰기 화살표·수정 이력 0). 아래 이름은
// 이 모듈의 기존 사용처(DiffView·StreamRenderer·editorFollow)를 위한 별칭이다.
export type { EditToolHunk as EditHunk, EditToolMode as EditMode } from '@vibisual/shared';
export type { ParsedEditToolInput as ParsedEdit } from '@vibisual/shared';
import { parseEditToolInputJson, type ParsedEditToolInput } from '@vibisual/shared';

/**
 * §5.5 #17-12 — 이 편집이 몇 줄짜리인지(자동 펼침 판정용 어림값).
 * 조각마다 이전/이후 중 큰 쪽 줄 수를 더한다 — LCS 를 돌리지 않고도 "긴 diff 인가"를 가릴 수 있다.
 */
export function editSizeLines(parsed: ParsedEditToolInput): number {
  let total = 0;
  for (const h of parsed.hunks) {
    const oldLines = h.oldText === '' ? 0 : h.oldText.split('\n').length;
    const newLines = h.newText === '' ? 0 : h.newText.split('\n').length;
    total += Math.max(oldLines, newLines);
  }
  return total;
}

export interface DiffLine {
  /** 파일 내 라인 번호(1-base). filler 쪽은 null. */
  no: number | null;
  text: string;
}

export type DiffRowType = 'equal' | 'replace' | 'delete' | 'insert';

/** 변경 라인 안의 토큰 조각 — changed=true 면 바뀐 부분(강조). */
export interface WordSpan {
  text: string;
  changed: boolean;
}

/** side-by-side 한 행 — left=이전(빨강 계열), right=이후(초록 계열). null=filler. */
export interface DiffRow {
  type: DiffRowType;
  left: DiffLine | null;
  right: DiffLine | null;
  /** type==='replace' 일 때만: 좌/우 라인의 단어 단위 강조 조각. */
  leftSpans?: WordSpan[];
  rightSpans?: WordSpan[];
}

// ─── 입력 파싱 ───

/**
 * 도구 이름 + input(JSON 문자열) → ParsedEdit. Edit 계열이 아니거나 JSON 파싱 실패(스트리밍 중 미완성 등)면 null.
 *
 * 모양을 아는 것은 shared `parseEditToolInputJson` 하나다 — 서버 그래프(`recordFileEdit`)도 같은
 * 파서를 본다. 여기 다시 분해하면 도구 입력이 바뀔 때 **한쪽만 고쳐져** 캔버스와 IDE 가 어긋난다.
 */
export const parseEditToolInput = parseEditToolInputJson;

// ─── 시퀀스 LCS diff (라인·단어 공용) ───

interface SeqOp {
  kind: 'equal' | 'delete' | 'insert';
  value: string;
}

/** 두 문자열 시퀀스의 LCS 기반 diff. 셀 수가 상한 초과면 naive(전량 삭제 후 전량 추가)로 폴백. */
function diffSeq(a: string[], b: string[]): SeqOp[] {
  const n = a.length;
  const m = b.length;
  if (n === 0) return b.map((value) => ({ kind: 'insert', value }));
  if (m === 0) return a.map((value) => ({ kind: 'delete', value }));
  if (n * m > MAX_DP_CELLS) {
    return [
      ...a.map((value): SeqOp => ({ kind: 'delete', value })),
      ...b.map((value): SeqOp => ({ kind: 'insert', value })),
    ];
  }

  // dp[i][j] = LCS 길이(a[i..], b[j..]).
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }

  const ops: SeqOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push({ kind: 'equal', value: a[i]! }); i++; j++; }
    else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) { ops.push({ kind: 'delete', value: a[i]! }); i++; }
    else { ops.push({ kind: 'insert', value: b[j]! }); j++; }
  }
  while (i < n) { ops.push({ kind: 'delete', value: a[i]! }); i++; }
  while (j < m) { ops.push({ kind: 'insert', value: b[j]! }); j++; }
  return ops;
}

/** 텍스트 → 라인 배열. 끝의 개행으로 생기는 빈 라인 1개는 제거(git diff 스타일). */
function toLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** 라인 → 단어/공백 토큰. 공백도 토큰으로 보존(경계 정확도). */
function tokenizeWords(line: string): string[] {
  return line.split(/(\s+)/).filter((t) => t !== '');
}

/** 변경 라인 쌍의 단어 단위 강조 — 이전(left)의 삭제 토큰·이후(right)의 추가 토큰만 changed=true. */
function computeWordSpans(oldLine: string, newLine: string): { left: WordSpan[]; right: WordSpan[] } {
  const ops = diffSeq(tokenizeWords(oldLine), tokenizeWords(newLine));
  const left: WordSpan[] = [];
  const right: WordSpan[] = [];
  for (const op of ops) {
    if (op.kind === 'equal') {
      left.push({ text: op.value, changed: false });
      right.push({ text: op.value, changed: false });
    } else if (op.kind === 'delete') {
      left.push({ text: op.value, changed: true });
    } else {
      right.push({ text: op.value, changed: true });
    }
  }
  return { left, right };
}

/**
 * 이전/이후 텍스트 → side-by-side diff 행 배열.
 * 라인 LCS 로 equal/delete/insert 를 낸 뒤, 연속 삭제/추가 런을 나란히 짝지어 replace 행으로 압축(나머지는 순수 삭제/추가).
 */
export function computeLineDiff(oldText: string, newText: string): DiffRow[] {
  const ops = diffSeq(toLines(oldText), toLines(newText));
  const rows: DiffRow[] = [];
  let oldNo = 1;
  let newNo = 1;
  let delBuf: string[] = [];
  let insBuf: string[] = [];

  const flush = (): void => {
    const max = Math.max(delBuf.length, insBuf.length);
    for (let k = 0; k < max; k++) {
      const d = k < delBuf.length ? delBuf[k]! : null;
      const ins = k < insBuf.length ? insBuf[k]! : null;
      if (d !== null && ins !== null) {
        const { left, right } = computeWordSpans(d, ins);
        rows.push({ type: 'replace', left: { no: oldNo++, text: d }, right: { no: newNo++, text: ins }, leftSpans: left, rightSpans: right });
      } else if (d !== null) {
        rows.push({ type: 'delete', left: { no: oldNo++, text: d }, right: null });
      } else if (ins !== null) {
        rows.push({ type: 'insert', left: null, right: { no: newNo++, text: ins } });
      }
    }
    delBuf = [];
    insBuf = [];
  };

  for (const op of ops) {
    if (op.kind === 'equal') {
      flush();
      rows.push({ type: 'equal', left: { no: oldNo++, text: op.value }, right: { no: newNo++, text: op.value } });
    } else if (op.kind === 'delete') {
      delBuf.push(op.value);
    } else {
      insBuf.push(op.value);
    }
  }
  flush();
  return rows;
}

/** ParsedEdit 요약 — 추가/삭제 라인 수(헤더 배지용). */
export function summarizeEdit(parsed: ParsedEditToolInput): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const h of parsed.hunks) {
    for (const row of computeLineDiff(h.oldText, h.newText)) {
      if (row.type === 'insert' || row.type === 'replace') added++;
      if (row.type === 'delete' || row.type === 'replace') removed++;
    }
  }
  return { added, removed };
}
