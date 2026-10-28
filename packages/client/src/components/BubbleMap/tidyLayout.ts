import type { BubbleType, NodeStatus, TidyBand, TidyGeometry } from '@vibisual/shared';
import { SATELLITE_ORBIT_GAP, SATELLITE_RING_SPACING, TIDY_BAND_ORDER, TIDY_LAYOUT } from '@vibisual/shared';

/**
 * §5.4 #33 버블 정리 — 흩어진 버블을 "지금 봐야 하는 순서"로 앉히는 순수 기하(물리는 겹침만 밀고 자리의 뜻은 말하지 않는다).
 * 기하는 둘(I-1): 순위 있는 기준은 **줄 세우기**(`layoutRows`), 순위 없는 분류는 **덩어리**(`layoutClusters`).
 * 동심 띠로 되돌리지 않는다 — 시작점이 없어 순서가 읽히지 않는다. `packRings` 는 덩어리끼리·위성 궤도가 쓴다.
 */

/** 정리에 태울 버블 하나. */
export interface TidyItem {
  id: string;
  /** 렌더 지름(px). `BubbleNode` 와 **같은 자**여야 한다 — 어긋나면 그 버블만 다른 크기로 앉아 이웃을 밟는다. */
  diameter: number;
  /** §5.4 #33 (I) 무리 키. 뜻(띠·종류·분위·에이전트 id)은 **이 모듈이 모른다** — 나눔은 `tidySort.ts`, 여기는 `groupOrder` 순서만(§3.3). */
  group: string;
  /** §5.4 #33 (I-5) 무리 안 순서 — 작을수록 앞(`rankById`, 뜻은 모른다). 없으면 맨 뒤·동점은 `id` 순. 줄 세우기만 쓴다. */
  rank?: number;
  /** 지금 중심 좌표. 자리 배정을 "덜 움직이는 쪽"으로 기울이는 데만 쓴다. */
  cx: number;
  cy: number;
}

/** 정리 후 그 버블이 앉을 자리. */
export interface TidyPlacement {
  id: string;
  /** 목표 **중심** 좌표(좌상단 ❌ — 지름이 제각각이라 중심이 유일한 공통 기준이다). */
  cx: number;
  cy: number;
  /** 몇 번째 칸인가 — 출발을 어긋나게 해 앞 칸부터 차례로 앉힌다(줄은 위→아래, 덩어리는 안→밖). 순서의 정본은 이 수 하나. */
  bandIndex: number;
}

export interface TidyLayoutOptions {
  center: { x: number; y: number };
  /**
   * 세로 눌림(0<a≤1, 바운딩 박스 세로/가로). 넓은 화면에서 정원이면 위아래가 박스를 넘어 물리 클램프에 눌린다(하한 `TIDY_LAYOUT.MIN_ASPECT`).
   * 줄 세우기에선 세로가 상자를 넘쳤는지 재는 데 쓴다(I-5).
   */
  aspect: number;
  /** `tidySort.ts` 의 `TidyGrouping.order` 그대로. 없으면 `TIDY_BAND_ORDER`(급한 순). */
  groupOrder?: readonly string[];
  /** §5.4 #33 (I-1) — 순위 없는 분류를 줄로 세우지 않기 위한 축(기본 `rows`). */
  geometry?: TidyGeometry;
  /** §5.4 #33 (I-5) 바운딩 박스 가로(px). 한 줄 예산을 이 값의 `LANE_FILL` 배로 묶는다 — 넘기면 물리 클램프가 정리한 모양을 도로 누른다. 없으면 상한 없음. */
  width?: number;
  /** §5.4 #33 (I-3) 무리 키 → 가운데에 고정할 버블(덩어리만, `lineage` 의 에이전트). `kind` 는 넘기지 않아 그 그림은 그대로다. */
  anchorByGroup?: ReadonlyMap<string, string>;
}

