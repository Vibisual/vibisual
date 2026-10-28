/**
 * §5.4 #34 — "이 버블을 지우면 무엇이 되는가"를 `Delete` 키와 우클릭 메뉴가 나눠 쓰는 순수 함수 한 벌(각자 판정하면 같은 버블에 다른 일을 한다).
 * DOM·스토어 ❌ — 인자만 본다.
 */
import type { BubbleData } from '@vibisual/shared';

/**
 * - `none` 골격(`root`·`back`) — 메뉴 항목 없음 · `trash` 커스텀 에이전트 → 휴지통 · `worktree` merge 가드 전용 흐름(§5.7 #26) · `remove` 즉시 제거.
 * - `purge` 휴지통 안 → 영구 삭제(`POST /api/trash/purge`). 일반 삭제로 보내면 다시 옮기려다 실패해 화면에서만 사라지고 identity·기억 파일은 남는다(§5.10 ②).
 */
export type BubbleDeleteKind = 'none' | 'purge' | 'trash' | 'worktree' | 'remove';

export interface BubbleDeleteAction {
  kind: BubbleDeleteKind;
  /** §2.4 고정 여부 — `kind` 는 그대로, 막는 것은 서버(`409 bubble preserved`)다. 이 값은 메뉴가 미리 알리는 용도(키 경로는 서버 거부에 맡긴다). */
  pinned: boolean;
}

/** 판정에 필요한 것만 추린 버블 — `BubbleData` 전체를 요구하지 않아 테스트가 가볍다. */
export type DeletableBubble = Pick<
  BubbleData,
  'bubbleType' | 'customCreated' | 'trashed' | 'preservePinned'
>;

/** `inTrashView` = 휴지통 내부를 보는 중인가 — 같은 버블도 밖은 "버리기", 안은 "영구 삭제"라 호출부마다 기억하면 한쪽이 빠진다. */
export function bubbleDeleteAction(
  node: DeletableBubble | undefined | null,
  opts: { inTrashView: boolean },
): BubbleDeleteAction {
  if (!node) return { kind: 'none', pinned: false };
  const pinned = node.preservePinned === true;

  // 네비게이션 골격은 사용자 데이터가 아니다 — 지우는 손을 아예 주지 않는다.
  //   §5.1 #2-1 (B) 묶음 버블도 화면이 짓는 자리라 지울 것이 없다(구성 파일은 각자 지운다).
  if (node.bubbleType === 'root' || node.bubbleType === 'back' || node.bubbleType === 'bundle') return { kind: 'none', pinned };

  // 휴지통 안에서는 버려진 것만 다룬다. 안에 떠 있는데 `trashed` 가 아닌 버블(내부 뷰의 골격 등)은
  //   지우기 대상이 아니다 — 여기서 일반 경로로 흘리면 위 `purge` 주석의 사고가 그대로 난다.
  if (opts.inTrashView) {
    return node.trashed === true ? { kind: 'purge', pinned } : { kind: 'none', pinned };
  }

  if (node.bubbleType === 'worktree') return { kind: 'worktree', pinned };
  if (node.bubbleType === 'agent' && node.customCreated === true) return { kind: 'trash', pinned };
  return { kind: 'remove', pinned };
}

/** "삭제"와 "휴지통으로 이동"은 되돌릴 수 있는지가 달라 같은 말로 적으면 안 된다 — 문구 키를 여기서 정한다. */
export function bubbleDeleteLabelKey(kind: BubbleDeleteKind): string | null {
  switch (kind) {
    case 'purge': return 'canvas.bubbleMenu.deleteForever';
    case 'trash': return 'canvas.bubbleMenu.moveToTrash';
    case 'worktree': return 'canvas.bubbleMenu.deleteWorktree';
    case 'remove': return 'canvas.bubbleMenu.delete';
    case 'none': return null;
  }
}

/** 스토어를 인자로 받는다 — 거대한 `graphStore` 를 끌어오지 않고 실행 경로도 시험에서 흉내 낸다. */
export interface BubbleDeleteRunner {
  requestTrashPurge: (ids: string[]) => void;
  requestWorktreeDelete: (nodeId: string, label: string) => void;
  selectNode: (id: string | null) => void;
}

/** `Delete` 키와 우클릭 메뉴가 이 실행을 나눠 쓴다 — 판정만 공유하면 실행이 갈린다. */
export function runBubbleDelete(
  nodeId: string,
  label: string,
  action: BubbleDeleteAction,
  runner: BubbleDeleteRunner,
): void {
  switch (action.kind) {
    case 'none':
      return;
    case 'purge':
      // 확인 팝업 → `POST /api/trash/purge`(§5.10).
      runner.requestTrashPurge([nodeId]);
      return;
    case 'worktree':
      // merge 가드 + 폴더 삭제 전용 흐름(§5.7 #26).
      runner.requestWorktreeDelete(nodeId, label);
      return;
    case 'trash':
    case 'remove':
      // 창구는 하나다 — 커스텀 에이전트면 서버가 휴지통으로 돌린다(§5.10).
      void fetch(`/api/bubble/${nodeId}`, { method: 'DELETE' }).catch(() => {});
      runner.selectNode(null);
      return;
  }
}

