/**
 * sessionBubbleLayout.ts — §5.5 #17-50 [버블] 지도의 **배치**(순수 함수). 버블 언어 = 원 · 궤도 · 위성.
 *
 * - 가운데 = 이 세션. 둘레 궤도에 폴더·웹·명령 앱·서브에이전트가 **처음 닿은 순서**로 고정 간격 칸에 앉고,
 *   한 궤도가 차면 바깥 궤도를 연다. 칸은 수와 무관한 고정 간격이라 새 버블이 서도 앞의 버블이 밀리지 않는다.
 *   첫 칸은 12시, 그다음은 시계 방향(§5.1 #2-2 새 버블 자리와 같은 결).
 * - 파일은 제 폴더 둘레를 도는 위성이다(고정 12칸 · 넘으면 마지막 칸이 `+N`).
 * - 폴더 안(들어가기)은 그 폴더가 가운데, 그 폴더에서 만진 파일 전부가 둘레 궤도다(§2.1 계층 탐색과 같은 문법).
 *
 * 좌표는 지도 세계 좌표(px, 가운데 = 0,0). 화면 배율·이동은 보는 쪽(`SessionBubbleView`)이 얹는다.
 * DOM·스토어를 보지 않으므로 단위 테스트로 고정한다(`sessionBubbleLayout.test.ts`).
 */
import { REDUCED_MOTION_LOOP_SLOWDOWN } from '@vibisual/shared';
import type {
  SessionAppBubble,
  SessionBubbleModel,
  SessionFileBubble,
  SessionFolderBubble,
  SessionTaskBubble,
  SessionTouch,
  SessionTouchDirection,
  SessionWebBubble,
} from './sessionBubbles.js';

/** 지도 기하·상한(한 곳). 값을 바꾸면 시험의 기대값도 이 표에서 계산되므로 따라온다. */
export const SESSION_BUBBLE_MAP = {
  /** 가운데(세션 · 들어간 폴더) 반지름. */
  centerR: 46,
  /** 가운데 테두리와 첫 궤도 칸 사이 여백. */
  firstGap: 56,
  /** 궤도 한 칸의 지름 — 위성까지 든 폴더 하나와 그 이름이 들어가는 크기. */
  slot: 196,
  /** 폴더 둘레 위성 궤도 반지름(폴더 중심에서). 12칸이 서로 닿지 않는 거리다. */
  satelliteOrbit: 66,
  /** 폴더 둘레 위성 칸 수(고정) — 넘으면 마지막 칸이 `+N`. */
  satellites: 12,
  /** 궤도 버블 상한 — 넘치면 가장 식은 것부터 「그 밖 N곳」 한 점으로 접는다. */
  orbitMax: 60,
  /** 폴더 안에서 둘레에 서는 파일 상한 — 넘으면 마지막 칸이 `+N`. */
  folderMax: 120,
  /** 폴더 안 궤도 한 칸의 지름(파일 하나와 그 이름). */
  folderSlot: 74,
  /** 파일 이름이 늘 보이는 배율 하한(LOD) — 그 아래에서는 고른 폴더 둘레·폴더 안에서만 보인다. */
  labelZoom: 0.9,
  /** 반지름 범위 — 접촉 횟수(읽기+쓰기)의 자릿수(로그 눈금, 1회 → 아래 끝 · 1000회 → 위 끝). */
  folderR: [20, 32] as const,
  orbitR: [17, 25] as const,
  fileR: [9, 15] as const,
  /** `+N`·「그 밖」 점의 반지름. */
  moreR: 11,
  /** 이름 줄이 원 아래로 차지하는 높이(경계 계산용). */
  labelPad: 30,
  /** 맥동·선 흐름 주기(ms) — `index.css` 의 `.session-bubble-pulse`·`.session-bubble-flow` 와 같은 값. */
  pulseMs: 1600,
  flowMs: 800,
} as const;

