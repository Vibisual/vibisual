/**
 * §5.5 #17-17 ⑫(c)·⑭(c)(d)·⑰(a)·⑲(c)·⑳·㉖ — 무대의 자리·선 → 순서 목록 + 행 표식(`parallel`)(그래프 자료구조 ❌, 전부 순수).
 * ⑳ 노드를 끌면 자리만 바뀌고 차례는 핀을 꽂을 때만(`wireAfter`) — 좌표 정렬로 차례를 얻지 마라. 우클릭 새 노드(`placeNewAt`)만 가장 가까운 노드 곁에 끼운다.
 */

/** 캔버스에 서 있는 노드 하나의 자리. `id` 는 단계 id 다. */
export interface GoalNodePoint {
  id: string;
  x: number;
  /** 노드의 **가운데** 높이 — 위쪽 모서리로 재면 키가 다른 노드끼리 판정이 흔들린다. */
  y: number;
}

/** 저장 형식 한 칸 — 순서 위에 얹힌 행 표식(⑰(a)). 행의 첫 노드는 `false`, 뒤따르는 노드가 `true`. */
export interface GoalRowEntry {
  id: string;
  parallel: boolean;
}

/** ⑰(a) — 누른 자리에 설 새 노드를 판정에 넣을 때 그 가짜 노드의 id. 단계 id 와 겹치지 않는다. */
export const NEW_POINT_ID = '__new__';

/** ⑰(a) — 저장 형식(순서 + 표식)을 행 목록으로 편다. 첫 단계는 표식이 있어도 제 행이다. */
export function rowsOf(entries: readonly GoalRowEntry[]): string[][] {
  const rows: string[][] = [];
  entries.forEach((e, i) => {
    const last = rows[rows.length - 1];
    if (i > 0 && e.parallel && last) last.push(e.id);
    else rows.push([e.id]);
  });
  return rows;
}

/** ⑰(a) — 행 목록을 저장 형식으로 접는다. 행의 첫 노드는 표식이 없고 뒤따르는 노드에 붙는다. */
export function entriesOf(rows: readonly (readonly string[])[]): GoalRowEntry[] {
  const out: GoalRowEntry[] = [];
  for (const row of rows) row.forEach((id, i) => out.push({ id, parallel: i > 0 }));
  return out;
}

/** 순서와 표식이 전부 같은가 — 같으면 보내지 않는다(살짝 흔든 것까지 서버 왕복을 만들지 않게). */
export function sameRows(a: readonly GoalRowEntry[], b: readonly GoalRowEntry[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((e, i) => e.id === b[i]?.id && e.parallel === b[i]?.parallel);
}

/** ⑳ — 선 잇기: `target` 이 `source` 다음 행에 제 행으로 서고 `source` 뒤 것들은 한 행씩 밀린다(옛 자리·빈 행은 빠진다). `null` = 할 일 없음(자기·모르는 id·이미 다음 행 — 떼기는 [줄에서 떼기]). */
export function wireAfter(
  entries: readonly GoalRowEntry[],
  source: string,
  target: string,
  opts?: { joinRow?: boolean },
): GoalRowEntry[] | null {
  if (source === target) return null;
  const rows = rowsOf(entries);
  const si = rows.findIndex((r) => r.includes(source));
  const ti = rows.findIndex((r) => r.includes(target));
  if (si < 0 || ti < 0) return null;
  // 이미 바로 다음 행이면 보낼 것이 없다 — 합류를 청한 경우도 같다(그 행이 곧 다음 행이다).
  if (ti === si + 1) return null;
  const rest = rows.map((r) => r.filter((id) => id !== target)).filter((r) => r.length > 0);
  const at = rest.findIndex((r) => r.includes(source));
  const nextRow = rest[at + 1];
  // ㉖(d) — 한 핀에서 갈라진 선은 **같은 행**이다(병렬). 다음 행이 아직 없으면 새로 세운다.
  if (opts?.joinRow && nextRow) nextRow.push(target);
  else rest.splice(at + 1, 0, [target]);
  return entriesOf(rest);
}

/** ㉖(c) — 사용자가 그은 선 하나. */
export interface GoalWire {
  source: string;
  target: string;
}

/** 같은 선인가 — **방향까지** 같아야 같다. */
function isWire(w: GoalWire, source: string, target: string): boolean {
  return w.source === source && w.target === target;
}

/** `from` 에서 선을 따라가 `to` 에 닿는가 — 순환 판정이 보는 것. */
function reaches(wires: readonly GoalWire[], from: string, to: string): boolean {
  const seen = new Set<string>([from]);
  const stack: string[] = [from];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (cur === undefined) break;
    for (const w of wires) {
      if (w.source !== cur) continue;
      if (w.target === to) return true;
      if (seen.has(w.target)) continue;
      seen.add(w.target);
      stack.push(w.target);
    }
  }
  return false;
}

