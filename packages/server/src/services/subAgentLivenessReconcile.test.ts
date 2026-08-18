import { describe, it, expect, beforeEach } from 'vitest';
import { subAgentManager } from './subAgentManager.js';

/**
 * 실행 표시 ↔ 실제 프로세스 생존 대조 회귀 테스트.
 *
 * 종전에는 `sub.status` 가 `active` 인 채로 자식을 잃으면 **5분 무활동 sweep** 이 걷을 때까지
 * 화면이 "돌고 있다"고 말했다(그동안 [중지]는 멈출 게 없는 헛버튼). 이제 5초 리컨사일이
 * 사실로 판정한다 — 다만 **잘못 강등하면 더 나쁘므로**(멀쩡히 도는 세션이 완료로 보인다)
 * 제외 조건들을 여기서 고정한다.
 */

/** 테스트가 만든 sub 를 매번 걷어 내 서로 간섭하지 않게 한다(매니저가 모듈 싱글턴이라). */
const created: string[] = [];

/** `preferredId` 는 **같은 테스트 안에서 sub 를 둘 이상 만들 때** 준다 — 생성 id 가 밀리초 기반이라
 *  연달아 만들면 같은 값이 나와 두 sub 가 한 탭으로 겹친다(아래 형제 탭 테스트가 그 자리다). */
function newSub(agentId: string, preferredId?: string): { id: string } {
  const sub = subAgentManager.create(agentId, preferredId);
  created.push(sub.id);
  return sub;
}

beforeEach(() => {
  while (created.length > 0) {
    const id = created.pop();
    if (id) subAgentManager.remove(id);
  }
});

describe('reconcileDeadActiveSubs — 죽은 active 를 걷는다', () => {
  it('자식도 워처도 없는 active 세션은 idle 로 되돌린다', () => {
    const sub = newSub('agent-dead');
    subAgentManager.getSub(sub.id)!.status = 'active';

    expect(subAgentManager.reconcileDeadActiveSubs()).toContain(sub.id);
    expect(subAgentManager.getSub(sub.id)!.status).toBe('idle');
  });

  it('이미 idle 인 세션은 건드리지 않는다', () => {
    const sub = newSub('agent-idle');
    subAgentManager.getSub(sub.id)!.status = 'idle';

    expect(subAgentManager.reconcileDeadActiveSubs()).not.toContain(sub.id);
  });

  it('실패로 끝난 세션을 idle 로 세탁하지 않는다', () => {
    const sub = newSub('agent-err');
    subAgentManager.getSub(sub.id)!.status = 'error';

    subAgentManager.reconcileDeadActiveSubs();
    expect(subAgentManager.getSub(sub.id)!.status).toBe('error');
  });

  it('한 번 걷은 뒤에는 다시 보고하지 않는다(도트 깜빡임 방지)', () => {
    const sub = newSub('agent-once');
    subAgentManager.getSub(sub.id)!.status = 'active';

    expect(subAgentManager.reconcileDeadActiveSubs()).toContain(sub.id);
    expect(subAgentManager.reconcileDeadActiveSubs()).not.toContain(sub.id);
  });
});

describe('reconcileDeadActiveSubs — 잘못 강등하지 않는다', () => {
  it('PTY(CMD) 세션은 자식이 없어도 강등하지 않는다', () => {
    const agentId = 'agent-cmd';
    const sub = newSub(agentId);
    // 훅이 이 탭을 몰고 간다 = CMD 세션. 이 호출이 곧 그 표식이다.
    subAgentManager.markCmdSubActivity(`term:${agentId}:${sub.id}`, /*isStop=*/false);
    expect(subAgentManager.getSub(sub.id)!.status).toBe('active');

    expect(subAgentManager.reconcileDeadActiveSubs()).not.toContain(sub.id);
    expect(subAgentManager.getSub(sub.id)!.status).toBe('active');
  });

  it('CMD 세션은 Stop 훅이 와야 idle 로 간다 — 리컨사일이 그 자리를 가로채지 않는다', () => {
    const agentId = 'agent-cmd-stop';
    const sub = newSub(agentId);
    subAgentManager.markCmdSubActivity(`term:${agentId}:${sub.id}`, false);
    subAgentManager.reconcileDeadActiveSubs();
    expect(subAgentManager.getSub(sub.id)!.status).toBe('active');

    subAgentManager.markCmdSubActivity(`term:${agentId}:${sub.id}`, /*isStop=*/true);
    expect(subAgentManager.getSub(sub.id)!.status).toBe('idle');
  });

  it('이 탭이 띄운 백그라운드 Task 가 남아 있으면 강등하지 않는다', () => {
    const agentId = 'agent-bg';
    const sub = newSub(agentId);
    // 대차대조 ↑ 가 이 sub 를 active 로 올린다(syncBgSubStatus).
    subAgentManager.noteSubagentTaskStart(agentId, 'tool-1', sub.id, { description: 'child' });
    expect(subAgentManager.getSub(sub.id)!.status).toBe('active');

    expect(subAgentManager.reconcileDeadActiveSubs()).not.toContain(sub.id);
    expect(subAgentManager.getSub(sub.id)!.status).toBe('active');
  });

  it('그 백그라운드 Task 가 끝나면 그때 정상적으로 내려간다', () => {
    const agentId = 'agent-bg-done';
    const sub = newSub(agentId);
    subAgentManager.noteSubagentTaskStart(agentId, 'tool-1', sub.id, { description: 'child' });
    subAgentManager.noteSubagentTaskStop(agentId, 'tool-1');

    expect(subAgentManager.getSub(sub.id)!.status).toBe('idle');
  });
});

