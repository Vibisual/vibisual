/**
 * §5.1 #2-1 (A) — 파일 얼굴의 화면 쪽 판정(`fileFaceOf` · `fileMediaTarget`) · 크기 하한(`calcBubbleSize`) 고정 시험.
 *
 * 고정하는 것:
 *  ① 미디어는 그 확장자를 받겠다고 선언한 앱이 굽고(레지스트리), 색도 그 앱의 것이다.
 *  ② 선언한 앱이 없는 미디어(psd)는 종류 기본색 + 굽는 앱 없음 · 미디어가 아닌 종류는 보라 계열.
 *  ③ 파일이 아니면 얼굴이 없다.
 *  ④ 미리보기 자리는 가장 긴 프로젝트 루트에서 자르고, 어느 루트에도 없으면 지금 탭의 프로젝트를 주인으로 절대경로를 싣는다
 *     (2026-10-21 — 주인이 없으면 굽지 않는다).
 *  ⑤ 미디어 얼굴·별자리 중심은 지름 하한을 갖는다(히트맵이 켜져 있으면 히트가 이긴다).
 *  ⑥ 더블클릭이 앱에서 여는가 — 프로젝트 밖 파일은 보기 전용으로 여는 앱(`viewsOutsideFiles`)만(툴팁과 같은 판정).
 *  ⑦ 미디어 얼굴 더블클릭이 여는 곳 — 그 앱 · 변환해서 우리 앱((R-8)) · OS 연결 프로그램 순(2026-10-22).
 */
import { describe, it, expect } from 'vitest';
import type { BubbleData } from '@vibisual/shared';
import { FILE_FACE, FILE_FACE_STYLES } from '@vibisual/shared';

import { thumbnailAppFor } from '../apps/appLinkedItems.js';
import { INTERNAL_APPS, getInternalApp } from '../apps/registry.js';
import { activeProjectRoot, fileFaceOf, fileFaceOpenRoute, fileFaceOpensInApp, fileFaceVersion, fileMediaTarget } from './fileFaceView.js';
import { calcBubbleSize } from './sizeCalc.js';

function file(absolutePath: string, extra: Partial<BubbleData> = {}): BubbleData {
  return {
    id: absolutePath,
    label: absolutePath.split('/').pop() ?? absolutePath,
    bubbleType: 'file',
    path: absolutePath,
    absolutePath,
    status: 'idle',
    activity: 1,
    ...extra,
  };
}

describe('fileFaceOf — 화면이 정하는 얼굴', () => {
  it('미디어는 선언한 앱이 굽고, 색도 그 앱의 것이다', () => {
    const face = fileFaceOf(file('C:/proj/out/teaser.mp4'));
    expect(face?.kind).toBe('video');
    expect(face?.media).toBe(true);
    expect(face?.appId).toBe(thumbnailAppFor('teaser.mp4'));
    expect(face?.appId).not.toBeNull();
    const app = getInternalApp(face!.appId!);
    expect(face?.color).toBe(app?.color);
    expect(face?.glow).toBe(app?.glow);
  });

  it('선언한 앱이 없는 미디어는 종류 기본색 · 미디어가 아닌 종류는 보라 계열', () => {
    const psd = fileFaceOf(file('C:/proj/art/cover.psd'));
    expect(psd).toMatchObject({ kind: 'image', media: true, appId: null, color: FILE_FACE_STYLES.image.color });
    const code = fileFaceOf(file('C:/proj/src/App.tsx'));
    expect(code).toMatchObject({ kind: 'code', media: false, appId: null, color: FILE_FACE_STYLES.code.color });
  });

  it('파일이 아니면 얼굴이 없다', () => {
    expect(fileFaceOf({ bubbleType: 'internal_folder', path: 'video', label: 'video' })).toBeNull();
  });

  it('미리보기 판본은 수정 시각, 없으면 크기', () => {
    expect(fileFaceVersion({ fileMtime: 123, fileSize: 9 })).toBe(123);
    expect(fileFaceVersion({ fileSize: 9 })).toBe(9);
    expect(fileFaceVersion({})).toBe(0);
  });
});

