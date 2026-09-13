import { describe, expect, it } from 'vitest';
import { planSilentPreCompact, displayCommands, capSetSize } from '@vibisual/shared';
import type { PreCompactQueueItem } from '@vibisual/shared';

/**
 * §5.3 #9-1 (P) — **조용한 선행 압축**. 압축이 도는 자리를 "턴이 끝난 직후"에서 "다음 명령이
 * 나가기 직전"으로 옮긴 축이고, 사용자 화면에는 아무것도 드러나지 않는다.
 *
 * 그래서 이 파일이 유일한 안전망이다 — 끼어드는 자리가 틀리면 압축이 사용자 명령 **사이**에
 * 끼거나 두 벌로 끼는데, 둘 다 화면에 안 보이므로 눈으로는 영영 못 잡는다.
 */

function cmd(over: Partial<PreCompactQueueItem> & { id: string }): PreCompactQueueItem {
  return {
    text: '고쳐줘',
    status: 'queued',
    subAgentId: 'sub-1',
    ...over,
  };
}

describe('planSilentPreCompact — 어디에 끼는가', () => {
  it('표식이 없으면 아무 데도 끼지 않는다 — 이 기능을 안 쓰는 세션은 종전과 같다', () => {
    const plan = planSilentPreCompact([cmd({ id: 'a' })], new Set());
    expect(plan.slots).toEqual([]);
    expect(plan.drop).toEqual([]);
  });

  it('기다리는 첫 명령 **앞**에 선다', () => {
    const queue = [cmd({ id: 'a' }), cmd({ id: 'b' })];
    const plan = planSilentPreCompact(queue, new Set(['sub-1']));
    expect(plan.slots).toEqual([{ index: 0, subAgentId: 'sub-1', beforeCommandId: 'a' }]);
  });

  it('한 세션에 하나뿐 — 뒤엣것 앞에도 끼면 압축이 사용자 명령 사이에 낀다', () => {
    const queue = [cmd({ id: 'a' }), cmd({ id: 'b' }), cmd({ id: 'c' })];
    const plan = planSilentPreCompact(queue, new Set(['sub-1']));
    expect(plan.slots).toHaveLength(1);
  });

  it('이미 도는 세션에는 끼지 않는다 — 지금 나갈 자리가 아니다(표식은 남는다)', () => {
    const queue = [cmd({ id: 'a', status: 'executing' }), cmd({ id: 'b' })];
    const plan = planSilentPreCompact(queue, new Set(['sub-1']));
    expect(plan.slots).toEqual([]);
    expect(plan.drop).toEqual([]); // 버리지 않는다 — 그 턴이 끝나면 다시 이 판정을 지난다.
  });

  it('기다리는 명령이 하나도 없으면 끼지 않는다 — 끼울 앞자리가 없다', () => {
    const queue = [cmd({ id: 'a', status: 'completed' })];
    const plan = planSilentPreCompact(queue, new Set(['sub-1']));
    expect(plan.slots).toEqual([]);
    expect(plan.drop).toEqual([]);
  });

  it('앞에 설 명령이 우리 내부 슬래시 명령이면 표식만 버린다 — 압축 앞의 압축은 낭비다', () => {
    const queue = [cmd({ id: 'a', text: '/compact' })];
    const plan = planSilentPreCompact(queue, new Set(['sub-1']));
    expect(plan.slots).toEqual([]);
    expect(plan.drop).toEqual(['sub-1']);
  });

  it('`/clear` 앞에서도 버린다 — 비울 대화를 접는 것은 두 번 무는 일이다', () => {
    const queue = [cmd({ id: 'a', text: '/clear' })];
    expect(planSilentPreCompact(queue, new Set(['sub-1'])).drop).toEqual(['sub-1']);
  });

  it('표식이 없는 세션의 명령 앞에는 서지 않는다', () => {
    const queue = [cmd({ id: 'a', subAgentId: 'sub-2' }), cmd({ id: 'b', subAgentId: 'sub-1' })];
    const plan = planSilentPreCompact(queue, new Set(['sub-1']));
    expect(plan.slots).toEqual([{ index: 1, subAgentId: 'sub-1', beforeCommandId: 'b' }]);
  });

  it('여러 세션이 걸리면 **뒤에서부터** 넣도록 index 내림차순으로 돌려준다', () => {
    const queue = [cmd({ id: 'a', subAgentId: 'sub-1' }), cmd({ id: 'b', subAgentId: 'sub-2' })];
    const plan = planSilentPreCompact(queue, new Set(['sub-1', 'sub-2']));
    expect(plan.slots.map((s) => s.index)).toEqual([1, 0]);
  });

  it('내림차순 자리를 그대로 splice 하면 각자 제 명령 앞에 선다 (실제 삽입 재현)', () => {
    const queue = [cmd({ id: 'a', subAgentId: 'sub-1' }), cmd({ id: 'b', subAgentId: 'sub-2' })];
    const plan = planSilentPreCompact(queue, new Set(['sub-1', 'sub-2']));
    const live = [...queue];
    for (const slot of plan.slots) {
      live.splice(slot.index, 0, cmd({ id: `compact-${slot.subAgentId}`, text: '/compact' }));
    }
    expect(live.map((c) => c.id)).toEqual(['compact-sub-1', 'a', 'compact-sub-2', 'b']);
  });

  it('세션이 없는 명령(subAgentId=null)은 대상이 아니다', () => {
    const queue = [cmd({ id: 'a', subAgentId: null })];
    expect(planSilentPreCompact(queue, new Set(['sub-1'])).slots).toEqual([]);
  });

  it("'즉시' 앞에는 서지 않는다 — 끊어 가며 당장 돌리려는 명령이다(표식은 남는다)", () => {
    const queue = [cmd({ id: 'a', dispatchMode: 'immediate' })];
    const plan = planSilentPreCompact(queue, new Set(['sub-1']));
    expect(plan.slots).toEqual([]);
    expect(plan.drop).toEqual([]); // 버리지 않는다 — 다음 일반 명령 앞에서 접는다.
  });

  it("'대기'·'합치기'는 종전대로 앞에 선다", () => {
    for (const mode of ['queue', 'merge', undefined]) {
      const queue = [cmd({ id: 'a', dispatchMode: mode })];
      expect(planSilentPreCompact(queue, new Set(['sub-1'])).slots).toHaveLength(1);
    }
  });
});

