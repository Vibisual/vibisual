// §5.5 #17-1 (판올림 번호 발급 대기) — IDE 창 도킹의 **순수 기하**.
//
// 종전 도킹은 "우측 한 곳 + 폭 하나"라 계산이 컴포넌트 안 몇 줄이면 끝났다. 네 변으로 넓히고
// 같은 변에 여러 창을 이어 붙이게 되면서 좌표가 (변 × 스택 순서 × 반대편 도크) 의 함수가 됐다 —
// `floatingWindowGeom` 선례대로 **window 바인딩과 분리한 순수 함수**로 모아 단위 테스트로 못 박는다.
// 뷰포트는 전역 `window` 가 아니라 인자로 받는다(테스트에서 값만 바꿔 넣는다).

/**
 * IDE 창이 사는 겹침 층의 바닥. 창은 여기서부터 `IDE_MAX_PANES` 개까지 한 칸씩 올라간다(40~45).
 *
 * ⚠ 이 층은 **모달 층(z-50)보다 아래**여야 한다. 이 저장소에서 z-50 은 설정창·확인 대화상자·
 * 컨텍스트 메뉴가 사는 자리라, 창이 그 위로 올라가면 "설정창을 띄웠는데 창 뒤에 깔리는" 상태가 된다
 * (창이 하나였을 때는 z-50 동률 + DOM 순서로 우연히 가려졌던 문제라, 창이 여럿이 되며 드러났다).
 */
export const IDE_PANE_Z_BASE = 40;

/**
 * 한 프로젝트에 동시에 띄울 수 있는 IDE 창 수.
 * §3.2.3 — 캡은 값 길이가 아니라 **개수**에 건다. 넘으면 가장 오래 안 만진 창을 재사용한다.
 */
export const IDE_MAX_PANES = 6;

/** 창이 붙을 수 있는 변. */
export type IDEDockSide = 'left' | 'right' | 'top' | 'bottom';

export const IDE_DOCK_SIDES: readonly IDEDockSide[] = ['left', 'right', 'top', 'bottom'] as const;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Viewport {
  w: number;
  h: number;
}

/** 네 변이 캔버스에서 가져간 두께(px). App 의 `main` 여백·DetailPanel 미러링이 함께 읽는다. */
export interface DockInsets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** 레이아웃 입력 — 붙어 있는 창 하나. */
export interface DockedPane {
  paneKey: string;
  side: IDEDockSide;
  /** 붙은 변 기준 두께(px) — 좌/우는 폭, 상/하는 높이. 같은 변의 창들은 이 값을 함께 쓴다. */
  size: number;
  /** 같은 변 안 순서(작을수록 위/왼쪽). 끼워 넣기는 정수 사이 소수를 쓴다 — 번호를 다시 매기지 않는다. */
  order: number;
  /**
   * 같은 변에서 이 창이 가져갈 **몫**(가중치, 기본 1). 종전에는 균등 분할 고정이라
   * "위쪽 창은 길게, 아래쪽 로그 창은 짧게" 같은 배치를 만들 수 없었다.
   */
  span: number;
}

export interface DockLayout {
  /** paneKey → 그 창이 앉을 자리(`position:fixed` 좌표). */
  rects: Record<string, Rect>;
  /** 캔버스가 비워 줘야 하는 네 변 두께. */
  insets: DockInsets;
}

/** 도킹 거동 기본값 — 모든 수치는 여기 한 곳(매직넘버 산개 ❌). */
export const IDE_DOCK = {
  /** 앱 통합 타이틀바(Header h-9 = 36px). 도크는 그 아래부터 시작한다. */
  HEADER_H: 36,
  /** 도크 두께 하한(px). */
  MIN_SIZE: 260,
  /** 도크 기본 두께 — 좌/우(폭), 상/하(높이). */
  DEFAULT_SIZE: { x: 480, y: 320 },
  /** 도크를 아무리 붙여도 캔버스에 남겨야 하는 최소 폭/높이(px). */
  KEEP_CANVAS: { w: 220, h: 160 },
  /** 같은 변에 이어 붙일 수 있는 창 수 — 더 넣으면 어느 창도 못 읽는다. */
  MAX_PER_SIDE: 3,
  /** 같은 변에서 창 하나가 가져야 하는 최소 길이(px) — 이보다 얇아질 만큼은 못 끼운다. */
  MIN_SLOT: 120,
  /** 가장자리 스냅 인식 폭 — 화면 크기 대비 비율. */
  SNAP_RATIO: 0.12,
  /** 작은 창에서도 보장하는 스냅 인식 폭(px). */
  SNAP_MIN_PX: 120,
} as const;