describe('fileMediaTarget — 미리보기를 구울 자리', () => {
  it('가장 긴 루트에서 자른다(워크트리가 부모보다 이긴다)', () => {
    const roots = ['C:/proj', 'C:/proj/.claude/worktrees/feat'];
    expect(fileMediaTarget('C:/proj/.claude/worktrees/feat/out/a.png', roots)).toEqual({
      root: 'C:/proj/.claude/worktrees/feat',
      rel: 'out/a.png',
    });
    expect(fileMediaTarget('C:/proj/assets/logo.png', roots)).toEqual({ root: 'C:/proj', rel: 'assets/logo.png' });
  });

  it('어느 루트에도 없고 주인(지금 탭의 프로젝트)도 없으면 굽지 않는다', () => {
    expect(fileMediaTarget('D:/elsewhere/clip.mp4', ['C:/proj'])).toBeNull();
    expect(fileMediaTarget('D:/elsewhere/clip.mp4', ['C:/proj'], null)).toBeNull();
    expect(fileMediaTarget(undefined, ['C:/proj'], 'C:/proj')).toBeNull();
  });

  it('프로젝트 밖 파일은 지금 탭의 프로젝트를 주인으로 절대경로를 싣는다(사진 속 그 그림)', () => {
    // 2026-10-21 사용자 보고 — 프로젝트 밖 `%TEMP%/vib-icon-probe/out/preview2.png` 가 png 인데 미리보기·그림 창이 비었다.
    const abs = 'c:/users/dev/appdata/local/temp/icon-probe/out/preview2.png'; // privacy-ok — 실제 홈이 아니라 테스트 픽스처
    expect(fileMediaTarget(abs, ['C:/proj'], 'C:/proj')).toEqual({ root: 'C:/proj', rel: abs, outside: true });
    // 구분자 모양만 고르고 대소문자는 그대로 둔다(linux 에서 다른 파일을 가리키지 않게).
    expect(fileMediaTarget('C:\\Temp\\Out\\A.PNG', ['C:/proj'], 'C:/proj')?.rel).toBe('C:/Temp/Out/A.PNG');
    expect(fileMediaTarget('/tmp/probe/out/a.png', ['/home/u/proj'], '/home/u/proj')).toEqual({ // privacy-ok — 실제 홈이 아니라 테스트 픽스처
      root: '/home/u/proj', rel: '/tmp/probe/out/a.png', outside: true, // privacy-ok — 실제 홈이 아니라 테스트 픽스처
    });
  });

  it('프로젝트 안 파일은 주인이 있어도 종전과 같다(outside 표식 없음)', () => {
    expect(fileMediaTarget('C:/proj/assets/logo.png', ['C:/proj'], 'C:/other')).toEqual({ root: 'C:/proj', rel: 'assets/logo.png' });
  });
});

describe('activeProjectRoot — 바깥 파일을 열 창의 주인', () => {
  it('표시 이름으로 찾은 지금 탭의 경로 · 없으면 null', () => {
    const projects = { vibisual: { path: 'C:/work/vibisual' } };
    expect(activeProjectRoot({ activeProject: 'vibisual', projects })).toBe('C:/work/vibisual');
    expect(activeProjectRoot({ activeProject: null, projects })).toBeNull();
    expect(activeProjectRoot({ activeProject: 'gone', projects })).toBeNull();
    expect(activeProjectRoot({ activeProject: 'stub', projects, stubProjects: { stub: { project: { path: '/srv/stub' } } } }))
      .toBe('/srv/stub');
  });
});

describe('fileFaceOpensInApp — 더블클릭이 앱에서 여는가(툴팁과 같은 판정)', () => {
  const outsideTarget = (rel: string) => fileMediaTarget(rel, ['C:/proj'], 'C:/proj');

  it('프로젝트 안 미디어는 굽는 앱이 연다', () => {
    const face = fileFaceOf(file('C:/proj/out/teaser.mp4'));
    expect(fileFaceOpensInApp(face, fileMediaTarget('C:/proj/out/teaser.mp4', ['C:/proj']))).toBe(true);
  });

  it('프로젝트 밖 그림은 보기 전용 앱(Vibimage)이 연다', () => {
    const abs = 'D:/elsewhere/out/preview2.png';
    const face = fileFaceOf(file(abs));
    expect(face?.appId).not.toBeNull();
    expect(getInternalApp(face!.appId!)?.viewsOutsideFiles).toBe(true);
    expect(fileFaceOpensInApp(face, outsideTarget(abs))).toBe(true);
  });

  it('프로젝트 밖 영상·소리·3D 는 열지 않는다 — 그 편집기는 file 로 프로젝트 문서를 짓는다', () => {
    for (const abs of ['D:/elsewhere/clip.mp4', 'D:/elsewhere/hit.wav', 'D:/elsewhere/robot.glb']) {
      const face = fileFaceOf(file(abs));
      expect(face?.appId, abs).not.toBeNull();
      expect(fileFaceOpensInApp(face, outsideTarget(abs)), abs).toBe(false);
    }
  });

  it('굽는 앱이 없거나 자리가 없으면 열지 않는다', () => {
    expect(fileFaceOpensInApp(fileFaceOf(file('C:/proj/art/cover.psd')), fileMediaTarget('C:/proj/art/cover.psd', ['C:/proj']))).toBe(false);
    expect(fileFaceOpensInApp(fileFaceOf(file('D:/elsewhere/a.png')), null)).toBe(false);
    expect(fileFaceOpensInApp(null, null)).toBe(false);
  });

  it('바깥 파일을 보기 전용으로 여는 앱은 선언한 앱뿐이다(코어는 앱 이름을 모른다)', () => {
    expect(INTERNAL_APPS.filter((a) => a.viewsOutsideFiles === true).map((a) => a.id)).toEqual(['vibimage']);
  });
});

