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

import {
  WINDOW_PULL_OUT,
  isCursorOutsideViewport,
  isCursorPinnedToViewportEdge,
} from '../../hooks/floatingWindowGeom.js';

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
  /**
   * (판올림 번호 발급 대기) 미는 창이 상대 창에게 남겨 주는 **여유**(px) — 자석 밀기의 사이 간격.
   *
   * `MAGNET_PX`(10)보다 **커야 한다**. 그래야 창끼리는 붙는 자석보다 **미는 자석이 먼저** 걸려,
   * 선에 붙어 멎었다가 문턱을 넘기며 겹치는 종전 거동이 아예 생기지 않는다(사용자 지적 — "멈추지 말고").
   */
  PUSH_GAP: 12,
  /**
   * 밀린 창이 목표 자리로 따라붙는 비율(프레임당). 1 이면 순간이동이라 "밀렸다"로 읽히지 않는다 —
   * 손보다 반 박자 늦게 미끄러지는 이 지연이 자석처럼 보이게 하는 실체다.
   */
  PUSH_EASE: 0.3,
  /** 목표까지 이만큼 안이면 다 온 것으로 본다(px) — 소수점이 영영 수렴하며 rAF 가 안 멎는 것을 막는다. */
  PUSH_SETTLE_PX: 0.5,
  /**
   * 한 번 정해진 밀림 방향을 지키는 여유(px). 더 얕게 빠지는 축이 생겨도 이 차이 안에서는 갈아타지
   * 않는다 — 축이 도중에 뒤집히면 밀리던 창이 손 앞에서 직각으로 튄다(끌던 사람이 가장 놀라는 순간).
   */
  PUSH_KEEP_DIR_PX: 64,
  /**
   * 커서가 앱 창 밖으로 이만큼 더 나가야 "독립 창으로 꺼낸다"로 읽는다.
   *
   * §5.13 (S-3) — 수치는 공용 한 곳(`WINDOW_PULL_OUT`)에서 온다. 내부 앱 창도 같은 손짓으로
   * 밖에 나가므로, 값이 두 벌이면 창 종류마다 다른 거리에서 반응한다.
   */
  POP_OUT_MARGIN: WINDOW_PULL_OUT.MARGIN,
  /**
   * 화면 끝에 **막혀** 더 나갈 수 없을 때 "밖으로 밀고 있다"로 읽어 주는 안쪽 띠(px).
   *
   * 단일 모니터에 앱이 최대화돼 있으면 커서는 뷰포트를 한 픽셀도 벗어나지 못한다 — 그 사람에게
   * `POP_OUT_MARGIN` 은 영영 닿지 않는 문턱이라 끌어내기라는 손짓 자체가 없는 것과 같다.
   */
  POP_OUT_EDGE_PX: WINDOW_PULL_OUT.EDGE_PX,
  /** 그 띠에 이만큼 버티면 밖으로 나간 것과 **같이** 본다(ms). 스치기만 한 손은 걸리지 않게. */
  POP_OUT_EDGE_DWELL_MS: WINDOW_PULL_OUT.EDGE_DWELL_MS,
  /**
   * (판올림 번호 발급 대기) (H-6) **놓을 수 있는 자리를 이만큼 넘어서면** 가상 창 윤곽선을 켠다(px).
   *
   * 문턱을 뷰포트가 아니라 **클램프 한계**(`clampFloatGeom`)로 잡는 까닭: 창을 화면 오른쪽에
   * 바짝 붙여 두는 것(80px 만 남기고 파킹)은 종전부터 정상 동작이라, 뷰포트를 기준으로 재면
   * 그 평범한 손짓마다 윤곽선이 번쩍인다.
   */
  POP_OUT_GHOST_ENTER_PX: 24,
  /**
   * (H-6) 손을 뗐을 때 **그대로 내보낼** 문턱(px, 놓을 수 있는 자리 기준).
   *
   * 윤곽선이 뜨는 문턱(`POP_OUT_GHOST_ENTER_PX`=24)과 벌려 둔다: 창을 화면 끝에 바짝 붙여 두려다
   * 몇 십 픽셀 더 간 손이 창을 밖으로 던지면 안 된다. 여기까지 끌었다면 "밖으로 뺀다" 말고 달리
   * 읽을 여지가 없다. (H-7) 로 `popOutGhostDecision` 이 함께 쥐게 되면서 이 곳으로 왔다 —
   * 선을 켜는 문턱과 무장 문턱이 떨어져 있으면 둘이 어긋나는지 한눈에 보이지 않는다.
   */
  POP_OUT_GHOST_COMMIT_PX: 120,
  /**
   * (H-6) 윤곽선이 **이미 떠 있을 때**의 가장자리 버팀(ms) — 밖으로 밀어냈다는 신호가 화면에
   * 이미 있는데 `POP_OUT_EDGE_DWELL_MS` 를 처음부터 다시 기다릴 이유가 없다.
   */
  POP_OUT_EDGE_DWELL_ARMED_MS: 220,
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
  // §5.13 (S-3) — 판정은 공용 한 곳. 내부 앱 창도 같은 손짓으로 밖에 나가므로, 여기서 따로 재면
  //   두 창이 다른 자리에서 반응하기 시작한다(그 어긋남은 화면에서 "가끔 안 된다"로만 보인다).
  return isCursorOutsideViewport(cursor, vp, margin);
}

