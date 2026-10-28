// §5.5 #17-1 — IDE 창 도킹의 순수 기하((변 × 스택 순서 × 반대편 도크)의 함수, 뷰포트는 인자 — `floatingWindowGeom` 선례).
// 화면을 나누는 단위는 슬롯이다(언리얼식 탭 도킹 — 같은 변 같은 `order` 창들은 한 칸을 탭으로 쓴다).

import {
  WINDOW_PULL_OUT,
  isCursorOutsideViewport,
  isCursorPinnedToViewportEdge,
  isWindowPulledFullyOut,
  pullOutGhostDecision,
} from '../../hooks/floatingWindowGeom.js';

/** IDE 창 겹침 층의 바닥(창마다 한 칸씩, 40~45). ⚠ 모달 층(z-50 — 설정창·확인 대화상자·컨텍스트 메뉴)보다 아래여야 한다(아니면 설정창이 창 뒤에 깔린다). */
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
  /** 같은 변에서 이 창의 몫(가중치, 기본 1) — 창마다 길이를 달리 줄 수 있게. */
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
  /** 빈 변 도킹 버튼이 벽에서 떨어진 거리(스냅 띠 대비 비율). 벽에 바짝 — 띠 가운데면 끌고 온 창이 버튼을 가리고 어느 벽인지 안 읽힌다. */
  ZONE_EDGE_INSET_RATIO: 0.25,
  /** 그 거리의 상한(px) — 큰 화면에서도 버튼이 벽에서 멀어지지 않게. 위와 같은 까닭으로 절반(60 → 30). */
  ZONE_EDGE_INSET_MAX_PX: 30,
} as const;

/** 떠 있는 창의 자리·크기 — 슬롯이 든다(컴포넌트 로컬이면 언마운트마다 초기화돼 창이 한가운데로 돌아간다). */
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
  /** 자석 밀기의 사이 간격(px). `MAGNET_PX`(10)보다 커야 미는 자석이 먼저 걸린다(작으면 붙어 멎었다가 겹친다). */
  PUSH_GAP: 12,
  /**
   * 밀린 창이 목표 자리로 따라붙는 비율(프레임당). 1 이면 순간이동이라 "밀렸다"로 읽히지 않는다 —
   * 손보다 반 박자 늦게 미끄러지는 이 지연이 자석처럼 보이게 하는 실체다.
   */
  PUSH_EASE: 0.3,
  /** 목표까지 이만큼 안이면 다 온 것으로 본다(px) — 소수점이 영영 수렴하며 rAF 가 안 멎는 것을 막는다. */
  PUSH_SETTLE_PX: 0.5,
  /** 밀림 방향을 지키는 여유(px) — 이 안에서는 축을 안 갈아탄다(도중에 뒤집히면 창이 직각으로 튄다). */
  PUSH_KEEP_DIR_PX: 64,
  /** 커서가 앱 창 밖으로 이만큼 더 나가야 꺼내기로 읽는다. §5.13 (S-3) — 값은 공용 `WINDOW_PULL_OUT`(내부 앱 창과 같은 거리). */
  POP_OUT_MARGIN: WINDOW_PULL_OUT.MARGIN,
  /** 화면 끝에 막혔을 때 "밖으로 밀고 있다"로 읽는 안쪽 띠(px) — 최대화한 단일 모니터는 `POP_OUT_MARGIN` 에 닿을 수 없다. */
  POP_OUT_EDGE_PX: WINDOW_PULL_OUT.EDGE_PX,
  /** 그 띠에 이만큼 버티면 밖으로 나간 것과 **같이** 본다(ms). 스치기만 한 손은 걸리지 않게. */
  POP_OUT_EDGE_DWELL_MS: WINDOW_PULL_OUT.EDGE_DWELL_MS,
  /** (H-6) 놓을 수 있는 자리를 이만큼 넘으면 윤곽선을 켠다(px). 뷰포트가 아니라 `clampFloatGeom` 한계로 잰다(오른쪽 끝 파킹마다 번쩍이지 않게). §5.13 (S-10) — 값은 공용 `WINDOW_PULL_OUT`. */
  POP_OUT_GHOST_ENTER_PX: WINDOW_PULL_OUT.GHOST_ENTER_PX,
  /** (H-6) 손을 떼면 그대로 내보낼 문턱(px). 윤곽선 문턱(24)과 벌려 둔다 — 끝에 붙이려다 조금 더 간 손이 창을 던지면 안 된다. (H-7) 두 문턱은 한 곳에 둔다. */
  POP_OUT_GHOST_COMMIT_PX: WINDOW_PULL_OUT.GHOST_COMMIT_PX,
  /** (H-6) 윤곽선이 이미 떠 있을 때의 가장자리 버팀(ms) — `POP_OUT_EDGE_DWELL_MS` 를 처음부터 다시 기다리지 않게. */
  POP_OUT_EDGE_DWELL_ARMED_MS: WINDOW_PULL_OUT.EDGE_DWELL_ARMED_MS,
} as const;