/** 움직임 줄이기에서의 주기 — 멈추지 않고 `REDUCED_MOTION_LOOP_SLOWDOWN` 배 느리게(§5.4 #31 (K) 선례). */
export const SESSION_BUBBLE_MOTION = {
  pulseReducedMs: SESSION_BUBBLE_MAP.pulseMs * REDUCED_MOTION_LOOP_SLOWDOWN,
  flowReducedMs: SESSION_BUBBLE_MAP.flowMs * REDUCED_MOTION_LOOP_SLOWDOWN,
} as const;

export type PlacedKind = 'center' | 'folder' | 'file' | 'web' | 'app' | 'task' | 'more' | 'overflow';

export interface PlacedBubble {
  id: string;
  kind: PlacedKind;
  x: number;
  y: number;
  r: number;
  /** 가운데 원인가(세션 · 들어간 폴더). */
  center: boolean;
  /** 위성이면 그 폴더 버블 id(고르기 강조가 따라간다). */
  parentId?: string;
  folder?: SessionFolderBubble;
  file?: SessionFileBubble;
  web?: SessionWebBubble;
  app?: SessionAppBubble;
  task?: SessionTaskBubble;
  /** `more` — 둘레에 못 선 파일 수 · `overflow` — 접힌 궤도 버블 수. */
  hiddenCount?: number;
  /** `overflow` — 접힌 버블 이름(정보 칸). */
  overflowNames?: string[];
  /** 이름이 배율과 무관하게 늘 보이나(궤도·가운데·폴더 안). 위성 파일은 LOD 를 탄다. */
  labelAlways: boolean;
}

export interface PlacedEdge {
  id: string;
  /** **데이터가 나가는 쪽**(읽기 = 버블 → 가운데, 쓰기 = 가운데 → 버블). 화살촉과 흐름이 이 방향을 따른다. */
  from: string;
  to: string;
  tone: SessionTouchDirection;
  /** 색을 정하는 끝(가운데·경유 서브에이전트가 아닌 쪽 — 궤도 버블이나 위성 파일)의 id. */
  target: string;
  /** 그 끝의 종류. */
  kind: PlacedKind;
  /** 결과가 아직 안 온 호출이 닿아 있나(흐름은 세션이 돌 때만 — 화면이 정한다). */
  pending: boolean;
  /** 폴더 → 위성 파일의 가는 선. */
  satellite: boolean;
}

