/**
 * §5.1 #2-1 (B) — 화면 하나의 별자리 배치(`applyConstellations`) 고정 시험. DOM 없이 순수 함수로 잰다.
 *
 * 고정하는 것:
 *  ① 폴더 위성 중 같은 이름의 json 은 영상 위성을 도는 위성이 된다(부모·선·꼬리표) — 중심 사본에는 위성 수가 실린다.
 *  ② 위성이 아닌 것(중심 포함)이 먼저 온다 — 새 위성의 첫 자리를 잡을 때 중심이 이미 자리에 있어야 한다.
 *  ③ 원 둘레의 직속 파일이 위성이 되면 원 둘레에서 빠지고 `converted` 로 알린다.
 *  ④ 앱 노드가 선언한 파일은 그 노드를 돈다 — 노드가 연결선을 숨겼으면 선도 숨는다.
 *  ⑤ 관계가 없으면 아무것도 바뀌지 않는다.
 *  ⑥ 같은 내용의 꼬리표는 같은 객체다(노드 data 얕은 비교가 매번 깨지지 않게).
 */
import { describe, it, expect } from 'vitest';
import type { BubbleData } from '@vibisual/shared';
import { FILE_FACE } from '@vibisual/shared';

import { applyConstellations, type ConstellationTag } from './constellationView.js';
import { collectSatellites } from './satellite.js';
import { calcBubbleSize } from './sizeCalc.js';

function file(id: string, absolutePath: string, extra: Partial<BubbleData> = {}): BubbleData {
  const label = absolutePath.split('/').pop() ?? id;
  return { id, label, bubbleType: 'file', path: absolutePath, absolutePath, status: 'idle', activity: 1, lastTool: 'Write', ...extra };
}

function folder(id: string, label: string): BubbleData {
  return { id, label, bubbleType: 'internal_folder', path: label, status: 'idle', activity: 1 };
}

const ROOT = 'C:/proj';

describe('applyConstellations — 위성 재배치', () => {
  const video = folder('folder-video', 'video');
  const mp4 = file('f-mp4', `${ROOT}/video/teaser.mp4`, { lastTool: 'Read' });
  const json = file('f-json', `${ROOT}/video/teaser.json`);
  const notes = file('f-ts', `${ROOT}/video/build.ts`);

  it('같은 이름의 json 은 영상 위성을 도는 위성이 되고, 중심에는 위성 수가 실린다', () => {
    const sats = collectSatellites([video], { [video.id]: [json, mp4, notes] }, undefined);
    const out = applyConstellations({ radial: [video], satInfos: sats, appHubs: [], heat: undefined, platform: 'win32' });
    const moon = out.satInfos.find((s) => s.bubble.id === 'sat-f-json');
    expect(moon?.parentId).toBe('sat-f-mp4');
    expect(moon?.edge).toMatchObject({ id: 'sat-edge-f-json', source: 'sat-f-mp4', target: 'sat-f-json' });
    const tag = (moon?.bubble as unknown as { _constellation?: ConstellationTag })._constellation;
    expect(tag).toEqual({ hubLabel: 'teaser.mp4', reason: 'sameStem' });
    const hub = out.satInfos.find((s) => s.bubble.id === 'sat-f-mp4');
    expect((hub?.bubble as unknown as { _moonCount?: number })._moonCount).toBe(1);
    expect(hub?.parentId).toBe(video.id);
    // 중심은 하한까지 자란다 — 위성의 부모 지름도 같은 자로 잰다.
    expect(calcBubbleSize(hub!.bubble, hub!.localRange, undefined)).toBeGreaterThanOrEqual(FILE_FACE.hubMinSize);
    expect(moon?.parentSize).toBe(calcBubbleSize(hub!.bubble, hub!.localRange, undefined));
    // 관계 없는 코드는 폴더 곁에 남는다.
    expect(out.satInfos.find((s) => s.bubble.id === 'sat-f-ts')?.parentId).toBe(video.id);
  });

  it('위성이 아닌 것(중심 포함)이 먼저 온다', () => {
    const sats = collectSatellites([video], { [video.id]: [json, mp4] }, undefined);
    const out = applyConstellations({ radial: [video], satInfos: sats, appHubs: [], heat: undefined, platform: 'win32' });
    const ids = out.satInfos.map((s) => s.bubble.id);
    expect(ids.indexOf('sat-f-mp4')).toBeLessThan(ids.indexOf('sat-f-json'));
  });

  it('같은 내용의 꼬리표는 같은 객체다', () => {
    const run = (): unknown => {
      const sats = collectSatellites([video], { [video.id]: [json, mp4] }, undefined);
      const out = applyConstellations({ radial: [video], satInfos: sats, appHubs: [], heat: undefined, platform: 'win32' });
      return (out.satInfos.find((s) => s.bubble.id === 'sat-f-json')?.bubble as unknown as { _constellation?: unknown })._constellation;
    };
    expect(run()).toBe(run());
  });

  it('관계가 없으면 아무것도 바뀌지 않는다', () => {
    const a = file('f-a', `${ROOT}/src/a.ts`);
    const b = file('f-b', `${ROOT}/src/b.ts`);
    const src = folder('folder-src', 'src');
    const sats = collectSatellites([src], { [src.id]: [a, b] }, undefined);
    const out = applyConstellations({ radial: [src], satInfos: sats, appHubs: [], heat: undefined, platform: 'win32' });
    expect(out.converted.size).toBe(0);
    expect(out.satInfos.map((s) => s.parentId)).toEqual([src.id, src.id]);
  });
});