/** 떠 있는 창을 지금 뷰포트 안으로 되돌린다 — 앱 창을 줄여 밖으로 나간 창은 타이틀바가 안 보여 되찾을 수 없다. 뷰포트가 바뀔 때마다 부른다. */
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

/** 도크 슬롯 — 같은 변·같은 `order` 창들이 탭으로 나눠 쓰는 한 칸. 화면을 자르는 단위는 창이 아니라 슬롯이다. */
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

/** 붙은 창들 → 각 자리 + 네 변 두께. 좌·우는 헤더 아래 세로 전체, 상·하는 좌우 도크를 뺀 폭(서로 안 겹친다). 칸은 긴 축을 몫대로, 한 칸의 창들은 같은 자리(탭). */
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

/** 두 칸 사이 손잡이 끌기 → 새 몫(합 유지, 몫이라 창 크기가 바뀌어도 비율 유지). `minSlot` 아래로는 안 간다(0 이면 다시 못 잡는다). */
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

/** 붙은 칸 위 판정 — 스택 축 앞/뒤 띠는 새 칸, 가운데는 탭. 새 칸을 못 만들면 탭으로 떨어진다(죽은 자리 ❌). */
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
 * 커서가 그 변에서 얼마나 떨어져 있는가(px). 음수면 그 변 **밖**이다(앱 창을 벗어났다).
 * 위쪽은 앱 통합 타이틀바(`HEADER_H`) 아래부터 잰다 — 도크가 거기서부터 시작하기 때문이다.
 */
export function dockSideDistance(side: IDEDockSide, cursor: { x: number; y: number }, vp: Viewport): number {
  switch (side) {
    case 'left': return cursor.x;
    case 'right': return vp.w - cursor.x;
    case 'top': return cursor.y - IDE_DOCK.HEADER_H;
    case 'bottom': return vp.h - cursor.y;
  }
}

/** 스냅 폭 안의 가장 가까운 변(없으면 null). `resolveDockDrop` ② 와 (H-11) 벽 잠금이 같이 읽는다(따로 재면 잠금이 헛돈다). */
export function nearestDockSide(cursor: { x: number; y: number }, vp: Viewport): IDEDockSide | null {
  let best: IDEDockSide | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const side of IDE_DOCK_SIDES) {
    const d = dockSideDistance(side, cursor, vp);
    if (d < 0 || d > snapDistance(side, vp)) continue;
    // 같은 거리면 좌/우가 이긴다(IDE_DOCK_SIDES 순서 = 좌·우 먼저) — 모서리에서 흔들리지 않게.
    if (d < bestDist) {
      bestDist = d;
      best = side;
    }
  }
  return best;
}