describe('중지·덧말로 턴이 갈릴 때 옛 백단 작업이 새 턴에 섞이지 않는다', () => {
  it('옛 자식의 SubagentStop(모르는 id)이 새 턴의 자식을 대신 지우지 않는다', () => {
    const agentId = 'agent-mix';
    const sub = newSub(agentId);

    // 턴 A — 자식 둘을 띄운 뒤 사용자가 [중지]. 그 세션의 장부가 비워진다.
    subAgentManager.noteSubagentTaskStart(agentId, 'old-X', sub.id, { description: 'X' });
    subAgentManager.noteSubagentTaskStart(agentId, 'old-Y', sub.id, { description: 'Y' });
    subAgentManager.clearPendingSubagentTasksForSession(agentId, sub.id);

    // 턴 B — 새 명령이 자식 Z 를 띄웠다.
    subAgentManager.noteSubagentTaskStart(agentId, 'new-Z', sub.id, { description: 'Z' });
    expect(subAgentManager.getRunningSubagentTasks()?.[agentId]?.map((t) => t.id)).toEqual(['new-Z']);

    // 뒤늦게 도착한 턴 A 자식의 종료 — 우리 장부에 없는 id 다.
    subAgentManager.noteSubagentTaskStop(agentId, 'old-X', '옛 결과');

    // Z 는 그대로 살아 있어야 한다(종전에는 최고령 폴백이 Z 를 지우고 옛 결과를 붙였다).
    expect(subAgentManager.getRunningSubagentTasks()?.[agentId]?.map((t) => t.id)).toEqual(['new-Z']);
  });

  it('id 없는 구버전 페이로드는 종전대로 최고령을 회수한다', () => {
    const agentId = 'agent-legacy-stop';
    const sub = newSub(agentId);
    subAgentManager.noteSubagentTaskStart(agentId, 'a', sub.id, { description: 'A' });

    subAgentManager.noteSubagentTaskStop(agentId, undefined, '결과');
    expect(subAgentManager.getRunningSubagentTasks()?.[agentId]).toBeUndefined();
  });

  it('중지하면 스트림 칩 백그라운드 작업도 함께 걷힌다 — 유령이 다음 턴에 안 남는다', () => {
    const agentId = 'agent-stream-stop';
    const sub = newSub(agentId);
    // 스트림 칩으로만 보이는 백그라운드 작업(훅이 못 보는 종류).
    subAgentManager.noteStreamTaskChip(sub.id, 'task_started', { id: 'bg1', description: '백그라운드 빌드' });
    expect(subAgentManager.hasLiveBackgroundTasks(agentId)).toBe(true);

    subAgentManager.stop(sub.id);
    expect(subAgentManager.hasLiveBackgroundTasks(agentId)).toBe(false);
  });
});

