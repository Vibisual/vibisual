import { describe, expect, it } from 'vitest';

import { studioOwnsKey, type KeyScopeNode, type StudioKeyScope } from './useStudioWindowKeys.js';

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
