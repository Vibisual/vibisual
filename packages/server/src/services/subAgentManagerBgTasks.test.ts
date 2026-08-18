import { describe, it, expect } from 'vitest';
import { SubAgentManager } from './subAgentManager.js';

/**
 * §5.5 #17-9 ⑧ — 백그라운드 서브에이전트 대차대조의 **내려가는 조건**.
 *
 * 이 화면이 답해야 할 질문은 하나다 — "지금 백단에 몇 개 도는가". 그래서 항목이 언제 내려가느냐가
 * 곧 이 기능의 정확도다. ⑦(b) 는 `SubagentStop` 유실을 대비해 `PostToolUse(Task|Agent)` 에도 ↓ 폴백을
 * 뒀는데, 현 CLI 의 `Agent` 도구는 `run_in_background` 가 기본 참이라 **띄우자마자** 접수증을
 * `tool_response` 로 돌려준다 → 그 폴백이 자식이 살아 있는데도 항목을 즉시 내려 활동바가 내내 `(0)`
 * 이었다. 여기서 고정하는 약속: **배경 스폰은 `SubagentStop` 으로만 내려간다.**
 */

const PARENT = 'agent-test-1';
const OWNER_SUB = 'sub-test-1';

function runningOf(m: SubAgentManager): { id: string; subAgentId?: string }[] {
  return m.getRunningSubagentTasks()?.[PARENT] ?? [];
}

describe('배경 스폰 — PostToolUse 접수증으로는 내려가지 않는다', () => {
  it('띄운 직후 도착한 tool_response 는 항목을 그대로 둔다', () => {
    const m = new SubAgentManager();
    m.noteSubagentTaskStart(PARENT, 'tu-bg', OWNER_SUB, { description: '조사', background: true });
    expect(runningOf(m)).toHaveLength(1);
    expect(runningOf(m)[0]?.subAgentId).toBe(OWNER_SUB);

    // 배경 스폰의 PostToolUse — "띄웠다" 접수증이지 최종 보고가 아니다.
    const changed = m.noteSubagentTaskResult(PARENT, 'tu-bg', 'Agent started (id: a-1)', true);

    expect(changed).toBe(false);
    expect(runningOf(m)).toHaveLength(1);
    // 시작하자마자 "끝난 것" 꼬리에 유령 카드가 생기지도 않는다.
    expect(m.getFinishedSubagentTasks()).toBeUndefined();
  });

  it('내리는 것은 SubagentStop 하나 — 그때 결과와 함께 끝난 것으로 옮겨간다', () => {
    const m = new SubAgentManager();
    m.noteSubagentTaskStart(PARENT, 'tu-bg', OWNER_SUB, { background: true });
    m.noteSubagentTaskResult(PARENT, 'tu-bg', '접수증', true);

    const { drained } = m.noteSubagentTaskStop(PARENT, 'tu-bg', '최종 보고');

    expect(drained).toBe(true);
    expect(runningOf(m)).toHaveLength(0);
    const finished = m.getFinishedSubagentTasks()?.[PARENT] ?? [];
    expect(finished).toHaveLength(1);
    expect(finished[0]?.result).toBe('최종 보고');
    expect(finished[0]?.subAgentId).toBe(OWNER_SUB);
  });

  it('항목에 찍힌 표식이 우선 — PostToolUse 가 배경 여부를 안 실어 와도 살아남는다', () => {
    const m = new SubAgentManager();
    m.noteSubagentTaskStart(PARENT, 'tu-bg', OWNER_SUB, { background: true });

    expect(m.noteSubagentTaskResult(PARENT, 'tu-bg', '접수증')).toBe(false);
    expect(runningOf(m)).toHaveLength(1);
  });

  it('표식이 없는 항목이라도 PostToolUse 가 배경이라고 말하면 그대로 둔다(폴백)', () => {
    const m = new SubAgentManager();
    m.noteSubagentTaskStart(PARENT, 'tu-bg', OWNER_SUB);

    expect(m.noteSubagentTaskResult(PARENT, 'tu-bg', '접수증', true)).toBe(false);
    expect(runningOf(m)).toHaveLength(1);
  });
});

describe('전경 스폰 — ⑦(b) 의 SubagentStop 유실 폴백은 그대로다', () => {
  it('배경이 아니면 PostToolUse 의 결과로 내려간다', () => {
    const m = new SubAgentManager();
    m.noteSubagentTaskStart(PARENT, 'tu-fg', OWNER_SUB, { background: false });

    const changed = m.noteSubagentTaskResult(PARENT, 'tu-fg', '자식 보고');

    expect(changed).toBe(true);
    expect(runningOf(m)).toHaveLength(0);
    expect(m.getFinishedSubagentTasks()?.[PARENT]?.[0]?.result).toBe('자식 보고');
  });

  it('이미 SubagentStop 으로 내려간 뒤 오는 결과는 끝난 항목에 붙는다', () => {
    const m = new SubAgentManager();
    m.noteSubagentTaskStart(PARENT, 'tu-fg', OWNER_SUB);
    m.noteSubagentTaskStop(PARENT, 'tu-fg');

    expect(m.noteSubagentTaskResult(PARENT, 'tu-fg', '뒤늦은 보고')).toBe(true);
    expect(m.getFinishedSubagentTasks()?.[PARENT]?.[0]?.result).toBe('뒤늦은 보고');
  });
});

describe('두 갈래가 섞여도 개수는 도는 것만 센다', () => {
  it('배경 1 + 전경 1 에서 전경만 끝나면 1 이 남는다', () => {
    const m = new SubAgentManager();
    m.noteSubagentTaskStart(PARENT, 'tu-bg', OWNER_SUB, { background: true });
    m.noteSubagentTaskStart(PARENT, 'tu-fg', OWNER_SUB, { background: false });
    expect(runningOf(m)).toHaveLength(2);

    m.noteSubagentTaskResult(PARENT, 'tu-bg', '접수증', true);
    m.noteSubagentTaskResult(PARENT, 'tu-fg', '자식 보고');

    const left = runningOf(m);
    expect(left).toHaveLength(1);
    expect(left[0]?.id).toBe('tu-bg');
  });
});
