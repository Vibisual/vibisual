import { afterEach, describe, expect, it, vi } from 'vitest';
import { SATELLITE_ORBIT_GAP, type BubbleData } from '@vibisual/shared';

import { applyConstellations } from './constellationView.js';
import { collectSatellites, placeSatellitePositions, type SatelliteInfo } from './satellite.js';
import { calcBubbleSize } from './sizeCalc.js';
import { createSpawnField } from './spawnZone.js';

const folder: BubbleData = {
  id: 'folder', label: 'video', path: '/project/video', bubbleType: 'internal_folder', status: 'idle', activity: 1,
};

function file(id: string, name: string): BubbleData {
  return { id, label: name, path: `/project/video/${name}`, absolutePath: `/project/video/${name}`,
    bubbleType: 'file', status: 'idle', activity: 1 };
}

function radiusFrom(sat: SatelliteInfo, position: { x: number; y: number }, center: { x: number; y: number }): number {
  const size = calcBubbleSize(sat.bubble, sat.localRange, sat.heat);
  return Math.hypot(position.x + size / 2 - center.x, position.y + size / 2 - center.y);
}

function orbitRadius(sat: SatelliteInfo): number {
  return sat.parentSize / 2 + calcBubbleSize(sat.bubble, sat.localRange, sat.heat) / 2 + SATELLITE_ORBIT_GAP;
}

afterEach(() => vi.restoreAllMocks());

/**
 * §5.1 #2-1 (B) — 같은 종류 묶음: `/project` 를 도는 위성 중 하위 폴더 `video` 의 영상 둘은 묶음 버블 하나가 되고 폴더의 낱자리로 서지 않는다.
 * 대신 폴더 위성과 같은 규칙으로 묶음의 위성이 된다. 묶음은 폴더의 위성처럼 첫 고리에 서되 제 위성까지가 몸이다.
 * 궤도(고리 0)에만 앉는 달은 앱 노드 별자리의 위성이다.
 */
const parent: BubbleData = {
  id: 'parent', label: 'project', path: '/project', bubbleType: 'internal_folder', status: 'idle', activity: 1,
};

function kindBundleView(): ReturnType<typeof applyConstellations> {
  return applyConstellations({
    radial: [parent],
    satInfos: collectSatellites([parent], { parent: [file('video', 'teaser.mp4'), file('clip', 'clip.mp4')] }, undefined),
    appHubs: [], heat: undefined, platform: 'linux',
  });
}

/** 앱 노드 별자리 — 그 노드가 결과로 선언한 영상이 노드 둘레 궤도(고리 0)를 도는 달이 된다. */
const APP_CENTER = { x: 900, y: 700 };
function appHubView(): ReturnType<typeof applyConstellations> {
  const video = file('video', 'teaser.mp4');
  return applyConstellations({
    radial: [video], satInfos: [], heat: undefined, platform: 'linux',
    appHubs: [{ id: 'app', label: 'Video', size: 208, linksHidden: false, results: [video.absolutePath!], parts: [], codeParts: [] }],
  });
}

