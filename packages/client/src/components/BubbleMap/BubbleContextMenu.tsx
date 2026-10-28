import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { BubbleData } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { PathLockGlyph } from '../PathLockGlyph.js';
import { groupUnlockByProject, planBubbleLock } from './bubbleLockAction.js';
import { canUseAgentCard, isAgentCardForm } from './agentCard.js';
import { agentHasAppLinks, effectiveLinkLens } from './linkView.js';
import { isMainCanvasView } from './canvasScope.js';
// §5.4 #36 (A) — 카드 입력칸 우클릭의 글자 항목. 전역 입력칸 메뉴와 **같은 함수**라 동작이 갈리지 않는다.
import { buildTextFieldMenuItems } from '../../hooks/textFieldContextMenu.js';
import {
  createTextFieldActions,
  hasSelectionFrom,
  type FieldSelection,
  type TextFieldElement,
} from '../../hooks/textFieldActions.js';
// §5.4 #34 — **새 메뉴 위젯을 만들지 않는다.** 넘침 보정·바깥 press 닫기·Esc·레지스트리 키캡이
//   이미 한 벌로 들어 있는 공용 위젯을 그대로 쓴다(그 파일 헤더의 "두 벌이 되면 한쪽은 반드시
//   뒤처진다"가 이 결정의 근거다). 이름이 `IDE*` 일 뿐 IDE 전용이 아니다.
import { IDEContextMenu, type ContextMenuItem } from '../IDE/IDEContextMenu.js';
import {
  bubbleDeleteAction,
  bubbleDeleteBatchLabelKey,
  bubbleDeleteLabelKey,
  planSelectionDelete,
  runBubbleDelete,
  runSelectionDelete,
  selectionDeleteRunnerOf,
  type SelectedFlowEdge,
  type SelectedFlowNode,
} from './bubbleDeleteAction.js';

/**
 * §5.4 #34 — 버블 위 우클릭 메뉴. 묶음 상자 위면 고른 것 전부가 대상(추림은 `Delete` 와 같은 `planSelectionDelete`).
 * §5.3 #12-3 — 잠글 수 있는 버블은 삭제 위에 [잠그기]/[잠금 풀기](`bubbleLockAction.ts`). 우더블클릭 대상은 `BubbleNode` 가 `RIGHT_DBLCLICK_MS` 기다렸다 연다.
 * §5.4 #36 (A) — 형태 전환은 맨 아래 한 줄. 말풍선 입력칸 위면 맨 위에 글자 항목(되돌리는 길이 숨지 않게).
 */

/** `BubbleNode`·묶음 상자가 "이 자리에 메뉴를 열어 달라"고 알릴 때 `BubbleMap` 이 듣는 이벤트. */
export const BUBBLE_MENU_EVENT = 'vibisual:bubble:menu';

/**
 * 위 이벤트의 `detail`(좌표는 client — 메뉴는 fixed). `nodeId` 가 `null` = 묶음 상자 위(고른 것 전부).
 * 값이 있으면 그 버블이 묶음 안인지 `BubbleMap` 이 가린다(남의 묶음을 지우지 않게).
 */
export interface BubbleMenuRequest {
  nodeId: string | null;
  screenX: number;
  screenY: number;
  /**
   * §5.4 #36 (A) — 카드 **입력칸** 위에서 부른 것이면 그 칸과 우클릭 순간의 선택 범위. 있으면 메뉴 맨 위에
   * 글자 항목이 서고, 대상은 묶음과 무관하게 **그 카드 하나**다(글을 치던 칸의 메뉴다).
   */
  textField?: BubbleMenuTextField;
  /**
   * §6 — 자기 메뉴가 있는 노드(앱·플레이·스펙·랩·선반·캡처)가 "묶음 안이면 묶음 메뉴를" 물을 때 켠다.
   * 캔버스는 묶음 안일 때만 열고 `handled` 를 켠다(`openGroupMenuIfGrouped`).
   */
  groupOnly?: boolean;
  /** 캔버스가 이 요청으로 메뉴를 열었는가 — 받는 쪽(`BubbleMap`)이 동기로 채운다. */
  handled?: boolean;
}

