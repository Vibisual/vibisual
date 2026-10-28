/**
 * §5.1 #2-1 (B) — 화면 하나의 별자리·묶음 배치(`applyConstellations`) 고정 시험(순수 함수, DOM 없음). 묶음엔 같은 종류만 · 하위 폴더 무관 하나 ·
 * 파일은 중심 ❌ · 앱 노드 파일은 그 노드를 돈다 · 묶음 자리·id·이름(서버 공통 폴더 → 화면 구성 공통 폴더 → 주인 폴더) · 묶음 안 구성(범위·상한·깊이) — describe 마다 하나씩.
 */
import { describe, it, expect } from 'vitest';
import type { BubbleData } from '@vibisual/shared';
import { BUBBLE_COLORS, BUNDLE_BUBBLE, DEFAULT_MAX_SATELLITES, kindBundleDirToken } from '@vibisual/shared';

import {
  BUNDLE_SATELLITE_MAX,
  applyConstellations,
  bundleInfoOf,
  bundleInteriorIds,
  bundleInteriorMembers,
  bundleNameOf,
  isBundleNodeId,
  type ConstellationTag,
} from './constellationView.js';
import { appWorkPathKey } from './appWorkView.js';
import { collectSatellites, satelliteHubReach } from './satellite.js';
import { calcBubbleSize } from './sizeCalc.js';

/** 서버 스냅샷의 파일 노드 모양 — `path` 는 노드 키(내부는 루트 기준 상대 경로), `absolutePath` 는 디스크 경로. */
function file(id: string, path: string, extra: Partial<BubbleData> = {}): BubbleData {
  const label = path.split('/').pop() ?? id;
  return { id, label, bubbleType: 'file', path, absolutePath: `C:/proj/${path}`, status: 'idle', activity: 1, lastTool: 'Write', ...extra };
}

function folder(id: string, path: string, extra: Partial<BubbleData> = {}): BubbleData {
  const label = path.split('/').pop() ?? id;
  return { id, label, bubbleType: 'internal_folder', path, absolutePath: `C:/proj/${path}`, status: 'idle', activity: 1, ...extra };
}

function tagOf(b: BubbleData | undefined): ConstellationTag | undefined {
  return (b as unknown as { _constellation?: ConstellationTag } | undefined)?._constellation;
}

function bundles(out: ReturnType<typeof applyConstellations>): ReturnType<typeof applyConstellations>['satInfos'] {
  return out.satInfos.filter((s) => s.bubble.bubbleType === 'bundle');
}

