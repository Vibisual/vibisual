/**
 * §5.1 #2-2 (J) — 위성 궤도에 숨 쉴 틈(2026-10-22 사용자 지시 「우리 폴더에 붙는 위성들이 지금 너무 짧아져서 다닥다닥 느낌」).
 *
 * 실측(사용자 프로젝트의 `bubble-test`, 180px 폴더): 위성 다섯이 폴더 테두리에서 20px 밖 첫 고리의 **이어진 칸**(9칸 고리 — 40° 간격)에
 * 앉아 12시~4시에 초승달로 몰렸고, 12시 자리 위성은 원 아래 이름 줄이 폴더 테두리에 닿았다. 같은 종류 다섯이 묶음이 되면 그 달이
 * 폴더 쪽으로 파고들었다.
 *
 * 고정하는 것: ① 부모 테두리와 위성 테두리 사이는 이름 줄을 지나서도 선이 보이는 틈 ② 첫 고리는 부모가 거느릴 수로 나눠 다 차면
 * 정다각형(12시부터 시계 방향은 그대로) ③ 위성 상한을 바꾸면 그 수로 나눈다 · 상한이 없는 부모는 고리가 담는 만큼 ④ 묶음은 달을
 * 거느리지 않는다(2026-10-22 「저런 버블은 없다고」 — 구성은 묶음 안에서만) · 묶음은 보통 위성처럼 틈 하나 밖 ⑤ 다른 위성은 묶음과
 * 겹치지 않는다 ⑥ 격자 기하(첫 고리 칸 수 · 넓힌 고리 · 주인 자신은 제 원).
 */
import { describe, expect, it } from 'vitest';
import {
  BUNDLE_BUBBLE,
  FILE_FACE,
  PHYSICS_MAGNET_GAP,
  SATELLITE_ORBIT_GAP,
  SATELLITE_RING_SPACING,
  SPAWN_ZONE,
  type BubbleData,
} from '@vibisual/shared';

import { applyConstellations } from './constellationView.js';
import {
  collectSatellites,
  placeSatellitePositions,
  satelliteZoneGrid,
  type SatelliteInfo,
} from './satellite.js';
import { calcBubbleSize } from './sizeCalc.js';
import {
  anchorFromObstacle,
  createSpawnField,
  seatInZone,
  zoneGridRadius,
  zoneRingSlots,
  zoneSlotCount,
  type ZoneGrid,
} from './spawnZone.js';

/** 원 아래 이름 줄의 높이 — `FileFaceRim` 이 원 바로 밑(`captionGap`)에 14px 줄로 그린다. */
const CAPTION_PX = FILE_FACE.captionGap + 14;
const TWO_PI = Math.PI * 2;
const DEG = Math.PI / 180;

function folderOf(id: string, dir: string, extra: Partial<BubbleData> = {}): BubbleData {
  return { id, label: dir.split('/').pop() ?? dir, path: dir, bubbleType: 'internal_folder', status: 'idle', activity: 1, ...extra };
}

function fileIn(dir: string, id: string, name: string, lastActivity: number): BubbleData {
  return {
    id, label: name, path: `${dir}/${name}`, absolutePath: `${dir}/${name}`,
    bubbleType: 'file', status: 'idle', activity: 1, lastActivity,
  };
}

interface Circle { cx: number; cy: number; r: number }

function circleOf(sat: SatelliteInfo, positions: ReadonlyMap<string, { x: number; y: number }>): Circle {
  const d = calcBubbleSize(sat.bubble, sat.localRange, sat.heat);
  const p = positions.get(sat.bubble.id)!;
  return { cx: p.x + d / 2, cy: p.y + d / 2, r: d / 2 };
}

/** 12시에서 시계 방향으로 잰 각도(0..2π) — 화면 y 는 아래로 자란다. */
function clockAngle(anchor: { cx: number; cy: number }, c: { cx: number; cy: number }): number {
  const a = Math.atan2(c.cy - anchor.cy, c.cx - anchor.cx) - SPAWN_ZONE.START_ANGLE;
  return ((a % TWO_PI) + TWO_PI) % TWO_PI;
}

