/**
 * §5.4 #30 v2.66 — 버블 북마크 / 단축키 점프 (언리얼 엔진 카메라 북마크 식).
 *
 * Alt + 1~0 : 현재 대상을 슬롯 N(0=10)에 지정.
 *             - IDE 오버레이가 열려 있으면 그 에이전트 + 현재 세션 탭을 `session` 북마크로,
 *             - 아니면 선택된 버블을 `bubble` 북마크로(소속 프로젝트 + 드릴다운 폴더 컨텍스트 포함).
 * 1~0       : 비입력 포커스에서 슬롯 N 으로 점프.
 *             - `bubble`: 프로젝트 전환 → (폴더면 enterFolderDeep) → focusOnNode + selectNode.
 *             - `session`: 프로젝트 전환 → focusOnNode(에이전트) → openIDEOverlay → setIDEActiveSession.
 *
 * - 영속화는 localStorage(`vibisual:bookmarks`) — tabPins/defaultSubAgents 와 동형. 서버/스냅샷/체크포인트 미관여.
 * - INPUT/TEXTAREA/contentEditable(xterm 터미널 helper textarea·IDE 입력창 포함) 포커스에서는 비활성.
 * - 키 판별은 레이아웃 독립 `e.code`(Digit0~9 / Numpad0~9).
 */

import { useEffect } from 'react';
import { useGraphStore, selectIDEOverlay } from '../stores/graphStore.js';

const BOOKMARKS_STORAGE_KEY = 'vibisual:bookmarks';

/** 버블(캔버스 노드) 북마크 — 점프 시 포커싱만. */
interface BubbleBookmark {
  kind: 'bubble';
  projectName: string;
  /** 드릴다운 폴더 컨텍스트(메인 캔버스면 null). */
  folderId: string | null;
  nodeId: string;
  label: string;
}

/** 세션 북마크 — 점프 시 에이전트 버블 포커싱 + IDE 창 해당 세션 탭 열기. */
interface SessionBookmark {
  kind: 'session';
  projectName: string;
  agentId: string;
  /** null = 메인 세션. */
  sessionId: string | null;
  label: string;
}

type Bookmark = BubbleBookmark | SessionBookmark;
type BookmarkMap = Record<string, Bookmark>;

/** 키('0'~'9') → 사람이 읽는 슬롯 번호('0' = 10). */
function slotLabel(key: string): string {
  return key === '0' ? '10' : key;
}

/** e.code 에서 슬롯 키('0'~'9')를 추출. 숫자가 아니면 null. */
function slotKeyFromCode(code: string): string | null {
  const m = /^(?:Digit|Numpad)([0-9])$/.exec(code);
  return m ? m[1]! : null;
}

