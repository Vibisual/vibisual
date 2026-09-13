import { describe, it, expect, beforeEach } from 'vitest';
import {
  useLinkFocusStore,
  setLinkModifierHeld,
  focusLinkGroup,
  clearLinkHover,
  clearLinkFocus,
  releaseLinkGrab,
  promoteLinkGrab,
  currentLinkGroup,
  currentLinkPhase,
  isLinkModifierHeld,
} from './linkFocus.js';
import type { LinkEdgeRef } from '../components/BubbleMap/linkedBubbles.js';

const EDGES: LinkEdgeRef[] = [
  { id: 'e1', source: 'agent', target: 'folderA' },
  { id: 'e2', source: 'other', target: 'folderB' },
];

beforeEach(() => {
  useLinkFocusStore.setState({ modifierHeld: false, phase: 'off', group: null });
});

describe('linkFocus 스토어', () => {
  it('처음에는 아무것도 잡혀 있지 않다', () => {
    expect(currentLinkPhase()).toBe('off');
    expect(currentLinkGroup()).toBeNull();
    expect(isLinkModifierHeld()).toBe(false);
  });

  it('무리를 잡으면 단계와 무리가 함께 선다', () => {
    focusLinkGroup('agent', EDGES, [], 'hover');
    expect(currentLinkPhase()).toBe('hover');
    expect(currentLinkGroup()?.focusId).toBe('agent');
    expect(currentLinkGroup()?.nodeIds.has('folderA')).toBe(true);
  });

  it('수식 키를 놓으면 미리보기는 사라진다', () => {
    setLinkModifierHeld(true);
    focusLinkGroup('agent', EDGES, [], 'hover');
    setLinkModifierHeld(false);
    expect(currentLinkPhase()).toBe('off');
    expect(currentLinkGroup()).toBeNull();
  });

  it('끌고 있는 중에 수식 키를 놓아도 무리는 흩어지지 않는다', () => {
    setLinkModifierHeld(true);
    focusLinkGroup('agent', EDGES, [], 'grab');
    setLinkModifierHeld(false);
    expect(currentLinkPhase()).toBe('grab');
    expect(currentLinkGroup()?.focusId).toBe('agent');
  });

  it('clearHover 는 확정(grab)을 건드리지 않는다', () => {
    focusLinkGroup('agent', EDGES, [], 'grab');
    clearLinkHover('agent');
    expect(currentLinkPhase()).toBe('grab');
  });

  it('다른 버블에서 온 늦은 leave 는 지금 미리보기를 끄지 않는다', () => {
    focusLinkGroup('agent', EDGES, [], 'hover');
    clearLinkHover('someoneElse'); // 이미 다른 버블로 옮겨 간 뒤 도착한 leave
    expect(currentLinkPhase()).toBe('hover');
    clearLinkHover('agent');
    expect(currentLinkPhase()).toBe('off');
  });

  it('드래그가 끝나면 — 키를 쥐고 있으면 미리보기로 내려앉는다', () => {
    setLinkModifierHeld(true);
    focusLinkGroup('agent', EDGES, [], 'grab');
    releaseLinkGrab();
    expect(currentLinkPhase()).toBe('hover');
    expect(currentLinkGroup()?.focusId).toBe('agent'); // 연달아 옮기는 손이 끊기지 않게
  });

  it('드래그가 끝나면 — 키를 놓았으면 걷는다', () => {
    setLinkModifierHeld(true);
    focusLinkGroup('agent', EDGES, [], 'grab');
    setLinkModifierHeld(false);
    releaseLinkGrab();
    expect(currentLinkPhase()).toBe('off');
    expect(currentLinkGroup()).toBeNull();
  });

  it('누르면 미리보기가 확정으로 오른다 — 무리는 다시 계산하지 않는다', () => {
    focusLinkGroup('agent', EDGES, [], 'hover');
    const groupBefore = currentLinkGroup();
    promoteLinkGrab('agent');
    expect(currentLinkPhase()).toBe('grab');
    expect(currentLinkGroup()).toBe(groupBefore); // 같은 무리 객체 그대로
  });

  it('다른 버블 id 로는 올라가지 않는다', () => {
    focusLinkGroup('agent', EDGES, [], 'hover');
    promoteLinkGrab('other');
    expect(currentLinkPhase()).toBe('hover');
  });

  it('잡힌 무리가 없으면 승격은 무동작 — 그 경우는 드래그가 새로 잡는다', () => {
    promoteLinkGrab('agent');
    expect(currentLinkPhase()).toBe('off');
    expect(currentLinkGroup()).toBeNull();
  });

  it('clear 는 단계와 무관하게 전부 걷는다(ESC·창 blur)', () => {
    focusLinkGroup('agent', EDGES, [], 'grab');
    clearLinkFocus();
    expect(currentLinkPhase()).toBe('off');
    expect(currentLinkGroup()).toBeNull();
  });

  it('같은 중심·같은 단계를 다시 잡으면 상태 객체가 그대로다 — 헛리렌더 ❌', () => {
    focusLinkGroup('agent', EDGES, [], 'hover');
    const before = useLinkFocusStore.getState();
    focusLinkGroup('agent', EDGES, [], 'hover');
    expect(useLinkFocusStore.getState()).toBe(before);
  });

  it('같은 값의 수식 키 재신고도 상태를 새로 만들지 않는다', () => {
    setLinkModifierHeld(true);
    const before = useLinkFocusStore.getState();
    setLinkModifierHeld(true);
    expect(useLinkFocusStore.getState()).toBe(before);
  });
});
