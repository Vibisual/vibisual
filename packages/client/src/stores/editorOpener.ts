import { IDE_EDITOR_MAX_TABS, isEditorPaneFileKind } from '@vibisual/shared';
import type { EditorPaneFileKind } from '@vibisual/shared';
import type { IDEEditorFile } from './graphStore.js';

// SCENARIO.md §5.5 #17-27 ⑱ — **빈 탭**(판이 먼저, 파일은 그다음).
//
// 탭 줄 [우측 판] 목록에서 갈래를 고르거나 보기의 [파일 열기] 를 누르면 우측 판에 그 갈래의 빈 탭이
// 선다. 빈 탭은 파일 탭과 **같은 목록**(`editorFiles`)에 들어간다 — 그래야 ③ 의 상한 · ⑯ 의 세션별
// 접기 · [고정] · 판이 서는 판정(`paneOpen`)을 새 갈래 없이 그대로 탄다. 다른 점은 하나, `opener` 칸이다.
//
// 키(`relPath`)는 **실제 상대 경로가 될 수 없는 모양**으로 짓는다 — 우리 상대 경로는 정규화돼 앞에 `/`
// 가 붙지 않고 `//` 를 품지 않는다(`resolveWorkspacePath` · 탐색기 조립 규약). 그래도 갈래는 키를
// 읽어 판정하지 않는다: 언제나 `opener` 칸으로 본다(키 모양에 뜻을 싣는 순간 그것을 파싱하는 곳이 생긴다).
//
// 여기 있는 것은 전부 **순수 함수**다 — 스토어도 화면도 만지지 않으므로 단위 시험으로 못 박는다
// (`editorOpener.test.ts`, `editorTabScope.ts` 와 같은 규약).

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

/**
 * 창 사이를 건너온 탭 한 장을 다시 세운다(§5.5 #17-6 창 꺼내기·들이기의 짐). 갈래가 맞으면 키를 그 갈래의
 * 키로 바로잡고, 빈 탭 키 모양인데 갈래가 없거나 틀리면 버린다(`null`) — 경로가 아닌 키로 파일을 읽으러 가면
 * 판에 "읽기 오류" 만 남는다. 빈 탭이 아닌 것은 그대로 돌려준다.
 */
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
 * 그 갈래의 빈 탭을 세우고 앞으로 가져온다. 이미 있으면 **자리를 옮기지 않고** 그 탭을 고른다.
 *
 * @param after 이 탭 바로 오른쪽에 세운다(보기의 [파일 열기] — 보던 파일 옆). 없거나 못 찾으면 맨 뒤.
 *
 * 상한은 `openIDEEditorFile` 과 **같은 규율**이다 — 넘치면 저장할 것이 없는 가장 오래된 탭부터 밀리고
 * (고치던 파일은 남는다), 방금 세운 빈 탭은 밀리지 않는다.
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

/**
 * 빈 탭을 고른 파일로 채운다 — **같은 자리**에서 그 파일 탭이 된다.
 *
 * 그 파일이 이미 다른 탭으로 열려 있으면 빈 탭을 걷고 그 탭으로 간다(같은 파일이 두 탭이 되지 않게 —
 * ③ "같은 파일을 다시 누르면 그 탭이 활성화된다"). 빈 탭이 그 사이 사라졌으면(닫았거나 세션을 옮겼다)
 * `null` — 호출부가 평소 열기로 떨어진다(고른 손짓이 허공에 사라지지 않게).
 */
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
