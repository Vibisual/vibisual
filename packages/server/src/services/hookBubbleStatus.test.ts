/**
 * §2.4·§3.6 — 훅 생명주기가 버블·세션 도트 상태로 이어지는 자리.
 * ① 자기 턴이 `StopFailure` 로 끝나면 completed 가 아니라 error(바깥 훅 버블·CMD 버블·CMD 탭 도트).
 * ② 도구 없이 다시 도는 턴(새 프롬프트·대기 해제)은 버블을 active 로 올린다.
 * 커스텀(헤드리스) 버블은 sub 집계가 주인이라 어느 쪽도 직접 덮지 않는다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BubbleData } from '@vibisual/shared';
import { ProjectGraph } from './projectGraph.js';
import { graphManager } from './projectGraphManager.js';
import { subAgentManager } from './subAgentManager.js';
import { AgentTracker, setSnapshotScheduler } from './agentTracker.js';
import { bubbleResumeFrom, isFailedTurnEnd } from './hookEventClass.js';

const createdSubs: string[] = [];
let graph: ProjectGraph;
let tracker: AgentTracker;
const snapshots = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  graph = new ProjectGraph();
  tracker = new AgentTracker();
  snapshots.mockClear();
  setSnapshotScheduler(snapshots);
  // 라우트가 부르는 매니저를 이 그래프로 잇는다(실제 HTTP 라우트·CLI 는 띄우지 않는다).
  vi.spyOn(graphManager, 'setAgentStatus').mockImplementation((sid, status) => graph.setAgentStatus(sid, status));
  vi.spyOn(graphManager, 'resumeAgentStatus').mockImplementation((sid, from) => graph.resumeAgentStatus(sid, from));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
  while (createdSubs.length > 0) {
    const id = createdSubs.pop();
    if (id) subAgentManager.remove(id);
  }
});

/** 바깥 Claude 세션의 훅 버블 — 도구 이벤트 하나로 세운다. */
function hookAgent(sessionId: string): BubbleData {
  graph.processHookEvent({ session_id: sessionId, hook_event_name: 'PreToolUse', tool_name: 'NoopTool', tool_input: {} });
  const agent = graph.getAgentBySession(sessionId);
  if (!agent) throw new Error(`hook agent not created: ${sessionId}`);
  return agent;
}

function statusOf(sessionId: string): string | undefined {
  return graph.getAgentBySession(sessionId)?.status;
}

/** 라우트의 자기 턴 종료 분기와 같은 호출. */
function ownTurnEnd(sessionId: string, event: 'Stop' | 'StopFailure'): void {
  tracker.markStop(sessionId, isFailedTurnEnd(event));
}

/** 라우트의 활동 분기와 같은 호출. */
function activity(sessionId: string, event: string): void {
  tracker.markActive(sessionId, bubbleResumeFrom(event));
}

function newSub(agentId: string): string {
  const sub = subAgentManager.create(agentId);
  createdSubs.push(sub.id);
  return sub.id;
}