/**
 * 안 붙어 있는(떠 있는) 창의 자리·크기. 종전에는 컴포넌트 로컬 상태로만 있어서 **언마운트마다
 * 초기화**됐다 — 접었다 펴거나 프로젝트 탭을 옮겼다 돌아오면 옮겨 둔 창이 화면 한가운데로
 * 되돌아갔다(사용자가 배치해 둔 것을 앱이 지우는 셈). 이제 슬롯이 들고 있는다.
 */
export interface FloatGeom {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 떠 있는 창의 크기 규칙 — 도크와 같은 자리에 모아 둔다(매직넘버 산개 ❌). */
export const IDE_FLOAT = {
  /** 리사이즈 하한(px). */
  MIN_W: 480,
  MIN_H: 320,
  /** 화면 밖으로 밀어도 남겨 두는 최소 가시 폭/높이(px) — 창을 완전히 잃지 않게. */
  KEEP_VISIBLE: { x: 80, y: 40 },
  /** 처음 뜰 때 뷰포트 대비 비율. */
  SIZE_RATIO: 0.56,
} as const;

/**
 * 떠 있는 창을 **지금 뷰포트 안**으로 되돌린다.
 *
 * 창을 오른쪽 끝에 놓아 둔 채 앱 창을 줄이면 그 창은 화면 밖으로 나가고, 타이틀바가 안 보이니
 * 끌어 올 수도 없다(닫는 것 말고는 되찾을 길이 없다). 뷰포트가 바뀔 때마다 이 함수를 통과시킨다.
 */
export function clampFloatGeom(geom: FloatGeom, vp: Viewport): FloatGeom {
  const w = Math.min(Math.max(geom.w, IDE_FLOAT.MIN_W), Math.max(1, vp.w));
  const h = Math.min(Math.max(geom.h, IDE_FLOAT.MIN_H), Math.max(1, vp.h - IDE_DOCK.HEADER_H));
  return {
    w,
    h,
    // 좌우로는 창 대부분이 나가도 되지만 최소 가시 폭은 남긴다(그 자락을 잡아 끌어온다).
    x: Math.min(Math.max(geom.x, -w + IDE_FLOAT.KEEP_VISIBLE.x), vp.w - IDE_FLOAT.KEEP_VISIBLE.x),
    // 위로는 헤더 아래가 하한 — 타이틀바가 헤더에 깔리면 잡을 수 없다.
    y: Math.min(Math.max(geom.y, IDE_DOCK.HEADER_H), Math.max(IDE_DOCK.HEADER_H, vp.h - IDE_FLOAT.KEEP_VISIBLE.y)),
  };
}

/** 창이 처음 뜰 자리 — 여럿이면 계단식으로 어긋내 정확히 겹치지 않게 한다. */
export function initialFloatGeom(vp: Viewport, cascadeIndex: number, step = 28): FloatGeom {
  const w = Math.max(IDE_FLOAT.MIN_W, Math.round(vp.w * IDE_FLOAT.SIZE_RATIO));
  const h = Math.max(IDE_FLOAT.MIN_H, Math.round(vp.h * IDE_FLOAT.SIZE_RATIO));
  const offset = step * (cascadeIndex % 6);
  return clampFloatGeom({
    w,
    h,
    x: Math.max(8, Math.round((vp.w - w) / 2) + offset),
    y: Math.max(IDE_DOCK.HEADER_H, Math.round((vp.h - h) / 2) + offset),
  }, vp);
}

/** 이 변이 가로 축(좌/우)인가 — 두께가 폭이면 true, 높이면 false. */
export function isHorizontalSide(side: IDEDockSide): boolean {
  return side === 'left' || side === 'right';
}

/** 그 변의 기본 두께. */
export function defaultDockSize(side: IDEDockSide): number {
  return isHorizontalSide(side) ? IDE_DOCK.DEFAULT_SIZE.x : IDE_DOCK.DEFAULT_SIZE.y;
}

/** 가장자리 스냅 인식 폭 — 좌/우는 뷰포트 폭, 상/하는 높이 기준. */
export function snapDistance(side: IDEDockSide, vp: Viewport): number {
  const base = isHorizontalSide(side) ? vp.w : vp.h;
  return Math.max(IDE_DOCK.SNAP_MIN_PX, Math.round(base * IDE_DOCK.SNAP_RATIO));
}

function sideThickness(panes: DockedPane[]): number {
  // 같은 변의 창들은 한 칸을 나눠 쓰므로 두께는 하나다 — 가장 두꺼운 값을 그 변의 두께로 본다
  // (리사이즈 손잡이는 같은 변 전원에게 같은 값을 쓴다).
  let out = 0;
  for (const p of panes) out = Math.max(out, p.size);
  return out;
}

/**
 * 마주 보는 두 변의 두께를 캔버스가 남을 만큼으로 함께 줄인다.
 * 한쪽만 자르면 사용자가 나중에 붙인 창이 늘 손해를 보므로 **비율로** 줄인다.
 */
function fitOpposite(a: number, b: number, total: number, keep: number): { a: number; b: number } {
  const room = Math.max(0, total - keep);
  if (a + b <= room) return { a, b };
  if (a + b === 0) return { a: 0, b: 0 };
  const ratio = room / (a + b);
  return { a: Math.floor(a * ratio), b: Math.floor(b * ratio) };
}

/**
 * 붙어 있는 창들 → 각자의 자리 + 캔버스가 비워 줄 네 변 두께.
 *
 * 배치 규약(고전 도킹 모델): **좌·우는 헤더 아래 세로 전체**를 먹고, **상·하는 좌우 도크를 뺀 폭**을
 * 먹는다. 그래서 네 변에 동시에 붙여도 서로 겹치지 않는다. 같은 변의 창들은 긴 축을 균등 분할한다.
 */
export function computeDockLayout(panes: DockedPane[], vp: Viewport): DockLayout {
  const bySide: Record<IDEDockSide, DockedPane[]> = { left: [], right: [], top: [], bottom: [] };
  for (const p of panes) bySide[p.side].push(p);
  for (const side of IDE_DOCK_SIDES) bySide[side].sort((a, b) => a.order - b.order);

  const bandTop = IDE_DOCK.HEADER_H;
  const bandH = Math.max(0, vp.h - bandTop);

  const horiz = fitOpposite(sideThickness(bySide.left), sideThickness(bySide.right), vp.w, IDE_DOCK.KEEP_CANVAS.w);
  const vert = fitOpposite(sideThickness(bySide.top), sideThickness(bySide.bottom), bandH, IDE_DOCK.KEEP_CANVAS.h);

  const insets: DockInsets = { left: horiz.a, right: horiz.b, top: vert.a, bottom: vert.b };

  // 상/하 도크가 쓰는 가로 구간 — 좌우 도크를 뺀 나머지.
  const midX = insets.left;
  const midW = Math.max(0, vp.w - insets.left - insets.right);

  const rects: Record<string, Rect> = {};

  const place = (side: IDEDockSide, list: DockedPane[]): void => {
    if (list.length === 0) return;
    const n = list.length;
    if (side === 'left' || side === 'right') {
      const w = side === 'left' ? insets.left : insets.right;
      const x = side === 'left' ? 0 : vp.w - insets.right;
      // 세로로 몫만큼 분할 — 나머지 픽셀은 마지막 칸이 흡수해 빈 줄이 남지 않게 한다.
      const lens = splitBySpan(bandH, list.map((p) => p.span));
      let y = bandTop;
      list.forEach((p, i) => {
        const h = i === n - 1 ? bandTop + bandH - y : lens[i]!;
        rects[p.paneKey] = { x, y, w, h };
        y += h;
      });
      return;
    }
    const h = side === 'top' ? insets.top : insets.bottom;
    const y = side === 'top' ? bandTop : vp.h - insets.bottom;
    const lens = splitBySpan(midW, list.map((p) => p.span));
    let x = midX;
    list.forEach((p, i) => {
      const w = i === n - 1 ? midX + midW - x : lens[i]!;
      rects[p.paneKey] = { x, y, w, h };
      x += w;
    });
  };

  for (const side of IDE_DOCK_SIDES) place(side, bySide[side]);

  return { rects, insets };
}

/** 총 길이를 몫(가중치)대로 나눈다. 몫이 없거나 0 이면 균등 분할로 떨어진다. */
function splitBySpan(total: number, spans: number[]): number[] {
  const sum = spans.reduce((acc, v) => acc + (v > 0 ? v : 0), 0);
  if (sum <= 0) return spans.map(() => Math.floor(total / Math.max(1, spans.length)));
  return spans.map((v) => Math.floor((total * (v > 0 ? v : 0)) / sum));
}

/**
 * 이웃한 두 칸 사이 손잡이를 끈 거리 → 두 칸의 새 몫(합은 그대로).
 *
 * 픽셀이 아니라 **몫**을 돌려주는 까닭은 그래야 창 크기가 바뀌어도 비율이 유지되기 때문이다.
 * 어느 칸도 `minSlot` 아래로는 내려가지 않는다 — 0 이 되면 그 창을 다시 잡을 수 없다.
 */
export function splitSpansFromDrag(
  spanA: number,
  spanB: number,
  lengthA: number,
  lengthB: number,
  deltaPx: number,
  minSlot: number,
): { a: number; b: number } {
  const totalSpan = (spanA > 0 ? spanA : 1) + (spanB > 0 ? spanB : 1);
  const totalPx = lengthA + lengthB;
  // 둘을 합쳐도 최소 두 칸이 안 나오는 화면에서는 손을 대지 않는다(움직일수록 나빠진다).
  if (totalPx < minSlot * 2) return { a: spanA, b: spanB };
  const wantA = Math.min(Math.max(lengthA + deltaPx, minSlot), totalPx - minSlot);
  const a = (wantA / totalPx) * totalSpan;
  return { a, b: totalSpan - a };
}

/** 드래그 중 커서가 가리키는 도킹 자리. `index` 는 그 변 스택 안에서 끼울 칸(0=맨 앞). */
export interface DockDropTarget {
  side: IDEDockSide;
  index: number;
}

/**
 * 커서 위치 → 도킹 자리(없으면 null).
 *
 * ① 네 변 중 스냅 폭 안에 든 가장 가까운 변을 고르고, ② 그 변에 이미 붙은 창이 있으면 **커서가
 * 그 스택 어디쯤인지**로 끼울 칸을 정한다(칸 중앙보다 앞이면 그 앞에). 이것이 "이어 붙이기"다.
 *
 * `docked` 에는 **끌고 있는 창 자신을 빼고** 넘긴다(자기 자리를 자기 기준으로 재면 안 된다).
 */
export function resolveDockDrop(
  cursor: { x: number; y: number },
  vp: Viewport,
  docked: DockedPane[],
): DockDropTarget | null {
  const bandTop = IDE_DOCK.HEADER_H;
  const dist: Record<IDEDockSide, number> = {
    left: cursor.x,
    right: vp.w - cursor.x,
    top: cursor.y - bandTop,
    bottom: vp.h - cursor.y,
  };

  let best: IDEDockSide | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const side of IDE_DOCK_SIDES) {
    const d = dist[side];
    if (d < 0 || d > snapDistance(side, vp)) continue;
    // 같은 거리면 좌/우가 이긴다(IDE_DOCK_SIDES 순서 = 좌·우 먼저) — 모서리에서 흔들리지 않게.
    if (d < bestDist) {
      bestDist = d;
      best = side;
    }
  }
  if (!best) return null;