/**
 * (판올림 번호 발급 대기) 커서가 뷰포트 **가장자리에 막혀** 있는가 — 밖으로 더 밀고 싶어도
 * 화면이 없어서 못 미는 자리.
 *
 * 단일 모니터에 앱을 최대화해 쓰는 사람은 커서를 앱 밖으로 낼 수 없다. 그에게는
 * `isOutsideViewport` 가 영영 참이 되지 않아 "끌어내면 독립 창"이라는 손짓이 **없는 기능**과
 * 같았다. 가장자리에 닿은 채 잠깐 버티는 것을 같은 뜻으로 읽어, 화면 수와 창 상태에 관계없이
 * 같은 손짓이 닿게 한다(무장 여부는 부르는 쪽이 시간으로 가른다 — 이 함수는 자리만 본다).
 *
 * 오른쪽·아래 경계에서 `-1` 을 빼는 까닭: 브라우저가 주는 `clientX/Y` 의 최대값은 `w-1`/`h-1`
 * 이라, `w` 를 그대로 견주면 끝까지 밀어도 띠 안에 들어오지 않는다.
 */
export function isPinnedToViewportEdge(
  cursor: { x: number; y: number },
  vp: Viewport,
  edge: number = IDE_FLOAT.POP_OUT_EDGE_PX,
): boolean {
  return isCursorPinnedToViewportEdge(cursor, vp, edge);
}

/**
 * (판올림 번호 발급 대기) (H-6) **끄는 동안**의 자리 — 크기만 정상화하고 좌표는 가두지 않는다.
 *
 * `clampFloatGeom` 은 **결과**를 위한 안전망이다(창을 화면 밖에 두고 잃지 않게). 그것을 끄는
 * **과정**에 걸어 두면 커서는 계속 가는데 창은 `KEEP_VISIBLE` 선에서 멈춰, 밖으로 빼려는 손에
 * 벽으로 잡힌다 — 그 벽을 넘는 순간 창이 독립 창으로 사라지므로 "버벅이다 튄다"가 된다.
 * 안전망은 손을 뗄 때 한 번만 건다.
 */
export function dragFloatGeom(geom: FloatGeom, vp: Viewport): FloatGeom {
  return {
    x: geom.x,
    y: geom.y,
    w: Math.min(Math.max(geom.w, IDE_FLOAT.MIN_W), Math.max(1, vp.w)),
    h: Math.min(Math.max(geom.h, IDE_FLOAT.MIN_H), Math.max(1, vp.h - IDE_DOCK.HEADER_H)),
  };
}

