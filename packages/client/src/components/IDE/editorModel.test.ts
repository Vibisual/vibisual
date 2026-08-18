import { describe, it, expect } from 'vitest';
import {
  INDENT_UNIT,
  applyDedent,
  applyIndent,
  editorFileFromAbsPath,
  editorFileFromRelPath,
  isDirty,
  splitPathTail,
  tabLabels,
} from './editorModel.js';

/**
 * §5.5 #17-27 v4.87 — 편집창 순수 로직 테스트.
 *
 * 캐럿·선택 범위는 화면에서 눈으로 확인하기 어려운 자리다 — `Tab` 한 번에 커서가 엉뚱한 곳으로
 * 튀면 편집창은 그 순간 못 쓰는 물건이 되므로, 위치까지 함께 못 박는다.
 */

describe('editorFileFromAbsPath', () => {
  it('루트 안 절대 경로를 상대 경로 + 표시 이름으로 가른다', () => {
    const file = editorFileFromAbsPath('C:\\repo\\packages\\client\\src\\App.tsx', 'C:/repo');
    expect(file.relPath).toBe('packages/client/src/App.tsx');
    expect(file.name).toBe('App.tsx');
    expect(file.absPath).toBe('C:/repo/packages/client/src/App.tsx');
  });

  it('루트 밖 파일은 절대 경로를 그대로 쓴다(숨기지 않는다)', () => {
    const file = editorFileFromAbsPath('D:/other/note.md', 'C:/repo');
    expect(file.relPath).toBe('D:/other/note.md');
    expect(file.name).toBe('note.md');
  });
});

describe('editorFileFromRelPath', () => {
  it('상대 경로만 아는 자리(탐색기)에서도 같은 탭이 나온다', () => {
    const fromRel = editorFileFromRelPath('src/App.tsx', 'C:/repo/');
    const fromAbs = editorFileFromAbsPath('C:/repo/src/App.tsx', 'C:/repo');
    expect(fromRel).toEqual(fromAbs);
  });
});

describe('applyIndent', () => {
  it('선택이 없으면 캐럿 자리에 들여쓰기를 넣고 커서를 그만큼 민다', () => {
    const out = applyIndent('ab', 1, 1);
    expect(out.text).toBe(`a${INDENT_UNIT}b`);
    expect(out.selectionStart).toBe(1 + INDENT_UNIT.length);
    expect(out.selectionEnd).toBe(1 + INDENT_UNIT.length);
  });

  it('여러 줄 선택은 줄마다 한 단계씩 민다', () => {
    const text = 'one\ntwo\nthree';
    const out = applyIndent(text, 0, text.length);
    expect(out.text).toBe('  one\n  two\n  three');
    expect(out.selectionEnd).toBe(text.length + INDENT_UNIT.length * 3);
  });
});

describe('applyDedent', () => {
  it('앞 공백을 한 단계까지만 뺀다', () => {
    const out = applyDedent('    deep', 6, 6);
    expect(out.text).toBe('  deep');
  });

  it('뺄 공백이 없으면 그대로 둔다', () => {
    const out = applyDedent('flush', 2, 2);
    expect(out.text).toBe('flush');
    expect(out.selectionStart).toBe(2);
  });

  it('여러 줄 선택은 줄마다 뺀다', () => {
    const text = '  one\n  two';
    const out = applyDedent(text, 0, text.length);
    expect(out.text).toBe('one\ntwo');
  });

  it('탭 문자도 한 칸으로 뺀다', () => {
    expect(applyDedent('\tone', 1, 1).text).toBe('one');
  });
});

describe('isDirty', () => {
  it('디스크 본문과 다르면 저장할 것이 있다', () => {
    expect(isDirty('a', 'a')).toBe(false);
    expect(isDirty('a', 'a ')).toBe(true);
  });
});

describe('tabLabels', () => {
  const file = (relPath: string) => editorFileFromRelPath(relPath, 'C:/repo');

  it('이름이 겹치지 않으면 파일명만', () => {
    const labels = tabLabels([file('src/App.tsx'), file('src/main.ts')]);
    expect(labels['src/App.tsx']).toBe('App.tsx');
  });

  it('같은 이름이 여럿이면 상위 폴더 한 겹을 덧붙인다', () => {
    const labels = tabLabels([file('a/index.ts'), file('b/index.ts')]);
    expect(labels['a/index.ts']).toBe('a/index.ts');
    expect(labels['b/index.ts']).toBe('b/index.ts');
  });
});

describe('splitPathTail', () => {
  it('폴더까지와 파일 이름을 가른다(앞 토막에 마지막 구분자가 남는다)', () => {
    expect(splitPathTail('C:/repo/src/App.tsx')).toEqual({ head: 'C:/repo/src/', tail: 'App.tsx' });
  });

  it('역슬래시 경로도 같은 결과로 정규화한다', () => {
    const win = ['C:', 'repo', 'src', 'App.tsx'].join(String.fromCharCode(92));
    expect(splitPathTail(win)).toEqual({ head: 'C:/repo/src/', tail: 'App.tsx' });
  });

  it('구분자가 없으면 전부 파일 이름이다', () => {
    expect(splitPathTail('App.tsx')).toEqual({ head: '', tail: 'App.tsx' });
  });

  it('빈 경로도 터지지 않는다', () => {
    expect(splitPathTail('')).toEqual({ head: '', tail: '' });
  });
});
