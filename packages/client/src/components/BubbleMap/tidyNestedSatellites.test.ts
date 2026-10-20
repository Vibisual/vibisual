/**
 * §5.1 #2-1 (B) · §5.4 #33 (F) — 정리가 **위성의 위성**(별자리)까지 다시 거는가(`computeTidySatellitesNested`).
 *
 * 고정하는 것: ① 중심(폴더의 파일 위성)이 먼저 폴더 둘레에 앉고 ② 그 위성은 중심이 앉은 자리 둘레에 걸린다
 * ③ 부모가 끝내 정리 대상이 아닌 위성(앱 노드 둘레)은 손대지 않는다.
 */
import { describe, it, expect } from 'vitest';
import { SATELLITE_ORBIT_GAP } from '@vibisual/shared';
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