/**
 * (H-6) 이 자리가 **놓을 수 있는 자리**를 몇 px 넘어섰는가 — 두 축 중 큰 쪽(0 이면 안 넘었다).
 *
 * "밖으로 빼고 있다"의 기준이다. 뷰포트 밖으로 얼마나 나갔는지가 아니라 `clampFloatGeom` 이
 * 허락하는 자리에서 얼마나 더 갔는지를 재야, 화면 가장자리에 창을 붙여 두는 평범한 손짓과
 * 밖으로 빼내려는 손짓이 갈린다.
 */
export function overflowPastClamp(geom: FloatGeom, vp: Viewport): number {
  const c = clampFloatGeom(geom, vp);
  return Math.max(Math.abs(geom.x - c.x), Math.abs(geom.y - c.y));
}

/**
 * (H-6) 창이 앱 화면과 **더는 겹치지 않는가** = 사용자가 완전히 빼냈다.
 *
 * 종전 이탈 판정은 커서 기준 둘(밖 `POP_OUT_MARGIN` · 가장자리 `POP_OUT_EDGE_PX` 버팀)뿐이라,
 * 최대화된 단일 모니터에서는 **기다리는 것** 말고 길이 없었다. 사용자가 실제로 한 일(창을
 * 밖으로 밀어냈다)을 그대로 읽는 판정을 하나 더 둔다.
 */
export function isPulledFullyOut(geom: FloatGeom, vp: Viewport): boolean {
  return geom.x >= vp.w
    || geom.y >= vp.h
    || geom.x + geom.w <= 0
    || geom.y + geom.h <= 0;
}

/** (H-7) 지금 윤곽선을 그려야 하는가 — 그리고 지금 손을 떼도 그대로 나가는가. */
export interface PopOutGhostDecision {
  show: boolean;
  armed: boolean;
}

/**
 * (판올림 번호 발급 대기) (H-7) **윤곽선을 켜는 이유는 셋이고, 판정은 한 곳이다.**
 *
 * (H-6) 은 이유를 둘만 알았다 — 창이 `clampFloatGeom` 한계를 `POP_OUT_GHOST_ENTER_PX` 넘게
 * 벗어났거나, 가장자리에 막힌 채 버티고 있거나. 그런데 **창 자리로만 재면 잡은 지점에 따라
 * 선이 아예 뜨지 않는다**: 창 좌상단은 `cursor - grab` 이므로, 타이틀바를 가운데쯤 잡으면
 * (`grab.x > KEEP_VISIBLE.x`=80) 커서가 오른쪽 변을 넘어 나가는 순간에도 창 좌상단은 아직
 * 클램프 한계 안이다. 실제로 오른쪽으로 뺄 때는 `grab.x < 80`, 왼쪽으로 뺄 때는
 * `w - grab.x < 80` 인 손만 선을 봤다 — 나머지 손에게는 (H-6) ⑤ 가 지키기로 한 "빈 화면 없는
 * 인계"가 **인계할 선 자체가 없는** 상태로 돌아갔다(창이 커서에서 사라진다).
 *
 * 그래서 이유를 하나 더 둔다: **커서가 앱 창 밖으로 나갔다.** 이 신호는 잡은 지점과 무관하고,
 * 창을 화면 가장자리에 파킹하는 평범한 손짓과도 섞이지 않는다(파킹하는 손은 앱 안에 있다) —
 * (H-6) 이 문턱을 뷰포트가 아니라 클램프 한계로 잡은 그 이유를 그대로 지킨다. 나가는 판정은
 * 커서가 `POP_OUT_MARGIN`(24px) 더 가야 서므로, 그 사이가 선이 먼저 서 있을 구간이 된다.
 */
