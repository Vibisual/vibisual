import { describe, expect, it } from 'vitest';

import { normalizePathKey, sameWorkspaceFile, toWorkspaceRelative } from './debugPaths.js';

/**
 * §5.5 #17-20 ⑩⑪ v4.94 — 경로 맞춰 보기.
 *
 * 디버거는 절대 경로를 주고 편집창은 상대 경로를 안다. 이 계산이 두 화면(멈춘 줄 강조 ·
 * 오류 줄 클릭해 열기)에서 같이 쓰이므로 여기서 못 박아 둔다.
 */
const BACKSLASH = String.fromCharCode(92);

describe('normalizePathKey', () => {
  it('구분자를 / 로 통일하고 대소문자를 접는다', () => {
    expect(normalizePathKey(`C:${BACKSLASH}Src${BACKSLASH}App.TS`)).toBe('c:/src/app.ts');
  });
});

describe('sameWorkspaceFile', () => {
  const root = 'C:/proj';

  it('루트 + 상대경로가 맞으면 같은 파일이다', () => {
    expect(sameWorkspaceFile('C:/proj/src/a.ts', root, 'src/a.ts')).toBe(true);
  });

  it('윈도우 구분자·대소문자가 달라도 같은 파일로 본다', () => {
    expect(sameWorkspaceFile(`C:${BACKSLASH}Proj${BACKSLASH}src${BACKSLASH}A.ts`, root, 'src/a.ts')).toBe(true);
  });

  it('앞부분이 달라도 꼬리가 같으면 같은 파일로 본다(워크트리·심볼릭 링크)', () => {
    expect(sameWorkspaceFile('D:/worktrees/wt1/src/a.ts', root, 'src/a.ts')).toBe(true);
  });

  it('다른 파일은 같다고 하지 않는다', () => {
    expect(sameWorkspaceFile('C:/proj/src/b.ts', root, 'src/a.ts')).toBe(false);
  });
});

describe('toWorkspaceRelative', () => {
  const root = 'C:/proj';

  it('루트 안의 절대 경로를 상대 경로로 바꾼다', () => {
    expect(toWorkspaceRelative('C:/proj/src/a.ts', root)).toBe('src/a.ts');
  });

  it('윈도우 구분자도 받는다', () => {
    expect(toWorkspaceRelative(`C:${BACKSLASH}proj${BACKSLASH}src${BACKSLASH}a.ts`, root)).toBe('src/a.ts');
  });

  it('상대 경로는 그대로 두고 ./ 만 떼어낸다', () => {
    expect(toWorkspaceRelative('./main.go', root)).toBe('main.go');
    expect(toWorkspaceRelative('src/a.ts', root)).toBe('src/a.ts');
  });

  it('루트 밖 절대 경로는 열지 않는다', () => {
    expect(toWorkspaceRelative('D:/other/a.ts', root)).toBeNull();
  });

  it('상위로 거슬러 올라가는 경로는 열지 않는다', () => {
    expect(toWorkspaceRelative('../secret.env', root)).toBeNull();
  });
});
