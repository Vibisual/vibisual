import { describe, it, expect } from 'vitest';
import type { SubAgentStreamEvent } from '@vibisual/shared';
import { turnInsertIndex, insertEventInTurnOrder } from './turnOrder.js';

let seq = 0;
function ev(turnId: string | undefined, content = 'x'): SubAgentStreamEvent {
  seq += 1;
  return {
    id: `e${seq}`,
    subAgentId: 'sub-1',
    parentAgentId: 'agent-1',
    timestamp: seq,
    eventType: 'text',
    content,
    ...(turnId ? { turnId } : {}),
  };
}

const ids = (b: SubAgentStreamEvent[]): string[] => b.map((e) => e.id);

describe('turnInsertIndex — 줄은 제 턴 끝에 선다', () => {
  it('빈 버퍼면 맨 앞', () => {
    expect(turnInsertIndex([], ev('A'))).toBe(0);
  });

  it('같은 턴이 이어지면 그냥 꼬리 — 평소 흐름은 재배치가 없다', () => {
    const buf = [ev('A'), ev('A')];
    expect(turnInsertIndex(buf, ev('A'))).toBe(buf.length);
  });

  it('처음 보는 턴은 맨 끝 — 새 명령의 첫 줄', () => {
    const buf = [ev('A'), ev('A')];
    expect(turnInsertIndex(buf, ev('B'))).toBe(buf.length);
  });

  it('앞 턴의 늦은 줄은 그 턴의 마지막 뒤로 돌아간다', () => {
    const buf = [ev('A'), ev('A'), ev('B')];
    // A 의 마지막은 index 1 → 그 뒤(2)에 꽂혀 B 앞에 선다.
    expect(turnInsertIndex(buf, ev('A'))).toBe(2);
  });

  it('도장이 없는 줄은 종전대로 맨 끝 — 모르는 순서를 지어내지 않는다', () => {
    const buf = [ev('A'), ev('B')];
    expect(turnInsertIndex(buf, ev(undefined))).toBe(buf.length);
  });

  it('도장 없는 줄이 사이에 껴 있어도 제 턴을 찾아간다', () => {
    const buf = [ev('A'), ev(undefined), ev('B')];
    expect(turnInsertIndex(buf, ev('A'))).toBe(1);
  });
});

describe('insertEventInTurnOrder — 꼬리인지 재배치인지 알려 준다', () => {
  it('꼬리 추가는 재배치가 아니다(증분 파서 유지)', () => {
    const buf = [ev('A')];
    const late = ev('A');
    const r = insertEventInTurnOrder(buf, late);
    expect(r.reordered).toBe(false);
    expect(ids(r.buffer)).toEqual(['e' + (seq - 1), late.id]);
  });

  it('앞 턴으로 끼어들면 재배치로 신고한다', () => {
    const a1 = ev('A');
    const b1 = ev('B');
    const lateA = ev('A');
    const r = insertEventInTurnOrder([a1, b1], lateA);
    expect(r.reordered).toBe(true);
    expect(ids(r.buffer)).toEqual([a1.id, lateA.id, b1.id]);
  });

  it('중지 뒤 새 턴이 도는 중에 옛 백단 통지가 와도 새 턴 블록을 오염시키지 않는다', () => {
    // 턴 A(중지됨) 두 줄 → 턴 B 두 줄 → A 가 띄웠던 백단 작업의 끝 통지가 뒤늦게 도착.
    const a1 = ev('A'); const a2 = ev('A');
    const b1 = ev('B'); const b2 = ev('B');
    const lateNotice = ev('A', '[task_notification]');
    const r = insertEventInTurnOrder([a1, a2, b1, b2], lateNotice);
    expect(ids(r.buffer)).toEqual([a1.id, a2.id, lateNotice.id, b1.id, b2.id]);
    // 마지막 두 줄은 여전히 B 의 것 — 새 명령 블록이 남의 일을 떠안지 않는다.
    expect(r.buffer.slice(-2).every((e) => e.turnId === 'B')).toBe(true);
  });
});