/** 부모를 (500,500) 좌상단에 두고 위성을 앉힌 결과 — 부모 원과 위성 원들. */
function seatAround(parent: BubbleData, files: BubbleData[]): { parent: Circle; sats: SatelliteInfo[]; circles: Map<string, Circle> } {
  const sats = collectSatellites([parent], { [parent.id]: files }, undefined);
  const ps = sats[0]!.parentSize;
  const positions = new Map([[parent.id, { x: 500, y: 500 }]]);
  placeSatellitePositions(sats, positions);
  const circles = new Map(sats.map((s) => [s.bubble.id, circleOf(s, positions)] as const));
  return { parent: { cx: 500 + ps / 2, cy: 500 + ps / 2, r: ps / 2 }, sats, circles };
}

describe('§5.1 #2-2 (J) 위성 궤도에 숨 쉴 틈', () => {
  it('부모 테두리와 위성 테두리 사이는 이름 줄을 지나서도 선이 보인다 — 12시 위성의 이름이 폴더에 닿지 않는다', () => {
    // 이름 줄(17px) 뒤로 선이 적어도 24px 보여야 "붙은 것"이 아니라 "도는 것"으로 읽힌다(종전 20px — 이름 줄과 거의 같았다).
    expect(SATELLITE_ORBIT_GAP).toBeGreaterThanOrEqual(CAPTION_PX + 24);
    const dir = '/p/shots';
    const { parent, circles } = seatAround(folderOf('f', dir), [fileIn(dir, 'a', 'shot.png', 1)]);
    const c = circles.get('sat-a')!;
    const edgeGap = Math.hypot(c.cx - parent.cx, c.cy - parent.cy) - parent.r - c.r;
    expect(edgeGap).toBeCloseTo(SATELLITE_ORBIT_GAP, 6);
    // 12시 자리 — 이름 줄은 위성 아래(폴더 쪽)로 내려온다. 그 끝과 폴더 테두리 사이가 비어 있다.
    expect(clockAngle(parent, c)).toBeCloseTo(0, 6);
    const captionBottom = c.cy + c.r + CAPTION_PX;
    expect(parent.cy - parent.r - captionBottom).toBeGreaterThanOrEqual(24);
  });

  it('다섯이 차면 정오각형 — 12시부터 72° 씩 시계 방향(이어진 칸에 몰린 초승달 ❌)', () => {
    const dir = '/p/bubble-test';
    // 실측 그 폴더 — 활동이 많아 가장 큰 지름(180px)이다. 고리가 담을 수 있는 칸은 다섯보다 많다.
    const parentBubble = folderOf('f', dir, { activity: 100_000 });
    const files = ['veg.veg', 'vob.vob', 'webm.webm', 'wmv.wmv', 'y4m.y4m'].map((n, i) => fileIn(dir, `v${i}`, n, i + 1));
    const { parent, sats, circles } = seatAround(parentBubble, files);
    const grid = satelliteZoneGrid(sats[0]!);
    expect(zoneSlotCount(zoneGridRadius(parent.r, grid, 0), grid.slot, grid.neighborGap)).toBeGreaterThan(5);
    const angles = files.map((f) => clockAngle(parent, circles.get(`sat-${f.id}`)!));
    angles.forEach((a, i) => expect(a).toBeCloseTo((i * 72) * DEG, 6));
    // 모두 첫 고리 — 부모 테두리와의 틈이 같다.
    for (const f of files) {
      const c = circles.get(`sat-${f.id}`)!;
      expect(Math.hypot(c.cx - parent.cx, c.cy - parent.cy) - parent.r - c.r).toBeCloseTo(SATELLITE_ORBIT_GAP, 6);
    }
  });

  it('덜 차면 12시부터 시계 방향의 호 — 셋은 0°·72°·144°', () => {
    const dir = '/p/three';
    const files = ['a.ts', 'b.ts', 'c.ts'].map((n, i) => fileIn(dir, `t${i}`, n, i + 1));
    const { parent, circles } = seatAround(folderOf('f', dir), files);
    const angles = files.map((f) => clockAngle(parent, circles.get(`sat-${f.id}`)!));
    expect(angles[0]).toBeCloseTo(0, 6);
    expect(angles[1]).toBeCloseTo(72 * DEG, 6);
    expect(angles[2]).toBeCloseTo(144 * DEG, 6);
  });

  it('폴더의 위성 상한을 바꾸면 그 수로 나눈다 — 상한 3 이면 120°', () => {
    const dir = '/p/capped';
    const files = ['a.ts', 'b.ts', 'c.ts'].map((n, i) => fileIn(dir, `c${i}`, n, i + 1));
    const { parent, circles } = seatAround(folderOf('f', dir, { maxSatellites: 3 }), files);
    const angles = files.map((f) => clockAngle(parent, circles.get(`sat-${f.id}`)!));
    angles.forEach((a, i) => expect(a).toBeCloseTo((i * 120) * DEG, 6));
  });

  it('상한이 없는 부모(에이전트)는 고리가 담는 만큼 — 첫 고리 칸 수를 정하지 않는다', () => {
    const agent: BubbleData = { id: 'ag', label: 'Agent', path: '', bubbleType: 'agent', status: 'active', activity: 5 };
    const sats = collectSatellites([agent], { ag: [fileIn('/p', 'x', 'x.ts', 1)] }, undefined);
    expect(sats[0]!.parentSlots).toBeUndefined();
    expect(satelliteZoneGrid(sats[0]!).firstRingSlots).toBeUndefined();
  });

  it('위성 격자의 이웃·고리 틈은 위성 간격 — 최상위 간격보다 넓다(이름 줄이 이웃을 밟지 않게)', () => {
    const grid = satelliteZoneGrid();
    expect(grid.neighborGap).toBe(SATELLITE_RING_SPACING.NEIGHBOR_GAP);
    expect(grid.rowGap).toBe(SATELLITE_RING_SPACING.ROW_GAP);
    expect(SATELLITE_RING_SPACING.NEIGHBOR_GAP).toBeGreaterThan(34);
    expect(SATELLITE_RING_SPACING.ROW_GAP).toBeGreaterThan(30);
  });
});

