import type { IDEEditorFile } from '../../stores/graphStore.js';
import { splitRelPath, toRelativeFromRoot } from './explorerModel.js';

/** §5.5 #17-27 내장 편집창 순수 로직 — 여는 손잡이 3곳 공용 탭 만들기 · `Tab`/`Shift+Tab` · 밖에서 바뀌었는지 판정. */

/** 들여쓴 줄이 없는 파일의 기본 들여쓰기(저장소 규약). §5.5 #17-27 ⑲ 편집창은 파일이 쓰는 단위를 알아본다(`detectIndentUnit`). */
export const INDENT_UNIT = '  ';

/** 탭 한 칸 폭(VS Code 기본값). 편집창 두 층의 `tab-size` 와 같아야 하고, 탭 파일에서 `Shift+Tab` 이 스페이스를 몇 칸까지 걷을지도 이 값이다. */
export const EDITOR_TAB_SIZE = 4;

/** 텍스트 편집 결과 — 본문과 캐럿/선택 범위를 함께 돌려준다(둘 중 하나만 바뀌면 커서가 튄다). */
export interface EditResult {
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

/** 절대 경로 + 루트 → 탭. 여는 손잡이 셋(트리·편집한 파일 구역·도구 헤더)이 모두 이 함수를 쓴다 — 각자 다듬으면 같은 파일이 다른 탭으로 열린다. */
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

/** 경로를 폴더·파일 이름 두 토막으로 — 앞만 줄여야 이름이 보인다(통째 `truncate` 면 이름이 잘린다). */
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

/** 여러 줄이면 각 줄을 밀고, 아니면 캐럿 자리에 넣는다. `unit` 은 파일의 한 단계(`detectIndentUnit`), 없으면 기본값. */
export function applyIndent(text: string, start: number, end: number, unit: string = INDENT_UNIT): EditResult {
  if (!spansLines(text, start, end)) {
    return {
      text: `${text.slice(0, start)}${unit}${text.slice(end)}`,
      selectionStart: start + unit.length,
      selectionEnd: start + unit.length,
    };
  }

  const starts = lineStarts(text, start, end);
  let next = text;
  // 뒤에서부터 넣어야 앞 줄의 삽입이 뒤 줄의 위치를 밀지 않는다.
  for (const pos of [...starts].reverse()) {
    next = `${next.slice(0, pos)}${unit}${next.slice(pos)}`;
  }
  return {
    text: next,
    selectionStart: start + unit.length,
    selectionEnd: end + unit.length * starts.length,
  };
}

/** 앞 공백을 한 단계까지 뺀다 — 탭으로 시작하면 탭 하나, 아니면 스페이스를 한 단계 폭까지(탭 단위면 `EDITOR_TAB_SIZE` 칸). */
export function applyDedent(text: string, start: number, end: number, unit: string = INDENT_UNIT): EditResult {
  const starts = lineStarts(text, start, end);
  const spaceLimit = unit === '\t' ? EDITOR_TAB_SIZE : unit.length;
  let next = text;
  let removedBeforeStart = 0;
  let removedTotal = 0;

  for (const pos of [...starts].reverse()) {
    let width = 0;
    if (next[pos] === '\t') width = 1;
    else while (width < spaceLimit && next[pos + width] === ' ') width += 1;
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

/** 같은 이름의 파일이 여럿이면 상위 폴더 한 겹을 덧붙인다(`a/index.ts`, `b/index.ts`). */
export function tabLabels(files: readonly IDEEditorFile[]): Record<string, string> {
  // §5.5 #17-27 ⑱ — 빈 탭은 파일이 아니다. 이름이 비어 있어 둘 이상이면 서로를 "같은 이름"으로 세고,
  //   라벨은 화면이 갈래로 짓는다(여기서 지으면 번역을 모르는 계산이 문구를 정하게 된다).
  const named = files.filter((f) => f.opener === undefined);
  const count = new Map<string, number>();
  for (const f of named) count.set(f.name, (count.get(f.name) ?? 0) + 1);

  const labels: Record<string, string> = {};
  for (const f of named) {
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
