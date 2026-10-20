/**
 * §5.1 #2-1 (A) — 파일 얼굴의 화면 쪽 판정(`fileFaceOf` · `fileMediaTarget`) · 크기 하한(`calcBubbleSize`) 고정 시험.
 *
 * 고정하는 것:
 *  ① 미디어는 그 확장자를 받겠다고 선언한 앱이 굽고(레지스트리), 색도 그 앱의 것이다.
 *  ② 선언한 앱이 없는 미디어(psd)는 종류 기본색 + 굽는 앱 없음 · 미디어가 아닌 종류는 보라 계열.
 *  ③ 파일이 아니면 얼굴이 없다.
 *  ④ 미리보기 자리는 가장 긴 프로젝트 루트에서 자르고, 어느 루트에도 없으면 굽지 않는다.
 *  ⑤ 미디어 얼굴·별자리 중심은 지름 하한을 갖는다(히트맵이 켜져 있으면 히트가 이긴다).
 */
import { describe, it, expect } from 'vitest';
import type { BubbleData } from '@vibisual/shared';
import { FILE_FACE, FILE_FACE_STYLES } from '@vibisual/shared';

import { thumbnailAppFor } from '../apps/appLinkedItems.js';
import { getInternalApp } from '../apps/registry.js';
import { fileFaceOf, fileFaceVersion, fileMediaTarget } from './fileFaceView.js';
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

  it('어느 루트에도 없으면 굽지 않는다(미디어 창구가 루트 밖을 막는다)', () => {
    expect(fileMediaTarget('D:/elsewhere/clip.mp4', ['C:/proj'])).toBeNull();
    expect(fileMediaTarget(undefined, ['C:/proj'])).toBeNull();
  });
});

describe('calcBubbleSize — 얼굴의 지름 하한', () => {
  it('미디어는 mediaMinSize, 위성을 거느린 중심은 hubMinSize, 코드는 종전 그대로', () => {
    expect(calcBubbleSize(file('C:/proj/a.png'))).toBeGreaterThanOrEqual(FILE_FACE.mediaMinSize);
    expect(calcBubbleSize({ ...file('C:/proj/a.png'), _moonCount: 2 } as BubbleData)).toBeGreaterThanOrEqual(FILE_FACE.hubMinSize);
    expect(calcBubbleSize(file('C:/proj/a.ts'))).toBeLessThan(FILE_FACE.mediaMinSize);
  });
});
