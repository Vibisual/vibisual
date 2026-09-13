/**
 * §5.5 #17-17 ⑫(c)·⑭(c)(d)·⑰(a)·⑲(c)·⑳·㉖ — **무대 캔버스의 자리와 선을 뜻으로 바꾼다.**
 *
 * ⑳ 로 갈렸다: **자리는 자리고, 흐름은 선이다.** 노드를 끌어 놓는 것은 자리만 바꾸고(클라 로컬),
 * 차례와 행은 **핀(작은 원)을 끌어 다른 단계에 꽂을 때만** 바뀐다(`wireAfter`). 종전(⑭(d)·⑰(a)①)의
 * "세로가 차례를 정한다"는 판정은 그래서 없다 — 좌표를 정렬해 차례를 얻는 순간, 보기 좋게 옮긴
 * 손짓이 실행을 바꾼다(사용자 지시 "이동 시킨게 바로 바로 연결되서 실행을 바꾸는게 아니라").
 *
 * 남는 좌표 판정은 하나뿐이다 — **우클릭한 자리에 새 노드가 서면 목록의 어디인가**(`placeNewAt`).
 * 좌표가 더는 차례를 말하지 않으므로 전체를 다시 세지 않고, **가장 가까운 노드**에 기대어 그 앞·뒤·옆에
 * 끼운다 — 있는 차례는 한 칸도 흔들지 않는다(다시 세면 사용자가 선으로 짠 차례가 좌표 순으로 도로
 * 섞인다).
 *
 * 저장 형식은 여전히 순서 목록 + 행 표식(`parallel` — "바로 앞 단계와 같은 행")이다 — 그래프 자료구조를
 * 새로 들이지 않는다. 여기서 하는 일은 (선 · 자리) → (순서 + 표식) 한 벌을 내는 것뿐이다.
 * 전부 순수 함수다 — 클라 테스트에는 DOM 이 없어 렌더로는 이 판정을 확인할 수 없다.
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

/**
 * ⑳ — **선을 잇는다: `target` 이 `source` 바로 다음에 선다.**
 *
 * 블루프린트의 실행 선 그대로다 — 한 단계의 아래 핀에서 다른 단계의 위 핀으로 선을 끌면 그 단계가
 * **바로 다음 행**에 제 행 하나로 선다. 원래 있던 자리에서는 빠지고(그 행이 비면 행도 사라진다),
 * `source` 뒤에 서 있던 것들은 한 행씩 밀려 새 단계 **뒤**에 이어진다(끊긴 선은 없다 — 목록은 언제나
 * 한 줄로 이어진다).
 *
 * 보낼 것이 없으면 `null` 이다 — 자기 자신에게 잇기 · 모르는 id · **이미 바로 다음 행에 서 있는 단계**
 * (그 선은 이미 화면에 그려져 있다 — 옆에 형제가 있어도 "이미 이어졌다"로 본다. 형제에서 떼는 손잡이는
 * 노드 메뉴 [줄에서 떼기]다).
 */
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

/**
 * ㉖(c) — **사용자가 그은 선 하나.** 무대에 그려지는 선은 이 목록에서만 나온다 — 차례에서 선을
 * 짓던 ⑰(a) 의 팬아웃·팬인은 걷었다(긋지도 않은 선이 화면에 서던 자리).
 */
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
 * ㉖(c) — **선을 하나 긋는다.** 바뀐 것이 없으면 **받은 배열을 그대로** 돌려준다(무변화 프레임에
 * 새 배열을 만들면 그만큼 헛되이 다시 그린다 — `collectMeasured` 와 같은 규율).
 *
 * - 자기 자신 · 이미 있는 선 → 그대로.
 * - **반대 방향 선이 이미 있으면 그것을 걷고 새 선을 넣는다** — 방향을 뒤집는 손짓으로 읽는다
 *   (끊고 다시 긋게 하면 같은 일에 손이 두 번 든다).
 * - 그 밖에 **순환을 만드는 선은 긋지 않는다** — 무대의 차례는 언제나 위에서 아래로 한 줄이라
 *   (⑳(b) "목록은 언제나 한 줄로 이어진다") 순환한 선은 그릴 수는 있어도 뜻을 가질 수 없다.
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

/**
 * ㉖(e)(h) — 그 단계에 붙은 선을 끊는다. `side` 를 주면 **그 핀의 선만** 걷는다 — 위 핀(`in`)은
 * 들어오는 선(`target`), 아래 핀(`out`)은 나가는 선(`source`). 주지 않으면 양쪽 전부다
 * (노드 메뉴 [선 끊기]).
 */
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

/**
 * ㉖(c) — 양 끝이 **지금 목록에 있는** 선만 남긴다. 단계가 사라지면 그 선도 함께 사라져야 한다 —
 * 남겨 두면 그릴 수 없는 선이 저장고에만 쌓이고(키 개수에 상한이 없는 그 부류), 같은 id 가 다시
 * 나면 옛 선이 되살아난다(죽은 좌표를 남기지 않는 ⑲(b) 와 같은 성격).
 */
export function pruneWires(wires: GoalWire[], liveIds: Iterable<string>): GoalWire[] {
  const live = new Set(liveIds);
  const next = wires.filter((w) => live.has(w.source) && live.has(w.target));
  return next.length === wires.length ? wires : next;
}

/**
 * ㉖(d) — 이 단계에서 **이미 나가는 선**이 있는가. 있으면 새로 꽂는 끝은 제 행을 새로 세우지 않고
 * 그 행에 **합류**한다 — 한 핀에서 갈라진 선 여럿은 "동시에 간다"는 뜻이다(`wireAfter` 의 `joinRow`).
 */