/** 묶음에서 한 번에 지울 수 있는 것만 추린 계획 — 키와 묶음 메뉴가 나눠 쓴다(인라인이면 묶음에서 규율이 깨진다). */
export interface SelectionDeletePlan {
  /** 휴지통 내부 — 확인 팝업을 거쳐 영구 삭제(`POST /api/trash/purge`). */
  purgeIds: string[];
  /** 배치 삭제 대상 버블. 개별 DELETE 를 N 번 쏘면 스냅샷이 N 번 와 버블이 나눠 사라진다. */
  bubbleIds: string[];
  taskEdgeIds: string[];
  commentBoxIds: string[];
  captureIds: string[];
  /** §6 — store 노드도 묶음에 들므로 센다(각자 창구, 고정이면 서버가 거절). 플레이는 두 노드가 한 레코드라 레코드 id 로 한 번. */
  appBubbleIds: string[];
  playBubbleIds: string[];
  specDocIds: string[];
  labRunIds: string[];
  shelfBubbleIds: string[];
  /** 워크트리는 merge 가드 다이얼로그 때문에 단건만 — 메뉴가 빠진 수를 알린다(말없이 빼면 "하나가 남았다"가 된다). */
  skippedWorktreeIds: string[];
  /** 메뉴 문구를 고르는 대표 동작. 전부 휴지통행이면 `trash`, 섞였으면 `remove`. */
  kind: BubbleDeleteKind;
  /** 실제로 지워지는 것의 총 개수(버블 + 엣지 + 메모 상자 + 캡처 + 앱·플레이·스펙·랩·선반). */
  count: number;
}

/** 종류가 늘면 여기 한 줄 — 키·메뉴가 같은 표를 본다. */
const STORE_NODE_DELETE: Readonly<Record<string, {
  readonly field: 'appBubbleIds' | 'playBubbleIds' | 'specDocIds' | 'labRunIds' | 'shelfBubbleIds';
  readonly key: string;
}>> = {
  appNode: { field: 'appBubbleIds', key: 'appBubbleId' },
  playNode: { field: 'playBubbleIds', key: 'playBubbleId' },
  playPreviewNode: { field: 'playBubbleIds', key: 'playBubbleId' },
  specNode: { field: 'specDocIds', key: 'specDocId' },
  labNode: { field: 'labRunIds', key: 'labRunId' },
  shelfNode: { field: 'shelfBubbleIds', key: 'shelfBubbleId' },
};

/** React Flow 노드에서 이 판정이 보는 것만 — `@xyflow` 타입을 이 모듈로 들이지 않는다. */
export interface SelectedFlowNode {
  id: string;
  type?: string;
  data?: unknown;
}

/** 같은 이유로 추린 엣지. */
export interface SelectedFlowEdge {
  id: string;
  type?: string;
  data?: unknown;
}

/** `n.data` 에서 그 갈래의 진짜 식별자를 꺼낸다(없으면 노드 id 가 곧 식별자다). */
function dataId(node: SelectedFlowNode | SelectedFlowEdge, key: string): string {
  const d = node.data as Record<string, unknown> | undefined;
  const v = d?.[key];
  return typeof v === 'string' ? v : node.id;
}

/** `inTrashView` 면 영구 삭제만 담는다 — 일반 경로로 흘리면 화면에서만 사라진다(§5.10 ②). */
export function planSelectionDelete(
  nodes: readonly SelectedFlowNode[],
  edges: readonly SelectedFlowEdge[],
  nodeMap: Record<string, DeletableBubble | undefined>,
  opts: { inTrashView: boolean },
): SelectionDeletePlan {
  const plan: SelectionDeletePlan = {
    purgeIds: [], bubbleIds: [], taskEdgeIds: [], commentBoxIds: [], captureIds: [],
    appBubbleIds: [], playBubbleIds: [], specDocIds: [], labRunIds: [], shelfBubbleIds: [],
    skippedWorktreeIds: [], kind: 'none', count: 0,
  };

  let sawTrash = false;
  let sawOther = false;

  for (const n of nodes) {
    if (n.type === 'bubble') {
      const action = bubbleDeleteAction(nodeMap[n.id], { inTrashView: opts.inTrashView });
      if (action.kind === 'purge') { plan.purgeIds.push(n.id); continue; }
      if (action.kind === 'worktree') { plan.skippedWorktreeIds.push(n.id); continue; }
      if (action.kind !== 'trash' && action.kind !== 'remove') continue;
      if (action.kind === 'trash') sawTrash = true; else sawOther = true;
      plan.bubbleIds.push(n.id);
      continue;
    }
    // 휴지통 안에서는 버려진 에이전트 말고는 손대지 않는다.
    if (opts.inTrashView) continue;
    if (n.type === 'commentBox') { plan.commentBoxIds.push(dataId(n, 'commentBoxId')); sawOther = true; continue; }
    if (n.type === 'captureNode') { plan.captureIds.push(dataId(n, 'captureBubbleId')); sawOther = true; continue; }
    const storeKind = n.type === undefined ? undefined : STORE_NODE_DELETE[n.type];
    if (storeKind) {
      const id = dataId(n, storeKind.key);
      const ids = plan[storeKind.field];
      if (!ids.includes(id)) ids.push(id);
      sawOther = true;
    }
  }

  if (!opts.inTrashView) {
    for (const ed of edges) {
      if (ed.type !== 'taskEdge') continue;
      const d = ed.data as { taskEdgeId?: string } | undefined;
      plan.taskEdgeIds.push(d?.taskEdgeId ?? (ed.id.startsWith('task-') ? ed.id.slice(5) : ed.id));
      sawOther = true;
    }
  }

  plan.count = plan.purgeIds.length + plan.bubbleIds.length
    + plan.taskEdgeIds.length + plan.commentBoxIds.length + plan.captureIds.length
    + plan.appBubbleIds.length + plan.playBubbleIds.length + plan.specDocIds.length
    + plan.labRunIds.length + plan.shelfBubbleIds.length;

  // 문구는 **되돌릴 수 있는지**로 갈린다. 하나라도 그냥 없어지는 것이 섞였으면 "휴지통으로 이동"이라
  //   말해서는 안 된다 — 되돌릴 수 있다고 약속하는 말이기 때문이다.
  plan.kind = plan.purgeIds.length > 0 ? 'purge'
    : plan.count === 0 ? 'none'
      : sawTrash && !sawOther ? 'trash'
        : 'remove';

  return plan;
}

