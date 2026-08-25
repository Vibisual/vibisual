// §5.5 #17-34 — IDE **창 안**의 화면 분할(멀티뷰) 트리와 그 연산.
//
// 어휘를 먼저 못 박는다. **창(pane)** 은 §5.5 #17-1 이 다루는 IDE 오버레이 그 자체(캔버스 위에 뜨고
// 네 변에 도킹되는 것)이고, 여기서 다루는 **칸(cell)** 은 그 창 **안쪽**을 세로/가로로 가른 한 조각이다.
// 두 축은 서로를 모른다 — 창을 셋 띄우든 하나를 셋으로 가르든 각자 자기 축에서만 셈한다.
//
// 이 파일은 DOM 도 React 도 만지지 않는다. 트리(무엇이 어디에 있는가)와 그 변형(끼우기·닫기·비율)만
// 답하고, 좌표→어느 변인가 판정은 `splitDrop.ts` 가 맡는다(`tabPushGeom`·`floatingWindowGeom` 선례 —
// 기하를 컴포넌트 안에서 계산하면 회귀를 시험으로 못 잡는다).

/** 가지가 자식을 늘어놓는 방향. `row` = 좌우로 나란히, `col` = 위아래로 포갬. */
export type SplitAxis = 'row' | 'col';

/** 분할 손맛의 모든 수치 — 값 조정은 여기 한 곳(매직넘버 산개 ❌). */
export const IDE_SPLIT = {
  /**
   * 한 창 안에 둘 수 있는 칸의 최대 개수. 칸 하나가 `IDEMainArea` 한 벌(가상 리스트 + 입력창)이라
   * 무한정 늘리면 창 하나가 앱 전체를 느리게 만든다. §3.2.3 개수 상한 규약과 같은 결.
   */
  maxCells: 6,
  /** 칸 하나가 차지할 수 있는 최소 비율. 이보다 얇아지면 본문이 글자 한 줄도 못 담는다. */
  minCellRatio: 0.12,
  /** 칸 사이 손잡이 두께(px). 도킹 손잡이(#17-1)와 같은 굵기라 손맛이 이어진다. */
  splitterPx: 4,
  /**
   * 손잡이의 **잡히는 폭**을 양옆으로 넓히는 여유(px). 보이는 것은 4px 그대로지만 실제로 집히는
   * 띠는 `4 + 2×pad` 다 — 4px 짜리 표적을 정확히 겨누게 하는 것은 눈에 안 보이는 마찰이고
   * (피츠의 법칙), 사용자는 "손잡이가 잘 안 잡힌다"로만 느낀다.
   */
  splitterHitPadPx: 6,
  /**
   * 칸이 **글자를 담을 수 있는** 최소 폭·높이(px). 비율 하한(`minCellRatio`)만으로는 못 막는다 —
   * 우측 도크처럼 좁은 창(320px)을 좌우로 나누면 각 칸이 158px 이 되어 스트림도 입력창도
   * 읽히지 않는다. **나눠도 되는가**는 비율이 아니라 실제 픽셀로 물어야 한다.
   */
  minCellWidthPx: 280,
  minCellHeightPx: 200,
} as const;

/** 잎 = 세션 하나를 보여 주는 칸. */
export interface SplitCell {
  kind: 'cell';
  id: string;
  /** 이 칸이 보여 주는 세션. `null` = 메인 탭(에이전트 전체 합본 — Hook 에이전트의 그 탭과 같은 뜻). */
  sessionId: string | null;
}

/** 가지 = 같은 방향으로 자식들을 비율대로 나눠 갖는 마디. */
export interface SplitBranch {
  kind: 'branch';
  id: string;
  axis: SplitAxis;
  /** `children` 과 같은 길이, 합은 항상 1(모든 변형이 `normalizeSizes` 를 지난다). */
  sizes: number[];
  children: SplitNode[];
}

export type SplitNode = SplitCell | SplitBranch;

