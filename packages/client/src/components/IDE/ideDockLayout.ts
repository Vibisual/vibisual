// §5.5 #17-1 (판올림 번호 발급 대기) — IDE 창 도킹의 **순수 기하**.
//
// 종전 도킹은 "우측 한 곳 + 폭 하나"라 계산이 컴포넌트 안 몇 줄이면 끝났다. 네 변으로 넓히고
// 같은 변에 여러 창을 이어 붙이게 되면서 좌표가 (변 × 스택 순서 × 반대편 도크) 의 함수가 됐다 —
// `floatingWindowGeom` 선례대로 **window 바인딩과 분리한 순수 함수**로 모아 단위 테스트로 못 박는다.
// 뷰포트는 전역 `window` 가 아니라 인자로 받는다(테스트에서 값만 바꿔 넣는다).
//
// (판올림 번호 발급 대기) **한 칸에 여러 창 — 언리얼 에디터식 탭 도킹**. 칸을 나누는 단위가
// 창에서 **슬롯**으로 바뀌었다: 같은 변에서 `order` 가 같은 창들은 한 칸을 탭으로 겹쳐 쓴다.
// 창이 여섯이어도 화면은 슬롯 수만큼만 잘리므로 "여러 개 띄우면 다 좁아진다"가 사라진다.

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
  /**
   * 같은 변 안 순서(작을수록 위/왼쪽). 끼워 넣기는 정수 사이 소수를 쓴다 — 번호를 다시 매기지 않는다.
   * **같은 값을 쓰는 창들은 한 칸을 탭으로 겹쳐 쓴다**(언리얼식 탭 도킹 — `dockSlotsOf`).
   */
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
  /** 같은 변에 이어 붙일 수 있는 **칸** 수 — 더 넣으면 어느 창도 못 읽는다(탭은 이 셈에서 빠진다). */
  MAX_PER_SIDE: 3,
  /** 같은 변에서 칸 하나가 가져야 하는 최소 길이(px) — 이보다 얇아질 만큼은 못 끼운다. */
  MIN_SLOT: 120,
  /** 가장자리 스냅 인식 폭 — 화면 크기 대비 비율. */
  SNAP_RATIO: 0.12,
  /** 작은 창에서도 보장하는 스냅 인식 폭(px). */
  SNAP_MIN_PX: 120,
  /** 붙어 있는 칸 위에서 "앞/뒤에 끼우기"로 읽히는 띠 — 칸 길이 대비(가운데는 탭 합류). */
  SLOT_BAND_RATIO: 0.28,
  /** 그 띠의 하한(px) — 아주 얇은 칸에서도 앞뒤를 집을 수 있게. */
  SLOT_BAND_MIN_PX: 28,
  /** 그 띠의 상한(칸 길이 대비) — 띠가 칸을 다 먹어 **탭 자리(가운데)** 가 사라지지 않게. */
  SLOT_BAND_MAX_RATIO: 0.4,
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
  /** 다른 창·화면 가장자리에 **딱 붙는** 자석 거리(px). 이 안이면 선이 맞춰진다. */
  MAGNET_PX: 10,
  /** 바둑판·계단식 정렬에서 창 사이 여백(px). */
  TILE_GAP: 8,
  /** 커서가 앱 창 밖으로 이만큼 더 나가야 "독립 창으로 꺼낸다"로 읽는다. */
  POP_OUT_MARGIN: 24,
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

/**
 * 도크 **슬롯** — 같은 변에서 `order` 가 같은 창들이 나눠 쓰는 한 칸(언리얼식 탭 도킹).
 *
 * 화면을 자르는 단위는 창이 아니라 이것이다. 그래서 창을 여섯 개 붙여도 슬롯이 둘이면
 * 화면은 둘로만 갈린다 — "여러 개 띄우면 전부 좁아진다"가 여기서 끊긴다.
 */