describe('별자리 첫 자리 — 새 파일 위성이 먼 임의 거리에 남지 않는다', () => {
  it('같은 종류 묶음은 구성 대신 묶음 버블 하나가 부모 둘레 첫 고리 12시에 서고, 구성은 그 묶음 둘레 12시부터 위성으로 선다', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const view = kindBundleView();
    // 묶음 하나 + 그 위성 둘 — 폴더를 직접 도는 것은 묶음뿐이다(구성은 폴더의 낱자리로 서지 않는다).
    expect(view.satInfos).toHaveLength(3);
    const bundle = view.satInfos[0]!;
    expect(bundle.bubble.bubbleType).toBe('bundle');
    expect(bundle.parentId).toBe(parent.id);
    expect(view.satInfos.filter((s) => s.parentId === parent.id)).toHaveLength(1);
    const moons = view.satInfos.filter((s) => s.parentId === bundle.bubble.id);
    expect(moons.map((s) => s.bubble.id).sort()).toEqual(['sat-clip', 'sat-video']);
    expect(typeof bundle.reach).toBe('number');
    const positions = new Map([[parent.id, { x: 500, y: 500 }]]);
    const center = { x: 500 + bundle.parentSize / 2, y: 500 + bundle.parentSize / 2 };

    placeSatellitePositions(view.satInfos, positions);

    // 묶음은 제 위성까지가 몸 — 부모 테두리 → 틈 → 몸집 테두리(§5.1 #2-2 (J) ④). 자리는 그대로 12시다.
    const size = calcBubbleSize(bundle.bubble, bundle.localRange, bundle.heat);
    const p = positions.get(bundle.bubble.id)!;
    expect(radiusFrom(bundle, p, center)).toBeCloseTo(bundle.parentSize / 2 + bundle.reach! + SATELLITE_ORBIT_GAP);
    expect(p.x + size / 2).toBeCloseTo(center.x);
    expect(p.y + size / 2).toBeLessThan(center.y);
    // 위성은 묶음 둘레 첫 고리 — 폴더 위성과 같은 틈이고, 먼저 앉은 것이 12시다(활동이 같으면 차례대로).
    const bundleCenter = { x: p.x + size / 2, y: p.y + size / 2 };
    const first = moons[0]!;
    const fp = positions.get(first.bubble.id)!;
    const fs = calcBubbleSize(first.bubble, first.localRange, first.heat);
    expect(radiusFrom(first, fp, bundleCenter)).toBeCloseTo(orbitRadius(first));
    expect(fp.x + fs / 2).toBeCloseTo(bundleCenter.x);
    expect(fp.y + fs / 2).toBeLessThan(bundleCenter.y);
    for (const moon of moons) {
      expect(radiusFrom(moon, positions.get(moon.bubble.id)!, bundleCenter)).toBeCloseTo(orbitRadius(moon));
    }
  });

  it('앱 중심의 새 위성도 앱 가운데를 기준으로 같은 궤도에 앉는다', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const video = file('video', 'teaser.mp4');
    const view = applyConstellations({
      radial: [video], satInfos: [], heat: undefined, platform: 'linux',
      appHubs: [{ id: 'app', label: 'Video', size: 208, linksHidden: false,
        results: [video.absolutePath!], parts: [], codeParts: [] }],
    });
    const moon = view.satInfos[0]!;
    const positions = new Map<string, { x: number; y: number }>();
    const center = { x: 900, y: 700 };

    placeSatellitePositions(view.satInfos, positions, (id) => id === 'app' ? { cx: center.x, cy: center.y, size: 208 } : null);

    expect(radiusFrom(moon, positions.get(moon.bubble.id)!, center)).toBeCloseTo(orbitRadius(moon));
  });

  it('사용자가 놓아 둔 기존 앱 중심 위성은 첫 자리 계산으로 옮기지 않는다', () => {
    const view = appHubView();
    const moon = view.satInfos[0]!;
    const saved = { x: 900, y: 1100 };
    const positions = new Map([[moon.bubble.id, saved]]);

    placeSatellitePositions(view.satInfos, positions, (id) => id === 'app' ? { cx: APP_CENTER.x, cy: APP_CENTER.y, size: 208 } : null);

    expect(positions.get(moon.bubble.id)).toBe(saved);
  });

  it('일반 폴더 위성도 부모 둘레 첫 고리 12시에 선다 — 무작위 퍼짐 폐기(§5.1 #2-2)', () => {
    // 무작위를 쓰지 않는다 — 난수가 무엇이든 같은 자리여야 한다.
    vi.spyOn(Math, 'random').mockReturnValue(0.93);
    const sats = collectSatellites([folder], { folder: [file('code', 'build.ts')] }, undefined);
    const sat = sats[0]!;
    const positions = new Map([[folder.id, { x: 500, y: 500 }]]);
    const center = { x: 500 + sat.parentSize / 2, y: 500 + sat.parentSize / 2 };

    placeSatellitePositions(sats, positions);

    const size = calcBubbleSize(sat.bubble, sat.localRange, sat.heat);
    const p = positions.get(sat.bubble.id)!;
    expect(radiusFrom(sat, p, center)).toBeCloseTo(orbitRadius(sat));
    expect(p.x + size / 2).toBeCloseTo(center.x);
    expect(p.y + size / 2).toBeLessThan(center.y);
  });

  it('앱 중심 위성은 부모 둘레가 붐벼도 궤도(고리 0)에만 앉는다 — 넓히지 않는다', () => {
    const view = appHubView();
    const moon = view.satInfos[0]!;
    expect(moon.orbitSeat).toBe(true);
    const center = { x: APP_CENTER.x, y: APP_CENTER.y };
    // 궤도 바로 바깥을 남의 버블로 채운다 — 일반 위성이면 바깥 고리로 넓혔을 수다.
    const crowd = Array.from({ length: 24 }, (_, i) => {
      const t = (i * Math.PI * 2) / 24;
      const r = orbitRadius(moon) + 30;
      return { id: `crowd-${i}`, cx: center.x + Math.cos(t) * r, cy: center.y + Math.sin(t) * r, r: 6 };
    });
    const field = createSpawnField([{ id: moon.parentId, cx: center.x, cy: center.y, r: moon.parentSize / 2 }, ...crowd], null);
    const positions = new Map([[moon.parentId, { x: 500, y: 500 }]]);

    placeSatellitePositions(view.satInfos, positions, undefined, field);

    expect(radiusFrom(moon, positions.get(moon.bubble.id)!, center)).toBeCloseTo(orbitRadius(moon));
  });
});
