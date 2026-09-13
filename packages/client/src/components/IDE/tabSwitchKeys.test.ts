/**
 * tabSwitchKeys.test.ts — §5.5 #17-37 세션 탭 전환 고정.
 *
 * 여기서 지키는 것은 넷이다:
 *  ① 기본 배정이 다른 기능(§5.4 #30 북마크 · #17-1 창 배치)과 겹치지 않는다,
 *  ② mac 에서 `⌘Tab` 이 아니라 `⌃Tab` 이다,
 *  ③ `9` 는 "아홉 번째"가 아니라 **마지막**이다,
 *  ④ 갈 곳이 없거나 제자리면 **아무 일도 하지 않는다**.
 *
 * ⚠ ①②는 이제 **§6 단축키 레지스트리의 기본값**이 정한다(키를 읽는 코드는 이 파일에 없다).
 * 그래서 여기서는 `COMMANDS` 의 기본 바인딩과 `matchesBinding` 으로 그 성질을 확인한다 —
 * 사용자가 키를 바꾸면 이 배정도 함께 바뀌는 것이 **의도된 동작**이다.
 */
import { describe, it, expect } from 'vitest';
import { COMMANDS, matchesBinding, type KeyEventLike } from '@vibisual/shared';
import {
  tabSwitchIntentOf, applyTabSwitch,
  type TabKey,
} from './tabSwitchKeys.js';

const key = (over: Partial<KeyEventLike> & { code: string }): KeyEventLike => ({
  ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...over,
});

/** 그 명령의 **기본** 바인딩이 이 이벤트를 받는가. */
function hits(id: keyof typeof COMMANDS, e: KeyEventLike): boolean {
  return matchesBinding(e, COMMANDS[id].defaultBinding);
}

