/**
 * §7.5 폴더 목록 — **행 펴기 · 창 자르기 · 버리기**를 고정한다.
 *
 * 이 세 계산이 화면 밖에서 결정되어야 "안 보는 것은 들고 있지 않는다"를 눈으로 확인하지 않고도
 * 지킬 수 있다. 특히 `dropLevelSubtree` 는 **접는 순간 메모리에서 사라지는가**를 정하는 자리라,
 * 형제 겹까지 쓸어 가면 옆 폴더가 이유 없이 다시 로딩된다.
 */
import { describe, expect, it } from 'vitest';
import type { FolderFileEntry } from '@vibisual/shared';
import {
  FOLDER_ROW_HEIGHT,
  childSubPathOf,
  dropExpandedSubtree,
  dropLevelSubtree,
  flattenFolderLevels,
  folderRowWindow,
  type FolderLevelState,
} from './folderFileRows.js';

const file = (name: string, rel: string): FolderFileEntry =>
  ({ name, relativePath: rel, isDirectory: false, isSatellite: false });
const dir = (name: string, rel: string): FolderFileEntry =>
  ({ name, relativePath: rel, isDirectory: true, isSatellite: false });

const level = (entries: FolderFileEntry[], over: Partial<FolderLevelState> = {}): FolderLevelState => ({
  entries,
  nextCursor: null,
  total: entries.length,
  loading: false,
  failed: false,
  ...over,
});