interface RingPackOptions {
  center: { x: number; y: number };
  aspect: number;
  /** 이 반경(px) 밖에서 시작한다 — 앞 띠의 바깥 테두리 또는 부모 버블의 반경. */
  startEdge: number;
  /** 첫 고리 앞에 두는 여백(px). */
  gapBefore: number;
  /** 첫 고리의 최소 반경(px). 위성 궤도에는 하한이 없어 0 을 넘긴다. */
  minRadius: number;
  bandIndex: number;
  /** 같은 고리 이웃 간격(px, 기본 `RING_GAP`). 덩어리끼리만 `CLUSTER_GAP` — 덩어리는 빈 자리 말고 경계를 말할 것이 없다. */
  ringGap?: number;
  /** 고리와 고리 사이 간격(px). 기본은 `TIDY_LAYOUT.ROW_GAP` — 위성은 `SATELLITE_RING_SPACING.ROW_GAP`(§5.1 #2-2 (J)). */
  rowGap?: number;
  /**
   * §5.1 #2-2 (J) — 제 크기로 앉는다: 가장 큰 것만 고리 반경에, 작은 것은 앞 테두리와 같은 틈만큼 안쪽에(`zoneSeatRadius` 와 같은 규칙).
   * 작은 위성이 큰 묶음 몸집만큼 밀려나지 않게. 원 고리(aspect 1)에서만 맞다.
   */
  ownRadius?: boolean;
}

interface RingPackResult {
  placements: TidyPlacement[];
  /** 이 묶음이 차지한 **세로 방향** 바깥 테두리(px). 다음 띠가 여기서 이어 간다. */
  outerEdge: number;
}

const TWO_PI = Math.PI * 2;

/** 라마누잔 근사 기준 — 반경 1 타원(1, a)의 둘레. 반경 ρ 의 둘레는 여기에 ρ 를 곱한 값이다. */
function perimeterFactor(aspect: number): number {
  const a = 1;
  const b = aspect;
  return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
}

/** 타원 위 호 길이 표 — 각도 균등 분할은 장축 끝이 촘촘해 큰 버블이 이웃을 밟는다. 반경 1 기준 한 벌, 실제 반경은 곱한다. */
interface ArcTable {
  /** `cum[i]` = 각도 `i * step` 까지의 누적 호 길이(반경 1 기준). */
  cum: Float64Array;
  step: number;
  total: number;
}

function buildArcTable(aspect: number): ArcTable {
  const n = TIDY_LAYOUT.ARC_SAMPLES;
  const step = TWO_PI / n;
  const cum = new Float64Array(n + 1);
  let acc = 0;
  // |d/dθ (cosθ, a·sinθ)| = sqrt(sin²θ + a²cos²θ) — 사다리꼴 적분.
  const speed = (t: number): number => Math.hypot(Math.sin(t), aspect * Math.cos(t));
  for (let i = 1; i <= n; i++) {
    const t0 = (i - 1) * step;
    const t1 = i * step;
    acc += ((speed(t0) + speed(t1)) / 2) * step;
    cum[i] = acc;
  }
  return { cum, step, total: acc };
}

/** 호 길이 → 각도. 표를 이분 탐색한 뒤 선형 보간. */
function angleAtArc(table: ArcTable, sRaw: number): number {
  const total = table.total;
  let s = sRaw % total;
  if (s < 0) s += total;
  const cum = table.cum;
  let lo = 0;
  let hi = cum.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid]! <= s) lo = mid;
    else hi = mid;
  }
  const span = cum[hi]! - cum[lo]!;
  const frac = span > 0 ? (s - cum[lo]!) / span : 0;
  return (lo + frac) * table.step;
}

/** 각도 → 호 길이(위 함수의 역). 지금 각도를 호 좌표로 옮겨 "가장 덜 도는 회전"을 찾는 데 쓴다. */
function arcAtAngle(table: ArcTable, thetaRaw: number): number {
  let theta = thetaRaw % TWO_PI;
  if (theta < 0) theta += TWO_PI;
  const idx = theta / table.step;
  const lo = Math.min(Math.floor(idx), table.cum.length - 2);
  const frac = idx - lo;
  return table.cum[lo]! + (table.cum[lo + 1]! - table.cum[lo]!) * frac;
}