describe('실패로 끝난 턴은 완료가 아니다', () => {
  it('바깥 훅 버블: StopFailure 는 error, Stop 은 completed', () => {
    hookAgent('hook-failed');
    hookAgent('hook-ok');
    ownTurnEnd('hook-failed', 'StopFailure');
    ownTurnEnd('hook-ok', 'Stop');

    expect(statusOf('hook-failed')).toBe('error');
    expect(graph.getAgentBySession('hook-failed')?.fadeStartedAt).toBeUndefined();
    expect(statusOf('hook-ok')).toBe('completed');
    expect(snapshots).toHaveBeenCalled();
  });

  it('error 는 완료 페이드·뒤이은 세션 끝으로 내려가지 않고 다음 프롬프트에서 active 로 돌아간다', () => {
    hookAgent('hook-retry');
    ownTurnEnd('hook-retry', 'StopFailure');
    vi.advanceTimersByTime(10 * 60_000);
    graph.expireCompletedAgents();
    expect(statusOf('hook-retry')).toBe('error');
    tracker.markStop('hook-retry', isFailedTurnEnd('SessionEnd'));
    expect(statusOf('hook-retry')).toBe('error');

    activity('hook-retry', 'UserPromptSubmit');
    expect(statusOf('hook-retry')).toBe('active');
  });

  it('CMD 버블과 그 탭 도트도 error 로 남는다 — 엔진 턴 끝 신호가 error 를 idle 로 세탁하지 않는다', () => {
    const cmd = graph.createCustomAgent('Term', undefined, null, { executionMode: 'interactive-terminal' });
    const subId = newSub(cmd.id);
    const termId = `term:${cmd.id}:${subId}`;
    subAgentManager.markCmdSubActivity(termId, false);
    expect(subAgentManager.getSub(subId)?.status).toBe('active');

    subAgentManager.markCmdSubActivity(termId, true, isFailedTurnEnd('StopFailure'));
    ownTurnEnd(cmd.path, 'StopFailure');
    expect(subAgentManager.getSub(subId)?.status).toBe('error');
    expect(statusOf(cmd.path)).toBe('error');

    subAgentManager.markCmdSubActivity(termId, true);
    expect(subAgentManager.getSub(subId)?.status).toBe('error');

    subAgentManager.markCmdSubActivity(termId, false);
    activity(cmd.path, 'UserPromptSubmit');
    expect(subAgentManager.getSub(subId)?.status).toBe('active');
    expect(statusOf(cmd.path)).toBe('active');
  });

  it('헤드리스 커스텀 버블은 sub 집계가 정한다 — 훅의 StopFailure 가 직접 칠하지 않는다', () => {
    const agent = graph.createCustomAgent('Headless');
    const subId = newSub(agent.id);
    subAgentManager.getSub(subId)!.status = 'active';
    expect(graph.recomputeCustomAgentStatus(agent.id)).toBe(true);

    ownTurnEnd(agent.path, 'StopFailure');
    expect(statusOf(agent.path)).toBe('active');

    subAgentManager.getSub(subId)!.status = 'idle';
    ownTurnEnd(agent.path, 'StopFailure');
    expect(statusOf(agent.path)).toBe('completed');
  });
});

describe('도구 없이 다시 도는 턴은 버블을 올린다', () => {
  it('완료된 훅 버블에 새 프롬프트가 오면 텍스트만 답하는 동안에도 active 다', () => {
    hookAgent('hook-text');
    ownTurnEnd('hook-text', 'Stop');
    snapshots.mockClear();

    activity('hook-text', 'UserPromptSubmit');
    expect(statusOf('hook-text')).toBe('active');
    expect(tracker.activeCount()).toBe(1);
    expect(snapshots).toHaveBeenCalled();
  });

  it.each(['ElicitationResult', 'PermissionDenied'])('%s 는 승인 대기를 내리고 active 로 돌린다', (event) => {
    hookAgent('hook-wait');
    graph.setAgentNotificationStatus('hook-wait', 'awaiting_permission');
    expect(statusOf('hook-wait')).toBe('awaiting_permission');

    activity('hook-wait', event);
    expect(statusOf('hook-wait')).toBe('active');
  });

  it('늦게 온 대기 해제는 끝난 턴을 되살리지 않는다', () => {
    hookAgent('hook-late');
    ownTurnEnd('hook-late', 'Stop');
    activity('hook-late', 'ElicitationResult');
    expect(statusOf('hook-late')).toBe('completed');
  });

  it('유휴 세션에도 오는 활동 신호는 버블을 깨우지 않는다', () => {
    hookAgent('hook-quiet');
    ownTurnEnd('hook-quiet', 'Stop');
    for (const event of ['Notification', 'FileChanged', 'SessionStart']) activity('hook-quiet', event);
    expect(statusOf('hook-quiet')).toBe('completed');
    expect(graphManager.resumeAgentStatus).not.toHaveBeenCalled();
  });

  it('헤드리스 커스텀 버블은 직접 덮지 않고 재계산만 한다', () => {
    const agent = graph.createCustomAgent('Headless');
    const subId = newSub(agent.id);
    subAgentManager.getSub(subId)!.status = 'active';
    graph.recomputeCustomAgentStatus(agent.id);
    subAgentManager.getSub(subId)!.status = 'idle';
    graph.recomputeCustomAgentStatus(agent.id);
    expect(statusOf(agent.path)).toBe('completed');

    activity(agent.path, 'UserPromptSubmit');
    expect(statusOf(agent.path)).toBe('completed');

    subAgentManager.getSub(subId)!.status = 'active';
    activity(agent.path, 'UserPromptSubmit');
    expect(statusOf(agent.path)).toBe('active');
  });

  it('모르는 세션의 프롬프트로 버블을 새로 만들지 않는다', () => {
    activity('hook-unknown', 'UserPromptSubmit');
    expect(graph.getAgentBySession('hook-unknown')).toBeNull();
  });
});
