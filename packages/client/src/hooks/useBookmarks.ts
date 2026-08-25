/**
 * §5.4 #30 v2.66 — 버블 북마크 / 단축키 점프 (언리얼 엔진 카메라 북마크 식).
 *
 * Alt + 1~0 : 현재 대상을 슬롯 N(0=10)에 지정.
 *             - IDE 오버레이가 열려 있으면 그 에이전트 + 현재 세션 탭을 `session` 북마크로,
 *             - 아니면 선택된 버블을 `bubble` 북마크로(소속 프로젝트 + 드릴다운 폴더 컨텍스트 포함).
 * 1~0       : 비입력 포커스에서 슬롯 N 으로 점프.
 *             - `bubble`: 프로젝트 전환 → (폴더면 enterFolderDeep) → focusOnNode + selectNode.
 *             - `session`: 프로젝트 전환 → focusOnNode(에이전트) → openIDEOverlay → setIDEActiveSession.
 *             - **생존 게이트**: 대상 노드가 지금 스냅샷에 없으면 아무 상태도 바꾸지 않고 토스트만
 *               (`resolveJumpTarget` — 사라진 대상으로 점프해 도킹 슬롯만 남던 빈 도크 방지).
 *
 * - 영속화는 localStorage(`vibisual:bookmarks`) — tabPins/defaultSubAgents 와 동형. 서버/스냅샷/체크포인트 미관여.
 * - INPUT/TEXTAREA/contentEditable(xterm 터미널 helper textarea·IDE 입력창 포함) 포커스에서는 비활성.
 * - 키 판별은 레이아웃 독립 `e.code`(Digit0~9 / Numpad0~9).
 */

import { useEffect } from 'react';
import { useGraphStore, selectIDEOverlay } from '../stores/graphStore.js';

const BOOKMARKS_STORAGE_KEY = 'vibisual:bookmarks';

/** 버블(캔버스 노드) 북마크 — 점프 시 포커싱만. */
export interface BubbleBookmark {
  kind: 'bubble';
  projectName: string;
  /** 드릴다운 폴더 컨텍스트(메인 캔버스면 null). */
  folderId: string | null;
  nodeId: string;
  label: string;
}

/** 세션 북마크 — 점프 시 에이전트 버블 포커싱 + IDE 창 해당 세션 탭 열기. */
export interface SessionBookmark {
  kind: 'session';
  projectName: string;
  agentId: string;
  /** null = 메인 세션. */
  sessionId: string | null;
  label: string;
}

export type Bookmark = BubbleBookmark | SessionBookmark;
type BookmarkMap = Record<string, Bookmark>;

/** 점프 판정 결과 — `ok` 면 이동, 아니면 토스트만 내고 상태는 그대로 둔다. */
export type JumpDecision =
  | { ok: true; stub: boolean }
  | { ok: false; reason: 'unknown-project' | 'missing-target' };

/**
 * §5.4 #30 (C) **출처 생존 게이트** — "지금 갈 수 있는 자리인가"를 순수 함수로 판정한다.
 *
 * `session` 점프는 `openIDEOverlay` 가 **열려 있던 도킹 슬롯의 agentId 를 갈아끼운다**. 대상 에이전트가
 * 스냅샷에 없으면 `AgentIDEOverlay` 는 `null` 을 반환하는데 슬롯은 도킹으로 남아, **도크 폭만 예약된
 * 빈 칸**이 캔버스를 가렸다(사용자 보고: "북마크 숫자키를 눌렀더니 켜둔 IDE 가 제대로 안 닫히고
 * 화면을 가린다"). 그래서 이동 전에 대상 노드의 생존을 먼저 본다 — §5.5 #17-7 v2.96 IDE 북마크의
 * 생존 게이트와 **같은 규약·같은 산식**(`nodeMap` 하나).
 *
 * stub(미hydrate) 프로젝트는 노드가 애초에 스냅샷에 실리지 않으므로 게이트를 적용하지 않는다 —
 * 적용하면 "아직 안 연 프로젝트로는 영영 못 간다"가 된다. 대신 탭 전환까지만 한다(호출부 참조).
 */
