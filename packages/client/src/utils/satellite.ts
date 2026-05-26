import type { XYPosition } from '@xyflow/react';
import type { BubbleData } from '@vibisual/shared';
import { BUBBLE_COLORS, READ_TOOLS, SATELLITE_ORBIT_GAP } from '@vibisual/shared';
import { calcBubbleSize, calcFileSizeRange } from './sizeCalc.js';

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
}

// ─── 위성 데이터 수집 ───

/**
 * 부모 버블(폴더/에이전트)별 위성 데이터를 추출한다.
 * 위치는 별도로 `placeSatellitePositions`에서 계산.
 *
 * Read: 위성→부모 (파일에서 데이터가 올라옴)
 * Write: 부모→위성 (데이터가 파일로 내려감)
 */
export function collectSatellites(
  parents: BubbleData[],
  satellites: Record<string, BubbleData[]>,
  savedPositions?: Record<string, { x: number; y: number }>,
): SatelliteInfo[] {
  const result: SatelliteInfo[] = [];
  // 동일 파일이 여러 부모의 위성 목록에 중복 등록될 수 있음 → 첫 번째 부모만 채택
  const seenFileIds = new Set<string>();

  for (const parent of parents) {
    const files = satellites[parent.id];
    if (!files || files.length === 0) continue;

    const parentSize = calcBubbleSize(parent);

    // 서버가 TTL 필터링 완료 — null 체크 + 중복 제거
    const aliveFiles = files.filter((f): f is BubbleData => f != null && !seenFileIds.has(f.id));
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
      const satSize = calcBubbleSize(satBubble, localRange);
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
      });
    }
  }

  return result;
}

// ─── 위성 위치 배치 ───

const SAT_SPAWN_RADIUS = 250;
const SAT_SPAWN_MIN_DIST = 50;
const SAT_SPAWN_MAX_TRIES = 50;

/**
 * positionsRef 기준으로 위성 위치를 계산한다.
 * 유효한 캐시 위치가 있는 위성은 스킵 (물리 엔진이 이동시킨 위치 보존).
 * 새 위성은 부모 중심 반경 250px 내에서 충돌 없는 위치에 배치.
 */
export function placeSatellitePositions(
  sats: SatelliteInfo[],
  positionsRef: Map<string, XYPosition>,
): void {
  for (const sat of sats) {
    const existing = positionsRef.get(sat.bubble.id);
    if (existing && (existing.x !== 0 || existing.y !== 0)) continue;

    const parentPos = positionsRef.get(sat.parentId);
    if (!parentPos) continue;

    const ps = sat.parentSize;
    const anchor = { x: parentPos.x + ps / 2, y: parentPos.y + ps / 2 };

    // 부모 중심 반경 SAT_SPAWN_RADIUS 내에서 충돌 없는 위치 탐색
    const satSize = calcBubbleSize(sat.bubble, sat.localRange);
    const minDist = Math.max(SAT_SPAWN_MIN_DIST, satSize);
    let placed = false;
    for (let i = 0; i < SAT_SPAWN_MAX_TRIES; i++) {
      const angle = Math.random() * 2 * Math.PI;
      const r = ps / 2 + satSize / 2 + SATELLITE_ORBIT_GAP + Math.random() * (SAT_SPAWN_RADIUS - ps / 2 - satSize / 2 - SATELLITE_ORBIT_GAP);
      const cx = anchor.x + Math.cos(angle) * r - satSize / 2;
      const cy = anchor.y + Math.sin(angle) * r - satSize / 2;
      let collides = false;
      for (const pos of positionsRef.values()) {
        const dx = pos.x - cx;
        const dy = pos.y - cy;
        if (dx * dx + dy * dy < minDist * minDist) { collides = true; break; }
      }
      if (!collides) {
        positionsRef.set(sat.bubble.id, { x: cx, y: cy });
        placed = true;
        break;
      }
    }
    if (!placed) {
      const fallbackAngle = Math.random() * 2 * Math.PI;
      const fallbackR = ps / 2 + satSize / 2 + SATELLITE_ORBIT_GAP;
      positionsRef.set(sat.bubble.id, {
        x: anchor.x + Math.cos(fallbackAngle) * fallbackR - satSize / 2,
        y: anchor.y + Math.sin(fallbackAngle) * fallbackR - satSize / 2,
      });
    }
  }
}