describe('멈춘 백단 자식 처리 — 항목별 만료와 개별 내리기', () => {
  it('개별 내리기는 그 항목만 내리고 형제는 남긴다', () => {
    const agentId = 'agent-dismiss';
    const sub = newSub(agentId);
    subAgentManager.noteSubagentTaskStart(agentId, 'stuck', sub.id, { description: '멈춘 것' });
    subAgentManager.noteSubagentTaskStart(agentId, 'healthy', sub.id, { description: '도는 것' });

    expect(subAgentManager.dismissRunningTask(agentId, 'stuck')).toBe(true);
    expect(subAgentManager.getRunningSubagentTasks()?.[agentId]?.map((x) => x.id)).toEqual(['healthy']);
  });

  it('스트림 칩 작업도 같은 손잡이로 내려간다', () => {
    const agentId = 'agent-dismiss-stream';
    const sub = newSub(agentId);
    subAgentManager.noteStreamTaskChip(sub.id, 'task_started', { id: 'bg1', description: '빌드' });
    expect(subAgentManager.hasLiveBackgroundTasks(agentId)).toBe(true);

    expect(subAgentManager.dismissRunningTask(agentId, 'bg1')).toBe(true);
    expect(subAgentManager.hasLiveBackgroundTasks(agentId)).toBe(false);
  });

  it('이미 사라진 항목을 내려도 조용히 false — 두 번 눌러도 안전', () => {
    expect(subAgentManager.dismissRunningTask('agent-none', 'nope')).toBe(false);
  });

  it('내린 항목은 "방금 끝난 것" 꼬리로 남는다 — 소리 없이 사라지지 않는다', () => {
    const agentId = 'agent-dismiss-tail';
    const sub = newSub(agentId);
    subAgentManager.noteSubagentTaskStart(agentId, 'gone', sub.id, { description: '내릴 것' });
    subAgentManager.dismissRunningTask(agentId, 'gone');

    const finished = subAgentManager.getFinishedSubagentTasks()?.[agentId] ?? [];
    expect(finished.some((f) => f.id === 'gone')).toBe(true);
  });
});