describe('flattenFolderLevels — 펼친 겹만 행이 된다', () => {
  it('아무것도 안 펼치면 루트 겹만 나온다 (하위는 애초에 받지도 않았다)', () => {
    const levels = new Map([['', level([dir('sub', 'sub'), file('a.txt', 'a.txt')])]]);

    const rows = flattenFolderLevels(levels, new Set());

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => (r.kind === 'entry' ? r.entry.name : 'more'))).toEqual(['sub', 'a.txt']);
    expect(rows.every((r) => r.depth === 0)).toBe(true);
  });

  it('펼친 폴더 바로 아래에 그 겹이 끼어들고 depth 가 한 칸 깊어진다', () => {
    const levels = new Map([
      ['', level([dir('sub', 'sub'), file('z.txt', 'z.txt')])],
      ['sub', level([file('inner.txt', 'sub/inner.txt')])],
    ]);

    const rows = flattenFolderLevels(levels, new Set(['sub']));

    expect(rows.map((r) => (r.kind === 'entry' ? r.entry.name : 'more'))).toEqual(['sub', 'inner.txt', 'z.txt']);
    expect(rows[1]?.depth).toBe(1);
    // 펼쳐진 폴더 행은 자기 상태를 안다(화살표 방향).
    expect(rows[0]?.kind === 'entry' && rows[0].expanded).toBe(true);
  });

  it('펼쳤는데 그 겹이 아직 안 왔으면 자식 행은 없다 (빈 자리를 만들지 않는다)', () => {
    const levels = new Map([['', level([dir('sub', 'sub')])]]);

    const rows = flattenFolderLevels(levels, new Set(['sub']));

    expect(rows).toHaveLength(1);
  });

  it('아직 더 받을 게 있으면 그 겹 끝에 `more` 행이 선다', () => {
    const levels = new Map([['', level([file('a.txt', 'a.txt')], { nextCursor: '100', total: 4812 })]]);

    const rows = flattenFolderLevels(levels, new Set());

    const more = rows[rows.length - 1];
    expect(more?.kind).toBe('more');
    expect(more?.kind === 'more' && more.loaded).toBe(1);
    expect(more?.kind === 'more' && more.total).toBe(4812);
  });

  it('실패했을 때도 `more` 행은 남는다 — 사라지면 다시 시도할 자리가 없다', () => {
    const levels = new Map([['', level([file('a.txt', 'a.txt')], { nextCursor: null, failed: true })]]);

    const rows = flattenFolderLevels(levels, new Set());

    const more = rows[rows.length - 1];
    expect(more?.kind === 'more' && more.failed).toBe(true);
  });

  it('행 키는 겹마다 갈린다 — 같은 이름이 두 겹에 있어도 React key 가 겹치지 않는다', () => {
    const levels = new Map([
      ['', level([dir('a', 'a'), dir('b', 'b')])],
      ['a', level([file('same.txt', 'a/same.txt')])],
      ['b', level([file('same.txt', 'b/same.txt')])],
    ]);

    const rows = flattenFolderLevels(levels, new Set(['a', 'b']));

    const keys = rows.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('folderRowWindow — 보이는 구간만 그린다', () => {
  it('맨 위에서는 앞쪽만 그리고 나머지는 아래 여백으로 대신한다', () => {
    const win = folderRowWindow(1000, 0, 220, FOLDER_ROW_HEIGHT, 8);

    expect(win.start).toBe(0);
    expect(win.end).toBeLessThan(1000);
    expect(win.padTop).toBe(0);
    // 위 여백 + 그린 행 + 아래 여백 = 전체 높이 (스크롤 막대가 흔들리지 않는다)
    expect(win.padTop + (win.end - win.start) * FOLDER_ROW_HEIGHT + win.padBottom)
      .toBe(1000 * FOLDER_ROW_HEIGHT);
  });

  it('가운데로 스크롤하면 그 구간만 남고 위아래가 여백이 된다', () => {
    const scrollTop = 500 * FOLDER_ROW_HEIGHT;
    const win = folderRowWindow(1000, scrollTop, 220, FOLDER_ROW_HEIGHT, 8);

    expect(win.start).toBe(500 - 8);
    expect(win.padTop).toBe((500 - 8) * FOLDER_ROW_HEIGHT);
    expect(win.padBottom).toBeGreaterThan(0);
    // 수천 줄이어도 DOM 에 남는 행은 화면 한 칸 + 여유분뿐이다.
    expect(win.end - win.start).toBeLessThan(40);
  });

  it('끝까지 내리면 아래 여백이 0 이다', () => {
    const win = folderRowWindow(50, 50 * FOLDER_ROW_HEIGHT, 220, FOLDER_ROW_HEIGHT, 8);

    expect(win.end).toBe(50);
    expect(win.padBottom).toBe(0);
  });

  it('높이를 아직 모를 때(첫 페인트 전)도 빈 창이 되지 않는다', () => {
    const win = folderRowWindow(100, 0, 0, FOLDER_ROW_HEIGHT, 8);

    expect(win.end).toBeGreaterThan(0);
  });

  it('행이 없으면 아무것도 그리지 않는다', () => {
    expect(folderRowWindow(0, 0, 220)).toEqual({ start: 0, end: 0, padTop: 0, padBottom: 0 });
  });
});

describe('접으면 그 자리에서 버린다', () => {
  it('접은 겹과 그 아래만 지우고 형제는 남긴다', () => {
    const levels = new Map([
      ['', level([])],
      ['a', level([])],
      ['a/deep', level([])],
      ['a/deep/deeper', level([])],
      ['b', level([])],
      ['ab', level([])],   // 이름이 겹쳐 보이지만 다른 가지다 — 접두 검사만 하면 함께 지워진다
    ]);

    const next = dropLevelSubtree(levels, 'a');

    expect([...next.keys()].sort()).toEqual(['', 'ab', 'b']);
  });

  it('펼침 표시도 같은 규칙으로 걷는다 (펼쳐졌는데 내용이 없는 상태를 만들지 않는다)', () => {
    const expanded = new Set(['a', 'a/deep', 'ab', 'b']);

    const next = dropExpandedSubtree(expanded, 'a');

    expect([...next].sort()).toEqual(['ab', 'b']);
  });

  it('childSubPathOf — 루트 아래는 이름 그대로, 그 아래는 이어 붙인다', () => {
    expect(childSubPathOf('', 'sub')).toBe('sub');
    expect(childSubPathOf('sub', 'deep')).toBe('sub/deep');
  });
});