export function resolveJumpTarget(
  bm: Bookmark,
  state: {
    projects: Record<string, unknown>;
    stubProjects: Record<string, unknown>;
    nodeMap: Record<string, unknown>;
  },
): JumpDecision {
  const loaded = !!state.projects[bm.projectName];
  const stub = !loaded && !!state.stubProjects[bm.projectName];
  if (!loaded && !stub) return { ok: false, reason: 'unknown-project' };
  if (stub) return { ok: true, stub: true };
  const targetId = bm.kind === 'session' ? bm.agentId : bm.nodeId;
  if (!state.nodeMap[targetId]) return { ok: false, reason: 'missing-target' };
  return { ok: true, stub: false };
}

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

      const sessionBookmark = (): SessionBookmark | null => {
        if (!ide.agentId || !ide.projectId) return null;
        return {
          kind: 'session',
          projectName: ide.projectId,
          agentId: ide.agentId,
          sessionId: ide.activeSessionId,
          label: st.nodeMap[ide.agentId]?.label ?? ide.agentId,
        };
      };
      const bubbleBookmark = (): BubbleBookmark | null => {
        if (!nodeId || !st.activeProject) return null;
        return {
          kind: 'bubble',
          projectName: st.activeProject,
          folderId: st.currentFolderId,
          nodeId,
          label: st.nodeMap[nodeId]?.label ?? nodeId,
        };
      };

      const sb = sessionBookmark();
      const bb = bubbleBookmark();
      // "지금 앞에 떠 있는 IDE" = 모달/플로팅(도킹 아님) 으로 캔버스를 덮고 있는 상태.
      // 이때는 클릭(포커스)·이전 선택과 무관하게 그 IDE 를 그대로 잡는다(사용자: "지금 떠있는 상태를 지정").
      const ideForeground = !!sb && !ide.dockSide;
      // 우선순위:
      //   (1) 포커스가 IDE 안(=IDE 를 보는 중) → 그 세션.
      //   (2) IDE 가 앞에 떠 있으면(모달/플로팅) → 그 세션. 클릭 불필요, 이전 선택 무시.
      //   (3) IDE(도킹 포함)가 열려 있고, 그 에이전트와 "다른" 버블을 따로 고르지 않았으면 → 그 세션.
      //   (4) 캔버스에서 IDE 의 에이전트와 다른 버블을 선택 중이면 → 그 버블(도킹된 무관 IDE 보다 우선).
      //   (5) IDE 도 선택도 없으면 → 없음.
      if (inIDE) {
        bm = sb ?? bb;
      } else if (ideForeground) {
        bm = sb;
      } else if (sb && (!nodeId || nodeId === sb.agentId)) {
        bm = sb;
      } else {
        bm = bb ?? sb;
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
      // 생존 게이트 — 프로젝트가 없거나(종전 판정) 대상 노드가 스냅샷에서 사라졌으면 아무것도
      //   바꾸지 않는다. 특히 session 점프를 그냥 통과시키면 도킹 슬롯이 사라진 에이전트를 가리켜
      //   "IDE 는 안 보이는데 도크 폭만 남는" 빈 칸이 된다(resolveJumpTarget 주석 참조).
      const decision = resolveJumpTarget(bm, store);
      if (!decision.ok) {
        onToast(messages.jumpMissing, 'error');
        return;
      }

      if (bm.kind === 'session') {
        store.setActiveProject(bm.projectName);
        // stub(미hydrate) 프로젝트는 아직 버블이 없다 — 탭만 열어 주고 IDE 는 열지 않는다.
        //   여기서 openIDEOverlay 를 부르면 그리지도 못할 에이전트로 도킹 슬롯이 만들어진다.
        if (!decision.stub) {
          store.focusOnNode(bm.agentId);
          store.openIDEOverlay(bm.agentId);
          const subs = useGraphStore.getState().subAgents[bm.agentId] ?? [];
          if (bm.sessionId && subs.some((s) => s.id === bm.sessionId)) {
            store.setIDEActiveSession(bm.sessionId);
          } else {
            // 세션이 사라졌으면 메인 세션으로 폴백
            store.setIDEActiveSession(null);
          }
        }
      } else {
        store.setActiveProject(bm.projectName);
        // 버블 북마크는 캔버스의 버블을 보여주는 용도 — 직전 세션 점프로 열린 IDE 오버레이가
        // 남아 캔버스를 가리지 않도록, 그 프로젝트의 IDE 창을 닫는다.
        store.closeIDEOverlay();
        if (!decision.stub) {
          if (bm.folderId) store.enterFolderDeep(bm.folderId);
          store.focusOnNode(bm.nodeId);
          store.selectNode(bm.nodeId);
        }
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
