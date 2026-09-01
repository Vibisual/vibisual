/**
 * tabSwitchKeys.test.ts — §5.5 #17-37 세션 탭 전환 단축키 판정 고정.
 *
 * 여기서 지키는 것은 셋이다: ① 배정이 다른 기능(§5.4 #30 북마크 · #17-1 창 배치)과 겹치지 않는다,
 * ② mac 에서 `⌘Tab` 이 아니라 `⌃Tab` 이다, ③ 갈 곳이 없거나 제자리면 **아무 일도 하지 않는다**.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveTabSwitchIntent, applyTabSwitch,
  type TabKey, type TabSwitchKeyLike,
} from './tabSwitchKeys.js';

const key = (over: Partial<TabSwitchKeyLike> & { code: string }): TabSwitchKeyLike => ({
  ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...over,
});

describe('resolveTabSwitchIntent — 키를 뜻으로', () => {
  it('Ctrl+Tab 은 다음, Ctrl+Shift+Tab 은 이전', () => {
    expect(resolveTabSwitchIntent(key({ code: 'Tab', ctrlKey: true })))
      .toEqual({ kind: 'cycle', delta: 1 });
    expect(resolveTabSwitchIntent(key({ code: 'Tab', ctrlKey: true, shiftKey: true })))
      .toEqual({ kind: 'cycle', delta: -1 });
  });

  it('맨 Tab 은 우리 것이 아니다 — 편집창 들여쓰기·포커스 이동을 뺏지 않는다', () => {
    expect(resolveTabSwitchIntent(key({ code: 'Tab' }))).toBeNull();
    expect(resolveTabSwitchIntent(key({ code: 'Tab', shiftKey: true }))).toBeNull();
  });

  it('#17-37 ③ — Tab 은 mac 에서도 진짜 Control 이다(⌘Tab 은 OS 앱 전환)', () => {
    expect(resolveTabSwitchIntent(key({ code: 'Tab', metaKey: true }))).toBeNull();
    expect(resolveTabSwitchIntent(key({ code: 'Tab', metaKey: true, shiftKey: true }))).toBeNull();
  });

  it('PageDown/PageUp 은 같은 동작의 별칭 — mac 의 ⌘ 도 함께 받는다', () => {
    expect(resolveTabSwitchIntent(key({ code: 'PageDown', ctrlKey: true })))
      .toEqual({ kind: 'cycle', delta: 1 });
    expect(resolveTabSwitchIntent(key({ code: 'PageUp', ctrlKey: true })))
      .toEqual({ kind: 'cycle', delta: -1 });
    expect(resolveTabSwitchIntent(key({ code: 'PageDown', metaKey: true })))
      .toEqual({ kind: 'cycle', delta: 1 });
    expect(resolveTabSwitchIntent(key({ code: 'PageUp', metaKey: true })))
      .toEqual({ kind: 'cycle', delta: -1 });
  });

  it('Shift 가 낀 PageDown 은 비켜선다 — 브라우저에서 그것은 "탭 옮기기"다', () => {
    expect(resolveTabSwitchIntent(key({ code: 'PageDown', ctrlKey: true, shiftKey: true }))).toBeNull();
  });

  it('Ctrl+1~8 은 N번째, Ctrl+9 는 마지막 — 숫자패드도 같다', () => {
    expect(resolveTabSwitchIntent(key({ code: 'Digit1', ctrlKey: true })))
      .toEqual({ kind: 'index', index: 0 });
    expect(resolveTabSwitchIntent(key({ code: 'Digit8', metaKey: true })))
      .toEqual({ kind: 'index', index: 7 });
    expect(resolveTabSwitchIntent(key({ code: 'Digit9', ctrlKey: true })))
      .toEqual({ kind: 'last' });
    expect(resolveTabSwitchIntent(key({ code: 'Numpad3', ctrlKey: true })))
      .toEqual({ kind: 'index', index: 2 });
    expect(resolveTabSwitchIntent(key({ code: 'Numpad9', ctrlKey: true })))
      .toEqual({ kind: 'last' });
  });

  it('#17-37 ② — 북마크·창 배치와 겹치지 않는다(맨 숫자 · Alt+숫자 · Ctrl+Alt 조합)', () => {
    // §5.4 #30 — 맨 숫자는 북마크 점프, Alt+숫자는 북마크 지정.
    expect(resolveTabSwitchIntent(key({ code: 'Digit3' }))).toBeNull();
    expect(resolveTabSwitchIntent(key({ code: 'Digit3', altKey: true }))).toBeNull();
    // #17-1 — Ctrl+Alt 는 창 배치(그리고 유럽 자판의 AltGr)의 것이다.
    expect(resolveTabSwitchIntent(key({ code: 'Digit3', ctrlKey: true, altKey: true }))).toBeNull();
    expect(resolveTabSwitchIntent(key({ code: 'Tab', ctrlKey: true, altKey: true }))).toBeNull();
    expect(resolveTabSwitchIntent(key({ code: 'ArrowRight', ctrlKey: true, altKey: true }))).toBeNull();
  });

  it('Ctrl+0 은 우리 것이 아니다 — 0 번째 탭이라는 것은 없다', () => {
    expect(resolveTabSwitchIntent(key({ code: 'Digit0', ctrlKey: true }))).toBeNull();
  });

  it('상관없는 키는 전부 null', () => {
    expect(resolveTabSwitchIntent(key({ code: 'KeyW', ctrlKey: true }))).toBeNull();
    expect(resolveTabSwitchIntent(key({ code: 'Enter', ctrlKey: true }))).toBeNull();
    expect(resolveTabSwitchIntent(key({ code: 'F2' }))).toBeNull();
  });
});

describe('applyTabSwitch — 뜻을 탭 순서에', () => {
  const subs: readonly TabKey[] = ['a', 'b', 'c'];
  /** 훅 에이전트의 탭 줄 — 맨 앞이 메인 탭(세션 `null`). */
  const withMain: readonly TabKey[] = [null, 'a', 'b'];

  it('다음/이전으로 한 칸씩 돈다', () => {
    expect(applyTabSwitch(subs, 'a', { kind: 'cycle', delta: 1 })).toEqual({ target: 'b' });
    expect(applyTabSwitch(subs, 'b', { kind: 'cycle', delta: -1 })).toEqual({ target: 'a' });
  });

  it('끝에서 감긴다 — 마지막의 다음은 첫째, 첫째의 이전은 마지막', () => {
    expect(applyTabSwitch(subs, 'c', { kind: 'cycle', delta: 1 })).toEqual({ target: 'a' });
    expect(applyTabSwitch(subs, 'a', { kind: 'cycle', delta: -1 })).toEqual({ target: 'c' });
  });

  it('메인 탭(null)도 한 칸으로 센다 — "갈 곳 없음" 과 헷갈리지 않는다', () => {
    expect(applyTabSwitch(withMain, 'a', { kind: 'cycle', delta: -1 })).toEqual({ target: null });
    expect(applyTabSwitch(withMain, null, { kind: 'cycle', delta: 1 })).toEqual({ target: 'a' });
    expect(applyTabSwitch(withMain, null, { kind: 'index', index: 0 })).toBeNull(); // 제자리
  });

  it('N번째 직행 — 9(=last)는 언제나 마지막 탭', () => {
    expect(applyTabSwitch(subs, 'a', { kind: 'index', index: 2 })).toEqual({ target: 'c' });
    expect(applyTabSwitch(subs, 'a', { kind: 'last' })).toEqual({ target: 'c' });
    expect(applyTabSwitch(withMain, 'a', { kind: 'last' })).toEqual({ target: 'b' });
  });

  it('없는 자리·제자리·빈 목록·탭 하나는 아무 일도 하지 않는다', () => {
    expect(applyTabSwitch(subs, 'a', { kind: 'index', index: 5 })).toBeNull();
    expect(applyTabSwitch(subs, 'b', { kind: 'index', index: 1 })).toBeNull();
    expect(applyTabSwitch(subs, 'c', { kind: 'last' })).toBeNull();
    expect(applyTabSwitch([], 'a', { kind: 'cycle', delta: 1 })).toBeNull();
    expect(applyTabSwitch(['a'], 'a', { kind: 'cycle', delta: 1 })).toBeNull();
  });

  it('지금 탭이 목록에 없으면(닫히는 중) 끝에서 시작한다', () => {
    expect(applyTabSwitch(subs, 'zzz', { kind: 'cycle', delta: 1 })).toEqual({ target: 'a' });
    expect(applyTabSwitch(subs, 'zzz', { kind: 'cycle', delta: -1 })).toEqual({ target: 'c' });
  });
});