/**
 * ㉖(c) — 선을 긋는다. 바뀐 게 없으면 받은 배열 그대로(새 배열이면 헛그리기 — `collectMeasured` 와 같다). 자기·중복은 그대로,
 * 반대 방향 선은 걷고 새로 넣으며(방향 뒤집기), 순환을 만드는 선은 긋지 않는다(차례는 위→아래 한 줄, ⑳(b)).
 */
export function addWire(wires: GoalWire[], source: string, target: string): GoalWire[] {
  if (!source || !target || source === target) return wires;
  if (wires.some((w) => isWire(w, source, target))) return wires;
  const base = wires.filter((w) => !isWire(w, target, source));
  if (base.length === wires.length && reaches(base, target, source)) return wires;
  return [...base, { source, target }];
}

/** ㉖(h) — 노드의 어느 핀인가. 위(`in`)는 들어오는 선, 아래(`out`)는 나가는 선의 자리다. */
export type GoalPinSide = 'in' | 'out';

/** ㉖(e) — 선 하나를 끊는다(선 끝을 잡아 빈 자리에 놓았을 때). */
export function removeWire(wires: GoalWire[], source: string, target: string): GoalWire[] {
  const next = wires.filter((w) => !isWire(w, source, target));
  return next.length === wires.length ? wires : next;
}

/** ㉖(e)(h) — 그 단계의 선을 끊는다. `side` 면 그 핀만(`in` = 들어오는 선, `out` = 나가는 선), 없으면 양쪽(노드 메뉴 [선 끊기]). */
export function removeWiresOf(wires: GoalWire[], stepId: string, side?: GoalPinSide): GoalWire[] {
  const next = wires.filter((w) => {
    if (side === 'in') return w.target !== stepId;
    if (side === 'out') return w.source !== stepId;
    return w.source !== stepId && w.target !== stepId;
  });
  return next.length === wires.length ? wires : next;
}

/** ㉖(h) — 그 핀에 걸린 **그은 선**이 하나라도 있는가. */
export function hasWiresAt(wires: readonly GoalWire[], stepId: string, side?: GoalPinSide): boolean {
  return wires.some((w) => {
    if (side === 'in') return w.target === stepId;
    if (side === 'out') return w.source === stepId;
    return w.source === stepId || w.target === stepId;
  });
}

/** ㉖(c) — 양 끝이 목록에 있는 선만 남긴다(남기면 그릴 수 없는 선이 상한 없이 쌓이고, 같은 id 가 다시 나면 되살아난다 — ⑲(b) 와 같다). */
export function pruneWires(wires: GoalWire[], liveIds: Iterable<string>): GoalWire[] {
  const live = new Set(liveIds);
  const next = wires.filter((w) => live.has(w.source) && live.has(w.target));
  return next.length === wires.length ? wires : next;
}

/** ㉖(d) — 이 단계에서 이미 나가는 선이 있나. 있으면 새 끝은 그 행에 합류한다(한 핀에서 갈라진 선 = 동시에 간다, `wireAfter` 의 `joinRow`). */
export function hasOutgoing(wires: readonly GoalWire[], source: string, except?: string): boolean {
  return wires.some((w) => w.source === source && w.target !== except);
}