/** 자리 폭은 **지름에 비례**(등각 분할 ❌). 묶음을 통째로 돌려 **가장 덜 움직이는** 회전을 고른다 — 정리가 버블을 뒤섞지 않게. */
function placeRing(
  ring: TidyItem[],
  rho: number,
  totalWidth: number,
  table: ArcTable,
  opts: {
    center: { x: number; y: number };
    aspect: number;
    bandIndex: number;
    ringGap: number;
    /** 항목마다 앉는 반경 — 없으면 모두 `rho`. 위성은 제 크기로 앞 테두리와의 틈을 같게 둔다(`RingPackOptions.ownRadius`). */
    radiusOf?: (item: TidyItem) => number;
  },
): TidyPlacement[] {
  const { center, aspect, bandIndex, ringGap } = opts;
  const radiusOf = opts.radiusOf ?? ((): number => rho);
  if (ring.length === 0) return [];
  if (ring.length === 1) {
    // 하나뿐이면 방향을 그대로 지킨다(회전 계산은 같은 답을 주지만 각도가 0 인 경우를 피한다).
    const only = ring[0]!;
    const theta = Math.atan2((only.cy - center.y) / (aspect || 1), only.cx - center.x);
    const r = radiusOf(only);
    return [{
      id: only.id,
      cx: center.x + Math.cos(theta) * r,
      cy: center.y + Math.sin(theta) * r * aspect,
      bandIndex,
    }];
  }

  // 지금 각도 순으로 세워 두면 옮겨 가는 길이 서로 가로지르지 않는다.
  const ordered = ring
    .map((item) => ({
      item,
      theta: Math.atan2((item.cy - center.y) / (aspect || 1), item.cx - center.x),
    }))
    .sort((p, q) => (p.theta - q.theta) || (p.item.id < q.item.id ? -1 : 1));

  const arcTotal = table.total * rho;
  const raw: number[] = [];
  let acc = 0;
  for (const { item } of ordered) {
    const width = ((item.diameter + ringGap) / totalWidth) * arcTotal;
    raw.push(acc + width / 2);
    acc += width;
  }

  // 통째 회전량 — 호 좌표를 각도로 바꿔 원형 평균을 낸다(단순 산술 평균은 0/2π 이음매에서 튄다).
  let sumSin = 0;
  let sumCos = 0;
  for (let i = 0; i < ordered.length; i++) {
    const cur = (arcAtAngle(table, ordered[i]!.theta) * rho) / arcTotal * TWO_PI;
    const want = (raw[i]! / arcTotal) * TWO_PI;
    sumSin += Math.sin(cur - want);
    sumCos += Math.cos(cur - want);
  }
  const shift = (Math.atan2(sumSin, sumCos) / TWO_PI) * arcTotal;

  return ordered.map(({ item }, i) => {
    const theta = angleAtArc(table, (raw[i]! + shift) / rho);
    const r = radiusOf(item);
    return {
      id: item.id,
      cx: center.x + Math.cos(theta) * r,
      cy: center.y + Math.sin(theta) * r * aspect,
      bandIndex,
    };
  });
}

/** 안쪽을 가장 빠듯한 반경에서 채우고 넘치면 바깥 줄. 여유는 **세로**로 잰다 — 눌린 타원에서 가장 좁은 곳이라 가로로 재면 위아래가 겹친다. */
function packRings(queue: TidyItem[], opts: RingPackOptions): RingPackResult {
  const { center, aspect, startEdge, minRadius, bandIndex } = opts;
  const ringGap = opts.ringGap ?? TIDY_LAYOUT.RING_GAP;
  const table = buildArcTable(aspect);
  const factor = perimeterFactor(aspect);
  const placements: TidyPlacement[] = [];
  let edge = startEdge;
  let gap = opts.gapBefore;
  let i = 0;

  while (i < queue.length) {
    const ring: TidyItem[] = [];
    let maxR = 0;
    let width = 0;
    let rho = 0;
    while (i < queue.length) {
      const cand = queue[i]!;
      const nextMaxR = Math.max(maxR, cand.diameter / 2);
      const nextWidth = width + cand.diameter + ringGap;
      const rhoClear = Math.max((edge + gap + nextMaxR) / aspect, minRadius);
      const rhoFit = nextWidth / factor;
      // 이미 한 개는 들어갔는데 더 넣으면 고리가 밖으로 밀린다 → 이 고리는 찼다.
      if (ring.length > 0 && rhoFit > rhoClear) break;
      ring.push(cand);
      i++;
      maxR = nextMaxR;
      width = nextWidth;
      rho = Math.max(rhoClear, rhoFit);
    }
    const ringMaxR = maxR;
    placements.push(...placeRing(ring, rho, width, table, {
      center,
      aspect,
      bandIndex,
      ringGap,
      ...(opts.ownRadius === true ? { radiusOf: (item: TidyItem): number => rho - ringMaxR + item.diameter / 2 } : {}),
    }));
    edge = rho * aspect + maxR;
    gap = opts.rowGap ?? TIDY_LAYOUT.ROW_GAP;
  }

  return { placements, outerEdge: edge };
}

