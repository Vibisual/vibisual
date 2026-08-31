import { describe, it, expect, vi } from 'vitest';
import type { ContextMenuItem } from '../components/IDE/IDEContextMenu.js';
import {
  buildTextFieldMenuItems,
  shouldOpenTextFieldMenu,
  spliceValue,
  type TextFieldMenuHandlers,
} from './textFieldContextMenu.js';

/**
 * 입력칸 우클릭 메뉴 테스트.
 *
 * 이 메뉴가 있는 이유는 **붙여넣기 말고는 들어갈 길이 없는 칸**(로그인 창의 인증 코드) 때문이다.
 * 그래서 여기서 못 박는 것은 하나 — 붙여넣기가 사라지거나 까닭 없이 흐려지는 일이 없어야 한다.
 */

/** 키를 그대로 돌려주는 t — 라벨이 어느 키에서 왔는지 그대로 확인한다. */
const t = (key: string): string => key;

function handlers(): TextFieldMenuHandlers {
  return { cut: vi.fn(), copy: vi.fn(), paste: vi.fn(), selectAll: vi.fn() };
}

function find(items: ContextMenuItem[], id: string): ContextMenuItem {
  const found = items.find((i) => i.id === id);
  if (!found) throw new Error(`메뉴에 ${id} 가 없다`);
  return found;
}

describe('buildTextFieldMenuItems', () => {
  it('네 항목을 정해진 차례로 낸다', () => {
    const items = buildTextFieldMenuItems({ hasSelection: true, readOnly: false }, handlers(), t);
    expect(items.map((i) => i.id)).toEqual(['cut', 'copy', 'paste', 'selectAll']);
  });

  it('고른 글자가 없으면 잘라내기·복사만 흐려지고, 붙여넣기·전체 선택은 살아 있다', () => {
    const items = buildTextFieldMenuItems({ hasSelection: false, readOnly: false }, handlers(), t);
    expect(find(items, 'cut').disabled).toBe(true);
    expect(find(items, 'copy').disabled).toBe(true);
    // 빈 칸에 붙여넣는 것이 이 메뉴의 본래 목적이다 — 여기서 흐려지면 존재 이유가 없다.
    expect(find(items, 'paste').disabled).toBe(false);
    expect(find(items, 'selectAll').disabled).toBeUndefined();
  });

  it('흐려진 항목에는 까닭이 붙는다 (이유 없는 회색은 고장으로 읽힌다)', () => {
    const items = buildTextFieldMenuItems({ hasSelection: false, readOnly: false }, handlers(), t);
    expect(find(items, 'cut').disabledTitle).toBe('ide.editor.ctx.needSelection');
    expect(find(items, 'copy').disabledTitle).toBe('ide.editor.ctx.needSelection');
  });

  it('고른 글자가 있으면 넷 다 눌린다', () => {
    const items = buildTextFieldMenuItems({ hasSelection: true, readOnly: false }, handlers(), t);
    expect(find(items, 'cut').disabled).toBe(false);
    expect(find(items, 'copy').disabled).toBe(false);
    expect(find(items, 'paste').disabled).toBe(false);
  });

  it('읽기 전용이면 글자를 바꾸는 항목만 흐려진다 — 복사는 남는다', () => {
    const items = buildTextFieldMenuItems(
      { hasSelection: true, readOnly: true },
      handlers(),
      t,
      '왜 못 고치는지',
    );
    expect(find(items, 'cut').disabled).toBe(true);
    expect(find(items, 'cut').disabledTitle).toBe('왜 못 고치는지');
    expect(find(items, 'paste').disabled).toBe(true);
    expect(find(items, 'paste').disabledTitle).toBe('왜 못 고치는지');
    expect(find(items, 'copy').disabled).toBe(false);
  });

  it('라벨은 모두 t 로 만든다 (하드코딩이면 언어 전환이 안 따라온다)', () => {
    const items = buildTextFieldMenuItems({ hasSelection: true, readOnly: false }, handlers(), t);
    for (const item of items) expect(item.label).toMatch(/^ide\.editor\.ctx\./);
  });

  it('누르면 그 손잡이가 불린다', () => {
    const h = handlers();
    const items = buildTextFieldMenuItems({ hasSelection: true, readOnly: false }, h, t);
    for (const id of ['cut', 'copy', 'paste', 'selectAll'] as const) {
      find(items, id).onClick();
      expect(h[id]).toHaveBeenCalledTimes(1);
    }
  });
});