describe('applyConstellations — 묶음에는 같은 종류만 (사진 속 경우)', () => {
  it('1번 — 다른 폴더의 md 는 사진 묶음에 끌려오지 않고, 하위 폴더의 사진만 그 폴더 이름의 사진 묶음이 된다', () => {
    const saved = folder('folder-saved', 'saved');
    const docs = folder('folder-docs', 'docs');
    const crop = file('file-crop', 'saved/dispatchframealpha/user-crop-x4.png', { lastTool: 'Read', lastActivity: 30 });
    const refTl = file('file-reftl', 'saved/dispatchframealpha/ref-tl.png', { lastTool: 'Read', lastActivity: 20 });
    const refBl = file('file-refbl', 'saved/dispatchframealpha/ref-bl.png', { lastTool: 'Read', lastActivity: 10 });
    const py = file('file-py', 'saved/dispatchframealpha/tools/align_ref.py', { lastActivity: 5 });
    const md = file('file-md', 'docs/mps_development/canon_corrections/r4/mps_dispatch_board_hud_user_replace_r1_20261020.md', {
      lastTool: 'Read', lastActivity: 40, mentions: ['file-crop'],
    });
    const sats = collectSatellites([saved, docs], { [saved.id]: [crop, refTl, refBl, py], [docs.id]: [md] }, undefined);
    const out = applyConstellations({ radial: [saved, docs], satInfos: sats, appHubs: [], heat: undefined, platform: 'win32' });

    const made = bundles(out);
    expect(made).toHaveLength(1);
    const bundle = made[0]!;
    expect(bundle.parentId).toBe(saved.id);
    expect(bundle.bubble.label).toBe('dispatchframealpha');
    expect(calcBubbleSize(bundle.bubble, undefined, undefined)).toBe(BUNDLE_BUBBLE.size);
    const info = bundleInfoOf(bundle.bubble);
    expect(info).toMatchObject({ source: 'folder', kind: 'image', folder: 'saved/dispatchframealpha', count: 3 });
    // 최근 것부터 — 사진만 든다.
    expect(info?.memberIds).toEqual(['file-crop', 'file-reftl', 'file-refbl']);
    // 구성 사진은 폴더의 낱자리로 서지 않고, 최근 것부터 기본 상한(2)까지 묶음의 위성으로 선다(폴더 위성과 같은 규칙).
    expect(out.satInfos.filter((s) => s.parentId === bundle.bubble.id).map((s) => s.bubble.id))
      .toEqual(['sat-file-crop', 'sat-file-reftl']);
    for (const id of ['sat-file-crop', 'sat-file-reftl']) {
      expect(out.satInfos.filter((s) => s.bubble.id === id).map((s) => s.parentId)).toEqual([bundle.bubble.id]);
    }
    expect(out.satInfos.some((s) => s.bubble.id === 'sat-file-refbl')).toBe(false);
    // md 는 자기 폴더 곁에 — 사진을 적고 있어도 묶음에 들지 않는다. 코드도 사진 묶음에 들지 않는다.
    expect(out.satInfos.find((s) => s.bubble.id === 'sat-file-md')?.parentId).toBe(docs.id);
    expect(out.satInfos.find((s) => s.bubble.id === 'sat-file-py')?.parentId).toBe(saved.id);
    // 폴더와 묶음 사이 선 — 가장 최근 구성이 쓰던 방향(읽기 → 묶음에서 폴더로).
    expect(bundle.edge).toMatchObject({ source: bundle.bubble.id, target: saved.id });
  });

  it('2번 — bubble-test 의 위성 다섯(전부 bubble-test/video 의 영상)은 video 영상 묶음 하나가 된다', () => {
    const test = folder('folder-2990648569', 'bubble-test');
    const names = ['veg.veg', 'vob.vob', 'webm.webm', 'wmv.wmv', 'y4m.y4m'];
    const videos = names.map((n, i) => file(`file-v${i}`, `bubble-test/video/${n}`, { lastActivity: i }));
    const sats = collectSatellites([test], { [test.id]: videos }, undefined);
    const out = applyConstellations({ radial: [test], satInfos: sats, appHubs: [], heat: undefined, platform: 'win32' });

    const made = bundles(out);
    expect(made).toHaveLength(1);
    expect(made[0]?.parentId).toBe(test.id);
    expect(made[0]?.bubble.label).toBe('video');
    expect(bundleInfoOf(made[0]!.bubble)).toMatchObject({ source: 'folder', kind: 'video', count: 5 });
    // 폴더를 직접 도는 것은 묶음 버블 하나뿐이다 — 영상 다섯은 폴더의 낱자리로 서지 않는다.
    expect(out.satInfos.filter((s) => s.parentId === test.id).map((s) => s.bubble.id)).toEqual([made[0]!.bubble.id]);
    // 다섯은 폴더 위성과 같은 규칙으로 묶음의 위성이다 — 최근 것부터 설정 없는 폴더의 상한(2)까지, 첫 고리도 그 수로 나눈다.
    const moons = out.satInfos.filter((s) => s.parentId === made[0]!.bubble.id);
    expect(moons.map((s) => s.bubble.id)).toEqual(['sat-file-v4', 'sat-file-v3']);
    for (const moon of moons) {
      expect(moon.bubble.bubbleType).toBe('file');
      expect(moon.parentSlots).toBe(DEFAULT_MAX_SATELLITES);
      expect(moon.orbitSeat).toBeUndefined(); // 앱 노드의 달이 아니라 폴더 위성과 같은 위성이다
      expect(moon.parentSize).toBe(BUNDLE_BUBBLE.size);
    }
    expect(isBundleNodeId(made[0]!.bubble.id)).toBe(true);
  });

  it('폴더의 직속 파일도 같은 종류 둘 이상이면 묶음 하나다', () => {
    const video = folder('folder-video', 'bubble-test/video');
    const veg = file('file-veg', 'bubble-test/video/veg.veg', { lastActivity: 2 });
    const vob = file('file-vob', 'bubble-test/video/vob.vob', { lastActivity: 1 });
    const sats = collectSatellites([video], { [video.id]: [veg, vob] }, undefined);
    const out = applyConstellations({ radial: [video], satInfos: sats, appHubs: [], heat: undefined, platform: 'win32' });
    const made = bundles(out);
    expect(made).toHaveLength(1);
    expect(made[0]?.parentId).toBe(video.id);
    expect(made[0]?.bubble.label).toBe('video');
    expect(bundleInfoOf(made[0]!.bubble)).toMatchObject({ source: 'folder', kind: 'video', memberIds: ['file-veg', 'file-vob'], count: 2 });
    // 묶음 버블이 그 파일들의 위성 자리를 대신하고, 그 둘은 묶음의 위성으로 선다.
    expect(out.satInfos.map((s) => [s.bubble.id, s.parentId])).toEqual([
      [made[0]!.bubble.id, video.id],
      ['sat-file-veg', made[0]!.bubble.id],
      ['sat-file-vob', made[0]!.bubble.id],
    ]);
  });

  it('사진 속 many — 위성 상한이 줄인 png 여덟의 묶음은 그 폴더에서 사용한 40장을 말하고, 그 폴더 id 를 싣는다', () => {
    const many = folder('folder-many', 'bubble-test/many');
    const pngs = Array.from({ length: 8 }, (_, i) => file(`file-p${33 + i}`, `bubble-test/many/p${33 + i}.png`, {
      lastActivity: 33 + i, folderNodeId: many.id, folderKindCount: 40,
    }));
    const sats = collectSatellites([many], { [many.id]: pngs }, undefined);
    const out = applyConstellations({ radial: [many], satInfos: sats, appHubs: [], heat: undefined, platform: 'win32' });
    const made = bundles(out);
    expect(made).toHaveLength(1);
    const info = bundleInfoOf(made[0]!.bubble);
    expect(info).toMatchObject({ source: 'folder', kind: 'image', folderId: many.id, count: 40 });
    expect(info?.memberIds).toHaveLength(8);
    // 서버가 못 셌으면(옛 스냅샷) 화면의 구성 수다 — 폴더 id 도 싣지 않는다.
    const bare = pngs.map((p) => {
      const copy: BubbleData = { ...p };
      delete copy.folderNodeId;
      delete copy.folderKindCount;
      return copy;
    });
    const bareOut = applyConstellations({
      radial: [many], satInfos: collectSatellites([many], { [many.id]: bare }, undefined), appHubs: [], heat: undefined, platform: 'win32',
    });
    const bareInfo = bundleInfoOf(bundles(bareOut)[0]!.bubble);
    expect(bareInfo?.count).toBe(8);
    expect(bareInfo?.folderId).toBeUndefined();
  });

  it('파일은 중심이 되지 않는다 — 같은 이름의 json 은 영상과 함께 원래 폴더 곁에 남는다', () => {
    const video = folder('folder-video', 'video');
    const mp4 = file('f-mp4', 'video/teaser.mp4', { lastTool: 'Read' });
    const json = file('f-json', 'video/teaser.json');
    const sats = collectSatellites([video], { [video.id]: [json, mp4] }, undefined);
    const out = applyConstellations({ radial: [video], satInfos: sats, appHubs: [], heat: undefined, platform: 'win32' });
    expect(bundles(out)).toHaveLength(0);
    expect(out.satInfos.map((s) => s.parentId)).toEqual([video.id, video.id]);
    expect(out.converted.size).toBe(0);
  });

  it('원 둘레 파일도 종류가 다르면 묶지 않는다 — 같은 이름이어도 그 자리에 그대로 선다', () => {
    const mp4 = file('f-mp4', 'teaser.mp4', { lastTool: 'Read' });
    const srt = file('f-srt', 'teaser.srt');
    const out = applyConstellations({ radial: [mp4, srt], satInfos: [], appHubs: [], heat: undefined, platform: 'win32' });
    expect(out.radial.map((b) => b.id)).toEqual(['f-mp4', 'f-srt']);
    expect(out.converted.size).toBe(0);
    expect(out.satInfos).toHaveLength(0);
  });

  it('한 하위 폴더에 종류가 섞여 있으면 종류마다 따로 묶는다 — 묶음마다 그 종류만', () => {
    const test = folder('folder-test', 'bubble-test');
    const sats = collectSatellites([test], {
      [test.id]: [
        file('a', 'bubble-test/media/a.mp4', { lastActivity: 4 }),
        file('b', 'bubble-test/media/b.mp4', { lastActivity: 3 }),
        file('c', 'bubble-test/media/c.png', { lastActivity: 2 }),
        file('d', 'bubble-test/media/d.png', { lastActivity: 1 }),
        file('e', 'bubble-test/media/e.json', { lastActivity: 0 }),
      ],
    }, undefined);
    const out = applyConstellations({ radial: [test], satInfos: sats, appHubs: [], heat: undefined, platform: 'win32' });
    const infos = bundles(out).map((s) => bundleInfoOf(s.bubble));
    expect(infos.map((i) => [i?.kind, i?.memberIds])).toEqual(expect.arrayContaining([
      ['video', ['a', 'b']],
      ['image', ['c', 'd']],
    ]));
    expect(infos).toHaveLength(2);
    // json 은 어느 묶음에도 들지 않는다.
    expect(out.satInfos.find((s) => s.bubble.id === 'sat-e')?.parentId).toBe(test.id);
  });

  it('하나뿐인 하위 폴더 파일은 묶음이 아니라 파일이다', () => {
    const test = folder('folder-test', 'bubble-test');
    const sats = collectSatellites([test], {
      [test.id]: [file('a', 'bubble-test/video/a.mp4'), file('b', 'bubble-test/image/b.png')],
    }, undefined);
    const out = applyConstellations({ radial: [test], satInfos: sats, appHubs: [], heat: undefined, platform: 'win32' });
    expect(bundles(out)).toHaveLength(0);
  });

  it('외부 폴더 위성(`__ext__` 노드 키)도 같은 자로 잰다 — 하위 폴더와 직속이 한 묶음이다(2026-10-26)', () => {
    const ext: BubbleData = {
      id: 'ext-temp', label: 'c:/users/dev/temp', bubbleType: 'external_folder', path: 'c:/users/dev/temp', // privacy-ok — 실제 홈이 아니라 테스트 픽스처
      absolutePath: 'c:/users/dev/temp', status: 'idle', activity: 1, // privacy-ok — 실제 홈이 아니라 테스트 픽스처
    };
    const a: BubbleData = { ...file('xa', 'x'), path: '__ext__c:/users/dev/temp/out/a.png', absolutePath: 'c:/users/dev/temp/out/a.png', label: 'a.png' }; // privacy-ok — 실제 홈이 아니라 테스트 픽스처
    const b: BubbleData = { ...file('xb', 'x'), path: '__ext__c:/users/dev/temp/out/b.png', absolutePath: 'c:/users/dev/temp/out/b.png', label: 'b.png' }; // privacy-ok — 실제 홈이 아니라 테스트 픽스처
    const direct: BubbleData = { ...file('xc', 'x'), path: '__ext__c:/users/dev/temp/c.png', absolutePath: 'c:/users/dev/temp/c.png', label: 'c.png' }; // privacy-ok — 실제 홈이 아니라 테스트 픽스처
    const direct2: BubbleData = { ...file('xd', 'x'), path: '__ext__c:/users/dev/temp/d.png', absolutePath: 'c:/users/dev/temp/d.png', label: 'd.png' }; // privacy-ok — 실제 홈이 아니라 테스트 픽스처
    const sats = collectSatellites([ext], { [ext.id]: [a, b, direct, direct2] }, undefined);
    const out = applyConstellations({ radial: [ext], satInfos: sats, appHubs: [], heat: undefined, platform: 'win32' });
    const made = bundles(out);
    // 하위 폴더 `out` 의 사진 둘과 직속 사진 둘이 한 무리의 같은 종류 — 묶음 하나이고, 이름은 함께 든 폴더(`temp`)다.
    expect(made).toHaveLength(1);
    expect(made[0]!.bubble.label).toBe('temp');
    expect(bundleInfoOf(made[0]!.bubble)?.memberIds.slice().sort()).toEqual(['xa', 'xb', 'xc', 'xd']);
    // 폴더를 직접 도는 것은 묶음 버블 하나뿐이다.
    expect(out.satInfos.filter((s) => s.parentId === ext.id).map((s) => s.bubble.id)).toEqual([made[0]!.bubble.id]);
  });

  it('사진 속 경우 — `.vibisual` 둘레의 png 다섯이 attachments 하위 폴더 다섯에 흩어져 있어도 사진 묶음 하나다(2026-10-26)', () => {
    const vib = folder('folder-vib', '.vibisual');
    const shots = [1, 2, 3, 4, 5].map((n) => file(`file-s${n}`, `.vibisual/attachments/custom-a/sub-${n}/shot-${n}.png`, {
      lastTool: 'Read', lastActivity: n, folderNodeId: 'folder-vib', folderKindCount: 37, folderKindDir: '.vibisual/attachments',
    }));
    const md = file('file-md', '.vibisual/notes.md', { lastActivity: 9 });
    const sats = collectSatellites([vib], { [vib.id]: [md, ...shots] }, undefined);
    const out = applyConstellations({ radial: [vib], satInfos: sats, appHubs: [], heat: undefined, platform: 'win32' });
    const made = bundles(out);
    expect(made).toHaveLength(1);
    const bundle = made[0]!;
    // 이름 · 수 · 범위는 서버가 그 버블 아래 전부로 잰 것 — 사진 다섯이 아니라 attachments 아래 사용한 사진 서른일곱.
    expect(bundle.bubble.label).toBe('attachments');
    expect(bundleInfoOf(bundle.bubble)).toMatchObject({ source: 'folder', kind: 'image', folder: '.vibisual/attachments', folderId: vib.id, count: 37 });
    expect(bundle.bubble.id).toBe(`sat-bundle-${vib.id}-image`);
    // 폴더를 도는 것은 묶음 하나와 글(묶지 않는다) — png 다섯은 낱자리로 서지 않고, 최근 둘이 묶음의 위성이다.
    expect(out.satInfos.filter((s) => s.parentId === vib.id).map((s) => s.bubble.id)).toEqual(['sat-file-md', bundle.bubble.id]);
    expect(out.satInfos.filter((s) => s.parentId === bundle.bubble.id).map((s) => s.bubble.id)).toEqual(['sat-file-s5', 'sat-file-s4']);
  });

  it('서버가 공통 폴더를 싣지 않았으면(옛 스냅샷) 화면 구성의 공통 폴더, 그것도 없으면 주인 폴더 이름이다', () => {
    const vib = folder('folder-vib', '.vibisual');
    const shots = [1, 2].map((n) => file(`file-s${n}`, `.vibisual/attachments/sub-${n}/shot-${n}.png`, { lastActivity: n }));
    const out = applyConstellations({
      radial: [vib], satInfos: collectSatellites([vib], { [vib.id]: shots }, undefined), appHubs: [], heat: undefined, platform: 'win32',
    });
    expect(bundles(out)[0]?.bubble.label).toBe('attachments');
    // 공통 폴더가 없다(서로 다른 드라이브의 외부 파일) — 지어내지 않고 주인 폴더 이름을 쓴다.
    const ext: BubbleData = { ...folder('ext-x', 'x'), bubbleType: 'external_folder', label: 'Spread' };
    const c: BubbleData = { ...file('xc', 'x'), path: '__ext__c:/one/a.png', absolutePath: 'c:/one/a.png', label: 'a.png' };
    const d: BubbleData = { ...file('xd', 'x'), path: '__ext__d:/two/b.png', absolutePath: 'd:/two/b.png', label: 'b.png' };
    const spread = applyConstellations({
      radial: [ext], satInfos: collectSatellites([ext], { [ext.id]: [c, d] }, undefined), appHubs: [], heat: undefined, platform: 'win32',
    });
    const made = bundles(spread);
    expect(made).toHaveLength(1);
    expect(made[0]!.bubble.label).toBe('Spread');
    expect(bundleInfoOf(made[0]!.bubble)?.folder).toBeUndefined();
  });
});