export function popOutGhostDecision(input: {
  /** 가두지 않은 **지금** 창 자리(`dragFloatGeom` 결과). */
  geom: FloatGeom;
  /** 앱 창 안 좌표의 커서(`clientX/Y`) — 밖으로 나가면 음수·뷰포트 초과가 된다. */
  cursor: { x: number; y: number };
  vp: Viewport;
  /** 가장자리 버팀이 선을 띄울 만큼 진행됐는가(시간 판정은 부르는 쪽 몫). */
  edgeDwell: boolean;
}): PopOutGhostDecision {
  const beyond = overflowPastClamp(input.geom, input.vp);
  // 커서가 앱 밖이면 **무장**이다 — 그 자리에서 손을 떼는 것은 "여기 놓겠다"는 뜻 말고 없다.
  const outside = isOutsideViewport(input.cursor, input.vp, 0);
  return {
    show: outside || beyond > IDE_FLOAT.POP_OUT_GHOST_ENTER_PX || input.edgeDwell,
    armed: outside || beyond >= IDE_FLOAT.POP_OUT_GHOST_COMMIT_PX,
  };
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

// ─── 자석 밀기 — 창끼리 부딪혀도 멈추지 않는다 ───

/**
 * (판올림 번호 발급 대기) 밀려나는 방향. **한 판 동안 유지**한다 — 더 얕게 빠지는 축이 생겼다고
 * 도중에 갈아타면 밀리던 창이 손 앞에서 직각으로 튄다(끄는 사람이 가장 놀라는 순간).
 */
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

/**
 * 미는 창 하나에 대해 이 창이 **어디로 얼마나** 빠져야 하는가 — 안 걸리면 null.
 *
 * 축은 `가장 얕게 빠지는 쪽`이다(옆에서 밀면 옆으로, 위에서 밀면 위아래로 — 손이 민 방향과 같다).
 * `prefer` 가 있으면 그 축을 지킨다 — 더 나은 축이 생겨도 `PUSH_KEEP_DIR_PX` 안에서는 갈아타지 않는다.
 */
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
 * (판올림 번호 발급 대기) **미는 창 → 밀려나는 창들.** 종전 자석(`magnetFloatGeom`)이 선에 붙여
 * **멈춰 세우던** 자리를, 상대를 밀어 **계속 가게** 하는 물리로 바꾼다.
 *
 * - 여유(`gap`)까지 먹고 겹친 창만 민다 — 딱 붙이지 않아 두 창의 테두리가 각각 보인다.
 * - **사슬**: 밀려난 창은 그 자신이 미는 쪽이 되어 다음 창을 민다(창이 셋이어도 줄줄이 밀린다).
 * - **되밀림 금지**: 자기를 민 창(또는 그보다 뒤 사슬)에게는 밀리지 않는다 — 되밀리면 두 창이
 *   서로를 밀며 제자리에서 떤다.
 * - 밀린 자리는 `clampFloatGeom` 안이라 화면 밖으로 창을 잃지 않는다. 더 갈 데가 없으면 **거기서
 *   버틴다** — 그래도 미는 창은 멎지 않는다(겹칠 뿐이다). "멈추지 말라"가 이 규칙이다.
 *
 * 뷰포트는 인자다(전역 `window` 참조 ❌ — 이 모듈의 규약). 순수 함수라 세 OS 에서 같은 값이 나온다.
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

/**
 * 밀림 한 프레임 — 지금 보이는 값에서 목표로 `PUSH_EASE` 만큼 다가간다(0 이면 아직 멀었다는 뜻이 아니라
 * **다 왔다**는 뜻으로 `done` 을 함께 돌려준다). 이 지연이 "자석처럼 밀린다"의 실체다.
 */
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

/**
 * (판올림 번호 발급 대기) §5.5 #17-1 — 도크 손잡이를 끝까지 밀면 **마주 보는 도크가 밀려난다.**
 *
 * 종전(`clampDockSize`)에는 "반대편 도크 + 캔버스 최소치"에서 손잡이가 **그대로 멎었다** — 화면을 다
 * 쓰고 있는데도 더 못 넓히는 이유가 화면에 없어서, 끄는 사람에게는 손잡이가 고장 난 것처럼 읽혔다.
 * 이제 그 문턱을 넘기면 반대편이 자기 하한(`MIN_SIZE`)까지 **양보한다**. 창끼리 밀리는 것(`pushFloatGeoms`)과
 * 같은 규칙이다 — 부딪히면 멈추는 것이 아니라 상대가 비켜 준다.
 *
 * **캔버스 여유(`KEEP_CANVAS`)는 끝까지 지킨다** — 밀기는 남의 자리를 얻는 일이지 캔버스를 없애는 일이 아니다.
 */
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