describe('spliceValue', () => {
  it('고른 범위를 갈아 끼우고 caret 을 끝에 둔다', () => {
    expect(spliceValue('abcdef', 2, 4, 'XY')).toEqual({ value: 'abXYef', caret: 4 });
  });

  it('빈 글자를 끼우면 잘라내기가 된다', () => {
    expect(spliceValue('abcdef', 2, 4, '')).toEqual({ value: 'abef', caret: 2 });
  });

  it('caret 만 있으면(범위 0) 그 자리에 끼운다', () => {
    expect(spliceValue('abc', 3, 3, '!')).toEqual({ value: 'abc!', caret: 4 });
  });

  it('뒤집힌 범위도 바로잡는다 (드래그 방향이 거꾸로였을 때)', () => {
    expect(spliceValue('abcdef', 4, 2, 'XY')).toEqual({ value: 'abXYef', caret: 4 });
  });

  it('값 밖으로 나간 범위는 잘라서 쓴다 (우클릭 뒤 값이 짧아졌을 때)', () => {
    expect(spliceValue('abc', 1, 99, 'Z')).toEqual({ value: 'aZ', caret: 2 });
    expect(spliceValue('abc', -5, 1, 'Z')).toEqual({ value: 'Zbc', caret: 1 });
  });
});

describe('shouldOpenTextFieldMenu — 전역이 어디에 뜨는가', () => {
  it('textarea 와 평범한 input 에는 뜬다', () => {
    expect(shouldOpenTextFieldMenu({ tagName: 'TEXTAREA' })).toBe(true);
    expect(shouldOpenTextFieldMenu({ tagName: 'INPUT' })).toBe(true);
    expect(shouldOpenTextFieldMenu({ tagName: 'INPUT', type: 'text' })).toBe(true);
  });

  it('글자를 치는 유형이면 text 가 아니어도 뜬다 (여기서 못 붙여넣으면 막다른 길이다)', () => {
    for (const type of ['password', 'email', 'search', 'url', 'tel', 'number', 'date']) {
      expect(shouldOpenTextFieldMenu({ tagName: 'INPUT', type })).toBe(true);
    }
  });

  it('글자를 치는 칸이 아니면 뜨지 않는다', () => {
    for (const type of ['checkbox', 'radio', 'color', 'file', 'range', 'hidden', 'button', 'submit', 'reset', 'image']) {
      expect(shouldOpenTextFieldMenu({ tagName: 'INPUT', type })).toBe(false);
    }
  });

  it('input·textarea 가 아니면 뜨지 않는다 (본문 글자 선택은 이 메뉴의 몫이 아니다)', () => {
    for (const tagName of ['DIV', 'SPAN', 'PRE', 'BUTTON', 'SELECT', 'CANVAS']) {
      expect(shouldOpenTextFieldMenu({ tagName })).toBe(false);
    }
  });

  it('이미 자기 메뉴를 가진 자리에서는 비켜선다 (IDE 입력창·편집창·터미널)', () => {
    expect(shouldOpenTextFieldMenu({ tagName: 'TEXTAREA', ownsMenu: true })).toBe(false);
    expect(shouldOpenTextFieldMenu({ tagName: 'INPUT', type: 'text', ownsMenu: true })).toBe(false);
  });

  it('비활성 칸에서는 뜨지 않는다', () => {
    expect(shouldOpenTextFieldMenu({ tagName: 'INPUT', type: 'text', disabled: true })).toBe(false);
  });

  it('태그명·유형의 대소문자에 걸리지 않는다 (DOM 이 주는 값이 늘 대문자라는 보장은 없다)', () => {
    expect(shouldOpenTextFieldMenu({ tagName: 'textarea' })).toBe(true);
    expect(shouldOpenTextFieldMenu({ tagName: 'input', type: 'TEXT' })).toBe(true);
    expect(shouldOpenTextFieldMenu({ tagName: 'input', type: 'CHECKBOX' })).toBe(false);
  });
});