describe('applyConstellations — 묶음 버블의 자리와 모양', () => {
  const test = folder('folder-test', 'bubble-test');
  const v1 = file('v1', 'bubble-test/video/one.mp4', { lastActivity: 2, lastTool: 'Read' });
  const v2 = file('v2', 'bubble-test/video/two.mp4', { lastActivity: 1 });

  it('묶음 버블은 가장 최근 구성이 서던 자리에서 부모를 도는 위성이고, 구성은 그 묶음의 위성으로 맨 뒤에 선다', () => {
    const other = file('n1', 'bubble-test/notes.md', { lastActivity: 3 });
    const sats = collectSatellites([test], { [test.id]: [v2, other, v1] }, undefined);
    const out = applyConstellations({ radial: [test], satInfos: sats, appHubs: [], heat: undefined, platform: 'win32' });
    const bundle = bundles(out)[0]!;
    // 순서: 가장 최근 구성(v1 — 목록의 셋째)이 서던 차례에 묶음 · 묶이지 않은 파일은 제자리 그대로 · 묶음의 위성은 모든 자리
    //   뒤(묶음이 먼저 앉는다) · 위성끼리는 최근 것부터.
    expect(out.satInfos.map((s) => [s.bubble.id, s.parentId])).toEqual([
      ['sat-n1', test.id],
      [bundle.bubble.id, test.id],
      ['sat-v1', bundle.bubble.id],
      ['sat-v2', bundle.bubble.id],
    ]);
    expect(bundle.orbitSeat).toBeUndefined(); // 달이 아니라 폴더의 보통 위성이다
    // 폴더와 묶음 사이 선은 가장 최근 구성이 쓰던 방향 그대로(읽기 → 묶음에서 폴더로).
    expect(bundle.edge).toMatchObject({ source: bundle.bubble.id, target: test.id });
  });

  it('같은 내용의 구성은 같은 객체다', () => {
    const run = (): unknown => {
      const sats = collectSatellites([test], { [test.id]: [v1, v2] }, undefined);
      const out = applyConstellations({ radial: [test], satInfos: sats, appHubs: [], heat: undefined, platform: 'win32' });
      return bundleInfoOf(bundles(out)[0]!.bubble);
    };
    expect(run()).toBe(run());
  });

  it('구성 하나라도 돌면 묶음도 돈다', () => {
    const busy = { ...v2, status: 'active' as const };
    const sats = collectSatellites([test], { [test.id]: [busy, v1] }, undefined);
    const out = applyConstellations({ radial: [test], satInfos: sats, appHubs: [], heat: undefined, platform: 'win32' });
    expect(bundles(out)[0]?.bubble.status).toBe('active');
  });

  it('대소문자 — 묶음은 세 OS 모두 하나, 이름(공통 폴더)은 linux 만 Video 와 video 를 다른 폴더로 본다(플랫폼은 인자)', () => {
    const a = file('a', 'bubble-test/Video/a.mp4');
    const b = file('b', 'bubble-test/video/b.mp4');
    const sats = collectSatellites([test], { [test.id]: [a, b] }, undefined);
    const win = applyConstellations({ radial: [test], satInfos: sats, appHubs: [], heat: undefined, platform: 'win32' });
    const linux = applyConstellations({ radial: [test], satInfos: sats, appHubs: [], heat: undefined, platform: 'linux' });
    expect(bundles(win)).toHaveLength(1);
    expect(bundles(linux)).toHaveLength(1);
    expect(bundles(win)[0]?.bubble.label).toBe('Video');
    expect(bundles(linux)[0]?.bubble.label).toBe('bubble-test');
  });
});

