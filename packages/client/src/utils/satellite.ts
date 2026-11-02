import type { XYPosition } from '@xyflow/react';
import type { BubbleData, BubbleType, HeatScale } from '@vibisual/shared';
import {
  BUBBLE_COLORS,
  DEFAULT_MAX_SATELLITES,
  FOLDER_BUBBLE_TYPES,
  READ_TOOLS,
  SATELLITE_ORBIT_GAP,
  SATELLITE_RING_SPACING,
  SPAWN_ZONE,
} from '@vibisual/shared';
import { calcBubbleSize, calcFileSizeRange } from './sizeCalc.js';
import {
  addToSpawnField,
  anchorFromObstacle,
  createSpawnField,
  seatInZone,
  zoneGridRadius,
  zoneSeatRadius,
  type SpawnField,
  type ZoneAnchor,
  type ZoneGrid,
} from './spawnZone.js';

// ─── 타입 ───

export interface EdgeInput {
  id: string;
  source: string;
  target: string;
  label?: string;
  isActive: boolean;
  color: string;
  sourceRadius: number;
  targetRadius: number;
}

export interface SatelliteInfo {
  bubble: BubbleData;
  parentId: string;
  parentSize: number;
  edge: EdgeInput;
  /** 부모 기준 배치 index / total (위치 계산용) */
  index: number;
  total: number;
  /** 같은 부모 위성들끼리의 파일 크기 범위 (상대 크기 계산용) */
  localRange: { min: number; max: number };
  /**
   * §5.24 — 히트 척도(꺼져 있으면 `undefined`). `localRange` 와 **같은 칸**에 실어 나른다 —
   * `placeSatellitePositions` 가 배치용 지름을 다시 계산할 때 렌더와 같은 자를 쓰게 하기 위함.
   */
  heat: HeatScale | undefined;
  /**
   * §5.1 #2-1 (B) — 이 위성선을 그리지 않는다(연결은 그대로). 별자리 중심인 앱 노드가 연결선을 숨겼을 때(§5.4 #36 (H) ①).
   */
  edgeHidden?: boolean;
  /**
   * 앱 노드 별자리의 달 — 첫 고리(부모 반경 + 위성 반경 + 간격인 궤도) 하나에만 고르게 앉는다(§5.1 #2-2 (G)). 그 고리는 달 수(`parentSlots`)를
   * 다 담도록 넓힌다(§5.1 #2-2 (J)). 묶음 버블의 위성은 폴더 위성과 같은 규칙이라 쓰지 않는다(바깥 방향 부채꼴 · 빈칸 없으면 바깥 고리).
   */
  orbitSeat?: boolean;
  /**
   * §5.1 #2-2 (J) — 부모가 거느릴 위성 수 — 폴더는 위성 상한(`maxSatellites` · 기본 `DEFAULT_MAX_SATELLITES`), 묶음은 설정 없는 폴더와
   * 같은 기본 상한, 앱 노드 별자리는 달 수. 부채꼴에서는 짝수면 바깥 방향을 사이에 두고 반 칸씩 비켜 서고, 별자리는 첫 고리를 이 수로 나눈다.
   */
  parentSlots?: number;
  /**
   * §5.1 #2-1 (F) ⑤ — 앱 작업 위성의 자리 각도(라디안 · 화면 좌표: 0 = 3시, π/2 = 6시). 있으면 첫 자리도 이 각도에 서고,
   * 물리가 이 각도를 스프링 오프셋으로 건다(위쪽 반원에 역할 순). 노드 데이터에는 `_seatAngle` 로 실린다.
   */
  seatAngle?: number;
}

/**
 * §5.1 #2-1 (B) — 버블 밖 부모(앱 노드)의 자리. 그런 부모는 `positionsRef` 에 없으므로 새 위성의 첫 자리를 이 값으로 잡는다
 * (중심 좌표 + 부모를 원으로 볼 때의 지름).
 */
export interface SatelliteAnchor {
  cx: number;
  cy: number;
  size: number;
}

// ─── 위성 데이터 수집 ───

/**
 * §2.4 — 캔버스에 그리지 않는 위성 타입. 표시 계층 한정이다 — 서버는 그대로 만들고 스냅샷에 싣는다(`agent.persistSatellites`).
 * bash 히스토리·running server 기록·bash 훅발 iframe 위성 생성·체크포인트 영속은 불변이고, 다시 보이게 하려면 이 Set 에서 한 줄만 빼면 된다.
 */