/** 새 id 를 만드는 손 — 시험에서는 결정적인 것을 넣어 트리를 그대로 비교한다. */
export type SplitIdFactory = (kind: 'cell' | 'branch') => string;

let idSeq = 0;

/** 기본 id 발급기. 같은 밀리초에 여러 개가 나도 겹치지 않게 순번 + 난수를 함께 쓴다. */
export const defaultSplitIdFactory: SplitIdFactory = (kind) => {
  idSeq += 1;
  return `${kind === 'cell' ? 'sc' : 'sb'}-${idSeq.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
};

/** 칸 하나 만들기. */
export function makeCell(sessionId: string | null, newId: SplitIdFactory = defaultSplitIdFactory): SplitCell {
  return { kind: 'cell', id: newId('cell'), sessionId };
}

/** 왼→오른쪽(위→아래) 화면 순서 그대로의 칸 목록. */
export function listCells(node: SplitNode): SplitCell[] {
  if (node.kind === 'cell') return [node];
  return node.children.flatMap(listCells);
}

/** 지금 몇 칸인가. */
export function cellCount(node: SplitNode): number {
  return listCells(node).length;
}

/** 한 칸 더 나눌 수 있는가(상한 도달 판정). */
export function canSplit(node: SplitNode | null): boolean {
  return node === null || cellCount(node) < IDE_SPLIT.maxCells;
}

export function findCell(node: SplitNode, cellId: string): SplitCell | null {
  return listCells(node).find((c) => c.id === cellId) ?? null;
}

/** 지금 칸에 떠 있는 세션 id 집합(메인 탭 `null` 은 빠진다) — 탭바가 "이미 보이는 세션"을 표시할 때 쓴다. */
export function cellSessionIds(node: SplitNode): Set<string> {
  const out = new Set<string>();
  for (const c of listCells(node)) if (c.sessionId !== null) out.add(c.sessionId);
  return out;
}

/** 그 세션을 이미 띄우고 있는 칸(여럿이면 첫 칸). 같은 세션을 두 번 열지 않고 그 칸으로 옮겨 가게. */
export function cellIdForSession(node: SplitNode, sessionId: string | null): string | null {
  return listCells(node).find((c) => c.sessionId === sessionId)?.id ?? null;
}

/**
 * 비율 배열을 자식 수에 맞추고 합을 1로 만든다. 값이 깨져 들어와도(개수 불일치·0·NaN) 화면이
 * 무너지지 않게 하는 마지막 방벽 — 모든 변형이 이 함수를 지나 나간다.
 */
export function normalizeSizes(sizes: readonly number[], count: number): number[] {
  if (count <= 0) return [];
  const even = 1 / count;
  const raw = Array.from({ length: count }, (_, i) => {
    const v = sizes[i];
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : even;
  });
  const total = raw.reduce((a, b) => a + b, 0);
  if (total <= 0) return Array.from({ length: count }, () => even);
  return raw.map((v) => v / total);
}

/**
 * 트리를 항상 같은 모양으로 유지한다.
 * ① 자식 없는 가지는 사라지고 ② 자식이 하나면 그 자식이 가지를 대신하며 ③ **같은 축 중첩은 펴진다**.
 * ③ 이 없으면 좌우로 세 번 가를 때 비율이 층층이 곱해져(0.5 × 0.5) 마지막 칸만 유독 좁아진다.
 */
export function normalizeNode(node: SplitNode): SplitNode | null {
  if (node.kind === 'cell') return node;
  const kids: SplitNode[] = [];
  const sizes: number[] = [];
  const fallback = 1 / Math.max(1, node.children.length);
  node.children.forEach((child, i) => {
    const next = normalizeNode(child);
    if (!next) return;
    const share = node.sizes[i] ?? fallback;
    if (next.kind === 'branch' && next.axis === node.axis) {
      const innerFallback = 1 / Math.max(1, next.children.length);
      next.children.forEach((grand, gi) => {
        kids.push(grand);
        sizes.push(share * (next.sizes[gi] ?? innerFallback));
      });
      return;
    }
    kids.push(next);
    sizes.push(share);
  });
  if (kids.length === 0) return null;
  const only = kids[0];
  if (kids.length === 1 && only) return only;
  return { ...node, children: kids, sizes: normalizeSizes(sizes, kids.length) };
}

/** 형제로 끼우기 — 대상 칸의 몫을 반으로 갈라 새 칸에 준다(옆 칸들은 그대로). */
function insertBeside(branch: SplitBranch, index: number, before: boolean, cell: SplitCell): SplitBranch {
  const children = [...branch.children];
  const sizes = normalizeSizes(branch.sizes, children.length);
  const share = (sizes[index] ?? 1 / children.length) / 2;
  sizes[index] = share;
  const at = before ? index : index + 1;
  children.splice(at, 0, cell);
  sizes.splice(at, 0, share);
  return { ...branch, children, sizes: normalizeSizes(sizes, children.length) };
}

function dropInto(
  node: SplitNode,
  targetCellId: string,
  axis: SplitAxis,
  before: boolean,
  cell: SplitCell,
  newId: SplitIdFactory,
): SplitNode | null {
  if (node.kind === 'cell') {
    if (node.id !== targetCellId) return null;
    // 부모가 없거나 축이 다르다 — 이 칸을 새 가지로 감싼다.
    return {
      kind: 'branch',
      id: newId('branch'),
      axis,
      sizes: [0.5, 0.5],
      children: before ? [cell, node] : [node, cell],
    };
  }
  // 대상이 **직속 자식**이고 축까지 같으면 형제로 끼운다(가지를 더 깊게 만들지 않는다).
  const direct = node.children.findIndex((c) => c.kind === 'cell' && c.id === targetCellId);
  if (direct >= 0 && node.axis === axis) return insertBeside(node, direct, before, cell);
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    if (!child) continue;
    const next = dropInto(child, targetCellId, axis, before, cell, newId);
    if (!next) continue;
    const children = [...node.children];
    children[i] = next;
    return { ...node, children };
  }
  return null;
}

/** 드롭 결과 — 바뀐 트리와, 그 뒤 초점을 받을 칸. */
export interface SplitDropResult {
  layout: SplitNode;
  focusCellId: string;
}

/**
 * 세션을 대상 칸의 한 변(또는 가운데)에 떨군다.
 * - 가운데(`center`) = 그 칸의 내용만 이 세션으로 갈아 끼운다(칸 수 불변).
 * - 네 변 = 그 칸을 갈라 새 칸을 만든다. 상한(`maxCells`)에 닿았으면 `null`(호출자가 알린다).
 */
export function dropOnCell(
  layout: SplitNode,
  targetCellId: string,
  side: 'left' | 'right' | 'top' | 'bottom' | 'center',
  sessionId: string | null,
  newId: SplitIdFactory = defaultSplitIdFactory,
): SplitDropResult | null {
  if (!findCell(layout, targetCellId)) return null;
  if (side === 'center') {
    return { layout: setCellSession(layout, targetCellId, sessionId), focusCellId: targetCellId };
  }
  if (!canSplit(layout)) return null;
  const axis: SplitAxis = side === 'left' || side === 'right' ? 'row' : 'col';
  const before = side === 'left' || side === 'top';
  const cell = makeCell(sessionId, newId);
  const next = dropInto(layout, targetCellId, axis, before, cell, newId);
  if (!next) return null;
  const normalized = normalizeNode(next);
  if (!normalized) return null;
  return { layout: normalized, focusCellId: cell.id };
}

/** 칸 하나의 내용(세션)만 교체. */
export function setCellSession(layout: SplitNode, cellId: string, sessionId: string | null): SplitNode {
  if (layout.kind === 'cell') return layout.id === cellId ? { ...layout, sessionId } : layout;
  return {
    ...layout,
    children: layout.children.map((c) => setCellSession(c, cellId, sessionId)),
  };
}

/** 칸 닫기 — 마지막 칸을 닫으면 `null`(= 분할 없음, 종전 단일 화면으로 복귀). */
export function closeCell(layout: SplitNode, cellId: string): SplitNode | null {
  if (layout.kind === 'cell') return layout.id === cellId ? null : layout;
  const kids: SplitNode[] = [];
  const sizes: number[] = [];
  const fallback = 1 / Math.max(1, layout.children.length);
  layout.children.forEach((child, i) => {
    const next = closeCell(child, cellId);
    if (!next) return;
    kids.push(next);
    sizes.push(layout.sizes[i] ?? fallback);
  });
  if (kids.length === 0) return null;
  return normalizeNode({ ...layout, children: kids, sizes: normalizeSizes(sizes, kids.length) });
}

/** 사라진 세션을 문 칸을 걷어낸다(메인 탭 `null` 은 언제나 유효). 남는 칸이 없으면 `null`. */
export function pruneCells(layout: SplitNode, isValidSession: (sessionId: string) => boolean): SplitNode | null {
  if (layout.kind === 'cell') {
    return layout.sessionId === null || isValidSession(layout.sessionId) ? layout : null;
  }
  const kids: SplitNode[] = [];
  const sizes: number[] = [];
  const fallback = 1 / Math.max(1, layout.children.length);
  layout.children.forEach((child, i) => {
    const next = pruneCells(child, isValidSession);
    if (!next) return;
    kids.push(next);
    sizes.push(layout.sizes[i] ?? fallback);
  });
  if (kids.length === 0) return null;
  return normalizeNode({ ...layout, children: kids, sizes: normalizeSizes(sizes, kids.length) });
}

/** 그 칸이 닫힌 뒤 초점을 물려받을 이웃 칸(화면 순서상 앞, 없으면 뒤). */
export function adjacentCellId(layout: SplitNode, cellId: string): string | null {
  const cells = listCells(layout);
  const idx = cells.findIndex((c) => c.id === cellId);
  if (idx < 0) return null;
  return cells[idx - 1]?.id ?? cells[idx + 1]?.id ?? null;
}

/** 손잡이를 끌어 비율 바꾸기 — `index` 는 자식 `index` 와 `index+1` 사이의 손잡이. */
export function moveSplitter(layout: SplitNode, branchId: string, index: number, deltaRatio: number): SplitNode {
  if (layout.kind === 'cell') return layout;
  if (layout.id === branchId) {
    const sizes = normalizeSizes(layout.sizes, layout.children.length);
    const a = sizes[index];
    const b = sizes[index + 1];
    if (a === undefined || b === undefined) return layout;
    const min = IDE_SPLIT.minCellRatio;
    // 양쪽 다 최소 비율 아래로 못 내려간다 — 손을 더 끌어도 그 지점에서 멈춘다.
    const delta = Math.max(min - a, Math.min(b - min, deltaRatio));
    if (Math.abs(delta) < 1e-6) return layout;
    const next = [...sizes];
    next[index] = a + delta;
    next[index + 1] = b - delta;
    return { ...layout, sizes: normalizeSizes(next, next.length) };
  }
  return { ...layout, children: layout.children.map((c) => moveSplitter(c, branchId, index, deltaRatio)) };
}

/**
 * 고르게 나눈 비율 — 손잡이 더블클릭(균등 분배)의 값.
 * `normalizeSizes` 가 빈 배열을 이미 고르게 펴 주지만, 부르는 쪽에서 뜻이 읽히도록 이름을 준다.
 */
export function evenSplitSizes(count: number): number[] {
  return normalizeSizes([], count);
}

/** 비율을 통째로 지정(창 크기 변화·초기화용). */
export function setBranchSizes(layout: SplitNode, branchId: string, sizes: readonly number[]): SplitNode {
  if (layout.kind === 'cell') return layout;
  if (layout.id === branchId) {
    return { ...layout, sizes: normalizeSizes(sizes, layout.children.length) };
  }
  return { ...layout, children: layout.children.map((c) => setBranchSizes(c, branchId, sizes)) };
}