describe('applyConstellations — 앱 노드 중심', () => {
  it('앱 노드가 선언한 파일은 그 노드를 돌고, 연결선을 숨긴 노드면 선도 숨는다(묶음 버블은 만들지 않는다)', () => {
    const comp = folder('folder-vib', '.vibisual');
    const index = file('f-index', '.vibisual/video/compositions/intro/index.html');
    const css = file('f-css', '.vibisual/video/compositions/intro/style.css');
    const sats = collectSatellites([comp], { [comp.id]: [index, css] }, undefined);
    const hub = {
      id: 'app-1',
      results: [],
      parts: [],
      codeParts: ['C:/proj/.vibisual/video/compositions/intro/index.html'],
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
      expect(tagOf(moon?.bubble)).toEqual({ hubLabel: 'Teaser', reason: 'appPart' });
    }
    expect(bundles(out)).toHaveLength(0);
  });

  it('앱 노드로 옮겨 간 위성은 같은 종류 묶음에 들지 않는다', () => {
    const test = folder('folder-test', 'bubble-test');
    const a = file('a', 'bubble-test/video/a.mp4', { lastActivity: 3 });
    const b = file('b', 'bubble-test/video/b.mp4', { lastActivity: 2 });
    const sats = collectSatellites([test], { [test.id]: [a, b] }, undefined);
    const hub = { id: 'app-v', results: ['C:/proj/bubble-test/video/a.mp4'], parts: [], codeParts: [], label: 'Teaser', size: 200, linksHidden: false };
    const out = applyConstellations({ radial: [test], satInfos: sats, appHubs: [hub], heat: undefined, platform: 'win32' });
    expect(out.satInfos.find((s) => s.bubble.id === 'sat-a')?.parentId).toBe('app-v');
    // 남은 영상은 하나뿐이라 묶음이 아니다.
    expect(bundles(out)).toHaveLength(0);
    expect(out.satInfos.find((s) => s.bubble.id === 'sat-b')?.parentId).toBe(test.id);
  });

  it('연속 번호의 대표는 그 앱 노드를 도는 묶음 버블이다 — 이름은 확장자를 뗀다(아래 설명 통일)', () => {
    const work = folder('folder-out', 'out');
    const frames = [1, 2, 3].map((n) => file(`f-${n}`, `out/frame_000${n}.png`, { lastActivity: n }));
    const rep = frames[2]!;
    const sats = collectSatellites([work], { [work.id]: [rep] }, undefined);
    const repKey = rep.absolutePath!;
    const hub = {
      id: 'app-3d',
      results: [],
      parts: [],
      codeParts: [],
      work: [repKey],
      label: 'Vibi3D',
      size: 200,
      linksHidden: false,
      workSeat: {
        appName: 'Vibi3D',
        ring: '#B6A4E6',
        appKind: 'model' as const,
        meta: new Map([[appWorkPathKey(repKey, 'win32'), {
          role: 'material' as const,
          order: 0,
          writes: 3,
          script: true,
          sequence: { label: 'frame_####.png', count: 3, names: ['frame_0001.png', 'frame_0002.png', 'frame_0003.png'], ids: ['f-1', 'f-2', 'f-3'] },
        }]]),
      },
    };
    const out = applyConstellations({ radial: [work], satInfos: sats, appHubs: [hub], heat: undefined, platform: 'win32' });
    const seq = out.satInfos.find((s) => s.bubble.id === 'sat-bundle-f-3');
    expect(seq, JSON.stringify(out.satInfos.map((s) => s.bubble.id))).toBeDefined();
    expect(seq?.bubble.bubbleType).toBe('bundle');
    expect(seq?.bubble.label).toBe('frame_####');
    expect(seq?.parentId).toBe('app-3d');
    expect(seq?.edge.id).toBe('sat-edge-f-3');
    expect(typeof seq?.seatAngle).toBe('number');
    expect(bundleInfoOf(seq!.bubble)).toMatchObject({ source: 'sequence', kind: 'image', memberIds: ['f-1', 'f-2', 'f-3'], count: 3 });
    // 작업 위성 꼬리표는 그대로 싣는다(앱 색 테 · 작업 궤도의 위성 수).
    expect(tagOf(seq?.bubble)?.work?.sequenceLabel).toBe('frame_####.png');
    expect(out.satInfos.some((s) => s.bubble.id === 'sat-f-3')).toBe(false);
    // 연속 번호 묶음은 앱 작업 궤도의 한 자리 그대로다 — 묶음 위성은 같은 폴더 묶음의 규칙이다.
    expect(out.satInfos.some((s) => s.parentId === seq!.bubble.id)).toBe(false);
  });
});