describe('applyConstellations — 원 둘레의 직속 파일', () => {
  it('위성이 된 직속 파일은 원 둘레에서 빠지고 converted 로 알린다', () => {
    const mp4 = file('f-mp4', `${ROOT}/teaser.mp4`, { lastTool: 'Read' });
    const srt = file('f-srt', `${ROOT}/teaser.srt`);
    const out = applyConstellations({ radial: [mp4, srt], satInfos: [], appHubs: [], heat: undefined, platform: 'win32' });
    expect(out.radial.map((b) => b.id)).toEqual(['f-mp4']);
    expect((out.radial[0] as unknown as { _moonCount?: number })._moonCount).toBe(1);
    expect(out.converted.get('f-srt')).toBe('sat-f-srt');
    const moon = out.satInfos.find((s) => s.bubble.id === 'sat-f-srt');
    expect(moon?.parentId).toBe('f-mp4');
    expect(moon?.bubble.activity).toBe(1);
  });
});

describe('applyConstellations — 앱 노드 중심', () => {
  it('앱 노드가 선언한 파일은 그 노드를 돌고, 연결선을 숨긴 노드면 선도 숨는다', () => {
    const comp = folder('folder-vib', '.vibisual');
    const index = file('f-index', `${ROOT}/.vibisual/video/compositions/intro/index.html`);
    const css = file('f-css', `${ROOT}/.vibisual/video/compositions/intro/style.css`);
    const sats = collectSatellites([comp], { [comp.id]: [index, css] }, undefined);
    const hub = {
      id: 'app-1',
      results: [],
      parts: [],
      codeParts: [`${ROOT}/.vibisual/video/compositions/intro/index.html`],
      label: 'Teaser',
      size: 208,
      linksHidden: true,
    };
    const out = applyConstellations({ radial: [comp], satInfos: sats, appHubs: [hub], heat: undefined, platform: 'win32' });
    for (const id of ['sat-f-index', 'sat-f-css']) {
      const moon = out.satInfos.find((s) => s.bubble.id === id);
      expect(moon?.parentId).toBe('app-1');
      expect(moon?.parentSize).toBe(208);
      expect(moon?.edgeHidden).toBe(true);
      expect((moon?.bubble as unknown as { _constellation?: ConstellationTag })._constellation)
        .toEqual({ hubLabel: 'Teaser', reason: 'appPart' });
    }
  });
});