const HIDDEN_SATELLITE_TYPES: ReadonlySet<BubbleType> = new Set<BubbleType>(['bash']);

/**
 * 부모 버블(폴더/에이전트)별 위성 데이터를 추출한다(위치는 `placeSatellitePositions`).
 * Read: 위성→부모 (파일에서 데이터가 올라옴) · Write: 부모→위성 (데이터가 파일로 내려감)
 */
export function collectSatellites(
  parents: BubbleData[],
  satellites: Record<string, BubbleData[]>,
  heat: HeatScale | undefined,
  savedPositions?: Record<string, { x: number; y: number }>,
): SatelliteInfo[] {
  const result: SatelliteInfo[] = [];
  // 동일 파일이 여러 부모의 위성 목록에 중복 등록될 수 있음 → 첫 번째 부모만 채택
  const seenFileIds = new Set<string>();

  for (const parent of parents) {
    const files = satellites[parent.id];
    if (!files || files.length === 0) continue;

    const parentSize = calcBubbleSize(parent, undefined, heat);
    // §5.1 #2-2 (J) — 폴더는 위성 상한만큼 거느린다(서버가 그 수로 자른다) — 첫 고리를 그 수로 나눠 다 차면 고르게 둘러싼다.
    const parentSlots = FOLDER_BUBBLE_TYPES.has(parent.bubbleType)
      ? parent.maxSatellites ?? DEFAULT_MAX_SATELLITES
      : undefined;

    // TTL 필터링은 서버가 끝냈다 — 여기선 null 체크 + 중복 제거 + 숨김 타입(§2.4) 제외
    const aliveFiles = files.filter(
      (f): f is BubbleData =>
        f != null && !seenFileIds.has(f.id) && !HIDDEN_SATELLITE_TYPES.has(f.bubbleType),
    );
    if (aliveFiles.length === 0) continue;

    // 같은 부모 위성들끼리 파일 크기 범위 계산
    const localRange = calcFileSizeRange(aliveFiles.filter((f) => f.bubbleType === 'file'));

    for (let i = 0; i < aliveFiles.length; i++) {
      const file = aliveFiles[i];
      if (!file) continue;

      seenFileIds.add(file.id);
      const satId = `sat-${file.id}`;
      // 서버에 저장된 위성 위치가 있으면 BubbleData.position에 주입
      const savedPos = savedPositions?.[satId];
      const satBubble: BubbleData = {
        ...file,
        id: satId,
        activity: 1,
        position: savedPos ?? file.position,
      };
      const satSize = calcBubbleSize(satBubble, localRange, heat);
      const isRead = file.lastTool ? READ_TOOLS.has(file.lastTool) : false;

      result.push({
        bubble: satBubble,
        parentId: parent.id,
        parentSize,
        edge: {
          id: `sat-edge-${file.id}`,
          source: isRead ? satBubble.id : parent.id,
          target: isRead ? parent.id : satBubble.id,
          label: file.lastTool,
          isActive: file.status === 'active',
          color: BUBBLE_COLORS[file.bubbleType],
          sourceRadius: isRead ? satSize / 2 : parentSize / 2,
          targetRadius: isRead ? parentSize / 2 : satSize / 2,
        },
        index: i,
        total: aliveFiles.length,
        localRange,
        heat,
        ...(parentSlots !== undefined ? { parentSlots } : {}),
      });
    }
  }

  return result;
}

// ─── 위성 위치 배치 ───

/**
 * §5.1 #2-2 — 위성 둘레의 격자. 첫 고리는 물리 스프링의 평형점(부모 반경 + 위성 반경 + `SATELLITE_ORBIT_GAP`), 이웃·고리 사이는
 * 위성 간격(`SATELLITE_RING_SPACING` — 이름 줄을 달고 다니는 위성의 몫)이다(§5.1 #2-2 (J)).
 * 거느릴 수(`parentSlots`)는 부채꼴의 반 칸 비킴과 별자리의 첫 고리 나눔에 쓰인다. 고리 하나에만 앉는 달(`orbitSeat`)은
 * 그 수를 다 담도록 고리를 넓힌다(넘칠 바깥 고리가 없다). 정리(§5.4 #33)·물리의 다시 걸기가 같은 격자를 본다.
 */
