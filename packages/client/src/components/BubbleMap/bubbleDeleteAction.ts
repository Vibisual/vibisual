/**
 * bubbleDeleteAction.ts — **"이 버블을 지우면 무엇이 되는가"를 한 곳에서 정한다.**
 *
 * §5.4 #34 (판올림 번호 발급 대기) — 캔버스에서 버블을 지우는 손은 이제 둘이다: `Delete` 키와
 * 버블 위 우클릭 메뉴. 둘이 각자 판정하면 **같은 버블에 키와 메뉴가 다른 일을 하는** 날이 온다
 * (키는 휴지통으로 보내는데 메뉴는 즉시 지우는 식). 그래서 판정을 순수 함수 한 벌로 뽑고
 * 키·메뉴가 그것을 나눠 쓴다 — §5.10 v3.73 이 휴지통에 세운 "뚜껑(배지)·속(목록)·삭제 대상이
 * 한 배열에서 나온다"와 같은 규율이다.
 *
 * DOM 도 스토어도 보지 않는다(인자로 받은 것만 본다) — 그래야 단위 테스트로 고정된다.
 */
import type { BubbleData } from '@vibisual/shared';

/**
 * 그 버블에 지우기를 걸었을 때 실제로 일어나는 일.
 *
 * - `none` — 지울 수 없는 버블(`root`·`back` 같은 네비게이션 골격). 메뉴에 항목 자체를 안 낸다.
 * - `purge` — **휴지통 안**의 버려진 에이전트 → 영구 삭제(확인 팝업 경유, `POST /api/trash/purge`).
 *   여기서 일반 삭제 경로로 내려가면 이미 버려진 것을 다시 휴지통으로 옮기려다 실패해
 *   **화면에서만 사라지고 identity·기억 파일은 디스크에 남는다**(§5.10 v4.84 ②).
 * - `trash` — 커스텀 에이전트 → 휴지통 이동(`DELETE /api/bubble/:id` 가 서버에서 갈라 준다).
 * - `worktree` — 워크트리 버블 → merge 가드 + 폴더 삭제를 포함한 전용 흐름(§5.7 #26).
 * - `remove` — 그 외 버블 → 즉시 제거.
 */
export type BubbleDeleteKind = 'none' | 'purge' | 'trash' | 'worktree' | 'remove';

export interface BubbleDeleteAction {
  kind: BubbleDeleteKind;
  /**
   * 사용자가 고정(§2.4 preserve-pin)해 둔 버블인가. `true` 여도 `kind` 는 그대로다 —
   * 막는 것은 서버(`409 bubble preserved`)이고, 이 값은 **메뉴가 미리 알려 주기 위한** 것이다.
   * 키 경로는 종전처럼 그냥 보내고 서버 거부에 맡긴다(동작 무변경).
   */
  pinned: boolean;
}

/** 판정에 필요한 것만 추린 버블 — `BubbleData` 전체를 요구하지 않아 테스트가 가볍다. */
export type DeletableBubble = Pick<
  BubbleData,
  'bubbleType' | 'customCreated' | 'trashed' | 'preservePinned'
>;

/**
 * 이 버블에 지우기를 걸면 무엇이 되는가.
 *
 * `inTrashView` 는 **지금 휴지통 내부 뷰를 보고 있는가**다. 같은 버블이라도 밖에서는 "버리는 것",
 * 안에서는 "영구히 지우는 것"이라 답이 갈린다 — 그 갈림을 호출부가 각자 기억하면 한쪽이 빠진다.
 */
export function bubbleDeleteAction(
  node: DeletableBubble | undefined | null,
  opts: { inTrashView: boolean },
): BubbleDeleteAction {
  if (!node) return { kind: 'none', pinned: false };
  const pinned = node.preservePinned === true;

  // 네비게이션 골격은 사용자 데이터가 아니다 — 지우는 손을 아예 주지 않는다.
  if (node.bubbleType === 'root' || node.bubbleType === 'back') return { kind: 'none', pinned };

  // 휴지통 안에서는 버려진 것만 다룬다. 안에 떠 있는데 `trashed` 가 아닌 버블(내부 뷰의 골격 등)은
  //   지우기 대상이 아니다 — 여기서 일반 경로로 흘리면 위 `purge` 주석의 사고가 그대로 난다.
  if (opts.inTrashView) {
    return node.trashed === true ? { kind: 'purge', pinned } : { kind: 'none', pinned };
  }

  if (node.bubbleType === 'worktree') return { kind: 'worktree', pinned };
  if (node.bubbleType === 'agent' && node.customCreated === true) return { kind: 'trash', pinned };
  return { kind: 'remove', pinned };
}

/**
 * 그 동작을 가리키는 i18n 키. **메뉴가 문구를 지어내지 않게** 여기서 한 번에 정한다 —
 * "삭제"와 "휴지통으로 이동"은 되돌릴 수 있는지가 다르므로 같은 말로 적으면 안 된다.
 * `none` 은 항목을 내지 않으므로 키가 없다.
 */
export function bubbleDeleteLabelKey(kind: BubbleDeleteKind): string | null {
  switch (kind) {
    case 'purge': return 'canvas.bubbleMenu.deleteForever';
    case 'trash': return 'canvas.bubbleMenu.moveToTrash';
    case 'worktree': return 'canvas.bubbleMenu.deleteWorktree';
    case 'remove': return 'canvas.bubbleMenu.delete';
    case 'none': return null;
  }
}