export function hasOutgoing(wires: readonly GoalWire[], source: string, except?: string): boolean {
  return wires.some((w) => w.source === source && w.target !== except);
}

/**
 * ㉖(c) — 그릴 수 있는 선만 골라 낸다. 같은 선이 두 번 들어와도 한 번만 그린다(저장고가 어떤
 * 경로로 더럽혀져도 화면은 한 벌이어야 한다 — 엣지 id 가 겹치면 React Flow 가 경고를 뱉는다).
 */
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
 * ㉖(h)-3 — **차례가 그리는 선도 끊을 수 있다 — 끊은 자리를 기억하는 목록(`goalCuts`).**
 *
 * ㉖(h)-1 은 "인접한 두 행은 정의상 이어져 있으니 그 선을 없애는 유일한 길은 두 행을 합치는
 * 것"이라 보고 행을 합쳤다(`breakAt`). 그 판정이 사용자가 본 결함을 그대로 만들었다 —
 * `[A][B][C][D]` 에서 `C` 의 위 핀을 끊으면 `C` 가 `B` 의 행에 합류해 `[A][B,C][D]` 가 되고,
 * 팬아웃이 곧바로 `A→C` 를 **방금 끊은 그 핀에 다시 그린다**. 화면에서는 "끊으면 자동으로 다시
 * 연결된다"로 읽힌다(사용자 지시 "내가 링크를 끊을 수 있는데 끊으면 자동으로 연결되버리는 문제가 있어").
 *
 * 그래서 끊긴 관계를 **자료로 기억한다.** `goalWires`(그은 선)의 대칭이다 — 그은 선은 차례에 없는
 * 관계를 **더하고**, 끊은 자리는 차례가 그린 관계를 **뺀다**. 차례(순서·행)는 건드리지 않는다:
 * ㉖(e) 의 "걷어도 차례는 건드리지 않는다"를 이 손짓에도 그대로 적용한 것이고, 끊자마자 목록이
 * 뒤섞이던 것이 ⑲ 가 고친 그 오염이다. 나란히(병렬)로 만드는 손잡이는 종전대로 노드 메뉴
 * [나란히 놓기]다 — 끊기와 병렬화를 한 손짓에 묶지 않는다.
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

/**
 * ㉖(h)-3 — **차례(행)가 그리는 선 전부.** 무대의 밑바탕인 ⑰(a) 행 단위 팬아웃·팬인을 그리는 자리와
 * **같은 판정**이다 — 뷰가 따로 세면 "끊을 수 있는 선"과 "그려지는 선"이 조용히 갈린다.
 */
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

/**
 * ㉖(h)·(h)-3 — 이 핀에 **끊을 것이 있는가**. 그은 선이 걸려 있거나, 차례가 그리는 선 중 **아직
 * 끊기지 않은 것**이 있으면 참이다. 거짓이면 메뉴 칸을 세우지 않는다 — 눌러도 아무 일 없는 칸은
 * 없는 칸보다 나쁘다. 한 번 끊은 핀에서 [끊기]가 계속 서 있으면 그 자체로 "안 끊겼다"로 읽힌다.
 */
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
 * ⑭(c)·⑰(a)②·⑳ — **누른 자리에 새 노드가 서면 목록은 어떻게 되는가.**
 *
 * 좌표가 더는 차례를 말하지 않으므로(⑳) 노드 전부를 다시 세지 않는다 — **가장 가까운 노드**를 찾아
 * 그 노드의 행을 기준으로 끼운다. 같은 높이 띠(`band`) 안이면 **그 행에** 선다(왼쪽에 놓으면 행의
 * 첫 노드가 되고 원래 노드가 표식을 받는다 — 종전 그대로), 띠 밖이면 그 노드보다 아래일 때 **다음 행**,
 * 위일 때 **그 행 앞**에 제 행으로 선다. 있는 차례는 한 칸도 흔들리지 않는다.
 *
 * 노드가 하나도 없으면(빈 캔버스, 또는 자리를 모르는 목록) 꼬리에 붙는다.
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
 * ⑲(c) — **파생 배치는 손이 놓은 자리를 피해 흐른다.**
 *
 * 종전 산식은 `y = 행 번호 × 간격` 이었다. 행 번호는 목록의 몇 번째 행인지만 세므로 **손으로 옮긴
 * 노드가 어디에 있든 보지 않는다** — 우클릭으로 끼워 넣은 노드는 누른 자리(임의의 y)에 못 박히고,
 * 끌어 놓은 노드도 마찬가지다. 그 자리 위로 격자가 그대로 지나가면서 카드들이 서로를 덮었다
 * (사용자 지적 "중간에 마음대로 섞여 버리던데" 의 눈에 보이는 절반).
 *
 * 그래서 행 번호 대신 **지금까지 놓인 것들의 실제 바닥**을 따라 내려간다: 새 행의 파생 y 는
 * `바닥 + (간격 − 노드 높이)`. 아무도 손대지 않은 목록에서는 답이 종전과 **한 픽셀도 다르지 않다**
 * (0, gapY, 2·gapY …) — 달라지는 것은 손이 놓은 자리가 섞였을 때뿐이다.
 *
 * 바닥은 뒤로 물러나지 않는다(`Math.max`) — 위로 끌어 올린 노드 하나가 그 뒤의 모든 행을
 * 위로 빨아들여 앞 행들과 겹치는 것을 막는다(⑳ 뒤로 끌어 올린 자리는 차례를 바꾸지 않으므로,
 * 그 노드만 위에 서고 나머지 행은 제자리다).
 *
 * 행 표식이 붙은 노드는 종전대로 **왼쪽 이웃의 실제 자리** 오른쪽에 선다(⑰(a)).
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
