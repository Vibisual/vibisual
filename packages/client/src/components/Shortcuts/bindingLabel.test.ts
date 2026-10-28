/**
 * 표기: `Alt+Digit` → `Alt+1…0` · mac 은 `formatShortcut()` 그대로 · 모디파이어가 같은 묶음만 한 덩어리, 하나라도 바뀌면 따로
 * (꼬리를 떼는 문자열 수술이라 깨지기 쉬운 자리다).
 */
import { describe, it, expect } from 'vitest';
import { bindingLabel, bindingParts, groupBindingLabel } from './bindingLabel.js';

describe('bindingLabel — 한 조합', () => {
  it('자리표를 범위 표기로 편다', () => {
    expect(bindingLabel('Alt+Digit', false)).toBe('Alt+1…0');
    expect(bindingLabel('Ctrl+Digit1To9', false)).toBe('Ctrl+1…9');
  });

  it('mac 은 기호로, Apple 순서로', () => {
    expect(bindingLabel('Ctrl+Shift+C', true)).toBe('⇧⌘C');
    // `Control` 은 mac 에서도 진짜 Control 이다 — ⌘ 로 접지 않는다(#17-37 ③).
    expect(bindingLabel('Control+Tab', true)).toBe('⌃⇥');
  });

  it('해제된 명령은 빈 문자열 — 빈 키캡을 그리지 않는다', () => {
    expect(bindingLabel(null, false)).toBe('');
    expect(bindingLabel(undefined, false)).toBe('');
  });

  it('읽을 수 없는 값은 원문 그대로 — 조용히 삼키지 않는다', () => {
    expect(bindingLabel('완전히 아닌 것', false)).toBe('완전히 아닌 것');
  });
});

describe('bindingParts — 키캡 칸 나누기', () => {
  it('win/linux 는 칸마다 쪼갠다', () => {
    expect(bindingParts('Ctrl+Shift+C', false)).toEqual(['Ctrl', 'Shift', 'C']);
  });

  it('끝에 붙은 `+` 는 키 자체다 — 쪼개지 않는다', () => {
    expect(bindingParts('Ctrl++', false)).toEqual(['Ctrl', '+']);
  });

  it('mac 은 기호를 붙여 쓰는 것이 관례라 한 칸이다', () => {
    expect(bindingParts('Ctrl+Shift+C', true)).toEqual(['⇧⌘C']);
  });
});

describe('groupBindingLabel — 여러 조합 한 덩어리', () => {
  const ARROWS = ['Ctrl+Alt+Left', 'Ctrl+Alt+Right', 'Ctrl+Alt+Up', 'Ctrl+Alt+Down'];

  it('모디파이어가 같으면 붙여 쓴다', () => {
    expect(groupBindingLabel(ARROWS, false)).toBe('Ctrl+Alt+←→↑↓');
  });

  it('mac 에서도 기호 한 벌 + 키만 이어 붙인다', () => {
    expect(groupBindingLabel(ARROWS, true)).toBe('⌥⌘←→↑↓');
  });

  it('하나라도 다르게 바뀌면 따로 나열한다 — 없는 조합을 지어내지 않는다', () => {
    const mixed = ['Ctrl+Alt+Left', 'Shift+Right'];
    expect(groupBindingLabel(mixed, false)).toBe('Ctrl+Alt+←/Shift+→'.replace('/', ' / '));
  });

  it('해제된 것은 빼고 센다', () => {
    expect(groupBindingLabel(['Ctrl+Alt+Left', null, undefined], false)).toBe('Ctrl+Alt+←');
    expect(groupBindingLabel([null, null], false)).toBe('');
  });

  it('모디파이어가 아예 없는 묶음도 붙여 쓴다', () => {
    expect(groupBindingLabel(['Left', 'Right'], false)).toBe('←→');
  });
});
