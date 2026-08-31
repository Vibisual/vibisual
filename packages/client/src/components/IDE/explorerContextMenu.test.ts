import { describe, it, expect, vi } from 'vitest';
import type { ContextMenuItem } from './IDEContextMenu.js';
import {
  buildExplorerActivityMenuItems,
  buildExplorerEntryMenuItems,
  buildExplorerRootMenuItems,
  type ExplorerEntryMenuHandlers,
} from './explorerContextMenu.js';
import { workspaceMutateErrorKey, workspaceNameErrorKey } from './explorerModel.js';

/**
 * §5.5 #17-19 ⑦ — 탐색기 우클릭 메뉴 목록 테스트.
 *
 * 지키는 것 셋 — (a) 파일과 폴더가 **같은 자리 순서**를 쓴다(손이 기억하는 것은 위치다),
 * (b) 되돌릴 수 없는 항목(삭제)이 실수로 눌리지 않게 **맨 끝 · 구분선 뒤**에 선다,
 * (c) 열려 있는 프로젝트가 없으면 활동바 메뉴가 흐려지고 **그 까닭이 붙는다**.
 */

/** 키를 그대로 돌려주는 t — 라벨이 어느 키에서 왔는지 그대로 확인한다. */
const t = (key: string): string => key;

function handlers(): ExplorerEntryMenuHandlers {
  return {
    open: vi.fn(), openExternal: vi.fn(), revealFolder: vi.fn(),
    newFile: vi.fn(), newFolder: vi.fn(), copyPath: vi.fn(), rename: vi.fn(), remove: vi.fn(),
  };
}

const ids = (items: ContextMenuItem[]): string[] => items.map((i) => i.id ?? '');

function find(items: ContextMenuItem[], id: string): ContextMenuItem {
  const item = items.find((i) => i.id === id);
  expect(item, `menu item ${id}`).toBeDefined();
  return item!;
}

describe('buildExplorerEntryMenuItems', () => {
  it('파일 — 여는 것 둘로 시작하고, 만들기 항목은 서지 않는다', () => {
    const items = buildExplorerEntryMenuItems({ isDirectory: false }, handlers(), t);
    expect(ids(items)).toEqual(['open', 'openExternal', 'revealFolder', 'copyPath', 'rename', 'delete']);
  });

  it('폴더 — 그 자리에 만들기 둘이 서고, 파일에만 있는 열기는 빠진다', () => {
    const items = buildExplorerEntryMenuItems({ isDirectory: true }, handlers(), t);
    expect(ids(items)).toEqual(['newFile', 'newFolder', 'revealFolder', 'copyPath', 'rename', 'delete']);
  });

  it('파일·폴더가 뒤쪽 네 항목의 순서를 공유한다 — 같은 손짓이 같은 자리를 누른다', () => {
    const file = ids(buildExplorerEntryMenuItems({ isDirectory: false }, handlers(), t)).slice(2);
    const dir = ids(buildExplorerEntryMenuItems({ isDirectory: true }, handlers(), t)).slice(2);
    expect(file).toEqual(dir);
  });

  it('[안전] 삭제는 맨 끝이고 그 위(이름 바꾸기)에서 묶음이 갈린다', () => {
    const items = buildExplorerEntryMenuItems({ isDirectory: false }, handlers(), t);
    expect(ids(items).at(-1)).toBe('delete');
    expect(find(items, 'rename').separatorBefore).toBe(true);
    // 삭제 자신에는 구분선이 없다 — 이름 바꾸기와 한 묶음(그 항목을 고치는 일)이다.
    expect(find(items, 'delete').separatorBefore).toBeUndefined();
  });

  it('손잡이가 제 짝을 부른다', () => {
    const h = handlers();
    const items = buildExplorerEntryMenuItems({ isDirectory: true }, h, t);
    find(items, 'newFolder').onClick();
    find(items, 'delete').onClick();
    expect(h.newFolder).toHaveBeenCalledTimes(1);
    expect(h.remove).toHaveBeenCalledTimes(1);
    expect(h.newFile).not.toHaveBeenCalled();
  });

  it('단축키 표시가 붙는다(메뉴에 적힌 대로 키가 눌린다)', () => {
    const items = buildExplorerEntryMenuItems({ isDirectory: false }, handlers(), t);
    expect(find(items, 'rename').hint).toBe('F2');
    expect(find(items, 'delete').hint).toBeTruthy();
  });
});

describe('buildExplorerRootMenuItems', () => {
  it('루트에는 이름 바꾸기·삭제가 없다 — 탐색기가 서 있는 땅이다', () => {
    const items = buildExplorerRootMenuItems(
      { newFile: vi.fn(), newFolder: vi.fn(), revealFolder: vi.fn(), copyPath: vi.fn(), refresh: vi.fn() },
      t,
    );
    expect(ids(items)).toEqual(['newFile', 'newFolder', 'revealFolder', 'copyPath', 'refresh']);
    expect(ids(items)).not.toContain('delete');
    expect(ids(items)).not.toContain('rename');
  });
});

describe('buildExplorerActivityMenuItems', () => {
  it('프로젝트가 열려 있으면 폴더 열기가 첫 항목이다(사용자가 이 자리에서 찾는 것)', () => {
    const items = buildExplorerActivityMenuItems({ hasProject: true }, { revealFolder: vi.fn(), copyPath: vi.fn() }, t);
    expect(ids(items)).toEqual(['revealFolder', 'copyPath']);
    expect(find(items, 'revealFolder').disabled).toBe(false);
  });

  it('열린 프로젝트가 없으면 흐려지고 까닭이 붙는다', () => {
    const items = buildExplorerActivityMenuItems({ hasProject: false }, { revealFolder: vi.fn(), copyPath: vi.fn() }, t);
    for (const id of ['revealFolder', 'copyPath']) {
      expect(find(items, id).disabled, id).toBe(true);
      expect(find(items, id).disabledTitle, id).toBe('ide.explorer.noProject');
    }
  });
});

describe('실패 사유 → 문구 키', () => {
  it('이름 규칙 위반은 사유마다 다른 문구를 고른다(한 문구로 뭉개지 않는다)', () => {
    const keys = (['empty', 'separator', 'traversal', 'invalid-char', 'trailing', 'reserved', 'too-long'] as const)
      .map(workspaceNameErrorKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('서버가 준 사유도 마찬가지 — 사용자가 할 일이 사유마다 다르다', () => {
    expect(workspaceMutateErrorKey('exists')).toBe('ide.explorer.ctx.err.exists');
    expect(workspaceMutateErrorKey('denied')).toBe('ide.explorer.ctx.err.denied');
    expect(workspaceMutateErrorKey('offline')).toBe('ide.explorer.ctx.err.offline');
    expect(workspaceMutateErrorKey('failed')).toBe('ide.explorer.ctx.err.failed');
  });
});