export interface DockSlot {
  side: IDEDockSide;
  order: number;
  /** 그 변의 두께(같은 변은 한 값을 함께 쓴다 — 겹친 창 중 가장 두꺼운 값). */
  size: number;
  /** 긴 축에서 이 칸이 가져갈 몫. */
  span: number;
  /** 이 칸에 겹쳐 있는 창들. **어느 탭이 앞인가는 여기서 정하지 않는다**(스토어의 `z`). */
  paneKeys: string[];
}

/** 그 변의 칸들 — `order` 오름차순. 같은 `order` 는 한 칸으로 접힌다. */
export function dockSlotsOf(panes: DockedPane[], side: IDEDockSide): DockSlot[] {
  const byOrder = new Map<number, DockSlot>();
  for (const p of panes) {
    if (p.side !== side) continue;
    const cur = byOrder.get(p.order);
    if (cur) {
      cur.paneKeys.push(p.paneKey);
      cur.size = Math.max(cur.size, p.size);
      cur.span = Math.max(cur.span, p.span);
      continue;
    }
    byOrder.set(p.order, { side, order: p.order, size: p.size, span: p.span, paneKeys: [p.paneKey] });
  }
  return [...byOrder.values()].sort((a, b) => a.order - b.order);
}

/** 그 창과 **한 칸을 나눠 쓰는** 다른 창들(자기 자신 제외). 그룹 탭 스트립이 읽는다. */
export function dockSlotMates(panes: DockedPane[], paneKey: string): string[] {
  const self = panes.find((p) => p.paneKey === paneKey);
  if (!self) return [];
  return panes
    .filter((p) => p.side === self.side && p.order === self.order)
    .map((p) => p.paneKey);
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
 * 먹는다. 그래서 네 변에 동시에 붙여도 서로 겹치지 않는다. 같은 변의 **칸**들은 긴 축을 몫대로
 * 나누고, 한 칸에 겹친 창들은 **같은 자리**를 받는다(탭이라 한 번에 하나만 보인다).
 */
export function computeDockLayout(panes: DockedPane[], vp: Viewport): DockLayout {
  const bySide: Record<IDEDockSide, DockedPane[]> = { left: [], right: [], top: [], bottom: [] };
  for (const p of panes) bySide[p.side].push(p);

  const bandTop = IDE_DOCK.HEADER_H;
  const bandH = Math.max(0, vp.h - bandTop);

  const horiz = fitOpposite(sideThickness(bySide.left), sideThickness(bySide.right), vp.w, IDE_DOCK.KEEP_CANVAS.w);
  const vert = fitOpposite(sideThickness(bySide.top), sideThickness(bySide.bottom), bandH, IDE_DOCK.KEEP_CANVAS.h);

  const insets: DockInsets = { left: horiz.a, right: horiz.b, top: vert.a, bottom: vert.b };

  // 상/하 도크가 쓰는 가로 구간 — 좌우 도크를 뺀 나머지.
  const midX = insets.left;
  const midW = Math.max(0, vp.w - insets.left - insets.right);

  const rects: Record<string, Rect> = {};

  const place = (side: IDEDockSide, slots: DockSlot[]): void => {
    if (slots.length === 0) return;
    const n = slots.length;
    const assign = (slot: DockSlot, r: Rect): void => {
      // 한 칸에 겹친 창들은 **같은 자리**를 받는다 — 앞에 오는 하나만 그려지고 나머지는 탭으로 산다.
      for (const key of slot.paneKeys) rects[key] = r;
    };
    if (side === 'left' || side === 'right') {
      const w = side === 'left' ? insets.left : insets.right;
      const x = side === 'left' ? 0 : vp.w - insets.right;
      // 세로로 몫만큼 분할 — 나머지 픽셀은 마지막 칸이 흡수해 빈 줄이 남지 않게 한다.
      const lens = splitBySpan(bandH, slots.map((s) => s.span));
      let y = bandTop;
      slots.forEach((s, i) => {
        const h = i === n - 1 ? bandTop + bandH - y : lens[i]!;
        assign(s, { x, y, w, h });
        y += h;
      });
      return;
    }
    const h = side === 'top' ? insets.top : insets.bottom;
    const y = side === 'top' ? bandTop : vp.h - insets.bottom;
    const lens = splitBySpan(midW, slots.map((s) => s.span));
    let x = midX;
    slots.forEach((s, i) => {
      const w = i === n - 1 ? midX + midW - x : lens[i]!;
      assign(s, { x, y, w, h });
      x += w;
    });
  };

  for (const side of IDE_DOCK_SIDES) place(side, dockSlotsOf(bySide[side], side));

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

/** 붙이는 방식 — 새 칸을 만드는가(`insert`), 그 칸에 **탭으로 합류**하는가(`tab`). */
export type DockDropMode = 'insert' | 'tab';

/** 드래그 중 커서가 가리키는 도킹 자리. */
export interface DockDropTarget {
  side: IDEDockSide;
  /**
   * 그 변 **칸 스택** 안의 자리. `insert` 면 끼워 넣을 칸 번호(0=맨 앞),
   * `tab` 이면 **합류할 칸**의 번호다.
   */
  index: number;
  mode: DockDropMode;
}

function inRect(p: { x: number; y: number }, r: Rect): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

/** 그 변에 칸을 **하나 더** 만들 수 있는가(개수 상한 + 한 칸 최소 길이). */
function canAddSlot(side: IDEDockSide, slotCount: number, vp: Viewport, docked: DockedPane[]): boolean {
  if (slotCount >= IDE_DOCK.MAX_PER_SIDE) return false;
  const longAxis = isHorizontalSide(side)
    ? Math.max(0, vp.h - IDE_DOCK.HEADER_H)
    : Math.max(0, vp.w - dockedThicknessOf(docked, 'left') - dockedThicknessOf(docked, 'right'));
  return longAxis / (slotCount + 1) >= IDE_DOCK.MIN_SLOT;
}

/**
 * 그 변에 **새 칸**을 하나 더 만들 수 있는가. 못 만들면 붙이기는 탭 합류로 떨어진다
 * (버튼·단축키·드래그가 같은 판정을 읽어야 "메뉴로는 되는데 끌면 안 되는" 어긋남이 없다).
 */
export function canAddDockSlot(side: IDEDockSide, vp: Viewport, docked: DockedPane[]): boolean {
  return canAddSlot(side, dockSlotsOf(docked, side).length, vp, docked);
}

/** 칸 위에서 "앞/뒤에 끼우기"로 읽히는 띠 두께(px). 나머지 가운데가 **탭 합류** 자리다. */
export function slotBandPx(length: number): number {
  if (length <= 0) return 0;
  const byRatio = length * IDE_DOCK.SLOT_BAND_RATIO;
  return Math.min(Math.max(byRatio, IDE_DOCK.SLOT_BAND_MIN_PX), length * IDE_DOCK.SLOT_BAND_MAX_RATIO);
}

/**
 * 이미 붙어 있는 **칸 위에서**의 판정 — 스택 축 앞/뒤 띠는 새 칸, 가운데는 탭 합류.
 * 새 칸을 못 만드는 상황(상한·너무 얇음)에서는 **탭으로 떨어진다** — 아무 일도 안 일어나는
 * 죽은 자리를 만들지 않는다(막힌 이유를 말하지 않는 무반응 ❌).
 */
function resolveSlotDrop(
  side: IDEDockSide,
  slots: DockSlot[],
  slotIndex: number,
  rect: Rect,
  cursor: { x: number; y: number },
  vp: Viewport,
  docked: DockedPane[],
): DockDropTarget {
  const vertical = isHorizontalSide(side); // 좌/우 도크는 세로로 쌓인다
  const length = vertical ? rect.h : rect.w;
  const pos = (vertical ? cursor.y - rect.y : cursor.x - rect.x);
  const band = slotBandPx(length);
  const wantsBefore = band > 0 && pos < band;
  const wantsAfter = band > 0 && pos > length - band;
  if ((wantsBefore || wantsAfter) && canAddSlot(side, slots.length, vp, docked)) {
    return { side, index: wantsBefore ? slotIndex : slotIndex + 1, mode: 'insert' };
  }
  return { side, index: slotIndex, mode: 'tab' };
}

/**
 * 커서 위치 → 도킹 자리(없으면 null).
 *
 * ① **이미 붙어 있는 칸 위**면 그 칸이 판정을 가져간다 — 가운데는 탭 합류, 스택 축 앞/뒤 띠는 새 칸.
 *    (종전에는 변에서 재는 거리 하나뿐이라, 넓은 도크 한가운데에 놓으면 아무 일도 안 일어났다.)
 * ② 그 밖이면 네 변 중 스냅 폭 안에 든 가장 가까운 변에 새 칸으로 붙는다.
 *
 * `docked` 에는 **끌고 있는 창 자신을 빼고** 넘긴다(자기 자리를 자기 기준으로 재면 안 된다).
 */
export function resolveDockDrop(
  cursor: { x: number; y: number },
  vp: Viewport,
  docked: DockedPane[],
): DockDropTarget | null {
  const layout = computeDockLayout(docked, vp);
  for (const side of IDE_DOCK_SIDES) {
    const slots = dockSlotsOf(docked, side);
    for (let i = 0; i < slots.length; i += 1) {
      const r = layout.rects[slots[i]!.paneKeys[0]!];
      if (!r || !inRect(cursor, r)) continue;
      return resolveSlotDrop(side, slots, i, r, cursor, vp, docked);
    }
  }

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

  const slots = dockSlotsOf(docked, best);
  if (!canAddSlot(best, slots.length, vp, docked)) return null;
  if (slots.length === 0) return { side: best, index: 0, mode: 'insert' };

  const pos = isHorizontalSide(best) ? cursor.y : cursor.x;
  let index = slots.length;
  for (let i = 0; i < slots.length; i += 1) {
    const r = layout.rects[slots[i]!.paneKeys[0]!];
    if (!r) continue;
    const mid = isHorizontalSide(best) ? r.y + r.h / 2 : r.x + r.w / 2;
    if (pos < mid) {
      index = i;
      break;
    }
  }
  return { side: best, index, mode: 'insert' };
}

function dockedThicknessOf(docked: DockedPane[], side: IDEDockSide): number {
  return sideThickness(docked.filter((p) => p.side === side));
}

/**
 * 칸 스택의 `index` 자리에 끼울 때 쓸 `order` 값.
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
 * 그 자리에 앉을 창이 가질 `order` — **미리보기와 실제 커밋이 같은 함수를 쓴다**.
 * `tab` 이면 합류할 칸의 번호를 **그대로** 물려받는다(같은 값 = 한 칸을 나눠 쓴다는 뜻).
 */
export function dockOrderForDrop(target: DockDropTarget, docked: DockedPane[]): number {
  const slots = dockSlotsOf(docked, target.side);
  if (target.mode === 'tab') return slots[target.index]?.order ?? 0;
  return orderForInsert(slots.map((s) => s.order), target.index);
}

/** 그 자리에 앉을 창이 물려받을 두께 — 그 변에 이미 칸이 있으면 그 값(한 칸을 나눠 쓰므로). */
export function dockSizeForDrop(target: DockDropTarget, docked: DockedPane[], fallback: number): number {
  const slots = dockSlotsOf(docked, target.side);
  return slots[0]?.size ?? fallback;
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
  const next: DockedPane[] = [
    ...docked,
    { paneKey: PREVIEW_KEY, side: target.side, size, order: dockOrderForDrop(target, docked), span: 1 },
  ];
  return computeDockLayout(next, vp).rects[PREVIEW_KEY] ?? null;
}

// ─── 도킹 십자 위젯 (언리얼 에디터의 방향 위젯) ───
//
// 종전에는 "가장자리 6~12% 안으로 들어가야 스냅"이라, 어디까지 밀어야 붙는지 손이 먼저 알아야 했다.
// 언리얼은 끌기 시작하는 순간 **붙을 수 있는 자리를 버튼으로 보여 준다** — 겨눌 곳이 눈에 있으니
// 처음 쓰는 사람도 헤매지 않는다. 우리도 같은 것을 그리되, **판정은 여전히 커서 위치**(`resolveDockDrop`)가
// 한다. 그래서 버튼은 언제나 **자기 판정 영역의 한가운데**에 놓는다 — 겨눈 대로 앉는다는 보장이
// 기하에서 나오지, 두 벌의 규칙이 우연히 맞아떨어져서가 아니다.

/** 십자 위젯 버튼 한 개. */
export interface DockZoneButton {
  /** 이 버튼을 겨눴을 때 앉을 자리 — 실제 판정과 같은 값. */
  target: DockDropTarget;
  /** 화면 좌표(버튼 사각형). */
  rect: Rect;
  /** 글리프를 고르는 데 쓰는 성격. `edge` 는 빈 변에 처음 붙이는 자리. */
  kind: 'edge' | 'before' | 'after' | 'tab';
}

/** 십자 버튼 한 변의 길이(px). */
export const IDE_DOCK_ZONE_BTN = 34;

function centeredRect(cx: number, cy: number, size = IDE_DOCK_ZONE_BTN): Rect {
  return { x: Math.round(cx - size / 2), y: Math.round(cy - size / 2), w: size, h: size };
}

/**
 * 지금 붙일 수 있는 자리 전부 — 드래그 중 화면에 그린다.
 *
 * 붙은 칸이 있는 변은 그 칸 위에 (앞 / 탭 / 뒤) 세 버튼이 서고, 빈 변은 가장자리 한가운데에
 * 버튼 하나가 선다. 못 붙이는 자리는 **애초에 목록에 없다**(눌러도 안 되는 버튼 ❌).
 */
export function dockZoneButtons(vp: Viewport, docked: DockedPane[]): DockZoneButton[] {
  const out: DockZoneButton[] = [];
  const layout = computeDockLayout(docked, vp);
  const bandTop = IDE_DOCK.HEADER_H;

  for (const side of IDE_DOCK_SIDES) {
    const slots = dockSlotsOf(docked, side);
    if (slots.length === 0) {
      // 빈 변 — 가장자리 스냅 띠의 한가운데(그 자리에서 놓으면 이 변에 처음 붙는다).
      const snap = snapDistance(side, vp);
      const inset = Math.min(snap / 2, 60);
      const cx = side === 'left' ? inset : side === 'right' ? vp.w - inset : vp.w / 2;
      const cy = side === 'top' ? bandTop + inset : side === 'bottom' ? vp.h - inset : bandTop + (vp.h - bandTop) / 2;
      out.push({ target: { side, index: 0, mode: 'insert' }, rect: centeredRect(cx, cy), kind: 'edge' });
      continue;
    }
    const canAdd = canAddSlot(side, slots.length, vp, docked);
    slots.forEach((slot, i) => {
      const r = layout.rects[slot.paneKeys[0]!];
      if (!r) return;
      const vertical = isHorizontalSide(side);
      const length = vertical ? r.h : r.w;
      const band = slotBandPx(length);
      const cx = r.x + r.w / 2;
      const cy = r.y + r.h / 2;
      // 가운데 = 탭 합류. 붙어 있는 칸 위에서는 언제나 가능하다.
      out.push({ target: { side, index: i, mode: 'tab' }, rect: centeredRect(cx, cy), kind: 'tab' });
      if (!canAdd || band <= 0) return;
      const beforeC = vertical ? { x: cx, y: r.y + band / 2 } : { x: r.x + band / 2, y: cy };
      const afterC = vertical ? { x: cx, y: r.y + r.h - band / 2 } : { x: r.x + r.w - band / 2, y: cy };
      out.push({ target: { side, index: i, mode: 'insert' }, rect: centeredRect(beforeC.x, beforeC.y), kind: 'before' });
      out.push({ target: { side, index: i + 1, mode: 'insert' }, rect: centeredRect(afterC.x, afterC.y), kind: 'after' });
    });
  }
  return out;
}

/**
 * (판올림 번호 발급 대기) 커서가 앱 창 **밖으로** 나갔는가 — 그 자리에서 손을 떼면 이 창은
 * 앱 안이 아니라 **독립 OS 창**으로 빠진다(§5.5 #17-6 오버레이 창).
 *
 * 여유(margin)를 두는 까닭: 0 이면 창을 화면 가장자리까지 끌기만 해도 튀어나가고, 너무 크면
 * 모니터가 하나이고 앱이 최대화된 사용자는 커서를 그만큼 밖으로 낼 수 없어 손이 닿지 않는다
 * (그 경우를 위해 붙이기 메뉴에 같은 일을 하는 손잡이를 따로 둔다).
 */
export function isOutsideViewport(
  cursor: { x: number; y: number },
  vp: Viewport,
  margin: number = IDE_FLOAT.POP_OUT_MARGIN,
): boolean {
  return cursor.x < -margin
    || cursor.y < -margin
    || cursor.x > vp.w + margin
    || cursor.y > vp.h + margin;
}

/** 두 자리가 같은 곳을 가리키는가 — 십자 버튼 강조가 판정과 어긋나지 않게 한 곳에서 견준다. */
export function sameDockTarget(a: DockDropTarget | null, b: DockDropTarget | null): boolean {
  if (!a || !b) return a === b;
  return a.side === b.side && a.index === b.index && a.mode === b.mode;
}

// ─── 떠 있는 창의 자석 정렬 ───

/** 자석이 붙은 선 — 드래그 중 그 자리에 얇은 안내선을 그린다. */
export interface MagnetResult {
  geom: FloatGeom;
  /** 세로 안내선의 x(안 붙었으면 null). */
  guideX: number | null;
  /** 가로 안내선의 y(안 붙었으면 null). */
  guideY: number | null;
}

function nearestLine(edges: number[], lines: number[], threshold: number): { line: number; delta: number } | null {
  let best: { line: number; delta: number } | null = null;
  for (const line of lines) {
    for (const edge of edges) {
      const delta = line - edge;
      if (Math.abs(delta) > threshold) continue;
      if (!best || Math.abs(delta) < Math.abs(best.delta)) best = { line, delta };
    }
  }
  return best;
}

/**
 * 옮기는 중인 창을 **다른 창·도크·화면 가장자리에 딱 붙인다**(창 관리자 관용 동작).
 *
 * 손으로 픽셀을 맞추면 늘 1~2px 어긋나 두 창 사이에 실금이 남는다. 10px 안이면 선을 맞춰 주고,
 * 맞춘 선을 함께 돌려줘 화면에 안내선으로 보여 준다 — 왜 갑자기 창이 튀었는지 알 수 있게.
 */
export function magnetFloatGeom(geom: FloatGeom, targets: Rect[], vp: Viewport): MagnetResult {
  const threshold = IDE_FLOAT.MAGNET_PX;
  const bandTop = IDE_DOCK.HEADER_H;
  const xLines = [0, vp.w];
  const yLines = [bandTop, vp.h];
  for (const t of targets) {
    xLines.push(t.x, t.x + t.w);
    yLines.push(t.y, t.y + t.h);
  }
  const hitX = nearestLine([geom.x, geom.x + geom.w], xLines, threshold);
  const hitY = nearestLine([geom.y, geom.y + geom.h], yLines, threshold);
  return {
    geom: {
      ...geom,
      x: hitX ? Math.round(geom.x + hitX.delta) : geom.x,
      y: hitY ? Math.round(geom.y + hitY.delta) : geom.y,
    },
    guideX: hitX ? hitX.line : null,
    guideY: hitY ? hitY.line : null,
  };
}

// ─── 여러 창 한 번에 정렬 ───

/**
 * 떠 있는 창들을 **바둑판**으로 늘어놓는다(언리얼 Window ▸ 레이아웃 관용).
 * 창을 서넛 띄우면 겹쳐 쌓여 아래 것을 찾을 수 없다 — 한 번에 다 보이게 하는 자리.
 */
export function tileFloatGeoms(count: number, bounds: Rect, gap = IDE_FLOAT.TILE_GAP): FloatGeom[] {
  if (count <= 0) return [];
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const cellW = (bounds.w - gap * (cols + 1)) / cols;
  const cellH = (bounds.h - gap * (rows + 1)) / rows;
  const out: FloatGeom[] = [];
  for (let i = 0; i < count; i += 1) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    out.push({
      x: Math.round(bounds.x + gap + c * (cellW + gap)),
      y: Math.round(bounds.y + gap + r * (cellH + gap)),
      // 하한보다 작아지면 겹치더라도 **읽을 수 있는 크기**를 지킨다(0에 수렴하는 칸 ❌).
      w: Math.max(IDE_FLOAT.MIN_W, Math.round(cellW)),
      h: Math.max(IDE_FLOAT.MIN_H, Math.round(cellH)),
    });
  }
  return out;
}

/** 떠 있는 창들을 **계단식**으로 겹쳐 놓는다 — 타이틀바가 전부 보여 골라 잡을 수 있다. */
export function cascadeFloatGeoms(count: number, bounds: Rect, step = 28): FloatGeom[] {
  if (count <= 0) return [];
  const w = Math.max(IDE_FLOAT.MIN_W, Math.round(bounds.w * 0.62));
  const h = Math.max(IDE_FLOAT.MIN_H, Math.round(bounds.h * 0.62));
  const out: FloatGeom[] = [];
  for (let i = 0; i < count; i += 1) {
    // 계단이 화면을 벗어나면 처음으로 되감는다 — 뒤쪽 창이 화면 밖으로 나가지 않게.
    const maxSteps = Math.max(1, Math.floor(Math.min(bounds.w - w, bounds.h - h) / step) || 1);
    const k = i % maxSteps;
    out.push({
      x: Math.round(bounds.x + k * step),
      y: Math.round(bounds.y + k * step),
      w,
      h,
    });
  }
  return out;
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

// ─── 떠 있는 창의 여덟 방향 리사이즈 ───

/** 잡을 수 있는 손잡이 — 네 모서리 + 네 변. */
export type FloatResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export const FLOAT_RESIZE_EDGES: readonly FloatResizeEdge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const;

/**
 * 손잡이를 끈 거리 → 새 자리·크기.
 *
 * 위/왼쪽을 끌면 **좌표도 함께** 움직여야 반대편 모서리가 제자리에 남는다(그러지 않으면 창이
 * 커지면서 통째로 미끄러진다). 하한에 부딪히면 좌표도 거기서 멈춘다 — 크기는 안 줄어드는데
 * 창만 계속 밀려가는 어긋남을 막는다.
 */
export function resizeFloatGeom(start: FloatGeom, edge: FloatResizeEdge, dx: number, dy: number): FloatGeom {
  const minW = IDE_FLOAT.MIN_W;
  const minH = IDE_FLOAT.MIN_H;
  let { x, y, w, h } = start;
  if (edge.includes('e')) w = Math.max(minW, start.w + dx);
  if (edge.includes('s')) h = Math.max(minH, start.h + dy);
  if (edge.includes('w')) {
    w = Math.max(minW, start.w - dx);
    x = start.x + (start.w - w);
  }
  if (edge.includes('n')) {
    h = Math.max(minH, start.h - dy);
    y = start.y + (start.h - h);
  }
  return { x, y, w, h };
}
