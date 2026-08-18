import { describe, it, expect } from 'vitest';
import type { WorkspaceEntry } from '@vibisual/shared';
import {
  flattenExplorerRows,
  splitRelPath,
  toRelativeFromRoot,
  ancestorDirs,
  type ExplorerDirCache,
} from './explorerModel.js';

/**
 * §5.5 #17-19 v4.71 — IDE 워크스페이스 탐색기 순수 로직 테스트.
 * 트리를 화면 순서로 펴는 계산과 경로 취급(대소문자·구분자·상대화)이 여기서 어긋나면
 * 사용자에게는 "엉뚱한 폴더가 열린다 / 경로가 안 뜬다"로 보인다.
 */

const dir = (name: string, relPath: string): WorkspaceEntry => ({ name, relPath, isDirectory: true });
const file = (name: string, relPath: string): WorkspaceEntry => ({ name, relPath, isDirectory: false });

const cache: ExplorerDirCache = {
  '': [dir('packages', 'packages'), dir('docs', 'docs'), file('README.md', 'README.md')],
  packages: [dir('client', 'packages/client'), file('tsconfig.json', 'packages/tsconfig.json')],
  'packages/client': [file('App.tsx', 'packages/client/App.tsx')],
  docs: [file('SCENARIO.md', 'docs/SCENARIO.md')],
};

describe('flattenExplorerRows', () => {
  it('아무것도 안 펼치면 루트 자식만, 깊이 0', () => {
    const rows = flattenExplorerRows(cache, new Set());
    expect(rows.map((r) => r.entry.relPath)).toEqual(['packages', 'docs', 'README.md']);
    expect(rows.every((r) => r.depth === 0)).toBe(true);
  });

  it('펼친 폴더의 자식이 바로 아래에 깊이+1 로 끼어든다(화면 순서)', () => {
    const rows = flattenExplorerRows(cache, new Set(['packages']));
    expect(rows.map((r) => [r.entry.relPath, r.depth])).toEqual([
      ['packages', 0],
      ['packages/client', 1],
      ['packages/tsconfig.json', 1],
      ['docs', 0],
      ['README.md', 0],
    ]);
  });

  it('중첩 펼침 — 깊이가 누적된다', () => {
    const rows = flattenExplorerRows(cache, new Set(['packages', 'packages/client']));
    expect(rows.map((r) => [r.entry.relPath, r.depth])).toEqual([
      ['packages', 0],
      ['packages/client', 1],
      ['packages/client/App.tsx', 2],
      ['packages/tsconfig.json', 1],
      ['docs', 0],
      ['README.md', 0],
    ]);
  });

  it('아직 안 받아온 폴더는 펼쳐져 있어도 자식 0 — 가짜 행을 만들지 않는다', () => {
    const partial: ExplorerDirCache = { '': [dir('docs', 'docs')] };
    const rows = flattenExplorerRows(partial, new Set(['docs']));
    expect(rows.map((r) => r.entry.relPath)).toEqual(['docs']);
  });

  it('루트 캐시가 비어 있으면 빈 목록(부팅 직후)', () => {
    expect(flattenExplorerRows({}, new Set())).toEqual([]);
  });

  it('파일이 펼침 집합에 잘못 들어와도 재귀하지 않는다', () => {
    const rows = flattenExplorerRows(cache, new Set(['README.md']));
    expect(rows.map((r) => r.entry.relPath)).toEqual(['packages', 'docs', 'README.md']);
  });
});

describe('splitRelPath', () => {
  it('상위 폴더와 파일명을 가른다', () => {
    expect(splitRelPath('packages/client/App.tsx')).toEqual({ dir: 'packages/client', name: 'App.tsx' });
  });

  it('최상위 항목은 dir 이 빈 문자열', () => {
    expect(splitRelPath('README.md')).toEqual({ dir: '', name: 'README.md' });
  });

  it('역슬래시·꼬리 구분자를 흡수한다', () => {
    expect(splitRelPath('packages\\client\\')).toEqual({ dir: 'packages', name: 'client' });
  });
});

describe('toRelativeFromRoot', () => {
  it('루트 아래 절대 경로를 상대 경로로 되돌린다', () => {
    expect(toRelativeFromRoot('C:/work/vibisual/packages/client/App.tsx', 'C:/work/vibisual'))
      .toBe('packages/client/App.tsx');
  });

  it('Windows 대소문자·역슬래시 차이를 흡수한다', () => {
    expect(toRelativeFromRoot('c:\\Work\\Vibisual\\docs\\SCENARIO.md', 'C:/work/vibisual'))
      .toBe('docs/SCENARIO.md');
  });

  it('루트 자신이면 빈 문자열', () => {
    expect(toRelativeFromRoot('C:/work/vibisual', 'C:/work/vibisual/')).toBe('');
  });

  it('루트 밖이면 절대 경로 그대로 — 숨기지 않는다', () => {
    expect(toRelativeFromRoot('D:/other/file.ts', 'C:/work/vibisual')).toBe('D:/other/file.ts');
  });

  it('접두사만 같은 형제 폴더를 루트 안으로 오인하지 않는다', () => {
    expect(toRelativeFromRoot('C:/work/vibisual-old/a.ts', 'C:/work/vibisual'))
      .toBe('C:/work/vibisual-old/a.ts');
  });
});

describe('ancestorDirs', () => {
  it('경로를 드러내려면 펼쳐야 하는 조상들을 위에서부터 준다', () => {
    expect(ancestorDirs('packages/client/src/App.tsx')).toEqual([
      'packages',
      'packages/client',
      'packages/client/src',
    ]);
  });

  it('최상위 항목은 조상이 없다', () => {
    expect(ancestorDirs('README.md')).toEqual([]);
  });
});