export function satelliteZoneGrid(sat: Pick<SatelliteInfo, 'parentSlots' | 'orbitSeat'> = {}): ZoneGrid {
  const slots = typeof sat.parentSlots === 'number' && Number.isFinite(sat.parentSlots) && sat.parentSlots >= 1
    ? Math.floor(sat.parentSlots)
    : undefined;
  return {
    slot: SPAWN_ZONE.SATELLITE_SLOT,
    firstGap: SATELLITE_ORBIT_GAP,
    neighborGap: SATELLITE_RING_SPACING.NEIGHBOR_GAP,
    rowGap: SATELLITE_RING_SPACING.ROW_GAP,
    ...(slots !== undefined ? { firstRingSlots: slots } : {}),
    ...(slots !== undefined && sat.orbitSeat === true ? { fitFirstRing: true } : {}),
  };
}

/**
 * §5.1 #2-2 (J) — 달 `count` 개를 거느린 중심(반경 `coreR`)의 **궤도 반경**(칸 지름 달의 중심이 지나는 고리). 묶음의 점선 궤도가
 * 이 반경에 그려진다 — 달이 앉는 격자(`satelliteZoneGrid` 의 고리 0)와 같은 함수라 점선이 달을 꿰뚫고 지나간다.
 */
export function satelliteOrbitRadius(coreR: number, count: number): number {
  return zoneGridRadius(coreR, satelliteZoneGrid({ parentSlots: Math.max(1, count), orbitSeat: true }), 0);
}

/**
 * §5.1 #2-2 (J) — 위성 `count` 개를 거느린 중심(반경 `coreR`) 둘레에서 지름 `diameter` 위성이 앉는 **중심 사이 거리** — 등장 영역
 * 고리 0 과 같은 자리(주인 테두리와의 틈이 같게 · 수를 다 담도록 넓힌 고리). 물리가 부모가 바뀐 위성을 다시 걸 때 쓴다.
 */
export function satelliteSeatDistance(coreR: number, count: number, diameter: number): number {
  return zoneSeatRadius(coreR, satelliteZoneGrid({ parentSlots: Math.max(1, count), orbitSeat: true }), diameter, 0);
}

/** 위성의 주인(부모) — 장부의 자리 → 화면 위치 + 부모 지름 → 버블 밖 부모(앱 노드) 순. */
function satelliteAnchor(
  sat: SatelliteInfo,
  positionsRef: ReadonlyMap<string, XYPosition>,
  field: SpawnField,
  anchorOf?: (parentId: string) => SatelliteAnchor | null,
): ZoneAnchor | null {
  // 장부에는 렌더와 같은 자로 잰 자리가 있다 — 말풍선 부모도 물리 스프링과 같은 중심(상자 가운데)을 본다.
  const known = field.byId.get(sat.parentId);
  if (known) return anchorFromObstacle(known);
  const parentPos = positionsRef.get(sat.parentId);
  if (parentPos) {
    const ps = sat.parentSize;
    return { id: sat.parentId, cx: parentPos.x + ps / 2, cy: parentPos.y + ps / 2, r: ps / 2 };
  }
  const external = anchorOf?.(sat.parentId) ?? null;
  return external ? { id: sat.parentId, cx: external.cx, cy: external.cy, r: external.size / 2 } : null;
}

/**
 * §5.1 #2-2 (C) — 위성 부모의 **윗선** 자리(부모가 매달린 쪽). 위성은 그 반대편 — 바깥 — 으로 가지를 친다. 화면이 정한다:
 * 부모와 선으로 이어진 에이전트, 없으면 캔버스 중심(`spawnZoneSeating.satelliteUpstreamOf`). 부모가 위성(묶음)이면 묻지 않고 그 부모의 주인이다.
 */
export type SatelliteUpstream = (parentId: string) => { x: number; y: number } | null;

/**
 * positionsRef 기준으로 새 위성의 첫 자리를 정한다(§5.1 #2-2 등장 영역). 유효한 캐시 위치가 있는 위성은 건너뛴다(물리가 옮긴 위치 보존). 물리는 이 첫 자리를 스프링 오프셋으로 기억한다.
 * 일반 위성은 부모 둘레 가장 가까운 고리부터 빈칸을 찾되, 윗선 → 부모의 **바깥 방향**을 가운데 두고 좌우로 번갈아 앉는다(부채꼴 — 윗선을 모르면 12시부터 시계 방향).
 * 빈칸이 없을 때만 한 고리씩 넓힌다. 별자리 위성은 궤도(고리 0)에만 고르게, 앱 작업 위성은 정해진 각도에 선다.
 * `field` 는 그 화면의 등장 영역 장부(`spawnZoneSeating.buildSpawnField`) — 주면 모든 버블·창을 장애물로 보고 앉힌 위성을 더해 간다. 없으면 이번에 앉힌 위성끼리만(시험·폴백).
 */