export interface SessionBubbleLayout {
  bubbles: PlacedBubble[];
  edges: PlacedEdge[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  /** 들어간 폴더(없거나 모델에서 사라졌으면 null — 보는 쪽이 세션 지도로 돌아간다). */
  focus: SessionFolderBubble | null;
}

const TAU = Math.PI * 2;
const START = -Math.PI / 2; // 12시

/** 접촉 횟수 → 반지름(로그 눈금, 정수). */
export function radiusFor(touches: number, range: readonly [number, number]): number {
  const t = Math.min(1, Math.log10(1 + Math.max(0, touches)) / 3);
  return Math.round(range[0] + (range[1] - range[0]) * t);
}

function touchesOf(t: SessionTouch): number {
  return t.reads + t.writes;
}

/** 궤도 반지름 — `ring` 은 0 부터. */
export function orbitRingRadius(ring: number, slot: number = SESSION_BUBBLE_MAP.slot, centerR: number = SESSION_BUBBLE_MAP.centerR, gap: number = SESSION_BUBBLE_MAP.firstGap): number {
  return centerR + gap + slot / 2 + ring * slot;
}

/** 그 궤도에 들어가는 칸 수(둘레 ÷ 칸 지름, 내림 · 최소 1). */
export function orbitRingCapacity(ring: number, slot: number = SESSION_BUBBLE_MAP.slot, centerR: number = SESSION_BUBBLE_MAP.centerR, gap: number = SESSION_BUBBLE_MAP.firstGap): number {
  return Math.max(1, Math.floor((TAU * orbitRingRadius(ring, slot, centerR, gap)) / slot));
}

/**
 * `index` 번째 칸의 자리. 칸은 궤도마다 12시부터 시계 방향으로 고정 간격이다 — 칸 수가 아니라 **칸의 순번**만
 * 자리를 정하므로, 뒤에 칸이 늘어도 앞 칸의 좌표는 바뀌지 않는다. 홀수 궤도는 반 칸 엇갈려 앉는다(안쪽 칸과 일렬 ❌).
 */
export function orbitSlotPosition(
  index: number,
  slot: number = SESSION_BUBBLE_MAP.slot,
  centerR: number = SESSION_BUBBLE_MAP.centerR,
  gap: number = SESSION_BUBBLE_MAP.firstGap,
): { x: number; y: number; ring: number } {
  let ring = 0;
  let rest = Math.max(0, index);
  for (;;) {
    const cap = orbitRingCapacity(ring, slot, centerR, gap);
    if (rest < cap) {
      const step = TAU / cap;
      const angle = START + rest * step + (ring % 2 === 1 ? step / 2 : 0);
      const radius = orbitRingRadius(ring, slot, centerR, gap);
      return { x: Math.round(radius * Math.cos(angle)), y: Math.round(radius * Math.sin(angle)), ring };
    }
    rest -= cap;
    ring += 1;
  }
}

/** 폴더 둘레 위성 칸 `index`(0..satellites-1)의 상대 좌표 — 12시부터 시계 방향, 고정 간격. */
export function satelliteOffset(index: number): { dx: number; dy: number } {
  const angle = START + (index * TAU) / SESSION_BUBBLE_MAP.satellites;
  return {
    dx: Math.round(SESSION_BUBBLE_MAP.satelliteOrbit * Math.cos(angle)),
    dy: Math.round(SESSION_BUBBLE_MAP.satelliteOrbit * Math.sin(angle)),
  };
}

/** 둘레에 설 것 고르기 — 넘치면 **최근에 닿은 것**(`limit - 1` 개)만 남기고 처음 닿은 순서로 다시 줄 세운다. */
export function pickVisible<T extends SessionTouch>(items: readonly T[], limit: number): { visible: T[]; hidden: number } {
  if (items.length <= limit) return { visible: [...items], hidden: 0 };
  const keep = Math.max(0, limit - 1);
  const recent = new Set([...items].sort((a, b) => b.lastAt - a.lastAt).slice(0, keep));
  return { visible: items.filter((it) => recent.has(it)), hidden: items.length - keep };
}

/** 궤도 한 자리의 원본. */
type OrbitEntry =
  | { kind: 'folder'; touch: SessionFolderBubble }
  | { kind: 'web'; touch: SessionWebBubble }
  | { kind: 'app'; touch: SessionAppBubble }
  | { kind: 'task'; touch: SessionTaskBubble };

function entryName(e: OrbitEntry): string {
  switch (e.kind) {
    case 'folder': return e.touch.relPath || e.touch.path;
    case 'web': return e.touch.host ?? e.touch.key;
    case 'app': return e.touch.name;
    case 'task': return e.touch.description;
  }
}

function boundsOf(bubbles: readonly PlacedBubble[]): SessionBubbleLayout['bounds'] {
  let minX = 0; let minY = 0; let maxX = 0; let maxY = 0;
  for (const b of bubbles) {
    minX = Math.min(minX, b.x - b.r);
    maxX = Math.max(maxX, b.x + b.r);
    minY = Math.min(minY, b.y - b.r);
    maxY = Math.max(maxY, b.y + b.r + SESSION_BUBBLE_MAP.labelPad);
  }
  return { minX, minY, maxX, maxY };
}

function placeFile(file: SessionFileBubble, x: number, y: number, parentId: string | undefined, labelAlways: boolean): PlacedBubble {
  return {
    id: `s:${file.key}`, kind: 'file', x, y, r: radiusFor(touchesOf(file), SESSION_BUBBLE_MAP.fileR),
    center: false, file, labelAlways, ...(parentId ? { parentId } : {}),
  };
}

function fileEdge(from: PlacedBubble, file: PlacedBubble, f: SessionFileBubble): PlacedEdge {
  const outward = f.lastDirection === 'write';
  return {
    id: `e:${from.id}>${file.id}`,
    from: outward ? from.id : file.id,
    to: outward ? file.id : from.id,
    tone: f.lastDirection, target: file.id, kind: 'file', pending: f.pending, satellite: true,
  };
}

/** 폴더 안 — 그 폴더가 가운데, 만진 파일 전부가 둘레 궤도(`folderSlot` 간격 · `folderMax` 까지). */
function layoutFolder(folder: SessionFolderBubble): SessionBubbleLayout {
  const M = SESSION_BUBBLE_MAP;
  const center: PlacedBubble = {
    id: `o:${folder.key}`, kind: 'folder', x: 0, y: 0, r: M.centerR, center: true, folder, labelAlways: true,
  };
  const bubbles: PlacedBubble[] = [center];
  const edges: PlacedEdge[] = [];
  const { visible, hidden } = pickVisible(folder.files, M.folderMax);
  visible.forEach((file, i) => {
    const at = orbitSlotPosition(i, M.folderSlot, M.centerR, M.firstGap / 2);
    const placed = placeFile(file, at.x, at.y, undefined, true);
    bubbles.push(placed);
    edges.push(fileEdge(center, placed, file));
  });
  if (hidden > 0) {
    const at = orbitSlotPosition(visible.length, M.folderSlot, M.centerR, M.firstGap / 2);
    bubbles.push({ id: `m:${folder.key}`, kind: 'more', x: at.x, y: at.y, r: M.moreR, center: false, hiddenCount: hidden, labelAlways: true });
  }
  return { bubbles, edges, bounds: boundsOf(bubbles), focus: folder };
}

/**
 * 모델 → 배치. `focusFolderKey` 가 모델에 있는 폴더면 그 폴더 안을, 아니면 세션 지도를 그린다.
 *
 * 세션 지도의 선: 가운데(또는 그 버블에 **중첩 서브에이전트로만** 닿았으면 그 서브에이전트 버블) ↔ 궤도 버블,
 * 폴더 ↔ 위성 파일. 방향은 그 버블에 마지막으로 닿은 도구(§2.1 #3 한 쌍에 방향은 하나).
 */
export function layoutSessionBubbles(model: SessionBubbleModel, focusFolderKey: string | null = null): SessionBubbleLayout {
  if (focusFolderKey) {
    const folder = model.folders.find((f) => f.key === focusFolderKey);
    if (folder) return layoutFolder(folder);
  }
  const M = SESSION_BUBBLE_MAP;
  const center: PlacedBubble = { id: 'center', kind: 'center', x: 0, y: 0, r: M.centerR, center: true, labelAlways: true };
  const bubbles: PlacedBubble[] = [center];
  const edges: PlacedEdge[] = [];

  const entries: OrbitEntry[] = [
    ...model.folders.map((touch) => ({ kind: 'folder' as const, touch })),
    ...model.webs.map((touch) => ({ kind: 'web' as const, touch })),
    ...model.apps.map((touch) => ({ kind: 'app' as const, touch })),
    ...model.tasks.map((touch) => ({ kind: 'task' as const, touch })),
  ].sort((a, b) => a.touch.firstAt - b.touch.firstAt);

  // 넘치면 가장 식은(마지막으로 닿은 지 오래된) 것부터 한 점으로 접는다 — 남는 것은 처음 닿은 순서를 지킨다.
  let kept = entries;
  let folded: OrbitEntry[] = [];
  if (entries.length > M.orbitMax) {
    const keep = new Set([...entries].sort((a, b) => b.touch.lastAt - a.touch.lastAt).slice(0, M.orbitMax - 1));
    kept = entries.filter((e) => keep.has(e));
    folded = entries.filter((e) => !keep.has(e));
  }

  const placedByKey = new Map<string, PlacedBubble>();
  kept.forEach((entry, i) => {
    const at = orbitSlotPosition(i);
    const id = `o:${entry.touch.key}`;
    const r = entry.kind === 'folder'
      ? radiusFor(touchesOf(entry.touch), M.folderR)
      : radiusFor(touchesOf(entry.touch), M.orbitR);
    const placed: PlacedBubble = {
      id, kind: entry.kind, x: at.x, y: at.y, r, center: false, labelAlways: true,
      ...(entry.kind === 'folder' ? { folder: entry.touch } : {}),
      ...(entry.kind === 'web' ? { web: entry.touch } : {}),
      ...(entry.kind === 'app' ? { app: entry.touch } : {}),
      ...(entry.kind === 'task' ? { task: entry.touch } : {}),
    };
    bubbles.push(placed);
    placedByKey.set(entry.touch.key, placed);

    if (entry.kind === 'folder') {
      const { visible, hidden } = pickVisible(entry.touch.files, M.satellites);
      visible.forEach((file, slot) => {
        const off = satelliteOffset(slot);
        const sat = placeFile(file, at.x + off.dx, at.y + off.dy, id, false);
        bubbles.push(sat);
        edges.push(fileEdge(placed, sat, file));
      });
      if (hidden > 0) {
        const off = satelliteOffset(visible.length);
        bubbles.push({
          id: `m:${entry.touch.key}`, kind: 'more', x: at.x + off.dx, y: at.y + off.dy, r: M.moreR,
          center: false, parentId: id, hiddenCount: hidden, labelAlways: true,
        });
      }
    }
  });

  if (folded.length > 0) {
    const at = orbitSlotPosition(kept.length);
    bubbles.push({
      id: 'overflow', kind: 'overflow', x: at.x, y: at.y, r: M.orbitR[0], center: false,
      hiddenCount: folded.length, overflowNames: folded.map(entryName), labelAlways: true,
    });
  }

  // 가운데(또는 경유 서브에이전트) ↔ 궤도 버블.
  for (const entry of kept) {
    const placed = placedByKey.get(entry.touch.key)!;
    const t = entry.touch;
    const via = !t.direct && t.viaTaskKey ? placedByKey.get(t.viaTaskKey) : undefined;
    const hub = via ?? center;
    const outward = t.lastDirection === 'write';
    edges.push({
      id: `e:${hub.id}>${placed.id}`,
      from: outward ? hub.id : placed.id,
      to: outward ? placed.id : hub.id,
      tone: t.lastDirection, target: placed.id, kind: entry.kind, pending: t.pending, satellite: false,
    });
  }

  return { bubbles, edges, bounds: boundsOf(bubbles), focus: null };
}

/** 지도 화면을 경계에 맞추는 배율·이동(가운데 정렬 · 여백 비율 `pad`). 배율은 `[min, max]` 로 묶는다. */
export function fitTransform(
  bounds: SessionBubbleLayout['bounds'],
  view: { width: number; height: number },
  opts: { pad?: number; min?: number; max?: number } = {},
): { k: number; x: number; y: number } {
  const pad = opts.pad ?? 0.08;
  const min = opts.min ?? 0.2;
  const max = opts.max ?? 1.4;
  const w = Math.max(1, bounds.maxX - bounds.minX);
  const h = Math.max(1, bounds.maxY - bounds.minY);
  const usableW = Math.max(1, view.width * (1 - pad * 2));
  const usableH = Math.max(1, view.height * (1 - pad * 2));
  const k = Math.min(max, Math.max(min, Math.min(usableW / w, usableH / h)));
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  return { k, x: view.width / 2 - cx * k, y: view.height / 2 - cy * k };
}

/** 커서(`px`,`py` — 화면 좌표)를 붙든 채 배율을 바꾼다 — 그 자리의 세계 좌표가 커서 아래에 남는다. */
export function zoomAround(
  t: { k: number; x: number; y: number },
  nextK: number,
  px: number,
  py: number,
): { k: number; x: number; y: number } {
  const wx = (px - t.x) / t.k;
  const wy = (py - t.y) / t.k;
  return { k: nextK, x: px - wx * nextK, y: py - wy * nextK };
}
