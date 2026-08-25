import { describe, it, expect, vi } from 'vitest';
import type { ContextMenuItem } from './IDEContextMenu.js';
import {
  buildBodyMenuItems,
  buildGutterMenuItems,
  buildTabMenuItems,
  type BodyMenuHandlers,
  type GutterMenuHandlers,
  type TabMenuHandlers,
} from './editorContextMenu.js';

/**
 * §5.5 #17-27 ⑨ v4.97 — 우클릭 메뉴 항목 목록 테스트.
 *
 * "누를 수 있나 / 없으면 왜인가" 는 화면을 띄우지 않고도 답이 나와야 한다 — 흐려진 항목에
 * 이유가 안 붙으면 사용자는 고장으로 읽는다.
 */

/** 키를 그대로 돌려주는 t — 라벨이 어느 키에서 왔는지 그대로 확인한다. */
const t = (key: string): string => key;

function bodyHandlers(): BodyMenuHandlers {
  return {
    cut: vi.fn(), copy: vi.fn(), paste: vi.fn(), selectAll: vi.fn(), undo: vi.fn(), redo: vi.fn(),
    save: vi.fn(), reload: vi.fn(), copyPath: vi.fn(), copyLineRef: vi.fn(), openExternal: vi.fn(),
    searchWeb: vi.fn(),
  };
}

function find(items: ContextMenuItem[], id: string): ContextMenuItem {
  const item = items.find((i) => i.id === id);
  expect(item, `menu item ${id}`).toBeDefined();
  return item!;
}

describe('buildBodyMenuItems', () => {
  it('고른 글자가 없으면 잘라내기·복사가 흐려지고 이유가 붙는다', () => {
    const items = buildBodyMenuItems({ hasSelection: false, readOnly: false, dirty: false }, bodyHandlers(), t);
    expect(find(items, 'cut').disabled).toBe(true);
    expect(find(items, 'copy').disabled).toBe(true);
    expect(find(items, 'copy').disabledTitle).toBe('ide.editor.ctx.needSelection');
    expect(find(items, 'paste').disabled).toBe(false);
  });

  it('읽기 전용 파일이면 고치는 항목이 전부 흐려진다', () => {
    const items = buildBodyMenuItems({ hasSelection: true, readOnly: true, dirty: false }, bodyHandlers(), t);
    for (const id of ['cut', 'paste', 'undo', 'redo']) {
      expect(find(items, id).disabled, id).toBe(true);
      expect(find(items, id).disabledTitle, id).toBe('ide.editor.ctx.readOnlyFile');
    }
    // 읽기 전용이어도 복사·전체 선택·경로 복사는 된다.
    expect(find(items, 'copy').disabled).toBe(false);
    expect(find(items, 'selectAll').disabled).toBeUndefined();
    expect(find(items, 'copyPath').disabled).toBeUndefined();
  });

  it('저장할 것이 없으면 저장이 흐려진다', () => {
    const clean = buildBodyMenuItems({ hasSelection: false, readOnly: false, dirty: false }, bodyHandlers(), t);
    expect(find(clean, 'save').disabled).toBe(true);
    expect(find(clean, 'save').disabledTitle).toBe('ide.editor.ctx.nothingToSave');

    const dirty = buildBodyMenuItems({ hasSelection: false, readOnly: false, dirty: true }, bodyHandlers(), t);
    expect(find(dirty, 'save').disabled).toBe(false);
  });

  it('누르면 그 조작이 불린다', () => {
    const h = bodyHandlers();
    const items = buildBodyMenuItems({ hasSelection: true, readOnly: false, dirty: true }, h, t);
    find(items, 'copy').onClick();
    find(items, 'save').onClick();
    expect(h.copy).toHaveBeenCalledOnce();
    expect(h.save).toHaveBeenCalledOnce();
  });

  it('묶음이 바뀌는 자리에만 구분선이 있다', () => {
    const items = buildBodyMenuItems({ hasSelection: true, readOnly: false, dirty: true }, bodyHandlers(), t);
    expect(items.filter((i) => i.separatorBefore).map((i) => i.id)).toEqual(['undo', 'save', 'copyPath']);
  });
  it('웹에서 검색은 고른 글자가 있을 때만 눌린다 — 읽기 전용이어도 막지 않는다', () => {
    const off = buildBodyMenuItems({ hasSelection: false, readOnly: true, dirty: false }, bodyHandlers(), t);
    expect(find(off, 'searchWeb').disabled).toBe(true);
    expect(find(off, 'searchWeb').disabledTitle).toBe('ide.editor.ctx.needSelection');

    const h = bodyHandlers();
    const on = buildBodyMenuItems({ hasSelection: true, readOnly: true, dirty: false }, h, t);
    const item = find(on, 'searchWeb');
    expect(item.disabled).toBe(false);
    // 스트림·입력창·터미널과 같은 원문이므로 키도 하나를 쓴다.
    expect(item.label).toBe('ide.mainArea.ctxSearchWeb');
    item.onClick();
    expect(h.searchWeb).toHaveBeenCalledTimes(1);
  });

  it('복사 바로 아래에 선다(#17-7 북마크와 같은 규약)', () => {
    const items = buildBodyMenuItems({ hasSelection: true, readOnly: false, dirty: false }, bodyHandlers(), t);
    const ids = items.map((i) => i.id);
    expect(ids.indexOf('searchWeb')).toBe(ids.indexOf('copy') + 1);
  });
});