/** 중심에서 먼 순서(같으면 id 순 — 같은 입력이 늘 같은 그림을 내게). */
function byDistanceFromCenter(center: { x: number; y: number }) {
  return (p: TidyItem, q: TidyItem): number => {
    const dp = (p.cx - center.x) ** 2 + (p.cy - center.y) ** 2;
    const dq = (q.cx - center.x) ** 2 + (q.cy - center.y) ** 2;
    if (dp !== dq) return dp - dq;
    return p.id < q.id ? -1 : 1;
  };
}

/** 무리 키 → 그 무리의 버블들. `order` 에 없는 키는 뒤에 붙여 **아무도 떨어뜨리지 않는다**. */
function bucketByGroup(
  items: readonly TidyItem[],
  order: readonly string[],
): { buckets: Map<string, TidyItem[]>; keys: string[] } {
  const buckets = new Map<string, TidyItem[]>();
  for (const item of items) {
    const bucket = buckets.get(item.group);
    if (bucket) bucket.push(item);
    else buckets.set(item.group, [item]);
  }
  const keys = order.filter((k) => (buckets.get(k)?.length ?? 0) > 0);
  const seen = new Set(keys);
  // 순서표에 없는 무리 — 나눔과 순서가 한 곳(`tidySort.ts`)에서 나오므로 평소엔 비어 있지만,
  // 어긋나는 날에도 그 버블들이 제자리에 남아 "정리했는데 얘만 안 갔다"가 되지 않게 한다.
  for (const key of buckets.keys()) if (!seen.has(key)) keys.push(key);
  return { buckets, keys };
}

/** `undefined` 는 맨 뒤, 동점은 `id` 순 — 같은 지도를 두 번 정리해도 같은 그림. */
function byRank(p: TidyItem, q: TidyItem): number {
  const rp = p.rank ?? Number.POSITIVE_INFINITY;
  const rq = q.rank ?? Number.POSITIVE_INFINITY;
  if (rp !== rq) return rp - rq;
  return p.id < q.id ? -1 : 1;
}

/** 한 줄 — 여기 든 것들은 왼쪽에서 오른쪽으로 순위 순이다. */
interface RowLine {
  items: TidyItem[];
  /** 이 줄이 실제로 쓰는 가로 폭(px) — 사이 간격 포함, 양 끝 여백 제외. */
  width: number;
  /** 줄 높이 = 이 줄에서 가장 큰 지름. 작은 것은 그 안에서 세로 가운데에 앉는다. */
  height: number;
}

/** 한 칸(무리) — 예산에 맞춰 줄로 접힌 결과. */
interface RowLane {
  key: string;
  lines: RowLine[];
  height: number;
  bandIndex: number;
}

