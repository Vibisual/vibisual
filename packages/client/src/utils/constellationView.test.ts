/**
 * §5.1 #2-1 (B) — 화면 하나의 별자리 · 묶음 배치(`applyConstellations`) 고정 시험. DOM 없이 순수 함수로 잰다.
 *
 * 고정하는 것(2026-10-21 사용자 지시 — "사진 묶음인데 위성이나 사진 묶음 안으로 들어가면 사진만 있는게 아니라 다른 파일들도 같이
 * 있는게 문제야 … 비디오나 영상인줄알고 들어갔더니 묶음이야 묶음 버블로 변경하고 아래 설명 … 통일"):
 *  ① 사진 속 1번 — 메인 화면에서 `docs` 의 md 가 `saved` 의 사진을 적고 있어도 사진 묶음에 끌려오지 않는다. 사진 묶음에는
 *     사진만 들고, 하위 폴더 `dispatchframealpha` 의 사진들이 그 이름의 묶음이 된다.
 *  ② 사진 속 2번 — `bubble-test` 의 위성 다섯(전부 `bubble-test/video` 의 영상)은 `video` 영상 묶음 하나가 된다. 그 다섯은 바깥
 *     화면에 서지 않는다(2026-10-22 사용자 지시 "저런 버블은 없다고 … 특정 유형을 연상시키는 버블이 나와있고 그걸 누르면 묶음 버블처럼
 *     동작하잖아" — 묶음 둘레를 돌던 영상 파일 버블을 누르면 그 폴더로 들어가 묶음과 똑같이 동작했다). 구성은 묶음 안에서만 보인다.
 *  ③ 폴더의 직속 파일도 같은 종류 둘 이상이면 묶는다(2026-10-22 사용자 지시 — 직속 제외 폐기) · 원 둘레 파일은 묶지 않는다.
 *  ④ 파일은 중심이 되지 않는다 — 같은 이름의 json 은 영상과 함께 원래 폴더 곁에 남는다.
 *  ⑤ 한 하위 폴더에 종류가 섞여 있으면 종류마다 따로 묶는다 · 외부 폴더 위성(`__ext__` 키)도 같은 자로 잰다.
 *  ⑥ 묶음 버블은 가장 최근 구성이 서던 자리(부모의 위성)에 선다 · 같은 내용은 같은 객체 · 구성 하나라도 돌면 묶음도 돈다.
 *  ⑦ 앱 노드가 선언한 파일은 그 노드를 돈다(앱 노드는 묶음 버블을 만들지 않는다) · 연속 번호는 확장자를 뗀 이름의 묶음.
 *  ⑧ 묶음 안 구성 id — 종류가 다른 것은 거르고, 상한 안이면 그대로, 넘치면 최근 것부터 원래 차례로.
 *  ⑨ (2026-10-22 "해당 묶음 버블 내부로 들어가면 위성 규칙으로 인해 사라졌던 사용한 버블들이 눈에 보이게") 묶음의 수는 서버가 센
 *     그 폴더의 같은 종류 사용 수 · 묶음에 그 폴더 id 를 싣는다 · 묶음 안 = 구성 + 범위로 받은 그 폴더의 같은 종류 전부.
 */
import { describe, it, expect } from 'vitest';
import type { BubbleData } from '@vibisual/shared';
import { BUNDLE_BUBBLE } from '@vibisual/shared';

import {
  applyConstellations,
  bundleInfoOf,
  bundleInteriorIds,
  bundleInteriorMembers,
  bundleNameOf,
  isBundleNodeId,
  type ConstellationTag,
} from './constellationView.js';
import { appWorkPathKey } from './appWorkView.js';
import { collectSatellites } from './satellite.js';
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
    // 구성 사진은 바깥 화면에 서지 않는다 — 묶음 안에서만 보인다(2026-10-22).
    for (const id of ['sat-file-crop', 'sat-file-reftl', 'sat-file-refbl']) {
      expect(out.satInfos.some((s) => s.bubble.id === id)).toBe(false);
    }
    expect(out.satInfos.some((s) => s.parentId === bundle.bubble.id)).toBe(false);
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
    // 영상처럼 보이던 위성 다섯은 바깥 화면에 서지 않는다 — 누르면 그 폴더로 들어가 묶음처럼 동작하던 버블이다(2026-10-22 "저런
    //   버블은 없다고"). 이 화면에 남는 것은 묶음 버블 하나뿐이다.
    expect(out.satInfos.filter((s) => s.bubble.bubbleType === 'file')).toHaveLength(0);
    expect(out.satInfos.map((s) => s.bubble.id)).toEqual([made[0]!.bubble.id]);
    expect(isBundleNodeId(made[0]!.bubble.id)).toBe(true);
  });

  it('폴더의 직속 파일도 같은 종류 둘 이상이면 묶음 하나다 — 직속 제외는 걷었다(2026-10-22 사용자 지시)', () => {
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
    // 묶음 버블이 그 파일들의 위성 자리를 대신한다 — 구성은 바깥에 서지 않는다(2026-10-22).
    expect(out.satInfos.map((s) => s.bubble.id)).toEqual([made[0]!.bubble.id]);
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

  it('외부 폴더 위성(`__ext__` 노드 키)도 같은 자로 잰다 — 하위 폴더와 직속이 저마다 묶음이다', () => {
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
    expect(made).toHaveLength(2);
    const byLabel = new Map(made.map((s) => [s.bubble.label, s] as const));
    expect(bundleInfoOf(byLabel.get('out')!.bubble)?.memberIds.slice().sort()).toEqual(['xa', 'xb']);
    // 직속 사진 둘도 그 폴더(마지막 조각 `temp`) 이름의 묶음이다 — 2026-10-22 부터 직속도 묶는다.
    expect(bundleInfoOf(byLabel.get('temp')!.bubble)?.memberIds.slice().sort()).toEqual(['xc', 'xd']);
    // 폴더를 직접 도는 것은 묶음 버블 둘뿐이다.
    expect(out.satInfos.filter((s) => s.parentId === ext.id).map((s) => s.bubble.id).sort()).toEqual(made.map((s) => s.bubble.id).sort());
  });
});

