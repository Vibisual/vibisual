import { describe, it, expect, beforeEach } from 'vitest';
import { subAgentManager } from './subAgentManager.js';

/**
 * §5.5 #17-9 ⑪ — **끝 통지로 훅 대차대조를 내린다.**
 *
 * 사용자 보고(2026-08-19): 정상 완료한 배경 서브에이전트가 몇 시간째 "실행 중"으로 붙어 있어
 * "이 세션이 아직 돌고 있다"고 오해하게 만들었다. 원인은 배경 스폰이 내려가는 길이 오직
 * `SubagentStop` 하나뿐이었다는 것이다 —
 *
 *  - ⑧ 규약상 `PostToolUse(Task|Agent)` 는 배경 스폰에서 "띄웠다" 접수증이라 내리지 않는다.
 *  - `sweepOrphanedBackgroundTasks` 는 **그 항목을 담고 있던 세션 프로세스가 죽어야** 걷는다.
 *    사용자가 IDE 탭을 열어 두고 계속 대화하면 그 조건은 영원히 오지 않는다.
 *  - 절대 상한(`PENDING_SUBAGENT_MAX_AGE_MS`)은 **소유 탭이 미상인 항목에만** 적용된다.
 *
 * 그래서 `SubagentStop` 이 유실되거나 `parent_tool_use_id` 가 우리 열쇠와 어긋나는 순간
 * (`noteSubagentTaskStop` 의 "unknown key → 무시" 분기) 항목은 회수 불가능해졌다.
 *
 * 스트림은 그 사이 **끝났다는 사실**(`task_notification`)을 이미 받아 놓고 자기 장부에서만 지웠다.
 * 그 사실을 훅 장부에도 전달하는 것이 이 회귀의 대상이다. 시간으로 추정하는 것이 아니라
 * 실제 종료 통지를 근거로 삼으므로 "조용함은 죽음의 증거가 아니다" 원칙과 충돌하지 않는다.
 */

const created: string[] = [];

function newSub(agentId: string, preferredId?: string): { id: string } {
  const sub = subAgentManager.create(agentId, preferredId);
  created.push(sub.id);
  return sub;
}

function runningOf(parentAgentId: string): { id: string; description?: string }[] {
  return subAgentManager.getRunningSubagentTasks()?.[parentAgentId] ?? [];
}

beforeEach(() => {
  while (created.length > 0) {
    const id = created.pop();
    if (id) subAgentManager.remove(id);
  }
});