/** 예산 하나로 모든 칸을 줄로 접는다(좌표 없음) — 예산을 바꿔 다시 접어 보려고 접기와 앉히기를 가른다(I-5). */
function foldLanes(
  keys: readonly string[],
  buckets: ReadonlyMap<string, TidyItem[]>,
  budget: number,
): { lanes: RowLane[]; width: number; height: number } {
  const gap = TIDY_LAYOUT.RING_GAP;
  const lanes: RowLane[] = [];
  let width = 0;
  let height = 0;
  keys.forEach((key, bandIndex) => {
    const members = [...(buckets.get(key) ?? [])].sort(byRank);
    const lines: RowLine[] = [];
    let cur: RowLine = { items: [], width: 0, height: 0 };
    for (const item of members) {
      // 한 장뿐인 줄은 예산을 넘어도 그대로 둔다 — 예산보다 큰 버블을 빠뜨리는 것이 더 나쁘다.
      if (cur.items.length > 0 && cur.width + gap + item.diameter > budget) {
        lines.push(cur);
        cur = { items: [], width: 0, height: 0 };
      }
      cur.width += (cur.items.length > 0 ? gap : 0) + item.diameter;
      cur.height = Math.max(cur.height, item.diameter);
      cur.items.push(item);
    }
    if (cur.items.length > 0) lines.push(cur);
    for (const line of lines) width = Math.max(width, line.width);
    const laneHeight = lines.reduce((acc, l) => acc + l.height, 0)
      + Math.max(0, lines.length - 1) * TIDY_LAYOUT.ROW_GAP;
    height += laneHeight;
    lanes.push({ key, lines, height: laneHeight, bandIndex });
  });
  height += Math.max(0, lanes.length - 1) * TIDY_LAYOUT.BAND_GAP;
  return { lanes, width, height };
}

/**
 * §5.4 #33 (I-5) 줄 세우기 — 칸은 위→아래, 칸 안은 왼→오른쪽 순위 순. 모든 줄이 같은 왼쪽 선에서 시작해 그 선이 칸 경계다.
 * 예산은 가장 긴 칸이 한 줄에 드는 폭부터, 상한은 상자 가로의 `LANE_FILL` 배. 세로가 넘치면 예산을 넓혀 다시 접는다(가로로 넓어지는 편이 덜 잘린다).
 */
function layoutRows(
  items: readonly TidyItem[],
  order: readonly string[],
  center: { x: number; y: number },
  aspect: number,
  boxWidth?: number,
): TidyPlacement[] {
  const { buckets, keys } = bucketByGroup(items, order);
  if (keys.length === 0) return [];
  const gap = TIDY_LAYOUT.RING_GAP;

  let longest = 0;
  for (const key of keys) {
    const group = buckets.get(key)!;
    let lane = Math.max(0, group.length - 1) * gap;
    for (const item of group) lane += item.diameter;
    longest = Math.max(longest, lane);
  }
  const cap = boxWidth !== undefined && boxWidth > 0
    ? boxWidth * TIDY_LAYOUT.LANE_FILL
    : Number.POSITIVE_INFINITY;
  let budget = Math.min(longest, cap);
  let folded = foldLanes(keys, buckets, budget);

  const heightCap = cap * aspect; // 상자 세로 × 같은 여유분 (cap 이 무한이면 여기도 무한)
  if (folded.height > heightCap) {
    // 상자 폭에 맞춰 접었는데도 세로가 넘친다 = 버블이 너무 많아 **어떤 폭으로도 상자에 안 들어간다.**
    // 그때는 세로로만 넘치게 두지 않고 **상자와 같은 비율로** 넘친다 — 상자가 가로로 길어 그쪽이
    // 덜 잘리고((B)), 지도의 모양이 상자를 닮아야 화면맞춤 뒤에도 줄이 줄로 보인다.
    let linear = 0;
    let sumDiameter = 0;
    for (const item of items) {
      linear += item.diameter + gap;
      sumDiameter += item.diameter;
    }
    const meanLine = sumDiameter / items.length + TIDY_LAYOUT.ROW_GAP;
    // 줄 수 ≈ linear/W, 높이 ≈ (linear/W)·meanLine. 높이/W = aspect 가 되는 W 가 이 값이다.
    const proportional = Math.sqrt((linear * meanLine) / aspect);
    if (Number.isFinite(proportional) && proportional > budget + 1) {
      budget = proportional;
      folded = foldLanes(keys, buckets, budget);
    }
  }

  // 폭은 **실제로 쓴 폭**으로 가운데를 맞춘다(예산으로 맞추면 내용이 짧은 날 왼쪽으로 쏠린다).
  const left = center.x - folded.width / 2;
  let y = center.y - folded.height / 2;
  const out: TidyPlacement[] = [];
  folded.lanes.forEach((lane, laneIndex) => {
    for (const line of lane.lines) {
      let x = left;
      for (const item of line.items) {
        out.push({
          id: item.id,
          cx: x + item.diameter / 2,
          cy: y + line.height / 2,
          bandIndex: lane.bandIndex,
        });
        x += item.diameter + gap;
      }
      y += line.height + TIDY_LAYOUT.ROW_GAP;
    }
    // 마지막 줄 뒤에 더해 둔 줄 간격을 칸 간격으로 바꾼다(마지막 칸 뒤에는 아무것도 없다).
    y += laneIndex === folded.lanes.length - 1
      ? -TIDY_LAYOUT.ROW_GAP
      : TIDY_LAYOUT.BAND_GAP - TIDY_LAYOUT.ROW_GAP;
  });
  return out;
}

