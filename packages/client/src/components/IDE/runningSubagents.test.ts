import { describe, it, expect } from 'vitest';
import type { FinishedSubagentTask, RunningSubagentTask } from '@vibisual/shared';
import { selectSessionTasks, selectSessionFinished, countSessionTasks, countOtherTasks } from './runningSubagents.js';

/**
 * §5.5 #17-9 ③(a) v4.95 / ⑥ v5.07 — 활동바 항목과 사이드바 뷰가 **같은 수**를 보게 하는 산식 회귀.
 *
 * 고정하는 약속 둘.
 *  ① 항목이 켜지는 조건 = 아래 숫자 = 목록 길이. 셋이 갈리면 v3.51 처럼 "아이콘은 떠 있는데
 *    숫자는 `(0)`, 눌러도 창이 안 뜬다"가 다시 난다.
 *  ② 모집단은 **백단에서 도는 것뿐**이다(v5.03 의 세션 실행 합류는 v5.07 에 철회). 지금 나누고
 *    있는 대화까지 세면 대화 중에는 늘 1건이 잡혀 "백단에 몇 개?"라는 질문이 오염된다.
 */

function task(over: Partial<RunningSubagentTask> = {}): RunningSubagentTask {
  return {
    id: 'toolu-1',
    parentAgentId: 'agent-1',
    startedAt: 0,
    ...over,
  };
}

const subA = task({ id: 't-a', subAgentId: 'sub-a' });
const subA2 = task({ id: 't-a2', subAgentId: 'sub-a' });
const subB = task({ id: 't-b', subAgentId: 'sub-b' });
const orphan = task({ id: 't-orphan' }); // 소유 탭 미상

describe('selectSessionTasks — 지금 보고 있는 탭 기준 목록', () => {
  it('메인 탭(null)은 그 에이전트 전부를 본다', () => {
    const all = [subA, subB, orphan];
    expect(selectSessionTasks(all, null)).toBe(all);
  });

  it('세션 탭은 그 탭이 띄운 것만 본다', () => {
    expect(selectSessionTasks([subA, subA2, subB], 'sub-a')).toEqual([subA, subA2]);
  });

  it('소유 탭이 미상인 항목은 세션 탭 목록에 들어가지 않는다', () => {
    expect(selectSessionTasks([subA, orphan], 'sub-a')).toEqual([subA]);
  });

  it('그 탭 것이 하나도 없으면 빈 목록', () => {
    expect(selectSessionTasks([subB, orphan], 'sub-a')).toEqual([]);
  });

  it('전부가 그 탭 것이면 원본 배열을 그대로 돌려준다(리렌더 방지)', () => {
    const all = [subA, subA2];
    expect(selectSessionTasks(all, 'sub-a')).toBe(all);
  });

  it('목록이 없거나 비면 빈 배열', () => {
    expect(selectSessionTasks(undefined, 'sub-a')).toEqual([]);
    expect(selectSessionTasks([], null)).toEqual([]);
  });

  it('빈 목록은 매번 같은 배열이다(참조 안정)', () => {
    expect(selectSessionTasks(undefined, null)).toBe(selectSessionTasks([], 'sub-a'));
  });
});

describe('countSessionTasks — 항목 노출·점등·배지가 함께 쓰는 수', () => {
  it('메인 탭은 전체 개수', () => {
    expect(countSessionTasks([subA, subB, orphan], null)).toBe(3);
  });

  it('세션 탭은 그 탭 개수', () => {
    expect(countSessionTasks([subA, subA2, subB], 'sub-a')).toBe(2);
  });

  it('그 탭 것이 없으면 0 — 이 경우 활동바 항목 자체가 뜨지 않아야 한다', () => {
    expect(countSessionTasks([subB, orphan], 'sub-a')).toBe(0);
  });

  it('목록 길이와 항상 일치한다', () => {
    const all = [subA, subA2, subB, orphan];
    for (const sid of [null, 'sub-a', 'sub-b', 'sub-c']) {
      expect(countSessionTasks(all, sid)).toBe(selectSessionTasks(all, sid).length);
    }
  });
});

describe('countOtherTasks — 이 탭 밖에서 도는 수', () => {
  it('메인 탭은 전부 이미 보이므로 0', () => {
    expect(countOtherTasks([subA, subB, orphan], null)).toBe(0);
  });

  it('다른 탭 것과 소유 미상을 함께 센다', () => {
    expect(countOtherTasks([subA, subB, orphan], 'sub-a')).toBe(2);
  });

  it('이 탭 것만 돌면 0', () => {
    expect(countOtherTasks([subA, subA2], 'sub-a')).toBe(0);
  });

  it('아무것도 안 돌면 0', () => {
    expect(countOtherTasks(undefined, 'sub-a')).toBe(0);
  });
});

/**
 * §5.5 #17-9 ⑦(b)(c) — "방금 끝난 것" 은 도는 것과 **같은 범위 규칙**을 쓰되,
 * **개수 산식에는 관여하지 않는다**(활동바 점등·배지는 여전히 도는 것만 센다).
 */
function done(over: Partial<FinishedSubagentTask> = {}): FinishedSubagentTask {
  return { id: 'f-1', parentAgentId: 'agent-1', startedAt: 0, endedAt: 1000, ...over };
}

const doneA = done({ id: 'f-a', subAgentId: 'sub-a' });
const doneB = done({ id: 'f-b', subAgentId: 'sub-b' });
const doneOrphan = done({ id: 'f-orphan' });

describe('selectSessionFinished — 끝난 것도 같은 범위 규칙', () => {
  it('메인 탭(null)은 전부를 본다', () => {
    expect(selectSessionFinished([doneA, doneB, doneOrphan], null)).toEqual([doneA, doneB, doneOrphan]);
  });

  it('세션 탭은 그 탭이 띄웠던 것만 본다', () => {
    expect(selectSessionFinished([doneA, doneB, doneOrphan], 'sub-a')).toEqual([doneA]);
  });

  it('소유 탭 미상은 세션 탭 목록에서 빠진다', () => {
    expect(selectSessionFinished([doneOrphan], 'sub-a')).toEqual([]);
  });

  it('없으면 빈 배열', () => {
    expect(selectSessionFinished(undefined, null)).toEqual([]);
  });
});

describe('끝난 것은 배지 숫자를 흔들지 않는다', () => {
  it('끝난 것이 몇 건이든 도는 개수 산식의 입력이 아니다', () => {
    // 도는 것 1건 + 끝난 것 3건 → 활동바가 보는 수는 여전히 1.
    expect(countSessionTasks([subA], 'sub-a')).toBe(1);
    expect(selectSessionFinished([doneA, doneA, doneA], 'sub-a')).toHaveLength(3);
  });
});