/** ㉖(c) — 그릴 수 있는 선만, 같은 선은 한 번만(엣지 id 가 겹치면 React Flow 가 경고한다). */
export function drawableWires(
  wires: readonly GoalWire[],
  liveIds: Iterable<string>,
  cuts: readonly GoalWire[] = [],
): GoalWire[] {
  const live = new Set(liveIds);
  const seen = new Set<string>();
  const out: GoalWire[] = [];
  for (const w of wires) {
    if (!live.has(w.source) || !live.has(w.target) || w.source === w.target) continue;
    // ㉖(h)-3 — 끊은 자리는 어느 원천에서 와도 그리지 않는다(그은 선을 끊는 손짓이 끊은 자리도 함께 남긴다).
    if (isCut(cuts, w.source, w.target)) continue;
    const key = `${w.source}->${w.target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ source: w.source, target: w.target });
  }
  return out;
}

/**
 * ㉖(h)-3 — 차례 선도 끊는다: 끊은 자리를 `goalCuts` 에 기억한다(`goalWires` 의 대칭, 차례는 그대로).
 * 행 합치기(`breakAt`)로 끊지 마라 — `C` 를 `B` 행에 합치면 팬아웃이 `A→C` 를 다시 그린다. 병렬화는 노드 메뉴 [나란히 놓기].
 */
export function isCut(cuts: readonly GoalWire[], source: string, target: string): boolean {
  return cuts.some((c) => isWire(c, source, target));
}

/** ㉖(h)-3 — 끊은 자리를 하나 기억한다. 이미 있으면 **받은 배열 그대로**(무변화 프레임에 새 배열 ❌). */
export function addCut(cuts: GoalWire[], source: string, target: string): GoalWire[] {
  if (!source || !target || source === target) return cuts;
  if (isCut(cuts, source, target)) return cuts;
  return [...cuts, { source, target }];
}

/** ㉖(h)-3 — 여러 쌍을 한 번에. 핀 하나에 걸린 선은 팬아웃·팬인이라 여럿일 수 있다. */
export function addCuts(cuts: GoalWire[], pairs: readonly GoalWire[]): GoalWire[] {
  let next = cuts;
  for (const p of pairs) next = addCut(next, p.source, p.target);
  return next;
}

/** ㉖(h)-3 — 차례(행)가 그리는 선 전부. ⑰(a) 팬아웃·팬인을 그리는 자리와 같은 판정이다(뷰가 따로 세면 끊을 선과 그린 선이 갈린다). */
export function rowWires(entries: readonly GoalRowEntry[]): GoalWire[] {
  const rows = rowsOf(entries);
  const out: GoalWire[] = [];
  for (let r = 1; r < rows.length; r++) {
    for (const from of rows[r - 1] ?? []) {
      for (const to of rows[r] ?? []) out.push({ source: from, target: to });
    }
  }
  return out;
}

/**
 * ㉖(h)-3 — 그 핀에 걸린 **차례 선**. 위 핀(`in`)은 앞 행에서 오는 것, 아래 핀(`out`)은 다음 행으로
 * 가는 것, 방향을 주지 않으면 양쪽 전부다(노드 메뉴 [선 끊기]).
 */
export function rowWiresAt(
  entries: readonly GoalRowEntry[],
  stepId: string,
  side?: GoalPinSide,
): GoalWire[] {
  return rowWires(entries).filter((w) => {
    if (side === 'in') return w.target === stepId;
    if (side === 'out') return w.source === stepId;
    return w.source === stepId || w.target === stepId;
  });
}

/** ㉖(h)·(h)-3 — 이 핀에 끊을 것(그은 선·안 끊긴 차례 선)이 있는가. 없으면 메뉴 칸을 세우지 않는다(남은 [끊기]는 "안 끊겼다"로 읽힌다). */
export function canBreakAt(
  entries: readonly GoalRowEntry[],
  wires: readonly GoalWire[],
  stepId: string,
  side: GoalPinSide,
  cuts: readonly GoalWire[] = [],
): boolean {
  if (hasWiresAt(wires, stepId, side)) return true;
  return rowWiresAt(entries, stepId, side).some((w) => !isCut(cuts, w.source, w.target));
}

/**
 * ⑭(c)·⑰(a)②·⑳ — 새 노드는 가장 가까운 노드 기준: 같은 높이 띠(`band`) 안이면 그 행(왼쪽이면 첫 노드가 되고 원래 노드가 표식을 받는다), 아래면 다음 행, 위면 그 행 앞.
 * 있는 차례는 안 흔든다. 노드가 없으면 꼬리.
 */
export function placeNewAt(
  entries: readonly GoalRowEntry[],
  points: readonly GoalNodePoint[],
  at: { x: number; y: number },
  band: number,
): GoalRowEntry[] {
  const rows = rowsOf(entries);
  const known = new Set(rows.flat());
  let nearest: GoalNodePoint | null = null;
  let best = Number.POSITIVE_INFINITY;
  for (const p of points) {
    if (!known.has(p.id)) continue;
    const d = (p.x - at.x) ** 2 + (p.y - at.y) ** 2;
    if (d < best) {
      best = d;
      nearest = p;
    }
  }
  if (!nearest) return [...entriesOf(rows), { id: NEW_POINT_ID, parallel: false }];

  const ri = rows.findIndex((r) => r.includes(nearest.id));
  const row = rows[ri];
  if (row && Math.abs(at.y - nearest.y) <= band) {
    // 옆 — 같은 행. 행 안의 자리는 가로가 정한다: 누른 자리보다 왼쪽에 선 것들의 뒤.
    const byId = new Map(points.map((p) => [p.id, p] as const));
    let idx = 0;
    for (const id of row) {
      const p = byId.get(id);
      if (p && p.x < at.x) idx += 1;
    }
    row.splice(idx, 0, NEW_POINT_ID);
  } else {
    rows.splice(at.y > nearest.y ? ri + 1 : ri, 0, [NEW_POINT_ID]);
  }
  return entriesOf(rows);
}

/** ⑪(f)·⑭(d)·⑰(a)·⑲(c) — 파생 배치가 쓰는 치수. 뷰가 가진 상수를 그대로 받는다(여기서 지어내지 않는다). */
export interface GoalLayoutMetrics {
  nodeW: number;
  nodeH: number;
  /** 같은 행의 노드 사이 가로 간격. */
  gapX: number;
  /** 행과 행 사이 세로 간격(노드 높이 포함 — 노드 높이보다 커야 사이가 벌어진다). */
  gapY: number;
  /** 행의 첫 노드가 서는 왼쪽 열. */
  originX: number;
}

/** 파생 배치가 알아야 하는 단계 한 칸 — id 와 행 표식뿐. */
export interface GoalLayoutStep {
  id: string;
  parallel?: boolean;
}

/**
 * ⑲(c) — 파생 y = 지금까지의 실제 바닥 + (간격 − 노드 높이)(`행 번호 × 간격` ❌ — 손으로 옮긴 노드와 겹친다). 손대지 않은 목록은 0, gapY, 2·gapY ….
 * 바닥은 `Math.max` 로만(위로 올린 노드가 뒤 행을 끌어올리지 않게). 행 표식 노드는 왼쪽 이웃 실제 자리의 오른쪽(⑰(a)).
 */
export function derivePositions(
  steps: readonly GoalLayoutStep[],
  stored: Readonly<Record<string, { x: number; y: number }>> | undefined,
  m: GoalLayoutMetrics,
): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  const clearance = m.gapY - m.nodeH;
  // 첫 행의 파생 y 가 0 이 되도록 바닥을 뒤로 물려 시작한다.
  let bottom = -clearance;
  let prev: { x: number; y: number } | null = null;
  steps.forEach((s, i) => {
    const kept = stored?.[s.id];
    const pos = i > 0 && s.parallel && prev
      ? (kept ?? { x: prev.x + m.nodeW + m.gapX, y: prev.y })
      : (kept ?? { x: m.originX, y: bottom + clearance });
    out.set(s.id, pos);
    prev = pos;
    if (pos.y + m.nodeH > bottom) bottom = pos.y + m.nodeH;
  });
  return out;
}
