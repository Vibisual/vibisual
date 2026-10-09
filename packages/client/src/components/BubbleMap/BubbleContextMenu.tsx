import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { BubbleData } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { PathLockGlyph } from '../PathLockGlyph.js';
import { groupUnlockByProject, planBubbleLock } from './bubbleLockAction.js';
import { isAgentCardForm } from './agentCard.js';
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
  type SelectedFlowEdge,
  type SelectedFlowNode,
} from './bubbleDeleteAction.js';

/**
 * BubbleContextMenu.tsx — §5.4 #34 (판올림 번호 발급 대기) **버블 위 우클릭 메뉴.**
 *
 * 종전에 캔버스 우클릭 메뉴(§5.4 #13)는 **빈 곳 전용**이었고(`isCanvasSurfaceTarget` 이 버블 위를
 * 걸러낸다), 버블 위 우클릭은 브라우저 기본 메뉴만 막고 아무 일도 하지 않았다. 그래서 버블을
 * 치우는 손은 `Delete` 키 하나뿐이었는데, 키는 **어디를 눌러야 하는지 화면이 말해 주지 않는다**.
 * 이제 버블 위에서 우클릭하면 그 버블에 할 수 있는 일이 목록으로 뜬다.
 *
 * **묶어 고른 상태에서도 뜬다** — 여러 개를 고르면 React Flow 가 그 위에 상자
 * (`.react-flow__nodesselection-rect`)를 덮는데, 그것이 버블을 가려 우클릭이 빈 곳 메뉴(만들기)로
 * 새던 것이 2026-09-11 사용자 보고다. 이제 그 상자 위 우클릭은 **고른 것 전부**를 대상으로 하는
 * 한 줄을 낸다(대상 추림은 `Delete` 키와 같은 `planSelectionDelete` 한 벌).
 *
 * **자물쇠도 여기 선다(§5.3 #12-3)** — 잠글 수 있는 버블(파일·폴더·워크트리·Ghost·도메인)이면 삭제 위에
 * [잠그기]/[잠금 풀기]. 판정은 `bubbleLockAction.ts`(shared `pathLockTargetOf`·`findPathLockCover` 한 벌)다.
 *
 * **우더블클릭(기억 화면, §5.10)과 겹치지 않는다** — 여는 쪽(`BubbleNode`)이 우더블클릭 대상
 * 버블에서는 `RIGHT_DBLCLICK_MS` 만큼 기다렸다 연다. 그 창 안에 두 번째 우클릭이 오면 메뉴 요청은
 * 취소되고 기억 화면이 열린다.
 */

/** `BubbleNode`·묶음 상자가 "이 자리에 메뉴를 열어 달라"고 알릴 때 `BubbleMap` 이 듣는 이벤트. */
export const BUBBLE_MENU_EVENT = 'vibisual:bubble:menu';

/**
 * 위 이벤트의 `detail`. 좌표는 **화면(client) 좌표** — 메뉴는 fixed 로 뜬다.
 *
 * `nodeId` 가 `null` 이면 **묶음 상자 위에서 부른 것**이라 대상은 지금 고른 것 전부다. 값이 있으면
 * 그 버블 위에서 부른 것이고, 그 버블이 묶음 안에 들어 있는지는 받는 쪽(`BubbleMap`)이 가린다 —
 * 고르지 않은 버블 위 우클릭이 남의 묶음을 지우면 안 되기 때문이다(탐색기·파인더와 같은 규칙).
 */
export interface BubbleMenuRequest {
  nodeId: string | null;
  screenX: number;
  screenY: number;
}

