import type { BubbleType, NodeStatus, TidyBand, TidyGeometry } from '@vibisual/shared';
import { SATELLITE_ORBIT_GAP, TIDY_BAND_ORDER, TIDY_LAYOUT } from '@vibisual/shared';

/**
 * §5.4 #33 **버블 정리** — 흩어진 버블을 "지금 봐야 하는 순서"로 앉히는 순수 기하.
 *
 * 물리(`usePhysicsLayout`)와 역할이 다르다. 물리는 **겹치지 않게** 밀어낼 뿐 어디에 놓을지는
 * 말하지 않아서, 오래 쓴 캔버스는 겹치진 않지만 아무 뜻도 없는 배치로 굳는다. 여기서 정하는 것은
 * 그 "뜻" — 도는 것이 맨 윗 줄, 손이 가야 하는 것이 그다음, 쉬는 것과 자리(폴더)가 아래.
 *
 * 기하는 둘이다(§5.4 #33 I-1) — 순위 있는 기준은 **줄 세우기**(`layoutRows`), 순위 없는 분류는
 * **덩어리**(`layoutClusters`). 종전의 동심 띠는 2026-09-12 에 폐기했다(고리에 시작점이 없어
 * 순서가 읽히지 않았다). 고리를 만드는 `packRings` 는 남아 있다 — 덩어리를 서로 앉히는 자리와
 * 위성 궤도가 그 기하를 쓴다.
 *
 * **UI 없이 검증한다.** 좌표·기하는 렌더링 없이 확인하는 편이 정확하다(`physicsGeometry`·
 * `bubbleTextFit` 선례) — 겹침 여부와 띠 순서를 `tidyLayout.test.ts` 가 숫자로 고정한다.
 */

/** 정리에 태울 버블 하나. */
export interface TidyItem {
  id: string;
  /**
   * 화면에 그려지는 지름(px). `BubbleNode` 가 쓰는 자와 **같은 값**이어야 한다 —
   * 어긋나면 그 버블만 다른 크기로 앉아 이웃을 밟는다(`findRadius` 가 세운 규율과 같다).
   */
  diameter: number;
  /**
   * §5.4 #33 (I) 이 버블이 속한 **무리의 키**. 뜻은 기준마다 다르다(띠 이름 · 버블 종류 ·
   * 분위 · 에이전트 id) — **이 모듈은 그 뜻을 알지 못한다.** 나눔은 `tidySort.ts` 가 쥐고,
   * 여기는 `groupOrder` 대로 순서만 지켜 앉힌다. 그래야 새 기준이 기하를 건드리지 않는다(§3.3).
   */
  group: string;
  /**
   * §5.4 #33 (I-5) 무리 **안에서** 서는 순서 — **작을수록 앞(왼쪽)**. `tidySort.ts` 의
   * `rankById` 가 낸 값이고, **이 모듈은 그 수가 무엇을 센 것인지 알지 못한다**(히트인지 시각인지).
   * 없으면 맨 뒤로 밀리고 동점은 `id` 순 — 줄 세우기에서만 쓰인다(덩어리는 보지 않는다).
   */
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
  /**
   * 몇 번째 칸인가. 출발 시각을 어긋나게 해 **앞 칸부터 차례로** 앉게 하는 데 쓴다
   * (줄 세우기는 위에서 아래로, 덩어리는 안쪽에서 바깥으로 — 순서의 정본은 이 수 하나다).
   */
  bandIndex: number;
}