/** §6 — 묶음 안의 우클릭이면 묶음 메뉴를 열고 `true`(노드는 자기 메뉴를 안 연다). 판정은 묶음을 아는 캔버스가 하고, 이벤트가 동기라 답이 바로 온다. */
export function openGroupMenuIfGrouped(nodeId: string, screenX: number, screenY: number): boolean {
  if (typeof window === 'undefined') return false;
  const detail: BubbleMenuRequest = { nodeId, screenX, screenY, groupOnly: true, handled: false };
  window.dispatchEvent(new CustomEvent<BubbleMenuRequest>(BUBBLE_MENU_EVENT, { detail }));
  return detail.handled === true;
}

/** 우클릭 순간에 떠 둔 입력칸 — 선택 범위는 메뉴를 누를 때가 아니라 **연 순간**의 것이어야 한다. */
export interface BubbleMenuTextField {
  el: TextFieldElement;
  sel: FieldSelection;
}

/** 휴지통 글리프 — `TrashToolbar` [모두 삭제]와 같은 path(버리는 일은 어디서나 같은 그림). */
function TrashGlyph(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
      aria-hidden="true"
    >
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

interface BubbleContextMenuProps {
  /** 대상 노드들. 단건이면 1개, 묶음이면 고른 것 전부. */
  nodes: readonly SelectedFlowNode[];
  /** 함께 고른 Task 엣지들(묶음일 때만 찬다). */
  edges: readonly SelectedFlowEdge[];
  x: number;
  y: number;
  /**
   * §5.4 #36 (A) — 말풍선 ↔ 버블 전환(원 중심을 지키는 좌표 환산은 캔버스가 한다). 주면 혼자 고른 커스텀
   * 에이전트의 메뉴 **맨 아래**에 [말풍선으로 전환] 또는 같은 자리 [버블로 되돌리기]가 선다.
   */
  onAgentForm?: (nodeId: string, form: 'card' | 'bubble') => void;
  /** §5.4 #36 (A) — 말풍선 입력칸에서 열었으면 그 칸. 맨 위에 글자 항목이 선다. */
  textField?: BubbleMenuTextField | undefined;
  onClose: () => void;
}

/** §5.4 #36 (A) — [말풍선으로 전환] 글리프. 말풍선 하나(lucide `message-circle` 톤). */
function SpeechBalloonGlyph(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
      aria-hidden="true"
    >
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
    </svg>
  );
}

/** §5.4 #36 (H) ① — [연결선 숨기기]/[보이기] 글리프. 끊기가 아니라 눈이다(연결은 두고 보이기만 바꾼다 — lucide `eye-off`/`eye` 톤). */
function LinksVisibilityGlyph({ hidden }: { hidden: boolean }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
      aria-hidden="true"
    >
      {hidden ? (
        // 지금 숨겨져 있다 → [보이기]: 뜬 눈.
        <>
          <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      ) : (
        // 지금 보인다 → [숨기기]: 빗금 친 눈.
        <>
          <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
          <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
          <path d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
          <path d="M2 2l20 20" />
        </>
      )}
    </svg>
  );
}

/** §5.4 #36 (H) ② — 보기 전환 글리프. 갈 곳을 그린다: "연결된 것 위주로" = 궤도(lucide `orbit` 톤), "작업 파일 위주로" = 겹친 문서(`files` 톤). */
function LinkLensGlyph({ to }: { to: 'linked' | 'files' }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
      aria-hidden="true"
    >
      {to === 'linked' ? (
        <>
          <circle cx="12" cy="12" r="3" />
          <circle cx="19" cy="5" r="2" />
          <circle cx="5" cy="19" r="2" />
          <path d="M10.4 21.9a10 10 0 0 0 9.94-15.42" />
          <path d="M13.5 2.1a10 10 0 0 0-9.84 15.42" />
        </>
      ) : (
        <>
          <path d="M20 7h-3a2 2 0 0 1-2-2V2" />
          <path d="M9 18a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h7l4 4v10a2 2 0 0 1-2 2Z" />
          <path d="M3 7.6v12.8A1.6 1.6 0 0 0 4.6 22h9.8" />
        </>
      )}
    </svg>
  );
}