/** 무리의 지금 무게중심 — 덩어리를 "가장 덜 움직이는 방향"에 앉히는 데 쓴다((D) 와 같은 규율). */
function centroidOf(group: readonly TidyItem[]): { x: number; y: number } {
  let sx = 0;
  let sy = 0;
  for (const item of group) { sx += item.cx; sy += item.cy; }
  return { x: sx / group.length, y: sy / group.length };
}

/**
 * §5.4 #33 (I) 덩어리 기하 — 무리마다 구역을 차지하고 구역들이 동심으로 놓인다(순위 없는 분류를 띠에 넣으면 뜻 없는 서열이 생긴다).
 * 두 번 접는다: 무리를 **정원**으로 뭉쳐 반경을 재고, 그 지름의 가상 버블을 `packRings` 로 앉혀 옮긴다 — 타원으로 뭉치면 이웃 덩어리를 밟는다.
 * (I-3) 주인이 있는 무리는 주인이 가운데(`anchors`). 주인 없는 무리(`kind`·`lineage` 마지막)의 그림은 그대로다.
 */
function layoutClusters(
  items: readonly TidyItem[],
  order: readonly string[],
  center: { x: number; y: number },
  aspect: number,
  anchors?: ReadonlyMap<string, string>,
): TidyPlacement[] {
  const { buckets, keys } = bucketByGroup(items, order);
  if (keys.length === 0) return [];

  // ① 무리마다 원점 기준 국소 배치 — 덩어리의 반경을 여기서 얻는다.
  const locals = keys.map((key, clusterIndex) => {
    const group = buckets.get(key)!;
    const anchorId = anchors?.get(key);
    const anchor = anchorId !== undefined ? group.find((g) => g.id === anchorId) : undefined;
    const seed = centroidOf(group);
    const orbiting = anchor ? group.filter((g) => g.id !== anchor.id) : group;
    const queue = [...orbiting].sort(byDistanceFromCenter(seed));
    // 국소 좌표는 원점 기준이지만 각도는 **화면의 지금 방향**을 그대로 지켜야 하므로,
    // 무게중심을 뺀 상대 좌표로 넣는다(그래야 ②로 옮겨도 무리 안의 방향이 보존된다).
    const relative = queue.map((it) => ({ ...it, cx: it.cx - seed.x, cy: it.cy - seed.y }));
    const packed = packRings(relative, {
      center: { x: 0, y: 0 },
      aspect: 1,
      // 주인이 가운데 자리를 먹었으니 둘레는 그 반경 밖에서 시작한다(간격은 이웃 사이와 같은 값).
      startEdge: anchor ? anchor.diameter / 2 : 0,
      gapBefore: anchor ? TIDY_LAYOUT.RING_GAP : 0,
      minRadius: 0,
      bandIndex: clusterIndex,
    });
    const placements = anchor
      ? [{ id: anchor.id, cx: 0, cy: 0, bandIndex: clusterIndex }, ...packed.placements]
      : packed.placements;
    // 한 장뿐인 무리는 반경이 곧 그 버블의 반경이다(`packRings` 의 첫 고리는 지름만큼 벌어진다).
    const radius = anchor
      ? Math.max(packed.outerEdge, anchor.diameter / 2)
      : group.length === 1 ? group[0]!.diameter / 2 : packed.outerEdge;
    return { key, seed, radius, placements, clusterIndex };
  });

  // ② 덩어리 자체를 하나의 버블로 보고 다시 앉힌다.
  const clusterItems: TidyItem[] = locals.map((c) => ({
    id: c.key,
    diameter: c.radius * 2,
    group: c.key,
    cx: c.seed.x,
    cy: c.seed.y,
  }));
  const seats = new Map<string, TidyPlacement>();
  if (clusterItems.length === 1) {
    seats.set(clusterItems[0]!.id, { id: clusterItems[0]!.id, cx: center.x, cy: center.y, bandIndex: 0 });
  } else {
    const packed = packRings(clusterItems, {
      center,
      aspect,
      startEdge: 0,
      gapBefore: 0,
      minRadius: TIDY_LAYOUT.MIN_RADIUS,
      bandIndex: 0,
      ringGap: TIDY_LAYOUT.CLUSTER_GAP,
    });
    for (const seat of packed.placements) seats.set(seat.id, seat);
  }

  // ③ 국소 좌표를 제 덩어리의 자리로 옮긴다. `bandIndex` 는 덩어리 순서 — 안쪽 덩어리부터
  //    차례로 앉아야 (E) 의 "한꺼번에 뒤엉키지 않는다"가 덩어리에서도 성립한다.
  const out: TidyPlacement[] = [];
  for (const cluster of locals) {
    const seat = seats.get(cluster.key);
    if (!seat) continue;
    for (const p of cluster.placements) {
      out.push({ id: p.id, cx: seat.cx + p.cx, cy: seat.cy + p.cy, bandIndex: cluster.clusterIndex });
    }
  }
  return out;
}