export interface TidyLayoutOptions {
  center: { x: number; y: number };
  /**
   * 세로 눌림(0<a≤1) — 캔버스 바운딩 박스의 세로/가로 비. 넓은 화면에서 정원(正圓)으로 두면
   * 좌우가 텅 비고 위아래가 박스를 넘어가 물리 클램프에 눌린다. `TIDY_LAYOUT.MIN_ASPECT` 로 하한.
   * 줄 세우기에서는 **세로가 상자를 넘쳤는지**를 재는 데 쓴다(I-5).
   */
  aspect: number;
  /**
   * §5.4 #33 (I) 무리가 서는 순서 — `tidySort.ts` 가 낸 `TidyGrouping.order` 를 그대로 넘긴다.
   * 안 주면 종전대로 `TIDY_BAND_ORDER`(급한 순).
   */
  groupOrder?: readonly string[];
  /**
   * §5.4 #33 (I) 기하 — 줄 세우기(`rows`, 기본)인가 덩어리(`clusters`)인가.
   * **순위가 없는 분류를 줄로 세우지 않기 위한 축이다**(SSOT §5.4 #33 I-1).
   */
  geometry?: TidyGeometry;
  /**
   * §5.4 #33 (I-5) 캔버스 바운딩 박스의 **가로 전체**(px). 줄 세우기가 한 줄의 예산을 이 값의
   * `TIDY_LAYOUT.LANE_FILL` 배로 묶는다 — 넘겨 앉히면 물리 클램프가 도로 눌러 정리한 모양이
   * 앉자마자 망가진다((B)). 안 주면 예산에 상한이 없다(가장 긴 칸이 한 줄로 선다).
   */
  width?: number;
  /**
   * §5.4 #33 (I-3) 무리 키 → 그 무리의 **가운데에 고정할 버블**(덩어리 기하만). `lineage` 의
   * 에이전트가 여기 든다. `kind` 는 넘기지 않으므로 그 그림은 바뀌지 않는다.
   */
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
  /**
   * 같은 고리에서 이웃 사이에 두는 간격(px). 기본은 `TIDY_LAYOUT.RING_GAP` 이고,
   * **덩어리끼리 앉힐 때만** `CLUSTER_GAP` 으로 넓힌다 — 동심 띠는 고리라는 모양이 경계를
   * 말해 주지만 덩어리는 빈 자리 말고 경계를 말할 것이 없다(§5.4 #33 I-1).
   */
  ringGap?: number;
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

/**
 * 타원 위의 **호 길이 표** — 각도가 아니라 호 길이로 자리를 나누기 위한 것.
 *
 * 각도를 균등하게 나누면 타원에서는 장축 끝이 촘촘해져 큰 버블이 이웃을 밟는다. 반경 1 기준으로
 * 한 번 만들어 두고 실제 반경 ρ 는 곱해서 쓴다(표는 각도만의 함수라 고리마다 다시 만들 필요가 없다).
 */
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

/**
 * 고리 하나에 항목을 앉힌다.
 *
 * 자리 폭은 **지름에 비례**한다(등각 분할 ❌ — 지름이 제각각이라 큰 버블이 작은 이웃을 밟는다).
 * 그리고 묶음 전체를 호 방향으로 통째로 돌려, 지금 각도에서 **가장 덜 움직이는** 회전을 고른다 —
 * 정리는 자리를 바꾸는 일이지 버블을 뒤섞는 일이 아니다.
 */
function placeRing(
  ring: TidyItem[],
  rho: number,
  totalWidth: number,
  table: ArcTable,
  opts: { center: { x: number; y: number }; aspect: number; bandIndex: number; ringGap: number },
): TidyPlacement[] {
  const { center, aspect, bandIndex, ringGap } = opts;
  if (ring.length === 0) return [];
  if (ring.length === 1) {
    // 하나뿐이면 방향을 그대로 지킨다(회전 계산은 같은 답을 주지만 각도가 0 인 경우를 피한다).
    const only = ring[0]!;
    const theta = Math.atan2((only.cy - center.y) / (aspect || 1), only.cx - center.x);
    return [{
      id: only.id,
      cx: center.x + Math.cos(theta) * rho,
      cy: center.y + Math.sin(theta) * rho * aspect,
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
    return {
      id: item.id,
      cx: center.x + Math.cos(theta) * rho,
      cy: center.y + Math.sin(theta) * rho * aspect,
      bandIndex,
    };
  });
}

/**
 * 항목을 동심 고리로 채운다 — 안쪽 고리를 **가장 빠듯한 반경**에서 채우고, 넘치면 바깥으로 한 줄.
 *
 * 여유 판정은 **세로 방향**으로 한다. 눌린 타원에서 고리 사이가 가장 좁아지는 곳이 거기라,
 * 가로 기준으로 잡으면 위아래에서 겹친다.
 */
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
    placements.push(...placeRing(ring, rho, width, table, { center, aspect, bandIndex, ringGap }));
    edge = rho * aspect + maxR;
    gap = TIDY_LAYOUT.ROW_GAP;
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

/**
 * §5.4 #33 (I-5) 줄 안에서 서는 순서 — `rank` 가 작을수록 앞(왼쪽).
 *
 * 순위가 없는 것(`undefined`)은 맨 뒤로 밀고, 동점은 `id` 순이다 — 그래야 같은 지도를 두 번
 * 정리해도 같은 그림이 나온다(순위를 지어내지 않으면서 흔들리지도 않는 유일한 방법).
 */
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

/**
 * 예산(한 줄의 최대 폭) 하나로 **모든 칸을 줄로 접는다.** 좌표는 아직 만들지 않는다 —
 * 예산을 바꿔 몇 번 다시 접어 볼 수 있어야 해서 접기와 앉히기를 갈라 두었다(I-5).
 */
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
 * §5.4 #33 (I-5) **줄 세우기 기하** — 칸이 위에서 아래로 순위 순으로 쌓이고, 칸 안은 왼쪽에서
 * 오른쪽으로 순위 순이다.
 *
 * 종전의 동심 띠를 대신한다. 고리는 순위를 말할 수 없었다 — ① 시작점이 없어 순서를 눈으로 좇을
 * 수 없고 ② 같은 칸이 원 둘레를 따라 서로 가장 멀리 갈라져 앉고 ③ 이웃 고리의 반경 차이가
 * 화면에서 거의 같아 칸이 몇 개인지도 세어지지 않는다. 줄은 글을 읽는 순서라 배우지 않아도
 * 읽히고, **모든 줄이 같은 왼쪽 선에서 시작**하므로 그 선 하나가 칸 경계를 그려 준다.
 *
 * 예산은 "가장 긴 칸이 한 줄에 들어가는 폭"에서 출발한다(칸 하나가 한 줄이어야 위→아래가 한눈에
 * 세어진다). 상자 가로의 `LANE_FILL` 배가 상한이고, 그래서 세로가 상자를 넘치면 예산을 넓혀
 * 다시 접는다 — 상자가 가로로 길어 **세로로 넘치는 편보다 가로로 넓어지는 편이 덜 잘린다**((B)).
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
 * §5.4 #33 (I) **덩어리 기하** — 무리마다 제 구역을 차지하고, 그 구역들이 다시 동심으로 놓인다.
 *
 * 순위가 없는 분류(종류·무리)를 동심 띠에 넣으면 두 가지가 잘못된다. ① "왜 파일이 안쪽이고
 * 폴더가 바깥인가"라는 **뜻 없는 서열**이 생기고 ② 같은 종류가 **고리 한 줄로 흩어져** 오히려
 * 멀어진다 — 사용자가 원한 "유사한 것끼리 모이게"의 정반대다.
 *
 * 두 번 접는다. ① 무리를 **원점 기준 정원**(aspect=1)으로 뭉쳐 그 덩어리의 반경을 재고
 * ② 그 반경을 지름으로 삼은 **가상 버블**을 다시 같은 `packRings` 로 앉힌 뒤, ①의 좌표를
 * 그 중심으로 통째로 옮긴다. 덩어리를 정원으로 뭉치는 것은 ②가 지름 하나로만 자리를 잡기
 * 때문이다 — 눌린 타원으로 뭉치면 세운 쪽이 이웃 덩어리를 밟는다.
 *
 * §5.4 #33 (I-3) **주인이 있는 무리는 그 한 장이 가운데에 앉고 나머지가 둘레를 돈다**
 * (`anchors`). 주인이 가장자리에 앉으면 덩어리가 "그냥 뭉친 공"으로 보여 무엇이 그 무리를
 * 만들었는지가 화면에 남지 않는다. 주인이 없는 무리(`kind` 전부·`lineage` 의 마지막 덩어리)는
 * 종전 그대로다 — 그래서 `kind` 의 그림은 한 픽셀도 바뀌지 않는다.
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

/**
 * §5.4 #33 — 최상위 버블의 정리 배치. 무리의 순서는 `opts.groupOrder` 가 정본이고,
 * 안 주면 종전대로 `TIDY_BAND_ORDER`(급한 순)다.
 *
 * 기하는 둘뿐이고 **기본은 줄 세우기**다(§5.4 #33 I-1) — 새 기준이 `geometry` 를 빠뜨려도
 * 순서가 읽히는 쪽에 앉는다. 이 함수 자신은 기준 이름도, `rank` 가 무엇을 센 수인지도 모른다.
 */
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
}

export interface TidyParentSeat {
  cx: number;
  cy: number;
  diameter: number;
  bandIndex: number;
}

/**
 * §5.4 #33 — 위성(파일 점) 정리. 부모가 앉은 자리 둘레에 **고르게** 다시 건다.
 *
 * 부모와 같은 함수(`packRings`)를 쓴다 — 다른 점은 정원(aspect=1)이고 최소 반경이 없다는 것뿐이다.
 * 위성이 많으면 저절로 두 겹, 세 겹 궤도가 된다.
 *
 * **반경은 `SATELLITE_ORBIT_GAP` 이다** — 물리 스프링이 위성을 끌어당기는 평형점(`부모 반경 +
 * 위성 반경 + 이 값`)과 **같은 값**이라야 앉힌 궤도가 그대로 유지된다. 다른 값을 쓰면 정리한
 * 직후부터 스프링이 조금씩 당겨 궤도가 스스로 풀린다.
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
      .map((s) => ({ id: s.id, diameter: s.diameter, group: 'satellite', cx: s.cx, cy: s.cy }))
      .sort(byDistanceFromCenter(center));
    const packed = packRings(queue, {
      center,
      aspect: 1,
      startEdge: seat.diameter / 2,
      gapBefore: SATELLITE_ORBIT_GAP,
      minRadius: 0,
      bandIndex: seat.bandIndex,
    });
    out.push(...packed.placements);
  }
  return out;
}

/**
 * 자리를 옮기지 않는 버블. `back`/`root` 는 탐색 손잡이라 **자리가 곧 뜻이고**(옮기면 되돌아갈
 * 곳을 눈으로 찾아야 한다), `bash` 는 애초에 캔버스에 그리지 않는다(§2.4 v4.48).
 */
const TIDY_EXCLUDED_TYPES: ReadonlySet<BubbleType> = new Set<BubbleType>(['back', 'root', 'bash']);
/** 상태로 띠가 갈리는 버블 — 에이전트 계열. 나머지는 종류가 곧 띠다. */
const TIDY_AGENT_TYPES: ReadonlySet<BubbleType> = new Set<BubbleType>(['agent', 'auto', 'pipeline']);
/** 자리(폴더) 계열 — worktree 도 "그 안에서 일하는 자리"라 같은 띠에 선다. */
const TIDY_FOLDER_TYPES: ReadonlySet<BubbleType> = new Set<BubbleType>(['internal_folder', 'external_folder', 'worktree']);

/**
 * 에이전트 상태 → 띠. **새 상태는 여기 한 줄 추가로만**(§3.3 config 테이블) —
 * 빠뜨리면 `Record<NodeStatus, …>` 가 타입 검사에서 잡는다.
 */
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
