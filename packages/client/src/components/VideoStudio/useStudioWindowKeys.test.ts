import { describe, expect, it } from 'vitest';

import { releasesFocus, studioOwnsKey, type KeyScopeNode, type StudioKeyScope } from './useStudioWindowKeys.js';

const node = (...inside: unknown[]): KeyScopeNode => ({ contains: (other: unknown) => inside.includes(other) });

const IN_ROOT = { name: 'preview' };
const IN_SLOT = { name: 'header title' };
const MAXIMIZE = { name: 'maximize button' };
const BODY = { name: 'body' };
const ELSEWHERE = { name: 'canvas' };

const root = node(IN_ROOT);
const slot = node(IN_SLOT);
const frame = node(IN_ROOT, IN_SLOT, MAXIMIZE);

function scope(over: Partial<StudioKeyScope>): StudioKeyScope {
  return { key: ' ', target: MAXIMIZE, root, frame, slot, unfocused: false, active: true, hosted: false, fullscreen: false, ...over };
}

describe('누른 컨트롤의 초점 돌려주기 (§5.13 37-24 (D-2))', () => {
  /** 조상에 그 꼬리표들이 있는 듯 답하는 흉내 요소(`input` 은 종류를 함께 준다). */
  const el = (tags: readonly string[], type?: string) => ({
    closest: (selector: string) => (selector.split(',').some((s) => tags.includes(s)) ? { type } : null),
  });

  it('포인터로 누른 단추·슬라이더·체크 칸은 돌려준다', () => {
    expect(releasesFocus(el(['button']), 'pointer')).toBe(true);
    expect(releasesFocus(el(['input'], 'range'), 'pointer')).toBe(true);
    expect(releasesFocus(el(['input'], 'checkbox'), 'pointer')).toBe(true);
  });

  it('글자 칸은 돌려주지 않는다', () => {
    expect(releasesFocus(el(['input'], 'text'), 'pointer')).toBe(false);
    expect(releasesFocus(el(['textarea']), 'pointer')).toBe(false);
    expect(releasesFocus(el(['[contenteditable="true"]']), 'pointer')).toBe(false);
  });

  it('선택 상자는 값을 고른 뒤에만 돌려준다 — 펼친 동안에는 초점이 있어야 한다', () => {
    expect(releasesFocus(el(['select']), 'pointer')).toBe(false);
    expect(releasesFocus(el(['select']), 'change')).toBe(true);
  });

  it('대화상자·메뉴·목록 안과 컨트롤이 아닌 곳은 건드리지 않는다', () => {
    for (const keep of ['[role="dialog"]', '[role="menu"]', '[role="listbox"]']) expect(releasesFocus(el(['button', keep]), 'pointer'), keep).toBe(false);
    expect(releasesFocus(el(['select', '[role="dialog"]']), 'change')).toBe(false);
    expect(releasesFocus(el(['div']), 'pointer')).toBe(false);
    expect(releasesFocus(null, 'pointer')).toBe(false);
  });
});

describe('창 수준 스튜디오 키 (§5.13 37-24 (D))', () => {
  it('창 틀 단추에 초점이 있어도 받는다', () => {
    expect(studioOwnsKey(scope({ target: MAXIMIZE }))).toBe(true);
    // 다른 창을 마지막으로 눌렀어도 초점이 이 창 틀에 있으면 이 창의 키다.
    expect(studioOwnsKey(scope({ target: MAXIMIZE, active: false }))).toBe(true);
  });

  it('뿌리 안·머리줄 자리의 키는 종전 길이 받으니 다시 받지 않는다', () => {
    expect(studioOwnsKey(scope({ target: IN_ROOT }))).toBe(false);
    expect(studioOwnsKey(scope({ target: IN_SLOT }))).toBe(false);
    expect(studioOwnsKey(scope({ target: IN_ROOT, fullscreen: true }))).toBe(false);
  });

  it('초점이 아무 데도 없으면 마지막으로 누른 곳이 이 창일 때만 받는다', () => {
    expect(studioOwnsKey(scope({ target: BODY, unfocused: true, active: true }))).toBe(true);
    expect(studioOwnsKey(scope({ target: BODY, unfocused: true, active: false }))).toBe(false);
  });

  it('다른 곳(캔버스·다른 창)에 초점이 있으면 받지 않는다', () => {
    expect(studioOwnsKey(scope({ target: ELSEWHERE }))).toBe(false);
  });

  it('Esc 는 넘기지 않는다', () => {
    expect(studioOwnsKey(scope({ key: 'Escape' }))).toBe(false);
    expect(studioOwnsKey(scope({ key: 'Escape', fullscreen: true, target: BODY, unfocused: true }))).toBe(false);
  });

  it('본창 안에 얹혔는데 창 틀이 없으면 창 수준에서 받지 않는다(전체 화면일 때만)', () => {
    expect(studioOwnsKey(scope({ frame: null, slot: null, hosted: true, target: BODY, unfocused: true }))).toBe(false);
    expect(studioOwnsKey(scope({ frame: null, slot: null, hosted: true, fullscreen: true, target: BODY, unfocused: true }))).toBe(true);
  });

  it('단독 OS 창은 창 전체가 이 스튜디오다', () => {
    expect(studioOwnsKey(scope({ frame: null, slot: null, target: BODY, unfocused: true, active: false }))).toBe(true);
    expect(studioOwnsKey(scope({ frame: null, slot: null, target: ELSEWHERE }))).toBe(true);
  });
});