describe('기본 배정 — 레지스트리가 정하는 키', () => {
  it('Ctrl+Tab 은 다음, Ctrl+Shift+Tab 은 이전', () => {
    expect(hits('ide.tabNext', key({ code: 'Tab', ctrlKey: true }))).toBe(true);
    expect(hits('ide.tabPrev', key({ code: 'Tab', ctrlKey: true, shiftKey: true }))).toBe(true);
    // 서로를 받지 않는다 — Shift 유무가 두 명령을 가른다.
    expect(hits('ide.tabNext', key({ code: 'Tab', ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(hits('ide.tabPrev', key({ code: 'Tab', ctrlKey: true }))).toBe(false);
  });

  it('맨 Tab 은 우리 것이 아니다 — 편집창 들여쓰기·포커스 이동을 뺏지 않는다', () => {
    expect(hits('ide.tabNext', key({ code: 'Tab' }))).toBe(false);
    expect(hits('ide.tabPrev', key({ code: 'Tab', shiftKey: true }))).toBe(false);
  });

  it('#17-37 ③ — Tab 은 mac 에서도 진짜 Control 이다(⌘Tab 은 OS 앱 전환)', () => {
    expect(hits('ide.tabNext', key({ code: 'Tab', metaKey: true }))).toBe(false);
    expect(hits('ide.tabPrev', key({ code: 'Tab', metaKey: true, shiftKey: true }))).toBe(false);
  });

  it('PageDown/PageUp 은 같은 동작의 별칭 — mac 의 ⌘ 도 함께 받는다', () => {
    expect(hits('ide.tabNextAlt', key({ code: 'PageDown', ctrlKey: true }))).toBe(true);
    expect(hits('ide.tabPrevAlt', key({ code: 'PageUp', ctrlKey: true }))).toBe(true);
    expect(hits('ide.tabNextAlt', key({ code: 'PageDown', metaKey: true }))).toBe(true);
    expect(hits('ide.tabPrevAlt', key({ code: 'PageUp', metaKey: true }))).toBe(true);
  });

  it('Shift 가 낀 PageDown 은 비켜선다 — 브라우저에서 그것은 "탭 옮기기"다', () => {
    expect(hits('ide.tabNextAlt', key({ code: 'PageDown', ctrlKey: true, shiftKey: true }))).toBe(false);
  });

  it('Ctrl+1~9 는 우리 것, Ctrl+0 은 아니다 — 0 번째 탭이라는 것은 없다', () => {
    expect(hits('ide.tabNth', key({ code: 'Digit1', ctrlKey: true }))).toBe(true);
    expect(hits('ide.tabNth', key({ code: 'Digit9', metaKey: true }))).toBe(true);
    expect(hits('ide.tabNth', key({ code: 'Numpad3', ctrlKey: true }))).toBe(true);
    expect(hits('ide.tabNth', key({ code: 'Digit0', ctrlKey: true }))).toBe(false);
  });

  it('#17-37 ② — 북마크·창 배치와 겹치지 않는다(맨 숫자 · Alt+숫자 · Ctrl+Alt 조합)', () => {
    // §5.4 #30 — 맨 숫자는 북마크 점프, Alt+숫자는 북마크 지정.
    expect(hits('ide.tabNth', key({ code: 'Digit3' }))).toBe(false);
    expect(hits('ide.tabNth', key({ code: 'Digit3', altKey: true }))).toBe(false);
    // #17-1 — Ctrl+Alt 는 창 배치(그리고 유럽 자판의 AltGr)의 것이다.
    expect(hits('ide.tabNth', key({ code: 'Digit3', ctrlKey: true, altKey: true }))).toBe(false);
    expect(hits('ide.tabNext', key({ code: 'Tab', ctrlKey: true, altKey: true }))).toBe(false);
  });
});

describe('tabSwitchIntentOf — 명령을 뜻으로', () => {
  it('다음/이전은 별칭까지 같은 뜻이다', () => {
    expect(tabSwitchIntentOf('ide.tabNext')).toEqual({ kind: 'cycle', delta: 1 });
    expect(tabSwitchIntentOf('ide.tabNextAlt')).toEqual({ kind: 'cycle', delta: 1 });
    expect(tabSwitchIntentOf('ide.tabPrev')).toEqual({ kind: 'cycle', delta: -1 });
    expect(tabSwitchIntentOf('ide.tabPrevAlt')).toEqual({ kind: 'cycle', delta: -1 });
  });

  it('1~8 은 N번째, 9 는 마지막', () => {
    expect(tabSwitchIntentOf('ide.tabNth', 1)).toEqual({ kind: 'index', index: 0 });
    expect(tabSwitchIntentOf('ide.tabNth', 8)).toEqual({ kind: 'index', index: 7 });
    expect(tabSwitchIntentOf('ide.tabNth', 9)).toEqual({ kind: 'last' });
  });

  it('숫자가 없거나 범위 밖이면 아무 뜻도 아니다', () => {
    expect(tabSwitchIntentOf('ide.tabNth')).toBeNull();
    expect(tabSwitchIntentOf('ide.tabNth', 0)).toBeNull();
    expect(tabSwitchIntentOf('ide.tabNth', 10)).toBeNull();
    expect(tabSwitchIntentOf('ide.tabNth', 1.5)).toBeNull();
  });
});

describe('applyTabSwitch — 뜻을 탭 순서에', () => {
  const order: TabKey[] = [null, 'a', 'b', 'c'];

  it('순환은 나열순으로 돌고 끝에서 이어진다', () => {
    expect(applyTabSwitch(order, 'a', { kind: 'cycle', delta: 1 })).toEqual({ target: 'b' });
    expect(applyTabSwitch(order, 'c', { kind: 'cycle', delta: 1 })).toEqual({ target: null });
    expect(applyTabSwitch(order, null, { kind: 'cycle', delta: -1 })).toEqual({ target: 'c' });
  });

  it('마지막은 언제나 마지막 탭이다 — 탭이 셋이어도', () => {
    expect(applyTabSwitch(['a', 'b', 'c'], 'a', { kind: 'last' })).toEqual({ target: 'c' });
  });

  it('없는 자리로의 직행은 아무 일도 하지 않는다', () => {
    expect(applyTabSwitch(['a', 'b'], 'a', { kind: 'index', index: 4 })).toBeNull();
  });

  it('제자리면 아무 일도 하지 않는다', () => {
    expect(applyTabSwitch(order, 'b', { kind: 'index', index: 2 })).toBeNull();
    expect(applyTabSwitch(['a'], 'a', { kind: 'cycle', delta: 1 })).toBeNull();
  });

  it('탭이 없으면 아무 일도 하지 않는다', () => {
    expect(applyTabSwitch([], null, { kind: 'cycle', delta: 1 })).toBeNull();
  });
});
