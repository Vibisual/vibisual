// §5.5 #17-19 ⑧ — IDE 본문이 탐색기에서 끌어온 것을 **받는 손**.
//
// 자리는 둘뿐이다 — **가운데(대화)** 에 놓으면 경로 글자가 입력창에 들어가고, **오른쪽** 에 놓으면
// 그 파일이 편집창에서 열린다. 판정·미리보기 기하는 전부 `explorerDrag` 순수 함수가 하고 여기서는
// 이벤트만 받는다(#17-34 `useSplitDrop` 과 같은 분담).

import { useCallback, useEffect, useRef, useState, type DragEvent, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import {
  clearActiveWorkspaceDrag,
  decodeWorkspaceDrag,
  dragHasWorkspaceEntry,
  dragIsDirectory,
  dropBoxToPercent,
  resolveWorkspaceDropZone,
  workspaceDropBox,
  WORKSPACE_DRAG_MIME,
  type WorkspaceDropBoxPct,
  type WorkspaceDropZone,
} from './explorerDrag.js';
import { useIDEPaneKey } from './idePane.js';
import { useIDEProjectRoot } from './useIDEProjectRoot.js';
import { useInsertPathIntoInput } from './useInsertPathIntoInput.js';
import { openWorkspaceTarget } from './openWorkspaceTarget.js';

/** 편집창 패널을 찾는 표식 — 보이는 경계와 판정 경계를 같게 만들기 위한 것이다. */
export const EDITOR_PANE_ATTR = 'data-ide-editor-pane';

export interface WorkspaceEntryDropState {
  /** 지금 손을 떼면 일어날 일. `null` 이면 이 본문 위에 탐색기 짐이 없다. */
  zone: WorkspaceDropZone | null;
  /** 막힌 이유 — 지금은 하나뿐이다(폴더는 편집창에서 열 수 없다). */
  blocked: 'folder' | null;
  box: WorkspaceDropBoxPct | null;
}

export interface WorkspaceEntryDropHandlers {
  onDragEnter: (e: DragEvent<HTMLElement>) => void;
  onDragOver: (e: DragEvent<HTMLElement>) => void;
  onDragLeave: (e: DragEvent<HTMLElement>) => void;
  onDrop: (e: DragEvent<HTMLElement>) => void;
}

const IDLE: WorkspaceEntryDropState = { zone: null, blocked: null, box: null };

/**
 * @param contentRef 대화 + 편집창을 감싼 자리(활동바·사이드바는 빼야 한다 — 트리 위에서 끌고
 *                   다니는 동안 "입력창에 넣기" 띠가 뜨면 어디에 놓는 중인지 알 수 없다).
 * @param outerRef   미리보기 띠가 그려질 위치 기준 조상(본문). 비율 계산의 분모다.
 */
export function useWorkspaceEntryDrop(
  agentId: string,
  contentRef: RefObject<HTMLElement | null>,
  outerRef: RefObject<HTMLElement | null>,
): { state: WorkspaceEntryDropState; handlers: WorkspaceEntryDropHandlers } {
  const { t } = useTranslation();
  const [state, setState] = useState<WorkspaceEntryDropState>(IDLE);
  // 자식 위를 지날 때마다 leave 가 나므로 깊이를 세어 **정말 나갔을 때만** 미리보기를 걷는다.
  const depth = useRef(0);
  const rootPath = useIDEProjectRoot();
  const paneKey = useIDEPaneKey();
  const insertPath = useInsertPathIntoInput(agentId);

  const reset = useCallback(() => {
    depth.current = 0;
    setState((prev) => (prev.zone === null ? prev : IDLE));
  }, []);

  const onDragEnter = useCallback((e: DragEvent<HTMLElement>) => {
    if (!dragHasWorkspaceEntry(e.dataTransfer.types)) return;
    e.preventDefault();
    depth.current += 1;
  }, []);

  const onDragOver = useCallback((e: DragEvent<HTMLElement>) => {
    if (!dragHasWorkspaceEntry(e.dataTransfer.types)) return;
    e.preventDefault();
    const content = contentRef.current;
    const outer = outerRef.current;
    if (!content || !outer) return;
    const rect = content.getBoundingClientRect();
    // 편집창이 열려 있으면 **그 패널 자체**가 오른쪽 자리다(닫혀 있으면 오른쪽 끝 띠).
    const pane = content.querySelector<HTMLElement>(`[${EDITOR_PANE_ATTR}]`);
    const editorLeft = pane ? pane.getBoundingClientRect().left : null;
    const zone = resolveWorkspaceDropZone(rect, e.clientX, editorLeft);
    // 폴더는 편집창에서 열 수 없다 — 값을 못 읽는 지금도 **종류**로는 알 수 있다.
    const blocked = zone === 'editor' && dragIsDirectory(e.dataTransfer.types) ? 'folder' : null;
    e.dataTransfer.dropEffect = blocked ? 'none' : 'copy';
    const box = dropBoxToPercent(workspaceDropBox(rect, zone, editorLeft), rect, outer.getBoundingClientRect());
    setState((prev) => (
      prev.zone === zone && prev.blocked === blocked && prev.box?.leftPct === box.leftPct && prev.box?.widthPct === box.widthPct
        ? prev
        : { zone, blocked, box }
    ));
  }, [contentRef, outerRef]);

  // 드래그가 **여기서 끝나지 않고** 사라지는 길(Esc 취소·창 밖 드롭·금지 커서에서 놓기)에도 띠가
  // 얼어붙지 않게 — 드래그의 끝은 어디서 끝나든 window 까지 올라온다(#17-34 가 배운 그대로).
  useEffect(() => {
    if (state.zone === null) return;
    const clear = (): void => { reset(); };
    window.addEventListener('dragend', clear);
    window.addEventListener('drop', clear);
    return () => {
      window.removeEventListener('dragend', clear);
      window.removeEventListener('drop', clear);
    };
  }, [state.zone, reset]);

  const onDragLeave = useCallback((e: DragEvent<HTMLElement>) => {
    if (!dragHasWorkspaceEntry(e.dataTransfer.types)) return;
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) reset();
  }, [reset]);

  const onDrop = useCallback((e: DragEvent<HTMLElement>) => {
    if (!dragHasWorkspaceEntry(e.dataTransfer.types)) return;
    e.preventDefault();
    e.stopPropagation();
    const zone = state.zone;
    const blocked = state.blocked;
    reset();
    clearActiveWorkspaceDrag();
    if (!zone || blocked) return;
    const drag = decodeWorkspaceDrag(e.dataTransfer.getData(WORKSPACE_DRAG_MIME));
    if (!drag) return;

    if (zone === 'input') {
      insertPath(drag.absPath);
      return;
    }
    if (drag.isDirectory || !rootPath) return;
    // 실행 여부(`executable`)는 **일부러 싣지 않는다** — 끌어다 놓는 손짓으로 프로그램이 뜨면 놀란다.
    // 모르면 실행 갈래로 가지 않는다는 `openWorkspaceTarget` 의 규약을 그대로 쓴다(§5.13 (R-7)).
    void openWorkspaceTarget(
      { relPath: drag.relPath, absPath: drag.absPath, kind: 'file' },
      rootPath,
      t('ide.streamRenderer.pathLink.runFailed'),
      paneKey,
    );
  }, [state.zone, state.blocked, reset, insertPath, rootPath, paneKey, t]);

  return { state, handlers: { onDragEnter, onDragOver, onDragLeave, onDrop } };
}