describe('묶음 버블 도우미', () => {
  it('연속 번호의 이름은 파일 이름에서 확장자만 뗀다(지어내지 않는다)', () => {
    expect(bundleNameOf('frame_####.exr')).toBe('frame_####');
    expect(bundleNameOf('scene.final.glb')).toBe('scene.final');
    expect(bundleNameOf('.env')).toBe('.env');
    expect(bundleNameOf('README')).toBe('README');
  });

  it('묶음 버블 노드 id 는 화면이 지은 자리로 가려낸다', () => {
    expect(isBundleNodeId('bundle-f-1')).toBe(true);
    expect(isBundleNodeId('sat-bundle-f-1')).toBe(true);
    expect(isBundleNodeId('sat-f-1')).toBe(false);
    expect(isBundleNodeId('file-1')).toBe(false);
  });

  it('묶음 안에도 그 종류만 — 종류가 다른 구성은 거른다', () => {
    const nodes = {
      a: { lastActivity: 1, path: 'v/a.mp4', label: 'a.mp4' },
      b: { lastActivity: 2, path: 'v/b.md', label: 'b.md' },
      c: { lastActivity: 3, path: 'v/c.mov', label: 'c.mov' },
    };
    expect(bundleInteriorIds({ kind: 'video', memberIds: ['a', 'b', 'c'] }, nodes)).toEqual(['a', 'c']);
  });

  it('묶음 안 구성 id — 상한 안이면 그대로, 넘치면 최근 것부터 원래 차례로', () => {
    const small = { kind: 'image' as const, memberIds: ['a', 'b', 'c'] };
    expect(bundleInteriorIds(small, {})).toEqual(['a', 'b', 'c']);
    const many = Array.from({ length: BUNDLE_BUBBLE.interiorMax + 5 }, (_, i) => `m${i}`);
    const nodes = Object.fromEntries(many.map((id, i) => [id, { lastActivity: i, path: `seq/${id}.png`, label: `${id}.png` }]));
    const picked = bundleInteriorIds({ kind: 'image', memberIds: many }, nodes);
    expect(picked).toHaveLength(BUNDLE_BUBBLE.interiorMax);
    // 가장 오래된 다섯이 빠지고, 남은 것은 원래 차례(번호 순)다.
    expect(picked[0]).toBe('m5');
    expect(picked[picked.length - 1]).toBe(`m${many.length - 1}`);
  });
});

