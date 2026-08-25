import { createContext, useContext, useMemo } from 'react';
import { useGraphStore, selectIDEPane, type IDEEditorFile, type IDEOverlayState, type IDEViewType } from '../../stores/graphStore.js';

// §5.5 #17-1 (판올림 번호 발급 대기) — **이 창이 누구인가**를 IDE 컴포넌트 나무에 흘리는 통로.
//
// 종전에는 IDE 창이 프로젝트당 하나였으므로 자식들이 전부 `selectIDEOverlay(s)`(= 활성 프로젝트의
// 슬롯 하나)를 직접 읽어도 문제가 없었다. 창이 여럿이 되는 순간 그 읽기는 **전부 남의 창을 볼 수도
// 있는** 코드가 된다 — 그래서 자기 슬롯 키를 컨텍스트로 받아 `useIDEPaneValue` 로 읽는다.
//
// 컨텍스트 밖(App·DetailPanel·BubbleNode·북마크 훅·오버레이 위젯 창)에서는 `paneKey` 가 null 이라
// 종전과 **한 줄도 다르지 않게** 활성 프로젝트의 주 창을 본다(선택자 `selectIDEPane` 이 그 폴백을 쥔다).

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

/**
 * 이 창이 보고 있는 프로젝트 이름. 슬롯에 프로젝트가 없으면(닫힌 창 등) 활성 탭으로 떨어진다 —
 * 종전 `selectIDEOverlay(s).projectId ?? s.activeProject` 관용구를 한 곳에 모은 것.
 */
export function useIDEPaneProjectName(): string | null {
  const paneKey = useIDEPaneKey();
  return useGraphStore((s) => selectIDEPane(s, paneKey).projectId ?? s.activeProject);
}

/** 콜백 안에서 지금 값을 한 번 읽을 때(구독 ❌). */
export function readIDEPane(paneKey: string | null): IDEOverlayState {
  return selectIDEPane(useGraphStore.getState(), paneKey);
}

export interface IDEPaneActions {
  openEditorFile: (file: IDEEditorFile) => void;
  closeEditorFile: (relPath: string) => void;
  setActiveEditorFile: (relPath: string | null) => void;
  setEditorFileDirty: (relPath: string, dirty: boolean) => void;
  setSession: (sessionId: string | null) => void;
  setActiveView: (view: IDEViewType) => void;
  toggleSidebar: () => void;
  close: () => void;
}

/**
 * **이 창에 매인** IDE 액션들 — 슬롯 키를 자동으로 실어 주므로 호출부는 종전과 같은 모양으로 부른다.
 *
 * 스토어 액션을 직접 집어 쓰면 키를 빠뜨리기 쉽고, 빠뜨리면 조용히 **맨 앞 창**을 고친다
 * (파일이 옆 창에서 열리는 부류의 버그 — 오류도 안 난다). 그래서 창 안에서는 이 묶음만 쓴다.
 */
export function useIDEPaneActions(): IDEPaneActions {
  const paneKey = useIDEPaneKey();
  return useMemo<IDEPaneActions>(() => ({
    openEditorFile: (file) => useGraphStore.getState().openIDEEditorFile(file, paneKey),
    closeEditorFile: (relPath) => useGraphStore.getState().closeIDEEditorFile(relPath, paneKey),
    setActiveEditorFile: (relPath) => useGraphStore.getState().setActiveIDEEditorFile(relPath, paneKey),
    setEditorFileDirty: (relPath, dirty) => useGraphStore.getState().setIDEEditorFileDirty(relPath, dirty, paneKey),
    setSession: (sessionId) => useGraphStore.getState().setIDEActiveSession(sessionId, paneKey),
    setActiveView: (view) => useGraphStore.getState().setIDEActiveView(view, paneKey),
    toggleSidebar: () => useGraphStore.getState().toggleIDESidebar(paneKey),
    close: () => useGraphStore.getState().closeIDEOverlay(paneKey),
  }), [paneKey]);
}
