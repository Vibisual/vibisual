import { describe, it, expect } from 'vitest';
import type { FinishedSubagentTask, RunningSubagentTask } from '@vibisual/shared';
import { isBackgroundShellTask } from '@vibisual/shared';
import { selectSessionTasks, selectSessionFinished, countSessionTasks, countOtherTasks, taskKindKey } from './runningSubagents.js';

/** §5.5 #17-9 ③(a)/⑥ — 활동바 점등 = 숫자 = 목록 길이, 모집단은 백단에서 도는 것뿐(지금 대화 ❌). */

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

/** §5.5 #17-9 ⑧ — 서브에이전트와 백그라운드 셸의 판정 한 곳, 그리고 12개 언어 전부에서 두 이름이 갈리는가(`tail -f` 가 토큰 소비로 읽히지 않게). */
describe('종류 판정 — 서브에이전트인가 셸인가', () => {
  it("스트림 칩(`Bash run_in_background`·`Monitor`)은 셸이다", () => {
    expect(taskKindKey({ origin: 'stream' })).toBe('kindShell');
  });

  it('훅 대차대조(Task/Agent)는 서브에이전트다', () => {
    expect(taskKindKey({ origin: 'hook' })).toBe('kindAgent');
  });

  it('미지정은 서브에이전트로 읽는다 — 옛 항목 호환(§5.5 #17-9 origin 규약)', () => {
    expect(taskKindKey({})).toBe('kindAgent');
  });

  it('끝난 항목도 같은 표식을 들고 온다 — 위칸·아래칸의 잣대가 갈리면 안 된다', () => {
    const doneShell: FinishedSubagentTask = { ...doneA, origin: 'stream' };
    expect(taskKindKey(doneShell)).toBe('kindShell');
    expect(taskKindKey(doneA)).toBe('kindAgent');
  });

  // §5.5 #17-9 ⑰ — 칩과 실행 축이 **같은 술어**를 쓴다. 갈리면 한쪽이 반드시 거짓말한다.
  it('스트림으로 와도 subagentType 이 붙었으면 서브에이전트다 — 중첩 자식을 셸로 적으면 안 된다', () => {
    // 이 항목은 실제로 모델이 돌아 토큰을 태운다. "토큰을 안 씁니다"라는 칩 설명이 거짓이 된다.
    expect(taskKindKey({ origin: 'stream', subagentType: 'explorer' })).toBe('kindAgent');
  });

  it('실행 축 술어(isBackgroundShellTask)와 답이 항상 같다', () => {
    const cases: Pick<RunningSubagentTask, 'origin' | 'subagentType'>[] = [
      {},
      { origin: 'hook' },
      { origin: 'stream' },
      { origin: 'stream', subagentType: 'explorer' },
      { origin: 'hook', subagentType: 'code-lead' },
    ];
    for (const c of cases) {
      expect(taskKindKey(c) === 'kindShell').toBe(isBackgroundShellTask(c));
    }
  });
});

describe('12개 언어 전부에서 두 이름이 갈린다', () => {
  const LOCALES = ['en', 'ko', 'ja', 'zh-CN', 'de', 'es', 'es-419', 'fr', 'hi', 'id', 'it', 'pt-BR'] as const;
  const KEYS = ['kindAgent', 'kindAgentTip', 'kindShell', 'kindShellTip'] as const;

  it.each(LOCALES)('%s — 네 문자열이 있고 두 이름이 서로 다르다', async (locale) => {
    const json = (await import(`../../i18n/locales/${locale}.json`)).default as {
      ide: { runningSubagents: Record<string, string> };
    };
    const rs = json.ide.runningSubagents;
    for (const k of KEYS) expect(rs[k], `${locale}.${k} 누락`).toBeTruthy();
    expect(rs.kindAgent, `${locale}: 두 종류가 같은 낱말이면 구분이 없는 것과 같다`).not.toBe(rs.kindShell);
  });
});