/** §5.4 #33 — 최상위 정리 배치. 무리 순서는 `opts.groupOrder`(없으면 `TIDY_BAND_ORDER`). 기본 기하는 줄 세우기 — `geometry` 를 빠뜨려도 순서가 읽힌다. */
export function computeTidyLayout(items: TidyItem[], opts: TidyLayoutOptions): TidyPlacement[] {
  const aspect = Math.min(1, Math.max(TIDY_LAYOUT.MIN_ASPECT, opts.aspect));
  const center = opts.center;
  const order = opts.groupOrder ?? TIDY_BAND_ORDER;
  if (opts.geometry === 'clusters') {
    return layoutClusters(items, order, center, aspect, opts.anchorByGroup);
  }
  return layoutRows(items, order, center, aspect, opts.width);
}

/** 위성 하나 — 부모 곁 궤도로 다시 앉힌다. */
export interface TidySatellite {
  id: string;
  parentId: string;
  diameter: number;
  cx: number;
  cy: number;
  /** §5.1 #2-2 (J) — 묶음 위성의 몸집 반경(`_orbitReach`). 부모 둘레엔 이 몸집으로 앉고(달이 부모를 파고들지 않게), 제 달은 `diameter` 원에 건다. */
  reach?: number;
}

export interface TidyParentSeat {
  cx: number;
  cy: number;
  diameter: number;
  bandIndex: number;
}

/**
 * §5.4 #33 — 위성 정리: 부모 둘레에 `packRings`(정원·최소 반경 없음)로 고르게 다시 건다.
 * 반경은 **`SATELLITE_ORBIT_GAP`** — 물리 스프링 평형점과 같아야 한다. 다르면 정리 직후 스프링이 궤도를 푼다.
 * §5.1 #2-2 (J) — 간격은 `SATELLITE_RING_SPACING`(등장 영역과 같은 값), 묶음은 몸집(`reach`)으로 앉는다.
 */
export function computeTidySatellites(
  satellites: TidySatellite[],
  parents: Map<string, TidyParentSeat>,
): TidyPlacement[] {
  const byParent = new Map<string, TidySatellite[]>();
  for (const sat of satellites) {
    if (!parents.has(sat.parentId)) continue; // 부모가 정리 대상이 아니면 위성도 그 자리에 둔다
    const bucket = byParent.get(sat.parentId);
    if (bucket) bucket.push(sat);
    else byParent.set(sat.parentId, [sat]);
  }

  const out: TidyPlacement[] = [];
  for (const [parentId, sats] of byParent) {
    const seat = parents.get(parentId)!;
    const center = { x: seat.cx, y: seat.cy };
    const queue = sats
      // 위성은 부모 곁 궤도가 곧 제자리라 무리 나눔의 대상이 아니다 — 키는 한 벌이면 족하다.
      //   달을 거느린 위성은 몸집 지름으로 자리를 잡는다(돌려주는 것은 중심이라 그려지는 원은 그대로다).
      .map((s) => ({
        id: s.id,
        diameter: typeof s.reach === 'number' && Number.isFinite(s.reach) && s.reach * 2 > s.diameter ? s.reach * 2 : s.diameter,
        group: 'satellite',
        cx: s.cx,
        cy: s.cy,
      }))
      .sort(byDistanceFromCenter(center));
    const packed = packRings(queue, {
      center,
      aspect: 1,
      startEdge: seat.diameter / 2,
      gapBefore: SATELLITE_ORBIT_GAP,
      minRadius: 0,
      bandIndex: seat.bandIndex,
      ringGap: SATELLITE_RING_SPACING.NEIGHBOR_GAP,
      rowGap: SATELLITE_RING_SPACING.ROW_GAP,
      ownRadius: true,
    });
    out.push(...packed.placements);
  }
  return out;
}

