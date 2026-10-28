import { IDE_EDITOR_MAX_TABS, isEditorPaneFileKind } from '@vibisual/shared';
import type { EditorPaneFileKind } from '@vibisual/shared';
import type { IDEEditorFile } from './graphStore.js';

// §5.5 #17-27 ⑱ — 빈 탭(판이 먼저, 파일은 그다음). 파일 탭과 같은 목록(`editorFiles`)이라 ③ 상한·⑯ 접기·[고정]·`paneOpen` 을 그대로 탄다.
// 키(`relPath`)는 실제 상대 경로가 될 수 없는 모양이지만, 갈래는 언제나 `opener` 칸으로 판정한다 — 키에 뜻을 실으면 파싱하는 곳이 생긴다.

/** 빈 탭 키의 머리 — 실제 상대 경로는 이것으로 시작할 수 없다. */
const OPENER_KEY_PREFIX = '//opener/';

/** 그 갈래 빈 탭의 키. 창 하나에 갈래마다 하나뿐이다(같은 갈래를 또 고르면 그 탭이 앞으로 온다). */
export function editorOpenerKey(kind: EditorPaneFileKind): string {
  return `${OPENER_KEY_PREFIX}${kind}`;
}

/** 그 갈래의 빈 탭 한 장. 경로·이름이 없다 — 라벨은 화면이 갈래로 짓는다. */
export function editorOpenerTab(kind: EditorPaneFileKind): IDEEditorFile {
  return { relPath: editorOpenerKey(kind), absPath: '', name: '', opener: kind };
}

/** 빈 탭인가 — 판정은 언제나 `opener` 칸이다(키를 읽지 않는다). */
export function isEditorOpenerTab(file: IDEEditorFile | null | undefined): boolean {
  return !!file && file.opener !== undefined;
}

/** 창 사이를 건너온 탭을 다시 세운다(§5.5 #17-6). 빈 탭 키 모양인데 갈래가 없거나 틀리면 `null` — 키로 파일을 읽으러 가면 "읽기 오류"만 남는다. */
export function coerceEditorOpenerTab(file: IDEEditorFile, rawOpener: unknown): IDEEditorFile | null {
  if (isEditorPaneFileKind(rawOpener)) return editorOpenerTab(rawOpener);
  return file.relPath.startsWith(OPENER_KEY_PREFIX) ? null : file;
}

/** 탭 목록과 활성 탭 — 스토어의 `editorFiles` · `activeEditorPath` 짝. */
export interface EditorTabsState {
  files: IDEEditorFile[];
  activePath: string | null;
}

/**
 * 그 갈래의 빈 탭을 세우고 앞으로 가져온다(이미 있으면 자리를 안 옮기고 고른다). `after` 오른쪽에, 없으면 맨 뒤.
 * 상한은 `openIDEEditorFile` 과 같은 규율 — 방금 세운 빈 탭은 밀리지 않는다.
 */
export function openEditorOpener(
  files: readonly IDEEditorFile[],
  kind: EditorPaneFileKind,
  after?: string | null,
): EditorTabsState {
  const key = editorOpenerKey(kind);
  if (files.some((f) => f.relPath === key)) return { files: [...files], activePath: key };

  const tab = editorOpenerTab(kind);
  const at = after ? files.findIndex((f) => f.relPath === after) : -1;
  let next = at >= 0
    ? [...files.slice(0, at + 1), tab, ...files.slice(at + 1)]
    : [...files, tab];
  if (next.length > IDE_EDITOR_MAX_TABS) {
    const victim = next.find((f) => !f.dirty && f.relPath !== key);
    if (victim) next = next.filter((f) => f.relPath !== victim.relPath);
  }
  return { files: next, activePath: key };
}

/** 빈 탭을 고른 파일로 같은 자리에서 채운다. 이미 다른 탭에 열려 있으면 빈 탭을 걷고 그 탭으로(③). 빈 탭이 사라졌으면 `null` — 호출부가 평소 열기로. */
export function fillEditorOpener(
  files: readonly IDEEditorFile[],
  openerKey: string,
  file: IDEEditorFile,
): EditorTabsState | null {
  const idx = files.findIndex((f) => f.relPath === openerKey && isEditorOpenerTab(f));
  if (idx < 0) return null;
  const opened = files.some((f) => !isEditorOpenerTab(f) && f.relPath === file.relPath);
  if (opened) return { files: files.filter((_, i) => i !== idx), activePath: file.relPath };
  const next = [...files];
  next[idx] = { relPath: file.relPath, absPath: file.absPath, name: file.name };
  return { files: next, activePath: file.relPath };
}
