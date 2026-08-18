import type { IDEEditorFile } from '../../stores/graphStore.js';
import { splitRelPath, toRelativeFromRoot } from './explorerModel.js';

/**
 * editorModel.ts — §5.5 #17-27 v4.87 내장 편집창의 순수 로직.
 *
 * 화면(JSX)과 통신(fetch)을 뺀 계산만 모아 둔다 — 여는 손잡이 3곳이 공유하는 **탭 만들기**,
 * `Tab`/`Shift+Tab` 의 들여쓰기 계산, 파일이 열린 채 밖에서 바뀌었는지 판정. 캐럿·선택 영역을
 * 다루는 계산은 화면에서 눈으로 확인하기 어려워, 단위 테스트로 못 박아 두는 편이 훨씬 촘촘하다.
 */

/** 한 단계 들여쓰기 폭(공백). 편집창은 탭 문자 대신 공백을 넣는다(우리 저장소 규약과 같다). */
export const INDENT_UNIT = '  ';

/** 텍스트 편집 결과 — 본문과 캐럿/선택 범위를 함께 돌려준다(둘 중 하나만 바뀌면 커서가 튄다). */
export interface EditResult {
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

/**
 * 절대 경로 + 루트 → 편집창 탭 하나.
 * 여는 손잡이(탐색기 트리 · 편집한 파일 구역 · 스트림의 도구 헤더)가 **모두 이 함수**를 쓴다 —
 * 세 곳이 각자 경로를 다듬으면 같은 파일이 서로 다른 탭으로 열린다.
 */
export function editorFileFromAbsPath(absPath: string, rootPath: string | null): IDEEditorFile {
  const normalized = absPath.replace(/\\/g, '/');
  const relPath = rootPath ? toRelativeFromRoot(normalized, rootPath) : normalized;
  return { relPath, absPath: normalized, name: splitRelPath(relPath).name };
}

/** 루트 기준 상대 경로 + 루트 → 편집창 탭 하나(탐색기 트리처럼 상대 경로만 아는 자리). */
export function editorFileFromRelPath(relPath: string, rootPath: string): IDEEditorFile {
  const base = rootPath.replace(/\\/g, '/').replace(/\/+$/, '');
  return { relPath, absPath: `${base}/${relPath}`, name: splitRelPath(relPath).name };
}

/**
 * 손잡이 줄에 적을 경로를 두 토막으로 — 앞(폴더까지) · 뒤(파일 이름).
 * 좁은 자리에서 **앞만 줄여야 파일 이름이 끝까지 보인다**(한 덩어리로 두고 `truncate` 하면
 * 잘리는 쪽이 하필 이름이라, 전체 경로를 적어 놓고도 무슨 파일인지 알 수 없게 된다).
 */
export function splitPathTail(fullPath: string): { head: string; tail: string } {
  const normalized = fullPath.replace(/\\/g, '/');
  const cut = normalized.lastIndexOf('/');
  if (cut < 0) return { head: '', tail: normalized };
  return { head: normalized.slice(0, cut + 1), tail: normalized.slice(cut + 1) };
}

/** 선택 범위가 걸친 줄들의 시작 위치(오름차순). 선택이 없으면 캐럿이 있는 줄 하나. */
function lineStarts(text: string, start: number, end: number): number[] {
  const firstStart = text.lastIndexOf('\n', start - 1) + 1;
  const starts: number[] = [firstStart];
  for (let i = firstStart; i < end; i += 1) {
    if (text[i] === '\n' && i + 1 <= end) starts.push(i + 1);
  }
  // 선택이 줄바꿈 바로 뒤에서 끝나면 그 빈 줄까지 잡히므로 마지막 항목이 end 를 넘지 않게 자른다.
  return starts.filter((s, idx) => idx === 0 || s < end);
}

/** 선택이 여러 줄에 걸쳐 있는가 — 한 줄이면 캐럿 자리에 공백을 넣고, 여러 줄이면 줄마다 민다. */
function spansLines(text: string, start: number, end: number): boolean {
  return end > start && text.slice(start, end).includes('\n');
}

/** `Tab` — 선택이 여러 줄이면 각 줄을 한 단계 밀고, 아니면 캐럿 자리에 들여쓰기를 넣는다. */
export function applyIndent(text: string, start: number, end: number): EditResult {
  if (!spansLines(text, start, end)) {
    return {
      text: `${text.slice(0, start)}${INDENT_UNIT}${text.slice(end)}`,
      selectionStart: start + INDENT_UNIT.length,
      selectionEnd: start + INDENT_UNIT.length,
    };
  }

  const starts = lineStarts(text, start, end);
  let next = text;
  // 뒤에서부터 넣어야 앞 줄의 삽입이 뒤 줄의 위치를 밀지 않는다.
  for (const pos of [...starts].reverse()) {
    next = `${next.slice(0, pos)}${INDENT_UNIT}${next.slice(pos)}`;
  }
  return {
    text: next,
    selectionStart: start + INDENT_UNIT.length,
    selectionEnd: end + INDENT_UNIT.length * starts.length,
  };
}

/** `Shift+Tab` — 선택이 걸친 줄(또는 캐럿 줄)의 앞 공백을 한 단계까지 뺀다. */
export function applyDedent(text: string, start: number, end: number): EditResult {
  const starts = lineStarts(text, start, end);
  let next = text;
  let removedBeforeStart = 0;
  let removedTotal = 0;

  for (const pos of [...starts].reverse()) {
    let width = 0;
    while (width < INDENT_UNIT.length && next[pos + width] === ' ') width += 1;
    if (width === 0 && next[pos] === '\t') width = 1;
    if (width === 0) continue;
    next = `${next.slice(0, pos)}${next.slice(pos + width)}`;
    removedTotal += width;
    if (pos < start) removedBeforeStart = width;
  }

  return {
    text: next,
    selectionStart: Math.max(0, start - removedBeforeStart),
    selectionEnd: Math.max(0, end - removedTotal),
  };
}

/** 저장할 것이 있는가 — 디스크에서 읽은 본문과 지금 본문이 다른가. */
export function isDirty(diskText: string, draftText: string): boolean {
  return diskText !== draftText;
}

/**
 * 탭에 적을 짧은 이름들 — 같은 이름의 파일이 여럿 열려 있으면 **상위 폴더 한 겹**을 덧붙여 가른다
 * (VS Code 가 `index.ts`, `index.ts` 를 `a/index.ts`, `b/index.ts` 로 구분해 주는 것과 같은 규칙).
 */
export function tabLabels(files: readonly IDEEditorFile[]): Record<string, string> {
  const count = new Map<string, number>();
  for (const f of files) count.set(f.name, (count.get(f.name) ?? 0) + 1);

  const labels: Record<string, string> = {};
  for (const f of files) {
    if ((count.get(f.name) ?? 0) <= 1) {
      labels[f.relPath] = f.name;
      continue;
    }
    const { dir } = splitRelPath(f.relPath);
    const parent = dir.split('/').filter(Boolean).pop();
    labels[f.relPath] = parent ? `${parent}/${f.name}` : f.name;
  }
  return labels;
}