describe('원 둘레 파일도 같은 종류 둘 이상이면 묶음 하나', () => {
  it('폴더 안 — 직속 영상 39개는 묶음 하나로 서고, 집어 준 veg.veg 는 원 둘레에 남지 않는다', () => {
    const veg = file('file-1768158432', 'bubble-test/video/veg.veg', { lastActivity: 5 });
    const clips = Array.from({ length: 38 }, (_, i) => file(`file-v${i}`, `bubble-test/video/clip${i}.mp4`, { lastActivity: i }));
    const notes = file('file-notes', 'bubble-test/video/notes.md', { lastActivity: 1 });
    const out = applyConstellations({ radial: [veg, ...clips, notes], satInfos: [], appHubs: [], heat: undefined, platform: 'win32' });
    const made = out.radial.filter((b) => b.bubbleType === 'bundle');
    expect(made).toHaveLength(1);
    const bundle = made[0]!;
    expect(bundle.label).toBe('video');
    expect(isBundleNodeId(bundle.id)).toBe(true);
    expect(bundleInfoOf(bundle)).toMatchObject({ source: 'folder', kind: 'video', folder: 'bubble-test/video', count: 39 });
    expect(bundleInfoOf(bundle)?.memberIds).toHaveLength(39);
    // 영상처럼 보이던 낱개 파일은 원 둘레에 없다 — 묶음 안에서 다 보인다. 미디어가 아닌 파일은 그대로다.
    expect(out.radial.some((b) => b.id === 'file-1768158432')).toBe(false);
    expect(out.radial.filter((b) => b.bubbleType === 'file').map((b) => b.id)).toEqual(['file-notes']);
    // 그 파일들로 들어오던 선은 묶음으로 옮겨 단다.
    expect(out.bundled.get('file-1768158432')).toBe(bundle.id);
    expect(out.bundled.size).toBe(39);
    // 원 둘레 묶음도 원 둘레의 폴더 버블처럼 최근 둘(기본 상한)을 위성으로 거느린다 — veg.veg 는 둘 안에 들지 않는다.
    expect(out.satInfos.map((s) => [s.bubble.id, s.parentId])).toEqual(
      [37, 36].map((n) => [`sat-file-v${n}`, bundle.id]),
    );
  });

  it('메인 화면 — 프로젝트 루트의 같은 종류 둘은 프로젝트 이름의 묶음이고, 폴더·다른 종류는 그대로다', () => {
    const a = file('f-a', 'a.png', { lastActivity: 2 });
    const b = file('f-b', 'b.png', { lastActivity: 1 });
    const readme = file('f-readme', 'README.md');
    const src = folder('folder-src', 'src');
    const out = applyConstellations({
      radial: [src, a, readme, b], satInfos: [], appHubs: [], heat: undefined, platform: 'win32', rootLabel: 'MyProject',
    });
    // 묶음은 가장 최근 파일(a)이 서던 차례에 선다.
    expect(out.radial.map((x) => x.bubbleType)).toEqual(['internal_folder', 'bundle', 'file']);
    const bundle = out.radial.find((x) => x.bubbleType === 'bundle')!;
    expect(bundle.label).toBe('MyProject');
    expect(bundleInfoOf(bundle)).toMatchObject({ kind: 'image', memberIds: ['f-a', 'f-b'], count: 2 });
    expect(bundleInfoOf(bundle)?.folder).toBeUndefined();
    // 그 둘은 묶음의 위성이다.
    expect(out.satInfos.map((s) => [s.bubble.id, s.parentId])).toEqual([['sat-f-a', bundle.id], ['sat-f-b', bundle.id]]);
  });

  it('종류가 다르거나 하나뿐이면 묶지 않는다', () => {
    const out = applyConstellations({
      radial: [file('a', 'p/x/a.mp4'), file('b', 'p/x/b.png'), file('c', 'p/x/c.wav')],
      satInfos: [], appHubs: [], heat: undefined, platform: 'win32',
    });
    expect(out.radial.map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(out.bundled.size).toBe(0);
  });

  it('원 둘레 묶음 id 는 종전과 같은 종류·폴더 열쇠다 — 화면(폴더)마다 다르고, 같은 폴더면 같다', () => {
    const inShots = applyConstellations({
      radial: [file('a', 'shots/a.png', { lastActivity: 2 }), file('b', 'shots/b.png', { lastActivity: 1 })],
      satInfos: [], appHubs: [], heat: undefined, platform: 'win32',
    }).radial.find((x) => x.bubbleType === 'bundle')!;
    const inClips = applyConstellations({
      radial: [file('c', 'clips/c.png', { lastActivity: 2 }), file('d', 'clips/d.png', { lastActivity: 1 })],
      satInfos: [], appHubs: [], heat: undefined, platform: 'win32',
    }).radial.find((x) => x.bubbleType === 'bundle')!;
    expect(inShots.id).toBe(`bundle-radial-${kindBundleDirToken('image', 'shots', 'win32')}`);
    expect(inClips.id).toBe(`bundle-radial-${kindBundleDirToken('image', 'clips', 'win32')}`);
    expect(inShots.id).not.toBe(inClips.id);
  });

  it('원 둘레 묶음의 안은 구성 전부다 — 화면에 다 실린 직속 파일이라 위성 상한이 없다', () => {
    const kids = Array.from({ length: 12 }, (_, i) => file(`p${i}`, `shots/p${i}.png`, { lastActivity: i }));
    const out = applyConstellations({ radial: kids, satInfos: [], appHubs: [], heat: undefined, platform: 'win32' });
    const info = bundleInfoOf(out.radial.find((x) => x.bubbleType === 'bundle')!)!;
    const nodeMap = Object.fromEntries(kids.map((k) => [k.id, k]));
    expect(bundleInteriorMembers({ memberIds: bundleInteriorIds(info, nodeMap) }, nodeMap, {})).toHaveLength(12);
  });
});

describe('묶음 안 구성 — 위성 상한으로 사라졌던 사용한 파일까지', () => {
  const folderId = 'folder-many';
  const png = (n: number): BubbleData => file(`file-p${n}`, `bubble-test/many/p${n}.png`, { lastActivity: n });

  it('범위로 받은 그 폴더의 같은 종류 전부를 세운다 — 구성(위성)과 겹치지 않게, 최근 것부터', () => {
    const all = Array.from({ length: 40 }, (_, i) => png(i + 1));
    const notes = file('file-notes', 'bubble-test/many/notes.md', { lastActivity: 99 });
    const sub = folder('folder-sub', 'bubble-test/many/sub');
    const nodeMap = Object.fromEntries([...all, notes, sub].map((b) => [b.id, b]));
    const memberIds = all.slice(-8).reverse().map((b) => b.id); // 위성 상한이 남긴 최근 여덟
    const out = bundleInteriorMembers({ memberIds, folderId, fileKind: 'image' }, nodeMap, { [folderId]: [...all, notes, sub] });
    expect(out).toHaveLength(40);
    expect(out[0]?.id).toBe('file-p40');
    expect(out[out.length - 1]?.id).toBe('file-p1');
    // 다른 종류·폴더는 묶음 안에 들지 않는다.
    expect(out.some((b) => b.id === 'file-notes' || b.id === 'folder-sub')).toBe(false);
  });

  it('범위가 도착하기 전에는 구성만으로 먼저 선다(빈 화면 ❌)', () => {
    const members = [png(40), png(39)];
    const nodeMap = Object.fromEntries(members.map((b) => [b.id, b]));
    const out = bundleInteriorMembers({ memberIds: members.map((b) => b.id), folderId, fileKind: 'image' }, nodeMap, {});
    expect(out.map((b) => b.id)).toEqual(['file-p40', 'file-p39']);
  });

  it('폴더가 없는 묶음(연속 번호)은 구성의 차례 그대로다', () => {
    const frames = [1, 2, 3].map((n) => file(`f-${n}`, `out/frame_000${n}.png`, { lastActivity: 10 - n }));
    const nodeMap = Object.fromEntries(frames.map((b) => [b.id, b]));
    const out = bundleInteriorMembers({ memberIds: ['f-1', 'f-2', 'f-3'] }, nodeMap, { 'folder-out': frames });
    expect(out.map((b) => b.id)).toEqual(['f-1', 'f-2', 'f-3']);
  });

  it('상한 `BUNDLE_BUBBLE.interiorMax` 를 넘으면 최근 것부터 그만큼', () => {
    const all = Array.from({ length: BUNDLE_BUBBLE.interiorMax + 7 }, (_, i) => png(i + 1));
    const out = bundleInteriorMembers({ memberIds: [], folderId, fileKind: 'image' }, {}, { [folderId]: all });
    expect(out).toHaveLength(BUNDLE_BUBBLE.interiorMax);
    expect(out[0]?.id).toBe(`file-p${all.length}`);
  });

  it('그 폴더 아래 모든 깊이 — 범위로 받은 위성 목록(서버가 덧붙인 같은 종류 전부)과 실려 온 하위 폴더 자식까지', () => {
    const deep = (n: number, dir: string): BubbleData => file(`file-d${n}`, `assets/${dir}/d${n}.png`, { lastActivity: n });
    // 위성 목록 — 서버가 범위로 선언된 주인 폴더에 덧붙인 하위 폴더의 사진(글은 들지 않는다).
    const fromSatellites = [deep(1, 'x/s1'), deep(2, 'x/s2'), file('file-note', 'assets/x/note.md', { lastActivity: 50 })];
    // 실려 온 자식 — 주인 폴더 → 하위 폴더 `y` → 그 안의 사진(IDE 세션 지도는 모든 폴더의 자식을 갖고 있다).
    const sub = folder('folder-y', 'assets/y');
    const children = { 'folder-assets': [sub, deep(3, '.')], 'folder-y': [deep(4, 'y'), file('file-clip', 'assets/y/clip.mp4', { lastActivity: 60 })] };
    const out = bundleInteriorMembers(
      { memberIds: ['file-d2'], folderId: 'folder-assets', fileKind: 'image' },
      { 'file-d2': deep(2, 'x/s2') },
      children,
      { 'folder-assets': fromSatellites },
    );
    expect(out.map((b) => b.id)).toEqual(['file-d4', 'file-d3', 'file-d2', 'file-d1']);
  });

  it('캔버스는 아직 확인하지 않은 턴의 파일만 더 줍는다 — 범위 안 자식에 실려 온 지난 턴 그림은 들지 않는다(그 에이전트가 지금 턴에 쓴 것만)', () => {
    const shot = (n: number, dir: string, inOpenTurn: boolean): BubbleData =>
      file(`file-s${n}`, `.vibisual/attachments/${dir}/s${n}.png`, { lastActivity: n, ...(inOpenTurn ? { inOpenTurn: true } : {}) });
    // 사진 속 경우 — 복원 유예로 살아난 지난 턴 그림(표시 없음)과 지금 턴 그림(표시)이 같은 폴더 아래 섞여 실려 온다.
    const sub = folder('folder-att', '.vibisual/attachments');
    const children = {
      'folder-vib': [sub, shot(1, '.', false)],
      'folder-att': [shot(2, 'a', false), shot(3, 'b', true), shot(4, 'c', false), shot(5, 'd', true)],
    };
    const satellites = { 'folder-vib': [shot(6, 'e', true), shot(7, 'f', false)] };
    // 구성(위성 목록에 선 것)은 턴 밖이어도 그대로 선다 — 이미 보이던 최근 것이다.
    const view = { memberIds: ['file-s7'], folderId: 'folder-vib', fileKind: 'image' as const };
    const nodeMap = { 'file-s7': shot(7, 'f', false) };
    const turnOnly = bundleInteriorMembers(view, nodeMap, children, satellites, { openTurnOnly: true });
    expect(turnOnly.map((b) => b.id)).toEqual(['file-s7', 'file-s6', 'file-s5', 'file-s3']);
    // IDE 세션 지도(표시가 없는 재료)는 켜지 않는다 — 종전대로 다 줍는다.
    expect(bundleInteriorMembers(view, nodeMap, children, satellites)).toHaveLength(7);
  });
});

describe('묶음 버블의 위성 — 다른 폴더 버블과 같은 규칙', () => {
  const many = folder('folder-many', 'bubble-test/many');
  const png = (n: number, extra: Partial<BubbleData> = {}): BubbleData => file(`file-p${n}`, `bubble-test/many/p${n}.png`, {
    lastActivity: n, folderNodeId: many.id, folderKindCount: 40, ...extra,
  });
  const viewOf = (sats: BubbleData[]): ReturnType<typeof applyConstellations> => applyConstellations({
    radial: [many], satInfos: collectSatellites([many], { [many.id]: sats }, undefined), appHubs: [], heat: undefined, platform: 'win32',
  });

  it('위성 상한까지 최근 것부터 — 서버가 여덟을 남겨도 설정 없는 폴더처럼 둘이고, 묶음의 수는 그대로 그 폴더의 전부다', () => {
    expect(BUNDLE_SATELLITE_MAX).toBe(DEFAULT_MAX_SATELLITES);
    const out = viewOf(Array.from({ length: 8 }, (_, i) => png(33 + i)));
    const bundle = bundles(out)[0]!;
    expect(bundleInfoOf(bundle.bubble)?.count).toBe(40);
    expect(out.satInfos.filter((s) => s.parentId === bundle.bubble.id).map((s) => s.bubble.id))
      .toEqual([40, 39].map((n) => `sat-file-p${n}`));
    // 둘 밖의 여섯은 이 화면에 서지 않는다 — 묶음 안에서 본다(폴더 위성 상한으로 빠진 파일과 같다).
    for (const n of [38, 37, 36, 35, 34, 33]) expect(out.satInfos.some((s) => s.bubble.id === `sat-file-p${n}`)).toBe(false);
    expect(new Set(out.satInfos.map((s) => s.bubble.id)).size).toBe(out.satInfos.length);
  });

  it('선은 폴더 위성선과 같다 — 읽은 파일은 위성에서 묶음으로, 쓴 파일은 묶음에서 위성으로 · 파일 색 · 도는 중이면 산다', () => {
    const out = viewOf([png(2, { lastTool: 'Read' }), png(1, { lastTool: 'Write', status: 'active' })]);
    const bundle = bundles(out)[0]!;
    const readMoon = out.satInfos.find((s) => s.bubble.id === 'sat-file-p2')!;
    const wroteMoon = out.satInfos.find((s) => s.bubble.id === 'sat-file-p1')!;
    expect(readMoon.edge).toMatchObject({
      id: 'sat-edge-file-p2', source: 'sat-file-p2', target: bundle.bubble.id, color: BUBBLE_COLORS.file, isActive: false, label: 'Read',
    });
    expect(wroteMoon.edge).toMatchObject({ id: 'sat-edge-file-p1', source: bundle.bubble.id, target: 'sat-file-p1', isActive: true });
    // 선 끝점 반경 — 묶음 쪽은 묶음 지름의 반이다.
    expect(readMoon.edge.targetRadius).toBe(BUNDLE_BUBBLE.size / 2);
    expect(wroteMoon.edge.sourceRadius).toBe(BUNDLE_BUBBLE.size / 2);
  });

  it('크기는 그 묶음의 위성끼리 견준다 — 폴더의 다른 위성 크기에 끌려가지 않는다', () => {
    const notes = file('file-notes', 'bubble-test/many/notes.md', { lastActivity: 9, fileSize: 9_000_000 });
    const out = viewOf([notes, png(2, { fileSize: 1_000 }), png(1, { fileSize: 4_000 })]);
    const bundle = bundles(out)[0]!;
    const moons = out.satInfos.filter((s) => s.parentId === bundle.bubble.id);
    expect(moons).toHaveLength(2);
    for (const moon of moons) expect(moon.localRange).toEqual({ min: 1_000, max: 4_000 });
    // 같은 내용이면 같은 범위 객체다(노드 data 얕은 비교).
    expect(moons[0]!.localRange).toBe(moons[1]!.localRange);
  });

  it('위성 자리의 묶음은 제 위성까지가 몸이다 — 물리·장부·정리가 읽는 `_orbitReach` 와 같은 값', () => {
    const out = viewOf([png(3), png(2), png(1)]);
    const bundle = bundles(out)[0]!;
    const moons = out.satInfos.filter((s) => s.parentId === bundle.bubble.id);
    const expected = satelliteHubReach(BUNDLE_BUBBLE.size / 2, moons.map((m) => calcBubbleSize(m.bubble, m.localRange, m.heat)));
    expect(bundle.reach).toBeCloseTo(expected, 9);
    expect((bundle.bubble as unknown as Record<string, unknown>)['_orbitReach']).toBeCloseTo(expected, 9);
    expect(bundle.reach!).toBeGreaterThan(BUNDLE_BUBBLE.size / 2);
  });

  it('원 둘레 묶음은 원 둘레의 폴더 버블처럼 몸집 없이 선다 — 위성만 거느린다', () => {
    const out = applyConstellations({
      radial: [file('a', 'shots/a.png', { lastActivity: 2 }), file('b', 'shots/b.png', { lastActivity: 1 })],
      satInfos: [], appHubs: [], heat: undefined, platform: 'win32',
    });
    const bundle = out.radial.find((x) => x.bubbleType === 'bundle')!;
    expect((bundle as unknown as Record<string, unknown>)['_orbitReach']).toBeUndefined();
    const moons = out.satInfos.filter((s) => s.parentId === bundle.id);
    expect(moons.map((s) => s.bubble.id)).toEqual(['sat-a', 'sat-b']);
    for (const moon of moons) {
      expect(moon.reach).toBeUndefined();
      expect(moon.parentSlots).toBe(BUNDLE_SATELLITE_MAX);
    }
  });

  it('원 둘레 묶음의 위성은 저장된 위성 자리를 싣는다 — 그 파일이 원 둘레에 서던 좌표를 물려받지 않는다', () => {
    const out = applyConstellations({
      radial: [
        file('a', 'shots/a.png', { lastActivity: 2, position: { x: 10, y: 10 } }),
        file('b', 'shots/b.png', { lastActivity: 1, position: { x: 20, y: 20 } }),
      ],
      satInfos: [], appHubs: [], heat: undefined, platform: 'win32',
      satellitePositions: { 'sat-a': { x: 700, y: 300 } },
    });
    expect(out.satInfos.find((s) => s.bubble.id === 'sat-a')?.bubble.position).toEqual({ x: 700, y: 300 });
    expect(out.satInfos.find((s) => s.bubble.id === 'sat-b')?.bubble.position).toBeUndefined();
  });

  it('같은 위성 id 가 그 화면에 이미 있으면(다른 부모가 먼저 거느렸다) 세우지 않고 다음 구성으로 채운다', () => {
    const agent: BubbleData = { id: 'agent-1', label: 'Agent', path: '', bubbleType: 'agent', status: 'active', activity: 3 };
    const a = file('f-a', 'a.png', { lastActivity: 3 });
    const out = applyConstellations({
      radial: [a, file('f-b', 'b.png', { lastActivity: 2 }), file('f-c', 'c.png', { lastActivity: 1 })],
      satInfos: collectSatellites([agent], { [agent.id]: [a] }, undefined),
      appHubs: [], heat: undefined, platform: 'win32', rootLabel: 'MyProject',
    });
    const bundle = out.radial.find((x) => x.bubbleType === 'bundle')!;
    expect(out.satInfos.filter((s) => s.bubble.id === 'sat-f-a').map((s) => s.parentId)).toEqual([agent.id]);
    expect(out.satInfos.filter((s) => s.parentId === bundle.id).map((s) => s.bubble.id)).toEqual(['sat-f-b', 'sat-f-c']);
    expect(new Set(out.satInfos.map((s) => s.bubble.id)).size).toBe(out.satInfos.length);
  });
});

describe('캔버스 묶음의 구성은 지금 턴의 것만 — 새 명령이 만든 묶음 안에 지난 턴 것이 남지 않는다', () => {
  // 사진 속 경우 — `.vibisual` 위성 목록에 다른 에이전트의 지난 그림 셋 + 이 에이전트의 앞 명령 그림 하나 + 지금 명령 그림 둘.
  const vib = folder('folder-vib', '.vibisual');
  const shot = (n: number, sub: string, lastActivity: number, inOpenTurn: boolean): BubbleData =>
    file(`file-${sub}-${n}`, `.vibisual/attachments/${sub}/${n}.png`, {
      lastTool: 'Read', lastActivity, ...(inOpenTurn ? { inOpenTurn: true } : {}), folderNodeId: vib.id, folderKindCount: 2,
    });
  const past = [shot(1, 'other', 10, false), shot(2, 'other', 11, false), shot(3, 'other', 12, false), shot(4, 'prev', 20, false)];
  const now = [shot(5, 'now', 31, true), shot(6, 'now', 30, true)];
  const run = (members: BubbleData[], openTurnOnly: boolean): ReturnType<typeof applyConstellations> =>
    applyConstellations({
      radial: [vib],
      satInfos: collectSatellites([vib], { [vib.id]: members }, undefined),
      appHubs: [],
      heat: undefined,
      platform: 'win32',
      openTurnOnly,
    });

  it('구성 · 수 · 묶음 위성은 이번 명령의 둘뿐이고, 지난 그림은 낱자리로도 서지 않는다', () => {
    const out = run([...past, ...now], true);
    const made = bundles(out);
    expect(made).toHaveLength(1);
    const info = bundleInfoOf(made[0]!.bubble);
    expect(info?.memberIds).toEqual(['file-now-5', 'file-now-6']); // 종전: 여섯 장 전부
    expect(info?.count).toBe(2);
    expect(out.satInfos.filter((s) => s.parentId === made[0]!.bubble.id).map((s) => s.bubble.id)).toEqual(['sat-file-now-5', 'sat-file-now-6']);
    for (const p of past) expect(out.satInfos.some((s) => s.bubble.id === `sat-${p.id}`)).toBe(false);
  });

  it('턴의 것이 하나도 없으면(확인했다) 묶음도 서지 않고 지난 그림도 내놓지 않는다', () => {
    const out = run(past, true);
    expect(bundles(out)).toHaveLength(0);
    expect(out.satInfos.some((s) => s.bubble.label.endsWith('.png'))).toBe(false);
  });

  it('스위치를 켜지 않은 화면(IDE 세션 지도)은 종전대로 구성 전부다', () => {
    const out = run([...past, ...now], false);
    expect(bundleInfoOf(bundles(out)[0]!.bubble)?.memberIds).toHaveLength(past.length + now.length);
  });
});