describe('displayCommands — 감추고, 진행 표시를 넘긴다', () => {
  interface Row { id: string; silent?: boolean; status?: string; subAgentId?: string | null; startedAt?: number }

  it('조용한 명령은 빠진다', () => {
    const list: Row[] = [{ id: 'a' }, { id: 'b', silent: true }, { id: 'c' }];
    expect(displayCommands(list).map((c) => c.id)).toEqual(['a', 'c']);
  });

  it('감출 것이 없으면 **같은 배열 참조**를 돌려준다 — 구조적 공유를 매 스냅샷마다 깨지 않게', () => {
    const list: Row[] = [{ id: 'a' }, { id: 'b' }];
    expect(displayCommands(list)).toBe(list);
  });

  it('빈 목록·undefined 도 받는다', () => {
    expect(displayCommands<Row>([])).toEqual([]);
    expect(displayCommands<Row>(undefined)).toEqual([]);
  });

  /**
   * 이 기능의 **눈에 보이는 전부**다 — 압축이 도는 동안 사용자가 넣은 명령이 "대기 중"으로
   * 앉아 있으면 감춘 보람이 없다("왜 멈췄지"가 된다). 진행 중으로 보여야 한다.
   */
  it('조용한 압축이 도는 동안 뒤에 선 명령이 **실행 중**으로 그려진다', () => {
    const list: Row[] = [
      { id: 'compact', silent: true, status: 'executing', subAgentId: 's1', startedAt: 100 },
      { id: 'mine', status: 'queued', subAgentId: 's1' },
    ];
    const out = displayCommands(list);
    expect(out.map((c) => c.id)).toEqual(['mine']);
    expect(out[0]!.status).toBe('executing');
    expect(out[0]!.startedAt).toBe(100); // 말풍선 자리가 압축이 나간 시각에 고정된다
  });

  it('물려받는 것은 **첫** 대기 명령 하나뿐 — 뒤엣것까지 실행 중으로 그리면 거짓이 된다', () => {
    const list: Row[] = [
      { id: 'compact', silent: true, status: 'executing', subAgentId: 's1' },
      { id: 'first', status: 'queued', subAgentId: 's1' },
      { id: 'second', status: 'queued', subAgentId: 's1' },
    ];
    const out = displayCommands(list);
    expect(out.map((c) => c.status)).toEqual(['executing', 'queued']);
  });

  it('다른 세션의 대기 명령은 물려받지 않는다', () => {
    const list: Row[] = [
      { id: 'compact', silent: true, status: 'executing', subAgentId: 's1' },
      { id: 'other', status: 'queued', subAgentId: 's2' },
    ];
    expect(displayCommands(list)[0]!.status).toBe('queued');
  });

  it('압축이 아직 대기 중이면 아무것도 물려주지 않는다 — 도는 것이 없다', () => {
    const list: Row[] = [
      { id: 'compact', silent: true, status: 'queued', subAgentId: 's1' },
      { id: 'mine', status: 'queued', subAgentId: 's1' },
    ];
    expect(displayCommands(list)[0]!.status).toBe('queued');
  });

  it('원본을 건드리지 않는다 — 서버가 준 값은 그대로다(§3.1)', () => {
    const mine: Row = { id: 'mine', status: 'queued', subAgentId: 's1' };
    const list: Row[] = [{ id: 'compact', silent: true, status: 'executing', subAgentId: 's1' }, mine];
    displayCommands(list);
    expect(mine.status).toBe('queued');
  });
});

describe('capSetSize — 표식 집합이 세션 수만큼 늘지 않게', () => {
  it('상한을 넘으면 오래된 것부터 나간다', () => {
    const set = new Set(['a', 'b', 'c']);
    expect(capSetSize(set, 2)).toBe(1);
    expect([...set]).toEqual(['b', 'c']);
  });

  it('0 은 무제한(§3.2.3 과 같은 규약)', () => {
    const set = new Set(['a', 'b']);
    expect(capSetSize(set, 0)).toBe(0);
    expect(set.size).toBe(2);
  });
});