  const onSide = docked.filter((p) => p.side === best).sort((a, b) => a.order - b.order);
  if (onSide.length >= IDE_DOCK.MAX_PER_SIDE) return null;
  // 한 칸이 너무 얇아질 만큼은 못 끼운다 — 붙여 봐야 아무것도 못 읽는다.
  const longAxis = isHorizontalSide(best)
    ? Math.max(0, vp.h - bandTop)
    : Math.max(0, vp.w - dockedThicknessOf(docked, 'left') - dockedThicknessOf(docked, 'right'));
  if (longAxis / (onSide.length + 1) < IDE_DOCK.MIN_SLOT) return null;

  if (onSide.length === 0) return { side: best, index: 0 };

  const layout = computeDockLayout(docked, vp);
  const pos = isHorizontalSide(best) ? cursor.y : cursor.x;
  let index = onSide.length;
  for (let i = 0; i < onSide.length; i += 1) {
    const r = layout.rects[onSide[i]!.paneKey];
    if (!r) continue;
    const mid = isHorizontalSide(best) ? r.y + r.h / 2 : r.x + r.w / 2;
    if (pos < mid) {
      index = i;
      break;
    }
  }
  return { side: best, index };
}

function dockedThicknessOf(docked: DockedPane[], side: IDEDockSide): number {
  return sideThickness(docked.filter((p) => p.side === side));
}