export function placeSatellitePositions(
  sats: SatelliteInfo[],
  positionsRef: Map<string, XYPosition>,
  /** §5.1 #2-1 (B) — 버블 밖 부모(앱 노드)의 자리. `positionsRef` 에 없는 부모만 여기서 찾는다. */
  anchorOf?: (parentId: string) => SatelliteAnchor | null,
  field?: SpawnField,
  upstreamOf?: SatelliteUpstream,
): void {
  const ledger = field ?? createSpawnField([], null);
  const satById = new Map(sats.map((s) => [s.bubble.id, s] as const));
  // 부모 차례(처음 나온 순)를 지키고, 한 부모 안에서는 마지막 활동이 이른 것부터 — 도착 순서가 곧 고르는 순서다.
  const parentOrder = new Map<string, number>();
  const pending: { sat: SatelliteInfo; at: number }[] = [];
  sats.forEach((sat, at) => {
    if (!parentOrder.has(sat.parentId)) parentOrder.set(sat.parentId, parentOrder.size);
    const existing = positionsRef.get(sat.bubble.id);
    if (existing && (existing.x !== 0 || existing.y !== 0)) return;
    pending.push({ sat, at });
  });
  pending.sort((a, b) =>
    (parentOrder.get(a.sat.parentId)! - parentOrder.get(b.sat.parentId)!)
    || ((a.sat.bubble.lastActivity ?? 0) - (b.sat.bubble.lastActivity ?? 0))
    || (a.at - b.at));

  /** 부모의 윗선 — 부모가 위성(묶음)이면 그 부모의 주인, 아니면 화면이 알려 준 자리. */
  const upstreamPoint = (parentId: string): { x: number; y: number } | null => {
    const parentSat = satById.get(parentId);
    if (parentSat) {
      const grand = satelliteAnchor(parentSat, positionsRef, ledger, anchorOf);
      return grand ? { x: grand.cx, y: grand.cy } : null;
    }
    return upstreamOf?.(parentId) ?? null;
  };
  const facingOf = (sat: SatelliteInfo, anchor: ZoneAnchor): number | undefined => {
    const up = upstreamPoint(sat.parentId);
    if (!up) return undefined;
    const dx = anchor.cx - up.x;
    const dy = anchor.cy - up.y;
    // 윗선과 부모가 겹치면 방향이 없다 — 12시부터 시계 방향.
    return Math.hypot(dx, dy) >= 1 ? Math.atan2(dy, dx) : undefined;
  };

  for (const { sat } of pending) {
    const anchor = satelliteAnchor(sat, positionsRef, ledger, anchorOf);
    if (!anchor) continue;

    const satSize = calcBubbleSize(sat.bubble, sat.localRange, sat.heat);
    let center: { cx: number; cy: number };
    // §5.1 #2-1 (F) ⑤ — 앱 작업 위성은 정해진 각도에 바로 선다(무작위 ❌ — 역할 순서가 자리다).
    if (typeof sat.seatAngle === 'number' && Number.isFinite(sat.seatAngle)) {
      const orbitR = anchor.r + satSize / 2 + SATELLITE_ORBIT_GAP;
      center = { cx: anchor.cx + Math.cos(sat.seatAngle) * orbitR, cy: anchor.cy + Math.sin(sat.seatAngle) * orbitR };
    } else {
      // §5.1 #2-2 (G) — 별자리 달은 궤도 하나(고리 0)에 고르게 앉는다 — 그 궤도가 무리의 표식이라 부채꼴로 몰지 않는다.
      const facing = sat.orbitSeat ? undefined : facingOf(sat, anchor);
      center = seatInZone({
        anchor,
        diameter: satSize,
        grid: satelliteZoneGrid(sat),
        obstacles: ledger.obstacles,
        bounds: ledger.bounds,
        onlyRing: sat.orbitSeat ? 0 : undefined,
        ...(facing !== undefined ? { facing } : {}),
      });
    }
    positionsRef.set(sat.bubble.id, { x: center.cx - satSize / 2, y: center.cy - satSize / 2 });
    addToSpawnField(ledger, { id: sat.bubble.id, cx: center.cx, cy: center.cy, r: satSize / 2 });
  }
}
