import { describe, expect, it } from 'vitest';
import { IDE_EDITOR_MAX_TABS } from '@vibisual/shared';
import type { IDEEditorFile } from './graphStore.js';
import {
  coerceEditorOpenerTab,
  editorOpenerKey,
  editorOpenerTab,
  fillEditorOpener,
  isEditorOpenerTab,
  openEditorOpener,
} from './editorOpener.js';

/** §5.5 #17-27 ⑱ — 빈 탭(판이 먼저, 파일은 그다음)의 탭 계산. */

const file = (relPath: string, dirty = false): IDEEditorFile => ({
  relPath,
  absPath: `/repo/${relPath}`,
  name: relPath.split('/').pop() ?? relPath,
  ...(dirty ? { dirty: true } : {}),
});

describe('빈 탭의 키', () => {
  it('실제 상대 경로가 될 수 없는 모양이다 — 앞에 `//`', () => {
    for (const kind of ['code', 'html', 'image', 'pdf'] as const) {
      const key = editorOpenerKey(kind);
      expect(key.startsWith('//')).toBe(true);
      expect(key).toContain(kind);
    }
  });

  it('판정은 키가 아니라 opener 칸이다', () => {
    expect(isEditorOpenerTab(editorOpenerTab('html'))).toBe(true);
    // 키 모양만 같고 칸이 없으면 빈 탭이 아니다(키를 읽어 판정하지 않는다).
    expect(isEditorOpenerTab({ relPath: editorOpenerKey('html'), absPath: '', name: '' })).toBe(false);
    expect(isEditorOpenerTab(file('a.ts'))).toBe(false);
    expect(isEditorOpenerTab(null)).toBe(false);
  });
});

describe('openEditorOpener — 세우고 앞으로', () => {
  it('맨 뒤에 서고 그 탭이 활성이 된다', () => {
    const r = openEditorOpener([file('a.ts')], 'html');
    expect(r.files.map((f) => f.relPath)).toEqual(['a.ts', editorOpenerKey('html')]);
    expect(r.activePath).toBe(editorOpenerKey('html'));
    expect(r.files[1]?.opener).toBe('html');
  });

  it('after 를 주면 그 탭 바로 오른쪽 — 보던 파일 옆([파일 열기])', () => {
    const r = openEditorOpener([file('a.ts'), file('b.ts'), file('c.ts')], 'code', 'a.ts');
    expect(r.files.map((f) => f.relPath)).toEqual(['a.ts', editorOpenerKey('code'), 'b.ts', 'c.ts']);
  });

  it('같은 갈래의 빈 탭이 이미 있으면 새로 세우지 않고 자리도 옮기지 않는다', () => {
    const start = openEditorOpener([file('a.ts')], 'html').files;
    const r = openEditorOpener([...start, file('b.ts')], 'html', 'b.ts');
    expect(r.files.map((f) => f.relPath)).toEqual(['a.ts', editorOpenerKey('html'), 'b.ts']);
    expect(r.activePath).toBe(editorOpenerKey('html'));
  });

  it('갈래가 다르면 따로 선다', () => {
    const one = openEditorOpener([], 'html');
    const two = openEditorOpener(one.files, 'pdf');
    expect(two.files.map((f) => f.opener)).toEqual(['html', 'pdf']);
  });

  it('상한 — 저장할 것이 없는 가장 오래된 탭부터 밀리고, 고치던 파일과 방금 세운 빈 탭은 남는다', () => {
    const files = [file('dirty.ts', true), ...Array.from({ length: IDE_EDITOR_MAX_TABS - 1 }, (_, i) => file(`f${String(i)}.ts`))];
    const r = openEditorOpener(files, 'image');
    expect(r.files).toHaveLength(IDE_EDITOR_MAX_TABS);
    expect(r.files.some((f) => f.relPath === 'dirty.ts')).toBe(true);
    expect(r.files.some((f) => f.relPath === 'f0.ts')).toBe(false);
    expect(r.files.some((f) => f.relPath === editorOpenerKey('image'))).toBe(true);
  });
});

describe('fillEditorOpener — 같은 자리에서 그 파일 탭이 된다', () => {
  it('빈 탭이 그 자리에서 파일 탭으로 바뀐다(순서 그대로)', () => {
    const files = [file('a.ts'), editorOpenerTab('html'), file('b.ts')];
    const r = fillEditorOpener(files, editorOpenerKey('html'), file('site/index.html'));
    expect(r?.files.map((f) => f.relPath)).toEqual(['a.ts', 'site/index.html', 'b.ts']);
    expect(r?.activePath).toBe('site/index.html');
    // 채운 탭은 더는 빈 탭이 아니다.
    expect(r?.files[1]?.opener).toBeUndefined();
  });

  it('이미 열린 파일을 고르면 빈 탭을 걷고 그 탭으로 간다 — 같은 파일이 두 탭이 되지 않게', () => {
    const files = [file('index.html'), editorOpenerTab('html')];
    const r = fillEditorOpener(files, editorOpenerKey('html'), file('index.html'));
    expect(r?.files.map((f) => f.relPath)).toEqual(['index.html']);
    expect(r?.activePath).toBe('index.html');
  });

  it('빈 탭이 그 사이 사라졌으면 null — 호출부가 평소 열기로 떨어진다', () => {
    expect(fillEditorOpener([file('a.ts')], editorOpenerKey('html'), file('x.html'))).toBeNull();
  });

  it('저장하지 않은 표식은 새 탭으로 옮겨 가지 않는다(고른 파일은 방금 연 것이다)', () => {
    const r = fillEditorOpener([editorOpenerTab('code')], editorOpenerKey('code'), file('a.ts', true));
    expect(r?.files[0]?.dirty).toBeUndefined();
  });
});

describe('coerceEditorOpenerTab — 창 사이 짐', () => {
  it('갈래가 맞으면 그 갈래의 빈 탭으로 다시 선다(키도 바로잡는다)', () => {
    const got = coerceEditorOpenerTab({ relPath: '//opener/whatever', absPath: 'x', name: 'y' }, 'pdf');
    expect(got).toEqual(editorOpenerTab('pdf'));
  });

  it('빈 탭 키 모양인데 갈래를 모르면 버린다 — 경로가 아닌 키로 디스크를 읽으러 가지 않게', () => {
    expect(coerceEditorOpenerTab({ relPath: editorOpenerKey('html'), absPath: '', name: '' }, undefined)).toBeNull();
    expect(coerceEditorOpenerTab({ relPath: editorOpenerKey('html'), absPath: '', name: '' }, 'video')).toBeNull();
  });

  it('파일 탭은 그대로', () => {
    const f = file('src/a.ts');
    expect(coerceEditorOpenerTab(f, undefined)).toBe(f);
  });
});