describe('고아 백그라운드 작업 — 프로세스가 사라진 세션의 표시를 걷는다', () => {
  /** 유예(15초)를 넘긴 시각. 이 sweep 은 시간이 아니라 "프로세스가 있나"로 판정하므로 유예만 넘기면 된다. */
  const later = (): number => Date.now() + 60_000;

  it('프로세스가 없는 세션의 스트림 작업은 유예 뒤 걷힌다', () => {
    const agentId = 'agent-orphan-stream';
    const sub = newSub(agentId);
    subAgentManager.noteStreamTaskChip(sub.id, 'task_started', { id: 'bg1', description: 'packaging output' });
    expect(subAgentManager.hasLiveBackgroundTasks(agentId)).toBe(true);

    expect(subAgentManager.sweepOrphanedBackgroundTasks(later())).toContain(agentId);
    expect(subAgentManager.hasLiveBackgroundTasks(agentId)).toBe(false);
  });

  it('유예 안에서는 걷지 않는다 — 막 띄운 작업을 죽었다고 하지 않는다', () => {
    const agentId = 'agent-orphan-grace';
    const sub = newSub(agentId);
    subAgentManager.noteStreamTaskChip(sub.id, 'task_started', { id: 'bg1', description: '방금 띄운 것' });

    expect(subAgentManager.sweepOrphanedBackgroundTasks()).not.toContain(agentId);
    expect(subAgentManager.hasLiveBackgroundTasks(agentId)).toBe(true);
  });

  it('PTY(CMD) 세션은 걷지 않는다 — 우리가 띄운 자식이 아니라 프로세스 유무로 판단할 수 없다', () => {
    const agentId = 'agent-orphan-cmd';
    const sub = newSub(agentId);
    subAgentManager.markCmdSubActivity(`term:${agentId}:${sub.id}`, /*isStop=*/false);
    subAgentManager.noteStreamTaskChip(sub.id, 'task_started', { id: 'bg1', description: '터미널이 띄운 것' });

    expect(subAgentManager.sweepOrphanedBackgroundTasks(later())).not.toContain(agentId);
    expect(subAgentManager.hasLiveBackgroundTasks(agentId)).toBe(true);
  });

  it('걷힌 작업은 "방금 끝난 것" 꼬리로 남는다 — 소리 없이 사라지지 않는다', () => {
    const agentId = 'agent-orphan-tail';
    const sub = newSub(agentId);
    subAgentManager.noteStreamTaskChip(sub.id, 'task_started', { id: 'bg-tail', description: '유령이 될 것' });
    subAgentManager.sweepOrphanedBackgroundTasks(later());

    const finished = subAgentManager.getFinishedSubagentTasks()?.[agentId] ?? [];
    expect(finished.some((f) => f.id === 'bg-tail' && f.subAgentId === sub.id)).toBe(true);
  });

  it('유령이 걷히면 그 탭 도트도 함께 내려간다 — 장부만 비고 파란 점이 남지 않는다', () => {
    const agentId = 'agent-orphan-dot';
    const sub = newSub(agentId);
    subAgentManager.noteStreamTaskChip(sub.id, 'task_started', { id: 'bg1', description: 'X' });
    expect(subAgentManager.getSub(sub.id)!.status).toBe('active');

    subAgentManager.sweepOrphanedBackgroundTasks(later());
    expect(subAgentManager.getSub(sub.id)!.status).toBe('idle');
  });

  it('훅 대차대조 항목도 같은 사실로 걷힌다 — SubagentStop 이 끝내 안 와도', () => {
    const agentId = 'agent-orphan-hook';
    const sub = newSub(agentId);
    subAgentManager.noteSubagentTaskStart(agentId, 'tool-1', sub.id, { description: '끝 신고를 못 한 자식' });
    expect(subAgentManager.hasPendingSubagentTasks(agentId)).toBe(true);

    expect(subAgentManager.sweepOrphanedBackgroundTasks(later())).toContain(agentId);
    expect(subAgentManager.hasPendingSubagentTasks(agentId)).toBe(false);
  });

  it('소유 탭이 미상인 훅 항목은 건드리지 않는다 — 어느 세션의 프로세스를 볼지 알 수 없다', () => {
    const agentId = 'agent-orphan-unknown';
    subAgentManager.noteSubagentTaskStart(agentId, 'tool-1', undefined, { description: '주인 미상' });

    expect(subAgentManager.sweepOrphanedBackgroundTasks(later())).not.toContain(agentId);
    expect(subAgentManager.hasPendingSubagentTasks(agentId)).toBe(true);
    subAgentManager.clearPendingSubagentTasks(agentId); // 싱글턴이라 뒤 테스트에 새지 않게 회수
  });

  it('조용해도, 아무리 오래 돌아도 걷지 않는다 — 프로세스가 살아 있으면 그대로 둔다', () => {
    const agentId = 'agent-long-poll';
    const sub = newSub(agentId);
    // 이 탭이 한 턴을 처리 중 = 프로세스가 있다(긴 패키징·무한 폴링을 돌리는 중일 수 있다).
    subAgentManager.noteSubagentTaskStart(agentId, 'tool-1', sub.id, { description: '몇 시간짜리 패키징' });
    subAgentManager.noteStreamTaskChip(sub.id, 'task_started', { id: 'bg-long', description: '무한 폴링' });
    subAgentManager.markCmdSubActivity(`term:${agentId}:${sub.id}`, /*isStop=*/false);

    // 하루가 지나도 판정은 시간이 아니라 사실이므로 아무것도 걷히지 않는다.
    const aDayLater = Date.now() + 24 * 60 * 60 * 1000;
    expect(subAgentManager.sweepOrphanedBackgroundTasks(aDayLater)).not.toContain(agentId);
    expect(subAgentManager.hasPendingSubagentTasks(agentId)).toBe(true);
    expect(subAgentManager.hasLiveBackgroundTasks(agentId)).toBe(true);
  });

  it('세션 프로세스가 끝나면 그 즉시 내려간다 — 유예도 주기 대조도 기다리지 않는다', () => {
    const agentId = 'agent-process-end';
    const sub = newSub(agentId);
    subAgentManager.noteStreamTaskChip(sub.id, 'task_started', { id: 'bg-exit', description: '패키징' });
    expect(subAgentManager.hasLiveBackgroundTasks(agentId)).toBe(true);

    // 자식 프로세스 종료 핸들러가 부르는 것과 같은 호출 — 시각을 밀지 않아도 즉시 내려간다.
    expect(subAgentManager.retireLiveBackgroundTasks(sub.id)).toBe(true);
    expect(subAgentManager.hasLiveBackgroundTasks(agentId)).toBe(false);

    // 소리 없이 사라지지 않는다 — "방금 끝난 것" 꼬리에 남는다.
    const finished = subAgentManager.getFinishedSubagentTasks()?.[agentId] ?? [];
    expect(finished.some((f) => f.id === 'bg-exit' && f.subAgentId === sub.id)).toBe(true);
  });

  it('훅 대차대조도 세션 종료 시 같은 자리에서 내려간다 — 두 장부가 같은 이벤트를 본다', () => {
    const agentId = 'agent-process-end-hook';
    const sub = newSub(agentId);
    subAgentManager.noteSubagentTaskStart(agentId, 'tool-1', sub.id, { description: '끝 신고를 놓칠 자식' });
    expect(subAgentManager.hasPendingSubagentTasks(agentId)).toBe(true);

    // 자식 프로세스 종료 핸들러가 부르는 것과 같은 호출.
    expect(subAgentManager.clearPendingSubagentTasksForSession(agentId, sub.id)).toBe(1);
    expect(subAgentManager.hasPendingSubagentTasks(agentId)).toBe(false);
    expect(subAgentManager.getSub(sub.id)!.status).not.toBe('active');
  });

  it('소유 탭이 다른 항목은 그 세션이 끝나도 남는다 — 남의 자식을 대신 내리지 않는다', () => {
    const agentId = 'agent-process-end-sibling';
    const mine = newSub(agentId, 'sub-sibling-mine');
    const other = newSub(agentId, 'sub-sibling-other');
    subAgentManager.noteSubagentTaskStart(agentId, 'tool-mine', mine.id, { description: '내 자식' });
    subAgentManager.noteSubagentTaskStart(agentId, 'tool-other', other.id, { description: '옆 탭 자식' });

    expect(subAgentManager.clearPendingSubagentTasksForSession(agentId, mine.id)).toBe(1);
    expect(subAgentManager.getRunningSubagentTasks()?.[agentId]?.map((t) => t.id)).toEqual(['tool-other']);
  });

  it('내릴 것이 없으면 조용히 false — 프로세스 종료마다 불려도 안전', () => {
    const sub = newSub('agent-process-end-empty');
    expect(subAgentManager.retireLiveBackgroundTasks(sub.id)).toBe(false);
  });

  it('실제 끝 통지를 받으면 그 즉시 내려간다 — 이것이 정상 경로다', () => {
    const agentId = 'agent-real-signal';
    const sub = newSub(agentId);
    subAgentManager.noteStreamTaskChip(sub.id, 'task_started', { id: 'bkw14fevc', description: 'Run packaging in background' });
    expect(subAgentManager.hasLiveBackgroundTasks(agentId)).toBe(true);

    // CLI 가 실제로 보내는 것: status=completed (+ exit code 요약).
    subAgentManager.noteStreamTaskChip(sub.id, 'task_notification', { id: 'bkw14fevc', status: 'completed' });
    expect(subAgentManager.hasLiveBackgroundTasks(agentId)).toBe(false);
  });

  it('탭이 사라진 뒤 남은 장부는 통째로 회수된다', () => {
    const agentId = 'agent-orphan-gone-tab';
    const sub = newSub(agentId);
    subAgentManager.noteStreamTaskChip(sub.id, 'task_started', { id: 'bg1', description: 'X' });
    subAgentManager.remove(sub.id);

    expect(subAgentManager.sweepOrphanedBackgroundTasks(later())).not.toContain(agentId);
    expect(subAgentManager.hasLiveBackgroundTasks(agentId)).toBe(false);
  });
});