/**
 * 스택의 `index` 칸에 끼울 때 쓸 `order` 값.
 * 사이에 넣을 땐 이웃 둘의 중간값을 쓴다 — 다른 창의 번호를 다시 매기지 않아 화면이 튀지 않는다.
 */
export function orderForInsert(existingOrders: number[], index: number): number {
  const sorted = [...existingOrders].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  if (index <= 0) return sorted[0]! - 1;
  if (index >= sorted.length) return sorted[sorted.length - 1]! + 1;
  return (sorted[index - 1]! + sorted[index]!) / 2;
}

/**
 * 도킹 미리보기 박스(Windows Snap Assist 풍)가 그릴 자리 —
 * **실제로 앉을 칸**을 그대로 그린다(계산을 두 벌로 두면 미리보기와 결과가 갈린다).
 */
export function previewDockRect(
  target: DockDropTarget,
  vp: Viewport,
  docked: DockedPane[],
  size: number,
): Rect | null {
  const PREVIEW_KEY = '__ide-dock-preview__';
  const onSide = docked.filter((p) => p.side === target.side);
  const order = orderForInsert(onSide.map((p) => p.order), target.index);
  const next: DockedPane[] = [
    ...docked,
    { paneKey: PREVIEW_KEY, side: target.side, size, order, span: 1 },
  ];
  return computeDockLayout(next, vp).rects[PREVIEW_KEY] ?? null;
}