describe('fileFaceOpenRoute — 미디어 얼굴 더블클릭이 여는 곳(우리 앱 안이 먼저)', () => {
  // 2026-10-22 사용자 지시 — 기존 파일은 누르면 그 위치로 가고, 미디어 얼굴은 그 파일이 우리 앱 안에서 열리게 하는 자리다.
  const routeOf = (abs: string) => fileFaceOpenRoute(fileFaceOf(file(abs)), fileMediaTarget(abs, ['C:/proj'], 'C:/proj'));

  it('받는 앱이 있으면 그 앱 — 영상·소리·3D·그림', () => {
    for (const abs of ['C:/proj/bubble-test/video/webm.webm', 'C:/proj/sfx/hit.wav', 'C:/proj/models/robot.glb', 'C:/proj/art/shot.png']) {
      expect(routeOf(abs), abs).toBe('app');
    }
  });

  it('우리 엔진이 그대로 못 읽는 영상·소리는 변환해서 우리 앱으로 — 연결 프로그램으로 내보내지 않는다((R-8))', () => {
    // 사진 속 영상 묶음의 wmv·vob — 종전 판은 이것들을 OS 연결 프로그램으로 넘겼다.
    for (const abs of ['C:/proj/bubble-test/video/wmv.wmv', 'C:/proj/bubble-test/video/vob.vob', 'C:/proj/raw/take1.avi', 'C:/proj/voice.wma', 'C:/proj/take.aiff']) {
      expect(routeOf(abs), abs).toBe('convert');
    }
  });

  it('우리 앱이 그리지 않는 원본은 OS 연결 프로그램 — 편집창 갈래는 IDE 창 없이는 열리지 않는다', () => {
    for (const abs of ['C:/proj/bubble-test/video/veg.veg', 'C:/proj/raw/clip.y4m', 'C:/proj/art/cover.psd', 'C:/proj/scene/robot.blend', 'C:/proj/bgm/theme.mid']) {
      expect(routeOf(abs), abs).toBe('external');
    }
  });

  it('프로젝트 밖은 그림만 보기 전용 앱 — 영상·소리·3D 는 변환도 하지 않는다(변환물은 그 프로젝트에 놓인다)', () => {
    expect(routeOf('D:/elsewhere/out/preview2.png')).toBe('app');
    for (const abs of ['D:/elsewhere/clip.mp4', 'D:/elsewhere/old.wmv', 'D:/elsewhere/hit.wav', 'D:/elsewhere/robot.glb']) {
      expect(routeOf(abs), abs).toBe('external');
    }
  });

  it('자리가 없으면 연결 프로그램', () => {
    expect(fileFaceOpenRoute(fileFaceOf(file('D:/elsewhere/old.wmv')), null)).toBe('external');
  });
});

describe('calcBubbleSize — 얼굴의 지름 하한', () => {
  it('미디어는 mediaMinSize, 코드는 종전 그대로 — 파일은 중심이 되지 않아 위성 수로 커지지 않는다(§5.1 #2-1 (B) 묶음 버블)', () => {
    expect(calcBubbleSize(file('C:/proj/a.png'))).toBeGreaterThanOrEqual(FILE_FACE.mediaMinSize);
    // 종전 `_moonCount` 하한(hubMinSize)은 걷었다 — 같은 파일은 위성 수와 무관하게 같은 지름이다.
    expect(calcBubbleSize({ ...file('C:/proj/a.png'), _moonCount: 2 } as BubbleData)).toBe(calcBubbleSize(file('C:/proj/a.png')));
    expect(calcBubbleSize(file('C:/proj/a.ts'))).toBeLessThan(FILE_FACE.mediaMinSize);
  });
});