/** §5.4 #36 (H) ①-2 — [연결된 버블 ▸] 글리프. 선으로 이은 원 셋(lucide `share-2` 톤) — ②의 궤도 글리프와 겹치지 않게 궤도는 쓰지 않는다. */
function LinkedBubblesGlyph(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
      aria-hidden="true"
    >
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="M8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98" />
    </svg>
  );
}

/** §5.4 #36 (H) ①-2 — [고정]/[고정 풀기] 글리프. 다른 고정 손잡이(앱 노드·탭·메모)와 같은 핀 path, 풀기는 빗금(lucide `pin-off` 톤). */
function LinksPinGlyph({ pinned }: { pinned: boolean }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
      aria-hidden="true"
    >
      {pinned ? (
        // 지금 고정돼 있다 → [고정 풀기]: 빗금 친 핀.
        <>
          <path d="M12 17v5" />
          <path d="M15 9.34V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H7.89" />
          <path d="M2 2l20 20" />
          <path d="M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h11" />
        </>
      ) : (
        <>
          <path d="M12 17v5" />
          <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
        </>
      )}
    </svg>
  );
}

/** §5.4 #36 (H) ①-2 — [이전 연결 다시 보기] 글리프. 거꾸로 도는 시계(lucide `history` 톤) — 지난 것을 다시 꺼낸다. */
function ReplayLinksGlyph(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
      aria-hidden="true"
    >
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l4 2" />
    </svg>
  );
}

/** §5.4 #36 (A) — [버블로 되돌리기] 글리프. 펼친 것이 원으로 모이는 그림(lucide `minimize-2` 톤). */
function FoldToBubbleGlyph(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
      aria-hidden="true"
    >
      <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" />
    </svg>
  );
}