/**
 * 판정을 실제로 실행하는 데 필요한 손잡이. **스토어를 직접 들이지 않고 인자로 받는다** —
 * 그래야 이 모듈이 거대한 `graphStore` 를 끌어오지 않고, 실행 경로도 테스트에서 흉내 낼 수 있다.
 */
export interface BubbleDeleteRunner {
  requestTrashPurge: (ids: string[]) => void;
  requestWorktreeDelete: (nodeId: string, label: string) => void;
  selectNode: (id: string | null) => void;
}

/**
 * 판정대로 지운다 — **`Delete` 키와 우클릭 메뉴가 이 함수를 나눠 쓴다.**
 *
 * 판정만 공유하고 실행을 각자 적으면 "키로 지운 것과 메뉴로 지운 것이 다른" 날이 온다(한쪽만
 * 고쳐지기 때문이다). 그래서 짧아도 여기 한 벌로 둔다.
 */
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
      // 확인 팝업을 거쳐 `POST /api/trash/purge` 로 간다(§5.10 v4.84).
      runner.requestTrashPurge([nodeId]);
      return;
    case 'worktree':
      // merge 가드 + 폴더 삭제를 포함한 전용 흐름(§5.7 #26 v1.20).
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

/**
 * 묶음(다중 선택)에서 **한 번에 지울 수 있는 것만** 추린 계획.
 *
 * 종전에는 이 추림이 `BubbleMap` 의 `Delete` 키 핸들러 안에 인라인으로만 있었다. 그래서 묶음 위
 * 우클릭 메뉴가 같은 일을 하려면 그 로직을 **한 벌 더 적어야** 했는데, 그러면 이 절이 세운 규율
 * ("키와 메뉴가 같은 버블에 다른 일을 하지 않는다")이 묶음에서만 깨진다. 계획을 여기로 올려 둘이
 * 나눠 쓴다.
 */
export interface SelectionDeletePlan {
  /** 휴지통 내부 — 확인 팝업을 거쳐 영구 삭제(`POST /api/trash/purge`). */
  purgeIds: string[];
  /** 배치 삭제 대상 버블. 개별 DELETE 를 N 번 쏘면 스냅샷이 N 번 와 버블이 나눠 사라진다. */
  bubbleIds: string[];
  taskEdgeIds: string[];
  commentBoxIds: string[];
  captureIds: string[];
  /**
   * 묶음에서 빠진 워크트리 버블. 지울 수 없어서가 아니라 **merge 가드 다이얼로그가 있어 단건
   * 처리만 가능**하기 때문이다(§5.7 #26). 메뉴는 이 수를 사용자에게 알려 준다 — 말없이 빼면
   * "지웠는데 하나가 남았다"가 된다.
   */
  skippedWorktreeIds: string[];
  /** 메뉴 문구를 고르는 대표 동작. 전부 휴지통행이면 `trash`, 섞였으면 `remove`. */
  kind: BubbleDeleteKind;
  /** 실제로 지워지는 것의 총 개수(버블 + 엣지 + 메모 상자 + 캡처). */
  count: number;
}

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

/**
 * 고른 것들을 지우면 무엇이 되는가.
 *
 * `inTrashView` 면 **버려진 것의 영구 삭제만** 담는다 — 휴지통 안에서 일반 경로로 흘리면 이미
 * 버려진 것을 다시 옮기려다 실패해 화면에서만 사라진다(§5.10 v4.84 ②).
 */
export function planSelectionDelete(
  nodes: readonly SelectedFlowNode[],
  edges: readonly SelectedFlowEdge[],
  nodeMap: Record<string, DeletableBubble | undefined>,
  opts: { inTrashView: boolean },
): SelectionDeletePlan {
  const plan: SelectionDeletePlan = {
    purgeIds: [], bubbleIds: [], taskEdgeIds: [], commentBoxIds: [], captureIds: [],
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
    + plan.taskEdgeIds.length + plan.commentBoxIds.length + plan.captureIds.length;

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
  deleteCommentBox: (id: string) => void | Promise<void>;
  deleteCaptureBubble: (id: string) => void | Promise<void>;
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
  if (plan.bubbleIds.length > 0) {
    // 한 번의 스냅샷으로 동시에 사라지게 — 배치 창구 하나로 보낸다.
    void fetch('/api/bubbles/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: plan.bubbleIds }),
    }).catch(() => {});
  }
}

/**
 * 묶음 문구의 번역 키. 단건과 **다른 키**를 쓴다 — "삭제"와 "3개 삭제"는 언어마다 어순·수 표현이
 * 달라 한 문장에 수를 끼워 넣으면 12개 로케일 중 몇은 반드시 어색해진다.
 */
export function bubbleDeleteBatchLabelKey(kind: BubbleDeleteKind): string | null {
  switch (kind) {
    case 'purge': return 'canvas.bubbleMenu.deleteForeverN';
    case 'trash': return 'canvas.bubbleMenu.moveToTrashN';
    case 'remove': return 'canvas.bubbleMenu.deleteN';
    case 'worktree': return 'canvas.bubbleMenu.deleteN';
    case 'none': return null;
  }
}