describe('buildGutterMenuItems', () => {
  const h = (): GutterMenuHandlers => ({
    toggleBreakpoint: vi.fn(), clearFileBreakpoints: vi.fn(), copyLine: vi.fn(), copyLineRef: vi.fn(),
  });

  it('중단점이 있으면 제거로, 없으면 추가로 라벨이 뒤집힌다', () => {
    const off = buildGutterMenuItems({ line: 3, hasBreakpoint: false, hasAnyBreakpoint: false, canBreakpoint: true }, h(), t);
    expect(find(off, 'toggleBreakpoint').label).toBe('ide.editor.ctx.addBreakpoint');

    const on = buildGutterMenuItems({ line: 3, hasBreakpoint: true, hasAnyBreakpoint: true, canBreakpoint: true }, h(), t);
    expect(find(on, 'toggleBreakpoint').label).toBe('ide.editor.ctx.removeBreakpoint');
  });

  it('찍힌 중단점이 없으면 모두 제거가 흐려진다', () => {
    const items = buildGutterMenuItems({ line: 1, hasBreakpoint: false, hasAnyBreakpoint: false, canBreakpoint: true }, h(), t);
    expect(find(items, 'clearFileBreakpoints').disabled).toBe(true);
    expect(find(items, 'clearFileBreakpoints').disabledTitle).toBe('ide.editor.ctx.noBreakpoints');
  });

  it('중단점을 다룰 수 없는 자리면 두 항목 다 흐려지고 같은 이유가 붙는다', () => {
    const items = buildGutterMenuItems({ line: 1, hasBreakpoint: false, hasAnyBreakpoint: true, canBreakpoint: false }, h(), t);
    expect(find(items, 'toggleBreakpoint').disabled).toBe(true);
    expect(find(items, 'clearFileBreakpoints').disabledTitle).toBe('ide.editor.ctx.noBreakpointTarget');
    // 줄을 집어 가는 항목은 디버그와 무관하게 늘 된다.
    expect(find(items, 'copyLine').disabled).toBeUndefined();
  });
});

describe('buildTabMenuItems', () => {
  const h = (): TabMenuHandlers => ({
    close: vi.fn(), closeOthers: vi.fn(), closeAll: vi.fn(), copyPath: vi.fn(), openExternal: vi.fn(),
  });

  it('탭이 하나뿐이면 다른 탭 모두 닫기가 흐려진다', () => {
    const alone = buildTabMenuItems({ hasOthers: false }, h(), t);
    expect(find(alone, 'closeOthers').disabled).toBe(true);
    expect(find(alone, 'closeOthers').disabledTitle).toBe('ide.editor.ctx.noOtherTabs');

    const many = buildTabMenuItems({ hasOthers: true }, h(), t);
    expect(find(many, 'closeOthers').disabled).toBe(false);
  });

  it('닫기·모두 닫기는 언제나 누를 수 있다', () => {
    const items = buildTabMenuItems({ hasOthers: false }, h(), t);
    expect(find(items, 'close').disabled).toBeUndefined();
    expect(find(items, 'closeAll').disabled).toBeUndefined();
  });
});
