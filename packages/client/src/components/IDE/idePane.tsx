import { createContext, useContext, useMemo } from 'react';
import type { EditorPaneFileKind } from '@vibisual/shared';
import { useGraphStore, selectIDEPane, selectPaneProjectName, type IDEEditorFile, type IDEOverlayState, type IDEViewType } from '../../stores/graphStore.js';
import type { EditorLineRange } from './editorLineRange.js';

// §5.5 #17-1 — 이 창의 슬롯 키를 흘리는 통로(창이 여럿이라 `selectIDEOverlay(s)` 직접 읽기는 남의 창을 본다 — `useIDEPaneValue`).
// 컨텍스트 밖은 `paneKey` null → 활성 프로젝트 주 창(`selectIDEPane` 폴백).

export interface IDEPaneScope {
  /** 이 창의 슬롯 키. null 이면 컨텍스트 밖 — 활성 프로젝트의 주 창. */
  paneKey: string | null;
  /** 그 프로젝트의 창 중 몇 번째로 열렸는가(0부터). 처음 뜰 자리를 계단식으로 어긋내는 데 쓴다. */
  index: number;
}

const FALLBACK_SCOPE: IDEPaneScope = { paneKey: null, index: 0 };

const IDEPaneContext = createContext<IDEPaneScope>(FALLBACK_SCOPE);

export function IDEPaneProvider({
  paneKey,
  index,
  children,
}: {
  paneKey: string;
  index: number;
  children: React.ReactNode;
}): React.JSX.Element {
  const value = useMemo<IDEPaneScope>(() => ({ paneKey, index }), [paneKey, index]);
  return <IDEPaneContext.Provider value={value}>{children}</IDEPaneContext.Provider>;
}

export function useIDEPaneScope(): IDEPaneScope {
  return useContext(IDEPaneContext);
}

/** 이 창의 슬롯 키(컨텍스트 밖이면 null = 주 창). 액션에 그대로 넘긴다. */
export function useIDEPaneKey(): string | null {
  return useContext(IDEPaneContext).paneKey;
}

/** 이 창의 슬롯에서 값 하나를 읽는다 — 종전 `useGraphStore((s) => selectIDEOverlay(s).X)` 의 자리. */
export function useIDEPaneValue<T>(pick: (pane: IDEOverlayState) => T): T {
  const paneKey = useIDEPaneKey();
  return useGraphStore((s) => pick(selectIDEPane(s, paneKey)));
}

/** 이 창의 프로젝트 = 안 에이전트의 소속(§5.7 #26), 슬롯(`pane.projectId`)이 아니다 — 워크트리로 드릴다운해도 슬롯은 부모 탭이라 중단점·실행이 부모에 매인다. 판정은 `selectPaneProjectName`. */
export function useIDEPaneProjectName(): string | null {
  const paneKey = useIDEPaneKey();
  return useGraphStore((s) => selectPaneProjectName(s, paneKey));
}

/** 콜백 안에서 지금 값을 한 번 읽을 때(구독 ❌). */
export function readIDEPane(paneKey: string | null): IDEOverlayState {
  return selectIDEPane(useGraphStore.getState(), paneKey);
}

export interface IDEPaneActions {
  /** §5.5 #17-27 ⑬ (g) — `lines` 를 주면 편집창이 그 줄로 가서 칠한다(오류 줄·본문 링크와 같은 한 길). */
  openEditorFile: (file: IDEEditorFile, lines?: EditorLineRange | null) => void;
  /**
   * §5.5 #17-27 ⑱ — 그 갈래의 빈 탭을 이 창 우측 판에 세운다(이미 있으면 앞으로).
   * `after` 를 주면 그 탭 바로 오른쪽(보기의 [파일 열기]).
   */
  openPaneOpener: (kind: EditorPaneFileKind, after?: string | null) => void;
  /** §5.5 #17-27 ⑱ — 빈 탭을 고른 파일로 채운다(같은 자리에서 그 파일 탭이 된다). */
  fillPaneOpener: (openerKey: string, file: IDEEditorFile) => void;
  closeEditorFile: (relPath: string) => void;
  setActiveEditorFile: (relPath: string | null) => void;
  setEditorFileDirty: (relPath: string, dirty: boolean) => void;
  /** §5.5 #17-27 ⑯ — 탭 줄 [고정] 토글(켜면 세션을 옮겨도 지금 탭이 따라간다). */
  setEditorTabsPinned: (pinned: boolean) => void;
  setSession: (sessionId: string | null) => void;
  setActiveView: (view: IDEViewType) => void;
  toggleSidebar: () => void;
  /**
   * §5.5 #17-17 ⑪(k) — 무대(단계 지도)를 이 창 우측에 열고 닫는다.
   * 값을 안 주면 뒤집는다([뷰 보기]), 명시하면 그 값으로(무대의 [닫기]).
   */
  setStageOpen: (open?: boolean) => void;
  close: () => void;
}

/** 이 창에 매인 IDE 액션(슬롯 키 자동). 창 안에서는 이것만 — 스토어 액션 직접 호출은 키를 빠뜨리면 오류 없이 맨 앞 창을 고친다. */
export function useIDEPaneActions(): IDEPaneActions {
  const paneKey = useIDEPaneKey();
  return useMemo<IDEPaneActions>(() => ({
    openEditorFile: (file, lines) => useGraphStore.getState().openIDEEditorFile(file, paneKey, lines),
    openPaneOpener: (kind, after) => useGraphStore.getState().openIDEPaneOpener(kind, paneKey, after),
    fillPaneOpener: (openerKey, file) => useGraphStore.getState().fillIDEPaneOpener(openerKey, file, paneKey),
    closeEditorFile: (relPath) => useGraphStore.getState().closeIDEEditorFile(relPath, paneKey),
    setActiveEditorFile: (relPath) => useGraphStore.getState().setActiveIDEEditorFile(relPath, paneKey),
    setEditorFileDirty: (relPath, dirty) => useGraphStore.getState().setIDEEditorFileDirty(relPath, dirty, paneKey),
    setEditorTabsPinned: (pinned) => useGraphStore.getState().setIDEEditorTabsPinned(pinned, paneKey),
    setSession: (sessionId) => useGraphStore.getState().setIDEActiveSession(sessionId, paneKey),
    setActiveView: (view) => useGraphStore.getState().setIDEActiveView(view, paneKey),
    toggleSidebar: () => useGraphStore.getState().toggleIDESidebar(paneKey),
    setStageOpen: (open) => useGraphStore.getState().setIDEStageOpen(open, paneKey),
    close: () => useGraphStore.getState().closeIDEOverlay(paneKey),
  }), [paneKey]);
}