describe('applyConstellations — 묶음 버블의 자리와 모양', () => {
  const test = folder('folder-test', 'bubble-test');
  const v1 = file('v1', 'bubble-test/video/one.mp4', { lastActivity: 2, lastTool: 'Read' });
  const v2 = file('v2', 'bubble-test/video/two.mp4', { lastActivity: 1 });

  it('묶음 버블은 가장 최근 구성이 서던 자리에서 부모를 도는 위성이다 — 구성 위성은 이 화면에 없다(2026-10-22)', () => {
    const other = file('n1', 'bubble-test/notes.md', { lastActivity: 3 });
    const sats = collectSatellites([test], { [test.id]: [v2, other, v1] }, undefined);
    const out = applyConstellations({ radial: [test], satInfos: sats, appHubs: [], heat: undefined, platform: 'win32' });
    // 순서: 가장 최근 구성(v1)이 서던 차례에 묶음 · 묶이지 않은 파일은 제자리 그대로.
    const ids = out.satInfos.map((s) => s.bubble.id);
    expect(ids).toHaveLength(2);
    expect(ids).toContain('sat-n1');
    const bundle = bundles(out)[0]!;
    expect(bundle.parentId).toBe(test.id);
    expect(bundle.orbitSeat).toBeUndefined(); // 달이 아니라 폴더의 보통 위성이다
    expect(ids.includes('sat-v1') || ids.includes('sat-v2')).toBe(false);
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

  it('대소문자 — linux 는 Video 와 video 를 다른 폴더로 본다(플랫폼은 인자)', () => {
    const a = file('a', 'bubble-test/Video/a.mp4');
    const b = file('b', 'bubble-test/video/b.mp4');
    const sats = collectSatellites([test], { [test.id]: [a, b] }, undefined);
    const win = applyConstellations({ radial: [test], satInfos: sats, appHubs: [], heat: undefined, platform: 'win32' });
    const linux = applyConstellations({ radial: [test], satInfos: sats, appHubs: [], heat: undefined, platform: 'linux' });
    expect(bundles(win)).toHaveLength(1);
    expect(bundles(linux)).toHaveLength(0);
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

describe('원 둘레 파일도 같은 종류 둘 이상이면 묶음 하나 (2026-10-22 "아니 이런게 없다고 … 내가 만들라는 구조에서 이게 뭐냐고")', () => {
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
    // 영상처럼 보이던 낱개 파일은 원 둘레에 없다 — 묶음 안에서만 보인다. 미디어가 아닌 파일은 그대로다.
    expect(out.radial.some((b) => b.id === 'file-1768158432')).toBe(false);
    expect(out.radial.filter((b) => b.bubbleType === 'file').map((b) => b.id)).toEqual(['file-notes']);
    // 그 파일들로 들어오던 선은 묶음으로 옮겨 단다.
    expect(out.bundled.get('file-1768158432')).toBe(bundle.id);
    expect(out.bundled.size).toBe(39);
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
  });

  it('종류가 다르거나 하나뿐이면 묶지 않는다', () => {
    const out = applyConstellations({
      radial: [file('a', 'p/x/a.mp4'), file('b', 'p/x/b.png'), file('c', 'p/x/c.wav')],
      satInfos: [], appHubs: [], heat: undefined, platform: 'win32',
    });
    expect(out.radial.map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(out.bundled.size).toBe(0);
  });

  it('원 둘레 묶음의 안은 구성 전부다 — 화면에 다 실린 직속 파일이라 위성 상한이 없다', () => {
    const kids = Array.from({ length: 12 }, (_, i) => file(`p${i}`, `shots/p${i}.png`, { lastActivity: i }));
    const out = applyConstellations({ radial: kids, satInfos: [], appHubs: [], heat: undefined, platform: 'win32' });
    const info = bundleInfoOf(out.radial.find((x) => x.bubbleType === 'bundle')!)!;
    const nodeMap = Object.fromEntries(kids.map((k) => [k.id, k]));
    expect(bundleInteriorMembers({ memberIds: bundleInteriorIds(info, nodeMap) }, nodeMap, {})).toHaveLength(12);
  });
});

describe('묶음 안 구성 — 위성 상한으로 사라졌던 사용한 파일까지 (2026-10-22)', () => {
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
});
