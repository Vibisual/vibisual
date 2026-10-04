import { describe, expect, it } from 'vitest';
import { applyAutoCompactFloor, COMPACT_FLOOR_SIBLING_SCAN, type SubAgent } from '@vibisual/shared';
import { pickCompactFloorSource } from './compactFloor.js';

/**
 * §4 (CLI 사양 추종) (5) 창 하한 — 설정창·상태바가 적는 압축 창이 **서버 턴 경계 판정이 쓰는 창**과 같아야
 * 한다. 고르는 순서가 어긋나면 화면은 400k 라는데 명령 사이 압축은 200k 기준으로 걸린다.
 */
const sub = (id: string, lastActivityAt: number, floor?: number, max?: number): SubAgent => ({
  id, parentAgentId: 'agent', sessionId: id, label: id, status: 'active', createdAt: 1, lastActivityAt,
  ...(floor !== undefined ? { contextFloor: floor } : {}),
  ...(max !== undefined ? { contextMax: max } : {}),
});

describe('pickCompactFloorSource — the viewed session first, then the agent\'s recent sessions', () => {
  it('prefers the session being viewed', () => {
    const subs = [sub('a', 100, 70_656, 1_000_000), sub('b', 900, 30_000, 1_000_000)];
    expect(pickCompactFloorSource(subs, 'a')).toEqual({ floor: 70_656, contextMax: 1_000_000 });
  });

  it('borrows from the most recent sibling when the session has no answer yet', () => {
    const subs = [sub('new', 1_000), sub('old', 100, 50_000), sub('recent', 900, 70_656, 1_000_000)];
    expect(pickCompactFloorSource(subs, 'new')).toEqual({ floor: 70_656, contextMax: 1_000_000 });
  });

  it('without a session, the most recent session with a floor wins', () => {
    const subs = [sub('old', 100, 50_000), sub('recent', 900, 70_656)];
    expect(pickCompactFloorSource(subs)).toEqual({ floor: 70_656, contextMax: null });
  });

  it('looks only at the few most recent siblings, like the server', () => {
    const recent = Array.from({ length: COMPACT_FLOOR_SIBLING_SCAN }, (_, i) => sub(`r${i}`, 1_000 + i));
    expect(pickCompactFloorSource([...recent, sub('ancient', 1, 70_656)], null)).toBeNull();
  });

  it('returns null without evidence', () => {
    expect(pickCompactFloorSource(undefined)).toBeNull();
    expect(pickCompactFloorSource([])).toBeNull();
    expect(pickCompactFloorSource([sub('a', 1, 0)], 'a')).toBeNull();
  });

  it('an unknown model window stays null, so the floor is not capped by a guess', () => {
    expect(pickCompactFloorSource([sub('a', 1, 70_656)], 'a')).toEqual({ floor: 70_656, contextMax: null });
  });

  it('feeds the shared floor function: the incident session shows 400k, not 200k', () => {
    const src = pickCompactFloorSource([sub('a', 1, 70_656, 1_000_000)], 'a')!;
    expect(applyAutoCompactFloor('200000', src.floor, src.contextMax)).toEqual({ value: '400000', raisedFrom: '200000' });
  });
});