/** 커서 → 도킹 자리(없으면 null). ① 붙은 칸 위면 그 칸이 판정(가운데 탭, 앞/뒤 띠 새 칸) ② 아니면 스냅 폭 안 가장 가까운 변에 새 칸. `docked` 에는 끄는 창 자신을 뺀다. */
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

  const best = nearestDockSide(cursor, vp);
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

// 도킹 십자 위젯(언리얼식) — 끌기 시작하면 붙을 자리를 버튼으로 보인다. 판정은 커서 위치(`resolveDockDrop`)라 버튼은 늘 자기 판정 영역 한가운데에 둔다.

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

/** 드래그 중 그릴 붙일 자리 전부 — 붙은 칸 위엔 (앞 / 탭 / 뒤) 셋, 빈 변엔 벽에 붙은 하나. 못 붙이는 자리는 목록에 없다. */
export function dockZoneButtons(vp: Viewport, docked: DockedPane[]): DockZoneButton[] {
  const out: DockZoneButton[] = [];
  const layout = computeDockLayout(docked, vp);
  const bandTop = IDE_DOCK.HEADER_H;

  for (const side of IDE_DOCK_SIDES) {
    const slots = dockSlotsOf(docked, side);
    if (slots.length === 0) {
      // 빈 변 — 그 벽에 바짝(스냅 띠 안쪽 끝). 그 자리에서 놓으면 이 변에 처음 붙는다.
      const snap = snapDistance(side, vp);
      const inset = Math.min(snap * IDE_DOCK.ZONE_EDGE_INSET_RATIO, IDE_DOCK.ZONE_EDGE_INSET_MAX_PX);
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

/** 커서가 앱 창 밖인가(놓으면 독립 OS 창, §5.5 #17-6). margin 0 이면 가장자리만 가도 튀고, 크면 최대화 단일 모니터에서 닿지 않는다(붙이기 메뉴에 같은 손잡이). */
export function isOutsideViewport(
  cursor: { x: number; y: number },
  vp: Viewport,
  margin: number = IDE_FLOAT.POP_OUT_MARGIN,
): boolean {
  // §5.13 (S-3) — 판정은 공용 한 곳. 내부 앱 창도 같은 손짓으로 밖에 나가므로, 여기서 따로 재면
  //   두 창이 다른 자리에서 반응하기 시작한다(그 어긋남은 화면에서 "가끔 안 된다"로만 보인다).
  return isCursorOutsideViewport(cursor, vp, margin);
}

/**
 * 커서가 뷰포트 가장자리에 막혔는가(최대화 단일 모니터용 — 무장 시간은 부르는 쪽이 잰다).
 * 오른쪽·아래는 `-1`: `clientX/Y` 최대값이 `w-1`/`h-1` 이라 `w` 와 견주면 끝까지 밀어도 띠에 안 든다.
 */
export function isPinnedToViewportEdge(
  cursor: { x: number; y: number },
  vp: Viewport,
  edge: number = IDE_FLOAT.POP_OUT_EDGE_PX,
): boolean {
  return isCursorPinnedToViewportEdge(cursor, vp, edge);
}

/**
 * (H-14) 선이 창이 되는 사각형 — 들어온 창 자리를 방금 윤곽선과 똑같이 낸다(다시 지으면 창이 튄다). `null` = 못 낸다(첫 이동이 잡는다).
 * @param screenOrigin 이 창 콘텐츠의 좌상단 화면 좌표(`window.screenX/Y`) — 커서는 화면 좌표로 온다.
 */
export function resumedFloatGeom(
  resume: {
    grabRatioX: number;
    grabRatioY: number;
    width: number;
    height: number;
    cursor: { x: number; y: number } | null;
  },
  screenOrigin: { x: number; y: number },
  vp: Viewport,
): FloatGeom | null {
  if (!resume.cursor) return null;
  if (!(resume.width > 0) || !(resume.height > 0)) return null;
  const cx = resume.cursor.x - screenOrigin.x;
  const cy = resume.cursor.y - screenOrigin.y;
  // 창 밖의 커서로 자리를 내면 화면 어디에도 안 보이는 곳에 창을 세우게 된다.
  if (!(cx >= 0 && cy >= 0 && cx <= vp.w && cy <= vp.h)) return null;
  return clampFloatGeom({
    x: cx - resume.grabRatioX * resume.width,
    y: cy - resume.grabRatioY * resume.height,
    w: resume.width,
    h: resume.height,
  }, vp);
}

/** (H-6) 끄는 동안의 자리 — 크기만 정상화, 좌표는 안 가둔다. `clampFloatGeom` 은 손을 뗄 때 한 번만(끄는 중에 걸면 `KEEP_VISIBLE` 에서 멎었다 튄다). */
export function dragFloatGeom(geom: FloatGeom, vp: Viewport): FloatGeom {
  return {
    x: geom.x,
    y: geom.y,
    w: Math.min(Math.max(geom.w, IDE_FLOAT.MIN_W), Math.max(1, vp.w)),
    h: Math.min(Math.max(geom.h, IDE_FLOAT.MIN_H), Math.max(1, vp.h - IDE_DOCK.HEADER_H)),
  };
}

/** (H-6) 놓을 수 있는 자리(`clampFloatGeom`)를 넘어선 px(두 축 중 큰 쪽) — 뷰포트 기준이면 가장자리 파킹과 빼내기가 안 갈린다. */
export function overflowPastClamp(geom: FloatGeom, vp: Viewport): number {
  const c = clampFloatGeom(geom, vp);
  return Math.max(Math.abs(geom.x - c.x), Math.abs(geom.y - c.y));
}

/** (H-6) 창이 앱 화면과 더는 안 겹치나 = 완전히 빼냈다 — 최대화 단일 모니터에서 기다리지 않고 나가는 길. */
export function isPulledFullyOut(geom: FloatGeom, vp: Viewport): boolean {
  // §5.13 (S-10) — 내부 앱 창도 같은 판정을 쓴다(공용 한 곳).
  return isWindowPulledFullyOut(geom, vp);
}

/** (H-7) 지금 윤곽선을 그려야 하는가 — 그리고 지금 손을 떼도 그대로 나가는가. */
export interface PopOutGhostDecision {
  show: boolean;
  armed: boolean;
  /** (H-22) 이번 판정에서 커서가 앱 밖이었나 — 판정은 기억이 없고(같은 입력 = 같은 답), 판을 쥔 쪽이 걸쇠로 들고 다음 프레임 `escaped` 로 되먹인다. */
  outside: boolean;
}

/**
 * (H-7) 윤곽선을 켜는 이유 셋(판정 한 곳): ① 클램프 한계를 `POP_OUT_GHOST_ENTER_PX` 넘음 ② 가장자리 버팀 ③ 커서가 앱 밖.
 * ③ 이 없으면 타이틀바 가운데를 잡은 손(`grab.x > 80`)은 선 없이 창이 사라진다. ③ 은 파킹과 안 섞이고 나감(`POP_OUT_MARGIN` 24px)보다 먼저 선다.
 */
export function popOutGhostDecision(input: {
  /** 가두지 않은 **지금** 창 자리(`dragFloatGeom` 결과). */
  geom: FloatGeom;
  /** 앱 창 안 좌표의 커서(`clientX/Y`) — 밖으로 나가면 음수·뷰포트 초과가 된다. */
  cursor: { x: number; y: number };
  vp: Viewport;
  /** 가장자리 버팀이 선을 띄울 만큼 진행됐는가(시간 판정은 부르는 쪽 몫). */
  edgeDwell: boolean;
  /** (H-17) 가장자리 버팀을 다 채웠나 — 나감은 뗄 때만이라 이건 선을 밝히기만 한다(시간은 부르는 쪽이 잰다). */
  edgeArmed?: boolean;
  /** (H-22) 이번 판에 커서가 한 번이라도 앱 밖에 나갔나 — 나갔으면 들어와도 판이 끝날 때까지 선(아니면 숨은 본체가 나타난다). 무장(`armed`)은 안 건다 — 들어와 놓는 손은 빼는 손이 아니다. */
  escaped?: boolean;
}): PopOutGhostDecision {
  // §5.13 (S-10) — 판정은 공용 `pullOutGhostDecision`(내부 앱 창과 같게), IDE 고유는 `clampFloatGeom` 초과량뿐. 커서 밖·(H-17) 밀어냄·버팀은 무장(확정은 놓을 때), (H-22) 나간 판은 끝까지 선.
  return pullOutGhostDecision({
    beyond: overflowPastClamp(input.geom, input.vp),
    fullyOut: isPulledFullyOut(input.geom, input.vp),
    cursor: input.cursor,
    vp: input.vp,
    edgeDwell: input.edgeDwell,
    edgeArmed: input.edgeArmed,
    escaped: input.escaped,
  });
}

/** 두 자리가 같은 곳을 가리키는가 — 십자 버튼 강조가 판정과 어긋나지 않게 한 곳에서 견준다. */
export function sameDockTarget(a: DockDropTarget | null, b: DockDropTarget | null): boolean {
  if (!a || !b) return a === b;
  return a.side === b.side && a.index === b.index && a.mode === b.mode;
}

/** (판올림 번호 발급 대기) (H-11) 밖에서 **돌아온 판**에서 그 벽에 붙이기를 잠가 두는 수치. */
export const IDE_DOCK_ENTRY = {
  /**
   * 들어온 자리에서 **버티면** 그 벽이 다시 열린다(ms). 잠금은 없앰이 아니라 **미룸**이므로,
   * 정말 그 벽에 붙이려는 손에게는 길이 남아 있어야 한다(꺼내기의 가장자리 버팀과 같은 어법).
   */
  DWELL_MS: 700,
  /** 버팀으로 쳐 주는 흔들림(px) — 손은 완전히 멎지 않는다. 이보다 움직였으면 다시 잰다. */
  DWELL_JITTER_PX: 8,
} as const;

/** (H-11) 돌아온 판이 잠가 둔 벽 — 어느 변인지와, 버팀을 재기 시작한 자리·시각. */
export interface DockEntryLock {
  /** 들어온 그 변. 이 변에 붙이는 판정만 없던 것으로 한다(나머지 셋은 그대로 산다). */
  side: IDEDockSide;
  /** 버팀을 재기 시작한 시각(ms). */
  since: number;
  /** 그때 커서 자리 — 여기서 `DWELL_JITTER_PX` 넘게 움직이면 버팀을 다시 잰다. */
  at: { x: number; y: number };
}

/**
 * (H-11) 돌아온 순간의 벽 붙이기를 잠근다 — 되돌아옴(H-4 ④)의 48px 이 스냅 폭(`snapDistance` 12%, 최소 120px) 한복판이라 들여놓자마자 떼면 벽에 붙는다.
 * 잠그는 것은 들어온 그 벽 하나다(네 변을 막으면 다른 벽에 붙이려는 손까지 막힌다).
 */
export function beginDockEntryLock(
  cursor: { x: number; y: number },
  vp: Viewport,
  now: number,
): DockEntryLock | null {
  const side = nearestDockSide(cursor, vp);
  // 어느 벽의 띠에도 안 들어왔다 = 이미 한복판이다 — 잠글 것이 없다.
  if (!side) return null;
  return { side, since: now, at: { x: cursor.x, y: cursor.y } };
}

/**
 * (H-11) 잠금을 한 프레임 진행(`null` = 풀림, 다시 안 걸림). 풀림: ① 그 벽 스냅 띠를 벗어남 ② 띠 안에서 `DWELL_MS` 버팀(좁은 화면에서도 붙일 길).
 * 다시 밖으로 나가면(거리 < 0) 잠금 유지 — 그건 꺼내기(H-6·H-7) 몫.
 */
export function stepDockEntryLock(
  lock: DockEntryLock | null,
  cursor: { x: number; y: number },
  vp: Viewport,
  now: number,
): DockEntryLock | null {
  if (!lock) return null;
  const dist = dockSideDistance(lock.side, cursor, vp);
  if (dist > snapDistance(lock.side, vp)) return null; // ① 안으로 들어왔다
  const moved = Math.abs(cursor.x - lock.at.x) > IDE_DOCK_ENTRY.DWELL_JITTER_PX
    || Math.abs(cursor.y - lock.at.y) > IDE_DOCK_ENTRY.DWELL_JITTER_PX;
  if (moved) return { side: lock.side, since: now, at: { x: cursor.x, y: cursor.y } };
  if (now - lock.since >= IDE_DOCK_ENTRY.DWELL_MS) return null; // ② 그 자리에서 버텼다
  return lock;
}

/** (H-11) 잠긴 벽이면 그 자리를 없던 것으로 한다 — 미리보기·십자 강조·커밋이 한 판정을 읽는다. */
export function applyDockEntryLock(
  target: DockDropTarget | null,
  lock: DockEntryLock | null,
): DockDropTarget | null {
  if (!target || !lock) return target;
  return target.side === lock.side ? null : target;
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

/** 옮기는 창을 다른 창·도크·가장자리에 10px 안이면 붙이고(손으론 1~2px 실금이 남는다), 맞춘 선을 안내선으로 돌려준다. */
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

// ─── 자석 밀기 — 창끼리 부딪혀도 멈추지 않는다 ───

/** 밀려나는 방향 — 한 판 동안 유지한다(도중에 축을 바꾸면 창이 직각으로 튄다). */
export type FloatPushDir = 'left' | 'right' | 'up' | 'down';

/** 밀기 계산에 넣는 창 하나 — 누구인지와 **지금** 자리. */
export interface FloatPushPaneGeom {
  key: string;
  geom: FloatGeom;
}

export interface FloatPushResult {
  /** 이번에 **실제로 움직인** 창들의 새 자리(안 밀린 창은 아예 없다). */
  geoms: Record<string, FloatGeom>;
  /** 그 창들이 밀려난 방향 — 다음 프레임에 되먹여 축이 도중에 뒤집히지 않게 한다. */
  dirs: Record<string, FloatPushDir>;
}

const FLOAT_PUSH_DIRS: readonly FloatPushDir[] = ['left', 'right', 'up', 'down'] as const;

/** 그 방향으로 빠져나가려면 얼마나 가야 하는가(px). 0 이하면 그 축으로는 이미 떨어져 있다. */
function floatPushDepth(target: FloatGeom, pusher: Rect, dir: FloatPushDir, gap: number): number {
  switch (dir) {
    case 'left': return (target.x + target.w) - (pusher.x - gap);
    case 'right': return (pusher.x + pusher.w + gap) - target.x;
    case 'up': return (target.y + target.h) - (pusher.y - gap);
    case 'down': return (pusher.y + pusher.h + gap) - target.y;
  }
}

/** 그 방향으로 `depth` 만큼 민 자리(크기는 그대로 — 미는 것은 옮기는 것이지 줄이는 것이 아니다). */
function shoveFloatGeom(target: FloatGeom, dir: FloatPushDir, depth: number): FloatGeom {
  switch (dir) {
    case 'left': return { ...target, x: target.x - depth };
    case 'right': return { ...target, x: target.x + depth };
    case 'up': return { ...target, y: target.y - depth };
    case 'down': return { ...target, y: target.y + depth };
  }
}

/** 미는 창 하나에 대해 이 창이 어디로 얼마나 빠지나(안 걸리면 null). 축은 가장 얕게 빠지는 쪽(손이 민 방향), `prefer` 가 있으면 `PUSH_KEEP_DIR_PX` 안에서는 그 축을 지킨다. */
function resolveFloatPush(
  target: FloatGeom,
  pusher: Rect,
  gap: number,
  prefer: FloatPushDir | undefined,
): { geom: FloatGeom; dir: FloatPushDir } | null {
  const depths = FLOAT_PUSH_DIRS.map((d) => ({ dir: d, depth: floatPushDepth(target, pusher, d, gap) }));
  // 네 방향이 **전부** 양수여야 여유까지 먹고 겹친 것이다 — 하나라도 0 이하면 그 축으로 이미 떨어져 있다.
  if (depths.some((x) => x.depth <= 0)) return null;
  let best = depths[0]!;
  for (const x of depths) if (x.depth < best.depth) best = x;
  if (prefer) {
    const kept = depths.find((x) => x.dir === prefer);
    if (kept && kept.depth <= best.depth + IDE_FLOAT.PUSH_KEEP_DIR_PX) best = kept;
  }
  return { geom: shoveFloatGeom(target, best.dir, best.depth), dir: best.dir };
}

/**
 * 미는 창 → 밀려나는 창들(멈춰 세우지 않고 민다). `gap` 까지 겹친 창만, 밀린 창이 다음을 민다(사슬), 자기를 민 사슬엔 안 밀린다(떨림 방지).
 * 밀린 자리는 `clampFloatGeom` 안 — 막히면 버티고 미는 창은 겹칠 뿐 안 멎는다.
 */
export function pushFloatGeoms(
  mover: FloatGeom,
  others: FloatPushPaneGeom[],
  vp: Viewport,
  prevDirs: Record<string, FloatPushDir> = {},
  gap: number = IDE_FLOAT.PUSH_GAP,
): FloatPushResult {
  const cur = new Map<string, FloatGeom>();
  for (const o of others) cur.set(o.key, o.geom);
  const dirs: Record<string, FloatPushDir> = {};
  /** 사슬에서의 깊이 — 끌고 있는 창이 0, 그것이 민 창이 1, 그 창이 민 창이 2 … */
  const rank = new Map<string, number>();

  // 미는 쪽부터 차례로 꺼내 본다(너비 우선). `key: null` 이 끌고 있는 창 자신이다.
  const queue: { key: string | null; rank: number }[] = [{ key: null, rank: 0 }];
  let guard = (others.length + 1) * 4 + 4;
  while (queue.length > 0 && guard > 0) {
    guard -= 1;
    const head = queue.shift()!;
    const pusher: Rect = head.key === null ? mover : cur.get(head.key)!;
    for (const o of others) {
      if (o.key === head.key) continue;
      const already = rank.get(o.key);
      // 되밀림 금지 — 나를 민 창과 같은 줄이거나 그 뒤라면 무시한다(진동의 원인).
      if (already !== undefined && already <= head.rank) continue;
      const self = cur.get(o.key)!;
      const hit = resolveFloatPush(self, pusher, gap, dirs[o.key] ?? prevDirs[o.key]);
      if (!hit) continue;
      const next = clampFloatGeom(hit.geom, vp);
      // 화면 끝에 막혀 한 픽셀도 못 간다 — 거기서 버틴다(미는 창을 세우지는 않는다).
      if (next.x === self.x && next.y === self.y) continue;
      cur.set(o.key, next);
      dirs[o.key] = hit.dir;
      rank.set(o.key, head.rank + 1);
      queue.push({ key: o.key, rank: head.rank + 1 });
    }
  }

  const geoms: Record<string, FloatGeom> = {};
  for (const o of others) {
    if (!rank.has(o.key)) continue;
    const g = cur.get(o.key)!;
    if (g.x === o.geom.x && g.y === o.geom.y) continue;
    geoms[o.key] = g;
  }
  return { geoms, dirs };
}

/** 밀림 한 프레임 — 목표로 `PUSH_EASE` 만큼 다가간다(다 왔으면 `done`). 이 지연이 자석처럼 밀리는 실체다. */
export function easeFloatPushOffset(
  now: { dx: number; dy: number },
  want: { dx: number; dy: number },
  ease: number = IDE_FLOAT.PUSH_EASE,
  settle: number = IDE_FLOAT.PUSH_SETTLE_PX,
): { dx: number; dy: number; done: boolean } {
  const dx = now.dx + (want.dx - now.dx) * ease;
  const dy = now.dy + (want.dy - now.dy) * ease;
  // 남은 거리가 반 픽셀 안이면 목표에 **정확히** 앉힌다 — 아니면 소수점이 영영 수렴하며 rAF 가 안 멎는다.
  if (Math.abs(want.dx - dx) < settle && Math.abs(want.dy - dy) < settle) {
    return { dx: want.dx, dy: want.dy, done: true };
  }
  return { dx, dy, done: false };
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

/** 마주 보는 변 — 밀기·상한 계산이 같은 표를 읽는다(두 곳에 적으면 언젠가 갈린다). */
export const OPPOSITE_DOCK_SIDE: Record<IDEDockSide, IDEDockSide> = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' };

export interface DockPushResult {
  /** 끄는 변의 새 두께. */
  size: number;
  /** **밀려난** 마주 보는 변 — 안 밀렸으면 null. */
  opposite: { side: IDEDockSide; size: number } | null;
}

/** §5.5 #17-1 — 도크 손잡이를 끝까지 밀면 마주 보는 도크가 `MIN_SIZE` 까지 비켜 준다(`pushFloatGeoms` 와 같은 규칙 — 멎으면 고장으로 읽힌다). 캔버스 여유(`KEEP_CANVAS`)는 끝까지 지킨다. */
export function pushDockSize(side: IDEDockSide, wanted: number, vp: Viewport, docked: DockedPane[]): DockPushResult {
  const opp = OPPOSITE_DOCK_SIDE[side];
  const other = dockedThicknessOf(docked.filter((p) => p.side !== side), opp);
  const total = isHorizontalSide(side) ? vp.w : Math.max(0, vp.h - IDE_DOCK.HEADER_H);
  const keep = isHorizontalSide(side) ? IDE_DOCK.KEEP_CANVAS.w : IDE_DOCK.KEEP_CANVAS.h;
  const want = Math.round(Math.max(wanted, IDE_DOCK.MIN_SIZE));
  // 반대편을 건드리지 않고 갈 수 있는 데까지.
  const room = Math.max(IDE_DOCK.MIN_SIZE, total - other - keep);
  if (other <= 0 || want <= room) {
    return { size: Math.round(Math.min(want, room)), opposite: null };
  }
  // 여기서부터가 밀기 — 반대편은 자기 하한까지만 양보한다(0 으로 접지 않는다: 그 창도 읽혀야 한다).
  const pushedOther = Math.round(Math.min(other, Math.max(IDE_DOCK.MIN_SIZE, total - keep - want)));
  const size = Math.round(Math.max(IDE_DOCK.MIN_SIZE, Math.min(want, total - keep - pushedOther)));
  return { size, opposite: pushedOther === other ? null : { side: opp, size: pushedOther } };
}
/** 도크 두께를 하한·상한(반대편 도크 + 캔버스 최소치) 안으로 자른다. */
export function clampDockSize(side: IDEDockSide, size: number, vp: Viewport, docked: DockedPane[]): number {
  const other = dockedThicknessOf(docked.filter((p) => p.side !== side), OPPOSITE_DOCK_SIDE[side]);
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

/** 손잡이 끌기 → 새 자리·크기. 위/왼쪽은 좌표도 함께 옮겨 반대 모서리를 고정하고, 하한에 닿으면 좌표도 멈춘다(창만 밀려가지 않게). */
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