function readMap(): BookmarkMap {
  try {
    const raw = window.localStorage.getItem(BOOKMARKS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as BookmarkMap;
  } catch {
    return {};
  }
}

function writeMap(map: BookmarkMap): void {
  try {
    window.localStorage.setItem(BOOKMARKS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* 저장 실패는 무시 — 북마크는 탐색 보조라 치명적 아님 */
  }
}

interface Params {
  onToast: (message: string, kind: 'success' | 'error') => void;
  /** i18n 메시지 빌더 — placeholder 치환은 호출자(BubbleMap)에서. */
  messages: {
    assigned: (slot: string, label: string) => string;
    assignEmpty: string;
    jumped: (label: string) => string;
    jumpEmpty: (slot: string) => string;
    jumpMissing: string;
  };
}

export function useBookmarks({ onToast, messages }: Params): void {
  useEffect(() => {
    function isEditableTarget(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return true;
      return false;
    }

    /** 키 이벤트가 IDE 오버레이 DOM 안에서 일어났는지(=사용자가 IDE 를 보고 있는지). */
    function isInIDE(target: EventTarget | null): boolean {
      return target instanceof HTMLElement && !!target.closest('[data-ide-overlay]');
    }

    function assign(slotKey: string, inIDE: boolean): void {
      const st = useGraphStore.getState();
      const ide = selectIDEOverlay(st);
      const nodeId = st.selectedNodeId ?? st.selectIntentId;
      let bm: Bookmark | null = null;

      const sessionBookmark = (): Bookmark | null => {
        if (!ide.agentId || !ide.projectId) return null;
        return {
          kind: 'session',
          projectName: ide.projectId,
          agentId: ide.agentId,
          sessionId: ide.activeSessionId,
          label: st.nodeMap[ide.agentId]?.label ?? ide.agentId,
        };
      };
      const bubbleBookmark = (): Bookmark | null => {
        if (!nodeId || !st.activeProject) return null;
        return {
          kind: 'bubble',
          projectName: st.activeProject,
          folderId: st.currentFolderId,
          nodeId,
          label: st.nodeMap[nodeId]?.label ?? nodeId,
        };
      };

      // 우선순위: (1) 포커스가 IDE 안 → 그 세션. (2) 캔버스에서 버블을 선택 중 → 그 버블
      //   (단지 도킹돼 있는 다른 에이전트 IDE 보다 "내가 고른 버블"이 우선 — 오캡처 방지).
      //   (3) 아무 선택 없이 IDE 만 열려 있으면 그 세션(폴백).
      if (inIDE) {
        bm = sessionBookmark() ?? bubbleBookmark();
      } else {
        bm = bubbleBookmark() ?? sessionBookmark();
      }

      if (!bm) {
        onToast(messages.assignEmpty, 'error');
        return;
      }
      const map = readMap();
      map[slotKey] = bm;
      writeMap(map);
      onToast(messages.assigned(slotLabel(slotKey), bm.label), 'success');
    }

    function jump(slotKey: string): void {
      const map = readMap();
      const bm = map[slotKey];
      if (!bm) {
        onToast(messages.jumpEmpty(slotLabel(slotKey)), 'error');
        return;
      }
      const store = useGraphStore.getState();
      const known = !!store.projects[bm.projectName] || !!store.stubProjects[bm.projectName];
      if (!known) {
        onToast(messages.jumpMissing, 'error');
        return;
      }

      if (bm.kind === 'session') {
        store.setActiveProject(bm.projectName);
        store.focusOnNode(bm.agentId);
        store.openIDEOverlay(bm.agentId);
        const subs = useGraphStore.getState().subAgents[bm.agentId] ?? [];
        if (bm.sessionId && subs.some((s) => s.id === bm.sessionId)) {
          store.setIDEActiveSession(bm.sessionId);
        } else {
          // 세션이 사라졌으면 메인 세션으로 폴백
          store.setIDEActiveSession(null);
        }
      } else {
        store.setActiveProject(bm.projectName);
        // 버블 북마크는 캔버스의 버블을 보여주는 용도 — 직전 세션 점프로 열린 IDE 오버레이가
        // 남아 캔버스를 가리지 않도록, 그 프로젝트의 IDE 창을 닫는다.
        store.closeIDEOverlay();
        if (bm.folderId) store.enterFolderDeep(bm.folderId);
        store.focusOnNode(bm.nodeId);
        store.selectNode(bm.nodeId);
      }
      onToast(messages.jumped(bm.label), 'success');
    }

    function handleKey(e: KeyboardEvent): void {
      if (e.ctrlKey || e.metaKey || e.shiftKey) return;
      const slotKey = slotKeyFromCode(e.code);
      if (slotKey === null) return;
      const editable = isEditableTarget(e.target);
      const inIDE = isInIDE(e.target);
      if (e.altKey) {
        // 지정: Alt+숫자는 일반 타이핑이 아니므로 IDE 안(터미널 textarea 등)에서도 허용 —
        //   단, IDE 가 아닌 일반 입력칸에서 타이핑 중이면 가로채지 않는다.
        if (editable && !inIDE) return;
        e.preventDefault();
        assign(slotKey, inIDE);
      } else {
        // 점프: 숫자 타이핑을 가로채지 않도록 입력칸 포커스면 비활성.
        if (editable) return;
        e.preventDefault();
        jump(slotKey);
      }
    }

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onToast, messages]);
}