/**
 * §5.1 #2-1 (B) — 별자리까지 정리: 한 바퀴는 부모가 앉은 위성만 걸어, 앉은 위성을 부모로 넘겨 다시 돈다(깊이 1 이라 두 바퀴, 상한은 그물).
 * 부모가 정리 대상이 아닌 위성(앱 노드 둘레)은 그대로 둔다.
 */
export function computeTidySatellitesNested(
  satellites: TidySatellite[],
  parents: Map<string, TidyParentSeat>,
): TidyPlacement[] {
  const seats = new Map(parents);
  const diameterById = new Map(satellites.map((s) => [s.id, s.diameter] as const));
  let remaining = satellites;
  const out: TidyPlacement[] = [];
  for (let pass = 0; pass < TIDY_SATELLITE_PASSES && remaining.length > 0; pass += 1) {
    const placed = computeTidySatellites(remaining, seats);
    if (placed.length === 0) break;
    const placedIds = new Set<string>();
    for (const p of placed) {
      placedIds.add(p.id);
      seats.set(p.id, { cx: p.cx, cy: p.cy, diameter: diameterById.get(p.id) ?? 0, bandIndex: p.bandIndex });
    }
    out.push(...placed);
    remaining = remaining.filter((s) => !placedIds.has(s.id));
  }
  return out;
}

/** 위성 정리를 몇 바퀴까지 도나 — 폴더 위성 한 바퀴 + 별자리 위성 한 바퀴, 그리고 여유 한 바퀴. */
const TIDY_SATELLITE_PASSES = 3;

/** `back`/`root` 는 자리가 곧 뜻인 탐색 손잡이, `bash` 는 캔버스에 그리지 않는다(§2.4). */
const TIDY_EXCLUDED_TYPES: ReadonlySet<BubbleType> = new Set<BubbleType>(['back', 'root', 'bash']);
/** 상태로 띠가 갈리는 버블 — 에이전트 계열. 나머지는 종류가 곧 띠다. */
const TIDY_AGENT_TYPES: ReadonlySet<BubbleType> = new Set<BubbleType>(['agent', 'auto', 'pipeline']);
/** 자리(폴더) 계열 — worktree 도 "그 안에서 일하는 자리"라 같은 띠에 선다. */
const TIDY_FOLDER_TYPES: ReadonlySet<BubbleType> = new Set<BubbleType>(['internal_folder', 'external_folder', 'worktree']);

/** 새 상태는 여기 한 줄로만(§3.3) — 빠뜨리면 `Record<NodeStatus, …>` 가 타입 검사에서 잡는다. */
const TIDY_STATUS_BANDS: Record<NodeStatus, TidyBand> = {
  active: 'running',
  awaiting_permission: 'running',
  completed: 'attention',
  error: 'attention',
  idle: 'waiting',
  disappearing: 'waiting',
};

/** §5.4 #33 — 이 버블이 어느 띠인가. **정리하지 않을 것은 `null`.** */
export function tidyBandOf(bubbleType: BubbleType, status: NodeStatus): TidyBand | null {
  if (TIDY_EXCLUDED_TYPES.has(bubbleType)) return null;
  if (TIDY_FOLDER_TYPES.has(bubbleType)) return 'folder';
  if (TIDY_AGENT_TYPES.has(bubbleType)) return TIDY_STATUS_BANDS[status];
  return 'other';
}