/** 묶음 삭제를 실행하는 데 필요한 손잡이. `BubbleDeleteRunner` 와 같은 이유로 인자로 받는다. */
export interface SelectionDeleteRunner {
  requestTrashPurge: (ids: string[]) => void;
  deleteTaskEdge: (id: string) => void;
  deleteCommentBox: (id: string) => void | Promise<unknown>;
  deleteCaptureBubble: (id: string) => void | Promise<unknown>;
  deleteAppBubble: (id: string) => void | Promise<unknown>;
  deletePlayBubble: (id: string) => void | Promise<unknown>;
  deleteSpecDoc: (id: string) => void | Promise<unknown>;
  deleteLabRun: (id: string) => void | Promise<unknown>;
  deleteShelfBubble: (id: string) => void | Promise<unknown>;
}

/** `Delete` 키와 묶음 메뉴가 같은 손잡이 목록을 쓴다 — 각자 적으면 새 종류를 한쪽만 빠뜨린다(§5.4 #34). */
export function selectionDeleteRunnerOf(s: SelectionDeleteRunner): SelectionDeleteRunner {
  return {
    requestTrashPurge: s.requestTrashPurge,
    deleteTaskEdge: s.deleteTaskEdge,
    deleteCommentBox: s.deleteCommentBox,
    deleteCaptureBubble: s.deleteCaptureBubble,
    deleteAppBubble: s.deleteAppBubble,
    deletePlayBubble: s.deletePlayBubble,
    deleteSpecDoc: s.deleteSpecDoc,
    deleteLabRun: s.deleteLabRun,
    deleteShelfBubble: s.deleteShelfBubble,
  };
}

/** 계획대로 지운다 — `Delete` 키와 묶음 우클릭 메뉴가 이 함수를 나눠 쓴다. */
export function runSelectionDelete(plan: SelectionDeletePlan, runner: SelectionDeleteRunner): void {
  if (plan.purgeIds.length > 0) {
    // 휴지통 안이면 여기서 끝난다 — 확인 팝업이 나머지를 맡는다.
    runner.requestTrashPurge(plan.purgeIds);
    return;
  }
  for (const id of plan.taskEdgeIds) runner.deleteTaskEdge(id);
  for (const id of plan.commentBoxIds) void runner.deleteCommentBox(id);
  for (const id of plan.captureIds) void runner.deleteCaptureBubble(id);
  for (const id of plan.appBubbleIds) void runner.deleteAppBubble(id);
  for (const id of plan.playBubbleIds) void runner.deletePlayBubble(id);
  for (const id of plan.specDocIds) void runner.deleteSpecDoc(id);
  for (const id of plan.labRunIds) void runner.deleteLabRun(id);
  for (const id of plan.shelfBubbleIds) void runner.deleteShelfBubble(id);
  if (plan.bubbleIds.length > 0) {
    // 한 번의 스냅샷으로 동시에 사라지게 — 배치 창구 하나로 보낸다.
    void fetch('/api/bubbles/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: plan.bubbleIds }),
    }).catch(() => {});
  }
}

/** 묶음 문구는 단건과 다른 키 — 수를 끼워 넣으면 로케일마다 어순·수 표현이 어색해진다. */
export function bubbleDeleteBatchLabelKey(kind: BubbleDeleteKind): string | null {
  switch (kind) {
    case 'purge': return 'canvas.bubbleMenu.deleteForeverN';
    case 'trash': return 'canvas.bubbleMenu.moveToTrashN';
    case 'remove': return 'canvas.bubbleMenu.deleteN';
    case 'worktree': return 'canvas.bubbleMenu.deleteN';
    case 'none': return null;
  }
}
