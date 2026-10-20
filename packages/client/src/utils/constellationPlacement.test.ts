import { afterEach, describe, expect, it, vi } from 'vitest';
import { SATELLITE_ORBIT_GAP, type BubbleData } from '@vibisual/shared';

import { applyConstellations } from './constellationView.js';
import { collectSatellites, placeSatellitePositions, type SatelliteInfo } from './satellite.js';
import { calcBubbleSize } from './sizeCalc.js';

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

describe('별자리 첫 자리 — 새 파일 위성이 먼 임의 거리에 남지 않는다', () => {
  it.each(['folderSatellite', 'radialFile'])('파일 중심(%s)의 새 위성이 처음부터 실제 궤도에 앉는다', (kind) => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const video = file('video', 'teaser.mp4');
    const json = file('json', 'teaser.json');
    const nested = kind === 'folderSatellite';
    const view = applyConstellations({
      radial: nested ? [folder] : [video, json],
      satInfos: nested ? collectSatellites([folder], { folder: [video, json] }, undefined) : [],
      appHubs: [], heat: undefined, platform: 'linux',
    });
    const moon = view.satInfos.find((s) => s.bubble.id === 'sat-json')!;
    const positions = new Map([[moon.parentId, { x: 500, y: 500 }]]);
    const center = { x: 500 + moon.parentSize / 2, y: 500 + moon.parentSize / 2 };

    placeSatellitePositions(view.satInfos, positions);

    expect(radiusFrom(moon, positions.get(moon.bubble.id)!, center)).toBeCloseTo(orbitRadius(moon));
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

  it('사용자가 놓아 둔 기존 별자리 위성은 첫 자리 계산으로 옮기지 않는다', () => {
    const video = file('video', 'teaser.mp4');
    const view = applyConstellations({ radial: [video, file('json', 'teaser.json')], satInfos: [],
      appHubs: [], heat: undefined, platform: 'linux' });
    const moon = view.satInfos[0]!;
    const saved = { x: 900, y: 1100 };
    const positions = new Map([[video.id, { x: 500, y: 500 }], [moon.bubble.id, saved]]);

    placeSatellitePositions(view.satInfos, positions);

    expect(positions.get(moon.bubble.id)).toBe(saved);
  });

  it('일반 폴더 위성은 기존의 초기 퍼짐을 유지한다', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const sats = collectSatellites([folder], { folder: [file('code', 'build.ts')] }, undefined);
    const sat = sats[0]!;
    const positions = new Map([[folder.id, { x: 500, y: 500 }]]);
    const center = { x: 500 + sat.parentSize / 2, y: 500 + sat.parentSize / 2 };

    placeSatellitePositions(sats, positions);

    expect(radiusFrom(sat, positions.get(sat.bubble.id)!, center)).toBeGreaterThan(orbitRadius(sat));
  });
});
