/** §5.1 #2-1 (B) · §5.4 #33 (F) — 정리가 위성의 위성까지 거는가: 중심이 먼저 폴더 둘레에, 그 위성은 중심 둘레에, 앱 노드 둘레는 그대로. */
import { describe, it, expect } from 'vitest';
import { PHYSICS_MAGNET_GAP, SATELLITE_ORBIT_GAP } from '@vibisual/shared';
import { computeTidySatellites, computeTidySatellitesNested, type TidyParentSeat } from './tidyLayout.js';

describe('computeTidySatellitesNested — 별자리까지 두 바퀴', () => {
  const parents = new Map<string, TidyParentSeat>([['folder', { cx: 0, cy: 0, diameter: 100, bandIndex: 0 }]]);
  const sats = [
    { id: 'sat-hub', parentId: 'folder', diameter: 68, cx: 300, cy: 0 },
    { id: 'sat-moon', parentId: 'sat-hub', diameter: 40, cx: 0, cy: 500 },
    { id: 'sat-app-moon', parentId: 'app-1', diameter: 40, cx: 900, cy: 900 },
  ];

  it('한 바퀴짜리(종전)는 위성의 위성을 걸지 못한다', () => {
    expect(computeTidySatellites(sats, parents).map((p) => p.id)).toEqual(['sat-hub']);
  });

  it('중심이 앉은 뒤 그 둘레에 위성의 위성을 건다', () => {
    const placed = computeTidySatellitesNested(sats, parents);
    const hub = placed.find((p) => p.id === 'sat-hub');
    const moon = placed.find((p) => p.id === 'sat-moon');
    expect(hub).toBeDefined();
    expect(moon).toBeDefined();
    // 위성은 중심이 **앉은 자리** 둘레의 궤도 — 중심 반경 + 간격 + 자기 반경.
    const d = Math.hypot(moon!.cx - hub!.cx, moon!.cy - hub!.cy);
    expect(d).toBeCloseTo(68 / 2 + SATELLITE_ORBIT_GAP + 40 / 2, 0);
  });

  it('부모가 정리 대상이 아닌 위성(앱 노드 둘레)은 그 자리에 둔다', () => {
    expect(computeTidySatellitesNested(sats, parents).some((p) => p.id === 'sat-app-moon')).toBe(false);
  });
});

/** §5.1 #2-2 (J) — 한 고리의 위성은 크기가 달라도 부모 테두리와 틈이 같고, 묶음은 몸집으로 앉아 달이 부모를 파고들지 않는다. */
describe('computeTidySatellites — 위성 틈(§5.1 #2-2 (J))', () => {
  const parents = new Map<string, TidyParentSeat>([['folder', { cx: 0, cy: 0, diameter: 180, bandIndex: 0 }]]);

  it('한 고리의 위성은 제 크기로 — 부모 테두리와의 틈이 모두 SATELLITE_ORBIT_GAP', () => {
    const sats = [
      { id: 'sat-big', parentId: 'folder', diameter: 90, cx: 0, cy: -300 },
      { id: 'sat-small', parentId: 'folder', diameter: 40, cx: 300, cy: 0 },
      { id: 'sat-mid', parentId: 'folder', diameter: 64, cx: 0, cy: 300 },
    ];
    const placed = computeTidySatellites(sats, parents);
    for (const s of sats) {
      const p = placed.find((q) => q.id === s.id)!;
      expect(Math.hypot(p.cx, p.cy) - 90 - s.diameter / 2).toBeCloseTo(SATELLITE_ORBIT_GAP, 6);
    }
  });

  it('달을 거느린 묶음은 몸집으로 앉는다 — 같은 고리의 작은 위성은 그 몸집만큼 밀려나지 않는다', () => {
    const reach = 150;
    const sats = [
      { id: 'sat-bundle', parentId: 'folder', diameter: 64, cx: 0, cy: -400, reach },
      { id: 'sat-a', parentId: 'folder', diameter: 56, cx: 400, cy: 0 },
      { id: 'sat-b', parentId: 'folder', diameter: 56, cx: -400, cy: 0 },
    ];
    const placed = computeTidySatellites(sats, parents);
    const bundle = placed.find((p) => p.id === 'sat-bundle')!;
    expect(Math.hypot(bundle.cx, bundle.cy)).toBeCloseTo(90 + SATELLITE_ORBIT_GAP + reach, 6);
    for (const id of ['sat-a', 'sat-b']) {
      const p = placed.find((q) => q.id === id)!;
      expect(Math.hypot(p.cx, p.cy)).toBeCloseTo(90 + SATELLITE_ORBIT_GAP + 28, 6);
      // 묶음의 몸집(달 자리)을 밟지 않는다.
      expect(Math.hypot(p.cx - bundle.cx, p.cy - bundle.cy)).toBeGreaterThanOrEqual(reach + 28 + PHYSICS_MAGNET_GAP);
    }
  });

  it('달은 묶음의 그려지는 원 둘레에 건다(몸집 둘레 ❌)', () => {
    const sats = [
      { id: 'sat-bundle', parentId: 'folder', diameter: 64, cx: 0, cy: -400, reach: 150 },
      { id: 'sat-moon', parentId: 'sat-bundle', diameter: 56, cx: 0, cy: -600 },
    ];
    const placed = computeTidySatellitesNested(sats, parents);
    const bundle = placed.find((p) => p.id === 'sat-bundle')!;
    const moon = placed.find((p) => p.id === 'sat-moon')!;
    expect(Math.hypot(moon.cx - bundle.cx, moon.cy - bundle.cy)).toBeCloseTo(32 + SATELLITE_ORBIT_GAP + 28, 6);
  });
});