describe('종료 전 경고 판정 — 지금 끊기면 잃는 일', () => {
  // 매니저가 모듈 싱글턴이라 다른 테스트가 남긴 항목이 섞인다 — **증분**으로 잰다.
  it('백그라운드 Task 가 늘면 그만큼 센다', () => {
    const before = subAgentManager.getRunningWorkSummary().backgroundTasks;
    const agentId = 'agent-quit-bg';
    const sub = newSub(agentId);
    subAgentManager.noteSubagentTaskStart(agentId, 'child', sub.id, { description: 'X' });

    expect(subAgentManager.getRunningWorkSummary().backgroundTasks).toBe(before + 1);
  });

  it('스트림 칩 작업도 같은 셈에 들어간다', () => {
    const before = subAgentManager.getRunningWorkSummary().backgroundTasks;
    const sub = newSub('agent-quit-stream');
    subAgentManager.noteStreamTaskChip(sub.id, 'task_started', { id: 'bg-quit-1', description: '빌드' });

    expect(subAgentManager.getRunningWorkSummary().backgroundTasks).toBe(before + 1);
  });

  it('그 작업이 끝나면 셈에서 빠진다 — 다 끝났으면 묻지 않는다', () => {
    const before = subAgentManager.getRunningWorkSummary().backgroundTasks;
    const sub = newSub('agent-quit-drain');
    subAgentManager.noteStreamTaskChip(sub.id, 'task_started', { id: 'bg-quit-2' });
    subAgentManager.noteStreamTaskChip(sub.id, 'task_notification', { id: 'bg-quit-2', status: 'completed' });

    expect(subAgentManager.getRunningWorkSummary().backgroundTasks).toBe(before);
  });

  it('자식 프로세스를 처리 중인 세션이 없으면 세션 수는 0 — 표시만 남은 항목은 못 잃는 일이 아니다', () => {
    newSub('agent-quit-idle');
    expect(subAgentManager.getRunningWorkSummary().sessions).toBe(0);
  });
});