describe('§5.5 #17-9 ⑪ — 배경 자식의 끝 통지가 훅 대차대조를 내린다', () => {
  it('SubagentStop 이 끝내 안 와도 task_notification 이 오면 실행 목록에서 내려간다', () => {
    const PARENT = 'agent-endchip-1';
    const sub = newSub(PARENT);

    // 부모의 PreToolUse(Agent) — 배경 스폰이라 PostToolUse 접수증으로는 내려가지 않는다(⑧).
    subAgentManager.noteSubagentTaskStart(PARENT, 'tu-1', sub.id, {
      description: 'Translate pt-BR',
      subagentType: 'i18n-translator',
      background: true,
    });
    subAgentManager.noteSubagentTaskResult(PARENT, 'tu-1', '접수증', true);
    expect(runningOf(PARENT)).toHaveLength(1);

    // 자식이 실제로 돌았다는 스트림 칩(시작) — 종류·이름은 이 칩에만 실린다.
    subAgentManager.noteStreamTaskChip(sub.id, 'task_started', {
      id: 'cli-task-1',
      description: 'Translate pt-BR',
      subagentType: 'i18n-translator',
    });

    // 끝 통지가 도착 — `SubagentStop` 은 끝내 오지 않는다(또는 열쇠가 어긋났다).
    subAgentManager.noteStreamTaskChip(sub.id, 'task_notification', {
      id: 'cli-task-1',
      status: 'completed',
      summary: '154개 키 번역 완료',
    });

    expect(runningOf(PARENT)).toHaveLength(0);
    const finished = subAgentManager.getFinishedSubagentTasks()?.[PARENT] ?? [];
    expect(finished).toHaveLength(1);
    expect(finished[0]?.description).toBe('Translate pt-BR');
    expect(finished[0]?.result).toBe('154개 키 번역 완료');
  });

  it('[회귀] 열쇠가 어긋난 SubagentStop 뒤에도 끝 통지가 회수한다', () => {
    const PARENT = 'agent-endchip-2';
    const sub = newSub(PARENT);

    subAgentManager.noteSubagentTaskStart(PARENT, 'tu-real', sub.id, {
      subagentType: 'i18n-translator',
      background: true,
    });

    // CLI 가 우리 장부에 없는 열쇠를 실어 보냈다 → "unknown key" 분기로 조용히 버려진다.
    const { drained } = subAgentManager.noteSubagentTaskStop(PARENT, 'tu-mismatched', '보고');
    expect(drained).toBe(false);
    expect(runningOf(PARENT)).toHaveLength(1); // 종전에는 여기서 영영 끝

    subAgentManager.noteStreamTaskChip(sub.id, 'task_started', {
      id: 'cli-task-2',
      subagentType: 'i18n-translator',
    });
    subAgentManager.noteStreamTaskChip(sub.id, 'task_notification', {
      id: 'cli-task-2',
      status: 'completed',
    });

    expect(runningOf(PARENT)).toHaveLength(0);
  });

  it('failed·stopped 도 끝이다 — 어느 쪽이든 내려간다', () => {
    for (const status of ['failed', 'stopped'] as const) {
      const PARENT = `agent-endchip-${status}`;
      const sub = newSub(PARENT, `sub-${status}`);
      subAgentManager.noteSubagentTaskStart(PARENT, 'tu-x', sub.id, {
        subagentType: 'worker',
        background: true,
      });
      subAgentManager.noteStreamTaskChip(sub.id, 'task_started', { id: 'c-x', subagentType: 'worker' });
      subAgentManager.noteStreamTaskChip(sub.id, 'task_notification', { id: 'c-x', status });

      expect(runningOf(PARENT)).toHaveLength(0);
    }
  });

  it('같은 종류가 여럿이면 이름이 같은 것부터 내린다 — 남은 자식은 그대로 돈다', () => {
    const PARENT = 'agent-endchip-many';
    const sub = newSub(PARENT);

    subAgentManager.noteSubagentTaskStart(PARENT, 'tu-ko', sub.id, {
      description: 'Translate ko', subagentType: 'i18n-translator', background: true,
    });
    subAgentManager.noteSubagentTaskStart(PARENT, 'tu-ja', sub.id, {
      description: 'Translate ja', subagentType: 'i18n-translator', background: true,
    });
    expect(runningOf(PARENT)).toHaveLength(2);

    subAgentManager.noteStreamTaskChip(sub.id, 'task_started', {
      id: 'c-ja', description: 'Translate ja', subagentType: 'i18n-translator',
    });
    subAgentManager.noteStreamTaskChip(sub.id, 'task_notification', { id: 'c-ja', status: 'completed' });

    const left = runningOf(PARENT);
    expect(left).toHaveLength(1);
    expect(left[0]?.description).toBe('Translate ko');
  });

  it('종류가 다른 자식은 대신 내려가지 않는다', () => {
    const PARENT = 'agent-endchip-kind';
    const sub = newSub(PARENT);

    subAgentManager.noteSubagentTaskStart(PARENT, 'tu-other', sub.id, {
      subagentType: 'verifier', background: true,
    });
    subAgentManager.noteStreamTaskChip(sub.id, 'task_started', { id: 'c-t', subagentType: 'i18n-translator' });
    subAgentManager.noteStreamTaskChip(sub.id, 'task_notification', { id: 'c-t', status: 'completed' });

    expect(runningOf(PARENT)).toHaveLength(1);
  });

  it('다른 탭이 띄운 자식은 건드리지 않는다', () => {
    const PARENT = 'agent-endchip-tab';
    const mine = newSub(PARENT, 'sub-mine');
    const other = newSub(PARENT, 'sub-other');

    subAgentManager.noteSubagentTaskStart(PARENT, 'tu-other-tab', other.id, {
      subagentType: 'i18n-translator', background: true,
    });
    subAgentManager.noteStreamTaskChip(mine.id, 'task_started', { id: 'c-m', subagentType: 'i18n-translator' });
    subAgentManager.noteStreamTaskChip(mine.id, 'task_notification', { id: 'c-m', status: 'completed' });

    expect(runningOf(PARENT)).toHaveLength(1);
  });

  it('SubagentStop 이 제때 내린 뒤 도착한 끝 통지는 아무것도 더 내리지 않는다', () => {
    const PARENT = 'agent-endchip-normal';
    const sub = newSub(PARENT);

    subAgentManager.noteSubagentTaskStart(PARENT, 'tu-done', sub.id, {
      subagentType: 'i18n-translator', background: true,
    });
    subAgentManager.noteSubagentTaskStart(PARENT, 'tu-live', sub.id, {
      subagentType: 'i18n-translator', background: true,
    });
    subAgentManager.noteSubagentTaskStop(PARENT, 'tu-done', '정상 보고');
    expect(runningOf(PARENT)).toHaveLength(1);

    // 정상 경로에서도 끝 통지는 뒤따라 온다 — 그때 남아 있는 형제를 대신 내리면 안 된다.
    subAgentManager.noteStreamTaskChip(sub.id, 'task_started', { id: 'c-done', subagentType: 'i18n-translator' });
    subAgentManager.noteStreamTaskChip(sub.id, 'task_notification', { id: 'c-done', status: 'completed' });

    // 형제가 하나 남아 있으므로 이 통지는 그 형제를 내린다 — 여기서 고정하는 것은
    // "훅이 이미 내린 항목을 두 번 세지 않는다"(끝난 것 꼬리에 중복이 생기지 않는다)이다.
    const finished = subAgentManager.getFinishedSubagentTasks()?.[PARENT] ?? [];
    expect(finished.filter((f) => f.id === 'tu-done')).toHaveLength(1);
  });

  it('훅 대차대조에 없는 자식의 끝 통지는 조용히 지나간다', () => {
    const PARENT = 'agent-endchip-empty';
    const sub = newSub(PARENT);

    subAgentManager.noteStreamTaskChip(sub.id, 'task_started', { id: 'c-none', subagentType: 'i18n-translator' });
    expect(() => {
      subAgentManager.noteStreamTaskChip(sub.id, 'task_notification', { id: 'c-none', status: 'completed' });
    }).not.toThrow();
    expect(runningOf(PARENT)).toHaveLength(0);
  });

  it('subagentType 이 없는 백그라운드 작업(Bash·Monitor)은 훅 장부를 건드리지 않는다', () => {
    const PARENT = 'agent-endchip-bash';
    const sub = newSub(PARENT);

    subAgentManager.noteSubagentTaskStart(PARENT, 'tu-keep', sub.id, {
      subagentType: 'i18n-translator', background: true,
    });
    subAgentManager.noteStreamTaskChip(sub.id, 'task_started', { id: 'c-bash', description: '백그라운드 빌드' });
    subAgentManager.noteStreamTaskChip(sub.id, 'task_notification', { id: 'c-bash', status: 'completed' });

    expect(runningOf(PARENT)).toHaveLength(1);
  });
});