/**
 * 휴지통 글리프. **새 모양을 만들지 않는다** — `TrashToolbar` 의 [모두 삭제]와 같은 path 라,
 * 앱 안에서 "버리는 일"은 어디서 보든 같은 그림이다(이모지 ❌ · lucide 톤 stroke SVG).
 */
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
   * §5.4 #36 (A) — 입력 카드 ↔ 버블 전환(중심을 지키는 좌표 환산은 캔버스가 한다). 주면 카드 위 우클릭의
   * 맨 위에 [버블로 접기]가 선다.
   */
  onAgentForm?: (nodeId: string, form: 'card' | 'bubble') => void;
  onClose: () => void;
}

/** §5.4 #36 (A) — [버블로 접기] 글리프. 판이 원으로 모이는 그림(lucide `minimize-2` 톤). */
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

export function BubbleContextMenu({ nodes, edges, x, y, onAgentForm, onClose }: BubbleContextMenuProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const nodeMap = useGraphStore((s) => s.nodeMap);
  const inTrashView = useGraphStore((s) => s.interiorView?.kind === 'trash');
  const pathLocks = useGraphStore((s) => s.pathLocks);
  const activeProject = useGraphStore((s) => s.activeProject);

  /**
   * §5.3 #12-3 — 자물쇠 계획. 대상은 **여는 순간의 노드 데이터**에서 뽑는다(위성 파일처럼 `nodeMap` 에
   * 없는 버블도 흐름 노드가 자기 버블 데이터를 들고 있다). 판정은 순수 함수 한 곳(`planBubbleLock`).
   */
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
    runSelectionDelete(batch, {
      requestTrashPurge: st.requestTrashPurge,
      deleteTaskEdge: st.deleteTaskEdge,
      deleteCommentBox: st.deleteCommentBox,
      deleteCaptureBubble: st.deleteCaptureBubble,
    });
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
        // §2.4 v1.28 — 고정한 버블은 서버가 `409 bubble preserved` 로 막는다. 눌러 본 뒤에
        //   아무 일도 안 일어나는 것보다, 왜 못 누르는지 미리 말해 주는 편이 낫다.
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
   * §5.4 #36 (A) — 카드 위 우클릭이면 맨 위에 [버블로 접기]. 버블 위 첫 우클릭은 이 메뉴가 아니라 전환이라
   * (캔버스가 가로챈다) 여기 오는 에이전트는 이미 카드이거나 카드가 될 수 없는 버블이다.
   */
  const formItems = useMemo<ContextMenuItem[]>(() => {
    if (!onAgentForm || !soleBubbleId) return [];
    const node = nodes[0];
    const data = (node?.data as BubbleData | undefined) ?? nodeMap[soleBubbleId];
    if (!isAgentCardForm(data)) return [];
    return [{
      id: 'bubble-fold-card',
      label: t('canvas.bubbleMenu.toBubble'),
      icon: <FoldToBubbleGlyph />,
      onClick: () => onAgentForm(soleBubbleId, 'bubble'),
    }];
  }, [onAgentForm, soleBubbleId, nodes, nodeMap, t]);

  // 전환이 맨 위, 자물쇠가 그 아래, 삭제가 맨 아래다 — 묶음이 바뀌는 자리에 구분선을 긋는다.
  const items = useMemo<ContextMenuItem[]>(() => {
    const groups = [formItems, lockItems, deleteItems].filter((g) => g.length > 0);
    const out: ContextMenuItem[] = [];
    for (const group of groups) {
      group.forEach((item, i) => out.push(i === 0 && out.length > 0 ? { ...item, separatorBefore: true } : item));
    }
    return out;
  }, [formItems, lockItems, deleteItems]);

  // 지울 수 없는 버블(네비게이션 골격 등)에서는 메뉴 자체를 내지 않는다 — 항목 하나 없는 빈
  //   상자가 뜨면 "고장난 메뉴"로 읽힌다.
  if (items.length === 0) return null;

  // 항목이 한둘뿐인 메뉴다 — 여럿을 담는 IDE 메뉴의 여백을 그대로 쓰면 빈 자리가 글자보다 넓다.
  return <IDEContextMenu x={x} y={y} items={items} density="compact" onClose={onClose} />;
}