/** 도크 두께를 하한·상한(반대편 도크 + 캔버스 최소치) 안으로 자른다. */
export function clampDockSize(side: IDEDockSide, size: number, vp: Viewport, docked: DockedPane[]): number {
  const opposite: Record<IDEDockSide, IDEDockSide> = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' };
  const other = dockedThicknessOf(docked.filter((p) => p.side !== side), opposite[side]);
  const total = isHorizontalSide(side) ? vp.w : Math.max(0, vp.h - IDE_DOCK.HEADER_H);
  const keep = isHorizontalSide(side) ? IDE_DOCK.KEEP_CANVAS.w : IDE_DOCK.KEEP_CANVAS.h;
  const max = Math.max(IDE_DOCK.MIN_SIZE, total - other - keep);
  return Math.round(Math.min(Math.max(size, IDE_DOCK.MIN_SIZE), max));
}

/**
 * 손잡이를 끈 거리(px) → 새 두께. 붙은 변마다 부호가 반대다
 * (우측 도크는 **왼쪽으로** 끌어야 넓어지고, 하단 도크는 **위로** 끌어야 높아진다).
 */
export function dockSizeFromDrag(side: IDEDockSide, startSize: number, dx: number, dy: number): number {
  switch (side) {
    case 'left': return startSize + dx;
    case 'right': return startSize - dx;
    case 'top': return startSize + dy;
    case 'bottom': return startSize - dy;
  }
}