export function BubbleContextMenu({ nodes, edges, x, y, onAgentForm, textField, onClose }: BubbleContextMenuProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const nodeMap = useGraphStore((s) => s.nodeMap);
  const inTrashView = useGraphStore((s) => s.interiorView?.kind === 'trash');
  const pathLocks = useGraphStore((s) => s.pathLocks);
  const activeProject = useGraphStore((s) => s.activeProject);

  /** §5.3 #12-3 — 자물쇠 계획. 대상은 여는 순간의 노드 데이터에서 뽑는다(`nodeMap` 에 없는 위성도 노드가 데이터를 든다). 판정은 `planBubbleLock`. */
  const lockPlan = useMemo(() => {
    const bubbles = nodes
      .filter((n) => n.type === 'bubble')
      .map((n) => ({ id: n.id, data: (n.data as BubbleData | undefined) ?? nodeMap[n.id] }));
    return planBubbleLock(bubbles, pathLocks);
  }, [nodes, nodeMap, pathLocks]);

  /** 대상이 하나뿐인가 — 워크트리 가드·영구 삭제 단건 흐름은 이쪽으로만 간다. */
  const soleBubbleId = useMemo(
    () => (nodes.length === 1 && edges.length === 0 && nodes[0]?.type === 'bubble' ? nodes[0].id : null),
    [nodes, edges],
  );

  const single = useMemo(
    () => (soleBubbleId ? bubbleDeleteAction(nodeMap[soleBubbleId], { inTrashView }) : null),
    [soleBubbleId, nodeMap, inTrashView],
  );

  const batch = useMemo(
    () => (soleBubbleId ? null : planSelectionDelete(nodes, edges, nodeMap, { inTrashView })),
    [soleBubbleId, nodes, edges, nodeMap, inTrashView],
  );

  const handleDelete = useCallback(() => {
    const st = useGraphStore.getState();
    if (soleBubbleId && single) {
      const node = st.nodeMap[soleBubbleId];
      if (!node) return;
      runBubbleDelete(soleBubbleId, node.label, single, {
        requestTrashPurge: st.requestTrashPurge,
        requestWorktreeDelete: st.requestWorktreeDelete,
        selectNode: st.selectNode,
      });
      return;
    }
    if (!batch) return;
    runSelectionDelete(batch, selectionDeleteRunnerOf(st));
    // 패널에 지워진 것의 상세가 남지 않게 — 키 경로가 하는 정리와 같다.
    st.selectNode(null);
    if (st.selectedCommentBoxId) st.selectCommentBox(null);
    if (st.selectedCaptureBubbleId) st.selectCaptureBubble(null);
    if (st.selectedTaskEdgeId) st.selectTaskEdge(null);
  }, [soleBubbleId, single, batch]);

  const deleteItems = useMemo<ContextMenuItem[]>(() => {
    if (single) {
      const labelKey = bubbleDeleteLabelKey(single.kind);
      if (!labelKey) return [];
      return [{
        id: 'bubble-delete',
        label: t(labelKey),
        icon: <TrashGlyph />,
        onClick: handleDelete,
        // §2.4 — 고정한 버블은 서버가 `409 bubble preserved` 로 막으므로 미리 끄고 이유를 보인다.
        disabled: single.pinned,
        disabledTitle: single.pinned ? t('canvas.bubbleMenu.pinnedTitle') : undefined,
        // §5.24 #32 — 키는 문장에 적지 않는다. 레지스트리에서 읽어 키캡으로 그려야 사용자가
        //   재매핑했을 때 메뉴가 옛 키를 계속 말하지 않는다. 지금 배정은 `Delete` 하나다.
        cmd: 'canvas.deleteSelection',
      }];
    }
    if (!batch) return [];
    const labelKey = bubbleDeleteBatchLabelKey(batch.kind);
    if (!labelKey || batch.count === 0) return [];
    return [{
      id: 'bubble-delete-selection',
      label: t(labelKey, { count: batch.count }),
      icon: <TrashGlyph />,
      onClick: handleDelete,
      // 워크트리는 merge 가드가 있어 단건으로만 지운다 — 말없이 빼면 "지웠는데 하나가 남았다"가 된다.
      //   문장이라 우측 `hint` 로 두면 그 길이만큼 메뉴가 넓어진다 — 라벨 아래로 흘린다.
      note: batch.skippedWorktreeIds.length > 0
        ? t('canvas.bubbleMenu.worktreeSkipped', { count: batch.skippedWorktreeIds.length })
        : undefined,
      cmd: 'canvas.deleteSelection',
    }];
  }, [single, batch, handleDelete, t]);

  // §5.3 #12-3 — 잠그기는 **지금 보고 있는 탭**이 건다(외부 폴더도 그 탭의 자물쇠다).
  const handleLock = useCallback(() => {
    if (!activeProject || lockPlan.toLock.length === 0) return;
    useGraphStore.getState().updatePathLocks(activeProject, lockPlan.toLock, []);
  }, [activeProject, lockPlan]);

  // 풀기는 **그 자물쇠를 건 탭**에 보낸다 — 다른 탭이 건 자물쇠가 이 캔버스에 뜰 수 있다.
  const handleUnlock = useCallback(() => {
    const st = useGraphStore.getState();
    for (const [projectName, ids] of groupUnlockByProject(lockPlan.toUnlock)) st.updatePathLocks(projectName, [], ids);
  }, [lockPlan]);

  const lockItems = useMemo<ContextMenuItem[]>(() => {
    const out: ContextMenuItem[] = [];
    const isSingle = nodes.length === 1 && edges.length === 0;
    if (isSingle) {
      if (lockPlan.toUnlock.length > 0) {
        out.push({ id: 'bubble-unlock', label: t('canvas.bubbleMenu.unlock'), icon: <PathLockGlyph open />, onClick: handleUnlock });
      } else if (lockPlan.inherited.length > 0) {
        // 상위 폴더가 잠갔다 — 자식에서 부모를 푸는 손은 주지 않는다(잠근 그 버블에서 푼다).
        //   눌리지 않는 항목이 **어느 폴더가 잠갔는지** 라벨 아래로 말한다.
        const lock = lockPlan.inherited[0]!.lock;
        out.push({
          id: 'bubble-locked-by-parent',
          label: t('canvas.bubbleMenu.lockedByParent'),
          icon: <PathLockGlyph />,
          onClick: () => undefined,
          disabled: true,
          note: lock.label ?? lock.target,
          disabledTitle: t('canvas.bubbleMenu.lockedByParentTitle', { path: lock.target }),
        });
      } else if (lockPlan.toLock.length > 0 && activeProject) {
        out.push({
          id: 'bubble-lock',
          label: t('canvas.bubbleMenu.lock'),
          icon: <PathLockGlyph />,
          // 처음 보는 개념이라 무엇이 되는지 한 줄로 말한다(문장이라 우측 hint 가 아니라 아랫줄).
          note: t('canvas.bubbleMenu.lockNote'),
          onClick: handleLock,
        });
      }
      return out;
    }
    if (lockPlan.toLock.length > 0 && activeProject) {
      out.push({
        id: 'bubble-lock-selection',
        label: t('canvas.bubbleMenu.lockN', { count: lockPlan.toLock.length }),
        icon: <PathLockGlyph />,
        onClick: handleLock,
        // 잠글 수 없는 버블(에이전트 등)을 말없이 빼지 않는다 — 삭제 묶음의 워크트리 안내와 같은 규율.
        note: lockPlan.notLockable > 0 ? t('canvas.bubbleMenu.lockSkipped', { count: lockPlan.notLockable }) : undefined,
      });
    }
    if (lockPlan.toUnlock.length > 0) {
      out.push({
        id: 'bubble-unlock-selection',
        label: t('canvas.bubbleMenu.unlockN', { count: lockPlan.toUnlock.length }),
        icon: <PathLockGlyph open />,
        onClick: handleUnlock,
      });
    }
    return out;
  }, [nodes, edges, lockPlan, activeProject, handleLock, handleUnlock, t]);

  /**
   * §5.4 #36 (A) — 형태 전환 한 줄은 맨 아래, 두 방향이 같은 자리. 메인 뷰에서만(폴더·워크트리·휴지통 안은 말풍선을 안 그린다).
   * 판정은 `agentCard.ts`(서버 `setAgentForm` 과 같은 조건).
   */
  const mainView = useGraphStore((s) => isMainCanvasView(s));
  const soleExecutionMode = useGraphStore((s) => (soleBubbleId ? s.agentConfigs[soleBubbleId]?.executionMode : undefined));
  const formItems = useMemo<ContextMenuItem[]>(() => {
    if (!onAgentForm || !soleBubbleId || !mainView) return [];
    const data = (nodes[0]?.data as BubbleData | undefined) ?? nodeMap[soleBubbleId];
    if (isAgentCardForm(data)) {
      return [{
        id: 'bubble-form-to-bubble',
        label: t('canvas.bubbleMenu.toBubble'),
        icon: <FoldToBubbleGlyph />,
        onClick: () => onAgentForm(soleBubbleId, 'bubble'),
      }];
    }
    if (!canUseAgentCard(data, { executionMode: soleExecutionMode })) return [];
    return [{
      id: 'bubble-form-to-card',
      label: t('canvas.bubbleMenu.toCard'),
      icon: <SpeechBalloonGlyph />,
      // 처음 보는 형태라 무엇이 되는지 한 줄로 말한다(자물쇠 항목과 같은 규율 — 문장은 아랫줄로).
      note: t('canvas.bubbleMenu.toCardNote'),
      onClick: () => onAgentForm(soleBubbleId, 'card'),
    }];
  }, [onAgentForm, soleBubbleId, mainView, soleExecutionMode, nodes, nodeMap, t]);

  /**
   * §5.4 #36 (H) — [숨기기] 하위 메뉴(버블·연결선 표시). 앱이 이어진 에이전트면 [버블 전부 보기] ↔ [앱 관련 버블만 보기] + ①-2 [연결된 버블 ▸].
   * 혼자 고른 에이전트만, 휴지통 안 ❌. 상태는 연 순간의 노드 데이터, 판정은 `linkView.ts`, 저장은 store 한 경로.
   */
  const soleHasAppLinks = useGraphStore((s) => (soleBubbleId ? agentHasAppLinks(s.appBubbles, soleBubbleId, s.activeProject) : false));
  const linkItems = useMemo<ContextMenuItem[]>(() => {
    if (!soleBubbleId || inTrashView) return [];
    const data = (nodes[0]?.data as BubbleData | undefined) ?? nodeMap[soleBubbleId];
    if (!data || data.bubbleType !== 'agent') return [];
    const agentId = soleBubbleId;
    const hidden = data.linksHidden === true;
    const bubblesHidden = data.bubblesHidden === true;
    const out: ContextMenuItem[] = [{
      id: 'bubble-visibility',
      label: t('canvas.bubbleMenu.visibility'),
      icon: <LinksVisibilityGlyph hidden={false} />,
      onClick: () => undefined,
      children: [{
        id: bubblesHidden ? 'bubble-bubbles-show' : 'bubble-bubbles-hide',
        label: t(bubblesHidden ? 'canvas.bubbleMenu.showBubbles' : 'canvas.bubbleMenu.hideBubbles'),
        icon: <LinksVisibilityGlyph hidden={bubblesHidden} />,
        note: bubblesHidden ? undefined : t('canvas.bubbleMenu.hideBubblesNote'),
        onClick: () => useGraphStore.getState().setAgentLinkView(agentId, { bubblesHidden: !bubblesHidden }),
      }, {
        id: hidden ? 'bubble-links-show' : 'bubble-links-hide',
        label: t(hidden ? 'canvas.bubbleMenu.showLinks' : 'canvas.bubbleMenu.hideLinks'),
        icon: <LinksVisibilityGlyph hidden={hidden} />,
        // 끄는 쪽에만 한 줄 — 연결이 끊기는 것으로 읽히지 않게.
        note: hidden ? undefined : t('canvas.bubbleMenu.hideLinksNote'),
        onClick: () => useGraphStore.getState().setAgentLinkView(agentId, { hidden: !hidden }),
      }],
    }];
    if (soleHasAppLinks) {
      const lens = effectiveLinkLens(data, true);
      const to = lens === 'linked' ? 'files' : 'linked';
      out.push({
        id: to === 'files' ? 'bubble-lens-files' : 'bubble-lens-linked',
        label: t(to === 'files' ? 'canvas.bubbleMenu.lensFiles' : 'canvas.bubbleMenu.lensLinked'),
        icon: <LinkLensGlyph to={to} />,
        note: t(to === 'files' ? 'canvas.bubbleMenu.lensFilesNote' : 'canvas.bubbleMenu.lensLinkedNote'),
        onClick: () => useGraphStore.getState().setAgentLinkView(agentId, { lens: to }),
      });
    }
    // §5.4 #36 (H) ①-2 — [연결된 버블 ▸]: 고정 ↔ 같은 자리 고정 풀기 · 이전 연결 다시 보기. 보기 묶음의 끝이다
    //   (숨기기·보기 전환이 "어떻게 보이나"라면 이 묶음은 "언제까지 남나"다). 판정(무엇이 남고 언제 걷히나)은 서버가 한다 —
    //   메뉴는 연 순간의 칸(`linksPinned`·`status`·`prevLinkCount`)으로 문구와 흐림만 고른다.
    const pinned = data.linksPinned === true;
    const running = data.status === 'active';
    const prevCount = data.prevLinkCount ?? 0;
    const replayBlocked = running ? 'canvas.bubbleMenu.replayLinksRunning' : prevCount === 0 ? 'canvas.bubbleMenu.replayLinksEmpty' : null;
    out.push({
      id: 'bubble-linked',
      label: t('canvas.bubbleMenu.linkedBubbles'),
      icon: <LinkedBubblesGlyph />,
      onClick: () => undefined,
      children: [{
        id: pinned ? 'bubble-links-unpin' : 'bubble-links-pin',
        label: t(pinned ? 'canvas.bubbleMenu.unpinLinks' : 'canvas.bubbleMenu.pinLinks'),
        icon: <LinksPinGlyph pinned={pinned} />,
        // 처음 보는 동작이라 무엇이 되는지 한 줄로 — 푸는 쪽은 지금 걷히는지(실행 중이 아니면) 미리 말한다.
        note: t(pinned
          ? (running ? 'canvas.bubbleMenu.unpinLinksRunningNote' : 'canvas.bubbleMenu.unpinLinksNote')
          : 'canvas.bubbleMenu.pinLinksNote'),
        onClick: () => useGraphStore.getState().setAgentLinksPinned(agentId, !pinned),
      }, {
        id: 'bubble-links-replay',
        label: t('canvas.bubbleMenu.replayLinks'),
        icon: <ReplayLinksGlyph />,
        // 못 누르는 까닭은 툴팁만이 아니라 라벨 아래 줄로도 말한다 — 터치에는 hover 가 없다.
        note: replayBlocked ? t(replayBlocked) : t('canvas.bubbleMenu.replayLinksNote', { count: prevCount }),
        disabled: replayBlocked !== null,
        disabledTitle: replayBlocked ? t(replayBlocked) : undefined,
        onClick: () => useGraphStore.getState().replayAgentLinks(agentId),
      }],
    });
    return out;
  }, [soleBubbleId, inTrashView, nodes, nodeMap, soleHasAppLinks, t]);

  /** §5.4 #36 (A) — 카드 입력칸에서 열었으면 맨 위에 글자 항목(전역 입력칸 메뉴와 같은 함수·문구). 선택 범위는 연 순간의 것. */
  const textItems = useMemo<ContextMenuItem[]>(() => {
    if (!textField) return [];
    return buildTextFieldMenuItems(
      { hasSelection: hasSelectionFrom(textField.sel), readOnly: textField.el.readOnly },
      createTextFieldActions(textField.el, textField.sel),
      t,
      undefined,
    );
  }, [textField, t]);

  // 글자 항목이 맨 위(입력칸에서 열었을 때), 연결 보기(§5.4 #36 (H) — 보는 일이 먼저), 자물쇠·삭제(버리는 일은 나중),
  //   형태 전환이 맨 아래다 — 묶음이 바뀌는 자리에 구분선을 긋는다.
  const items = useMemo<ContextMenuItem[]>(() => {
    const groups = [textItems, linkItems, lockItems, deleteItems, formItems].filter((g) => g.length > 0);
    const out: ContextMenuItem[] = [];
    for (const group of groups) {
      group.forEach((item, i) => out.push(i === 0 && out.length > 0 ? { ...item, separatorBefore: true } : item));
    }
    return out;
  }, [textItems, linkItems, lockItems, deleteItems, formItems]);

  // 지울 수 없는 버블(네비게이션 골격 등)에서는 메뉴 자체를 내지 않는다 — 항목 하나 없는 빈
  //   상자가 뜨면 "고장난 메뉴"로 읽힌다.
  if (items.length === 0) return null;

  // 항목이 한둘뿐인 메뉴다 — 여럿을 담는 IDE 메뉴의 여백을 그대로 쓰면 빈 자리가 글자보다 넓다.
  return <IDEContextMenu x={x} y={y} items={items} density="compact" onClose={onClose} />;
}