describe('§5.1 #2-2 (J) 묶음은 달을 거느리지 않는다 — 2026-10-22 사용자 지시 「저런 버블은 없다고」', () => {
  const top = '/project';
  const dir = '/project/video';
  const names = ['a.mp4', 'b.mp4', 'c.mp4', 'd.mp4', 'e.mp4', 'f.mp4', 'g.mp4', 'h.mp4'];

  function bundleScene(extra: BubbleData[] = []): {
    parent: Circle;
    view: ReturnType<typeof applyConstellations>;
    positions: Map<string, { x: number; y: number }>;
  } {
    const parent = folderOf('parent', top, { activity: 100_000, maxSatellites: 12 });
    const files = names.map((n, i) => fileIn(dir, `m${i}`, n, 100 + i));
    const view = applyConstellations({
      radial: [parent],
      satInfos: collectSatellites([parent], { parent: [...files, ...extra] }, undefined),
      appHubs: [], heat: undefined, platform: 'linux',
    });
    const ps = view.satInfos[0]!.parentSize;
    const positions = new Map([[parent.id, { x: 500, y: 500 }]]);
    placeSatellitePositions(view.satInfos, positions);
    return { parent: { cx: 500 + ps / 2, cy: 500 + ps / 2, r: ps / 2 }, view, positions };
  }

  it('구성(달)은 바깥 화면에 서지 않는다 — 묶음 버블 하나가 그 자리를 대신하고 몸집은 제 원이다', () => {
    const { view } = bundleScene();
    const bundle = view.satInfos.find((s) => s.bubble.bubbleType === 'bundle')!;
    expect(view.satInfos.filter((s) => s.parentId === bundle.bubble.id)).toHaveLength(0);
    expect(view.satInfos.filter((s) => s.bubble.bubbleType === 'file')).toHaveLength(0);
    expect(bundle.reach).toBeUndefined();
    expect((bundle.bubble as unknown as Record<string, unknown>)['_orbitReach']).toBeUndefined();
  });

  it('묶음은 보통 위성처럼 부모 테두리에서 틈 하나 밖에 제 원의 테두리가 온다', () => {
    const { parent, view, positions } = bundleScene();
    const bundle = view.satInfos.find((s) => s.bubble.bubbleType === 'bundle')!;
    const b = circleOf(bundle, positions);
    expect(b.r).toBeCloseTo(BUNDLE_BUBBLE.size / 2, 6);
    expect(Math.hypot(b.cx - parent.cx, b.cy - parent.cy)).toBeCloseTo(parent.r + SATELLITE_ORBIT_GAP + b.r, 6);
  });

  it('같은 부모의 다른 위성은 묶음과 겹치지 않는다', () => {
    const others = ['notes.md', 'plan.json', 'build.ts'].map((n, i) => fileIn(top, `o${i}`, n, i + 1));
    const { view, positions } = bundleScene(others);
    const bundle = view.satInfos.find((s) => s.bubble.bubbleType === 'bundle')!;
    const b = circleOf(bundle, positions);
    for (const o of others) {
      const p = circleOf(view.satInfos.find((s) => s.bubble.id === `sat-${o.id}`)!, positions);
      expect(Math.hypot(p.cx - b.cx, p.cy - b.cy)).toBeGreaterThanOrEqual(p.r + b.r + PHYSICS_MAGNET_GAP - 1e-6);
    }
  });
});

describe('§5.1 #2-2 (J) 격자 기하', () => {
  const base: ZoneGrid = { slot: 65, firstGap: 48, neighborGap: 44, rowGap: 40 };

  it('첫 고리는 정한 수까지만 나눈다 — 바깥 고리는 그대로', () => {
    const physical0 = zoneSlotCount(zoneGridRadius(90, base, 0), 65, 44);
    expect(physical0).toBeGreaterThan(5);
    expect(zoneRingSlots(90, { ...base, firstRingSlots: 5 }, 0)).toBe(5);
    expect(zoneRingSlots(90, { ...base, firstRingSlots: 5 }, 1)).toBe(zoneRingSlots(90, base, 1));
    // 정한 수가 고리보다 많으면 고리가 담는 만큼이다(넓히지 않으면).
    expect(zoneRingSlots(90, { ...base, firstRingSlots: 99 }, 0)).toBe(physical0);
  });

  it('`fitFirstRing` 이면 정한 수를 다 담도록 첫 고리를 넓힌다 — 부동소수 오차로 한 칸을 잃지 않는다', () => {
    const small = 32;
    expect(zoneRingSlots(small, { ...base, firstRingSlots: 8 }, 0)).toBeLessThan(8);
    const fitted = { ...base, firstRingSlots: 8, fitFirstRing: true };
    expect(zoneRingSlots(small, fitted, 0)).toBe(8);
    expect(zoneGridRadius(small, fitted, 0)).toBeGreaterThan(zoneGridRadius(small, base, 0));
    for (let n = 1; n <= 40; n += 1) expect(zoneRingSlots(small, { ...base, firstRingSlots: n, fitFirstRing: true }, 0)).toBe(n);
  });

  it('장부에 몸집으로 오른 칸도 주인일 때는 제 원이다 — 제 달이 앉을 칸을 스스로 막지 않는다', () => {
    const hub = { id: 'hub', cx: 0, cy: 0, r: 160, core: 32 };
    expect(anchorFromObstacle(hub).r).toBe(32);
    const seat = seatInZone({
      anchor: anchorFromObstacle(hub),
      diameter: 65,
      grid: { ...base, firstRingSlots: 4, fitFirstRing: true },
      obstacles: [hub],
      bounds: null,
      onlyRing: 0,
    });
    expect(seat.free).toBe(true);
    expect(Math.hypot(seat.cx, seat.cy)).toBeCloseTo(32 + 48 + 65 / 2, 6);
  });
});
