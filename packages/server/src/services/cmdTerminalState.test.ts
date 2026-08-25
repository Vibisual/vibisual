import { describe, it, expect, beforeEach } from 'vitest';
import { splitCmdPane } from '@vibisual/shared';
import { subAgentManager } from './subAgentManager.js';

/**
 * §4 (CMD 터미널 업그레이드 ① QA) — 터미널 상태 신호가 **세션 하나의 결론**으로 합쳐지는지.
 *
 * 처음 구현은 pane 마다 감지기가 따로 돌면서 같은 sub 를 서로 덮어썼다 — 왼쪽 pane 에서 빌드가
 * 돌고 오른쪽 pane 이 권한 프롬프트에서 멈춰 있으면 탭 도트가 1초 간격으로 working↔blocked 를
 * 오갔고, 분할을 쓰는 순간 상태 표시가 통째로 무의미해졌다. 그 합의 규칙을 여기서 고정한다.
 */

const created: string[] = [];

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

describe('applyCmdTerminalSignal — 단일 pane', () => {
  it('working 은 세션을 active 로 올리고 blocked 를 걷는다', () => {
    const agentId = 'agent-cmd-state-1';
    const sub = newSub(agentId);
    const termId = `term:${agentId}:${sub.id}`;

    subAgentManager.applyCmdTerminalSignal({ termId, state: 'blocked', reason: 'Continue? (y/n)' });
    expect(subAgentManager.getSub(sub.id)!.blocked).toBe(true);

    subAgentManager.applyCmdTerminalSignal({ termId, state: 'working' });
    const after = subAgentManager.getSub(sub.id)!;
    expect(after.blocked).toBeUndefined();
    expect(after.status).toBe('active');
  });

  it('blocked 는 상태 유니온을 늘리지 않고 플래그로만 선다(§2.4 잠듦 선례)', () => {
    const agentId = 'agent-cmd-state-2';
    const sub = newSub(agentId);
    subAgentManager.applyCmdTerminalSignal({
      termId: `term:${agentId}:${sub.id}`,
      state: 'blocked',
      reason: 'Do you want to proceed?',
    });
    const s = subAgentManager.getSub(sub.id)!;
    expect(s.status).toBe('active');       // 살아 있는 세션이다 — 완료로 내리지 않는다
    expect(s.blocked).toBe(true);
    expect(s.blockedReason).toContain('Do you want to proceed?');
  });

  it('idle 은 active 를 내리되 error 는 세탁하지 않는다', () => {
    const agentId = 'agent-cmd-state-3';
    const sub = newSub(agentId);
    const termId = `term:${agentId}:${sub.id}`;

    subAgentManager.applyCmdTerminalSignal({ termId, state: 'working' });
    subAgentManager.applyCmdTerminalSignal({ termId, state: 'idle' });
    expect(subAgentManager.getSub(sub.id)!.status).toBe('idle');

    subAgentManager.getSub(sub.id)!.status = 'error';
    subAgentManager.applyCmdTerminalSignal({ termId, state: 'idle' });
    expect(subAgentManager.getSub(sub.id)!.status).toBe('error');
  });

  it('sub 가 없는 termId 는 조용히 무시한다(실행 런처·메인 탭)', () => {
    expect(subAgentManager.applyCmdTerminalSignal({ termId: 'run:agent-x:cfg-1', state: 'working' })).toBe(false);
    expect(subAgentManager.applyCmdTerminalSignal({ termId: 'nonsense', state: 'working' })).toBe(false);
  });
});

describe('applyCmdTerminalSignal — 분할 pane 합의', () => {
  /** pane '0' + '1' 로 갈린 세션 하나를 세운다. */
  function splitSession(agentId: string): { subId: string; base: string } {
    const sub = newSub(agentId);
    subAgentManager.setCmdPaneTree(sub.id, splitCmdPane(null, '0', '1', 'row'));
    return { subId: sub.id, base: `term:${agentId}:${sub.id}` };
  }

  it('하나라도 돌고 있으면 working 이 이긴다 — 막힌 pane 이 있어도 깜빡이지 않는다', () => {
    const { subId, base } = splitSession('agent-cmd-pane-1');

    subAgentManager.applyCmdTerminalSignal({ termId: `${base}#1`, state: 'blocked', reason: 'Continue? (y/n)' });
    expect(subAgentManager.getSub(subId)!.blocked).toBe(true);

    // 왼쪽 pane 에서 빌드가 돈다 → 세션은 "돌고 있다".
    subAgentManager.applyCmdTerminalSignal({ termId: base, state: 'working' });
    expect(subAgentManager.getSub(subId)!.blocked).toBeUndefined();

    // 막힌 pane 이 같은 상태를 다시 신고해도 결론이 뒤집히지 않는다(종전엔 여기서 깜빡였다).
    subAgentManager.applyCmdTerminalSignal({ termId: `${base}#1`, state: 'blocked', reason: 'Continue? (y/n)' });
    expect(subAgentManager.getSub(subId)!.blocked).toBeUndefined();
  });

  it('도는 pane 이 멎으면 그때 막힌 pane 의 blocked 가 드러난다', () => {
    const { subId, base } = splitSession('agent-cmd-pane-2');

    subAgentManager.applyCmdTerminalSignal({ termId: base, state: 'working' });
    subAgentManager.applyCmdTerminalSignal({ termId: `${base}#1`, state: 'blocked', reason: 'Password:' });
    expect(subAgentManager.getSub(subId)!.blocked).toBeUndefined();

    subAgentManager.applyCmdTerminalSignal({ termId: base, state: 'idle' });
    const s = subAgentManager.getSub(subId)!;
    expect(s.blocked).toBe(true);
    expect(s.blockedReason).toBe('Password:');
  });

  it('모든 pane 이 조용해야 세션이 idle 이다', () => {
    const { subId, base } = splitSession('agent-cmd-pane-3');

    subAgentManager.applyCmdTerminalSignal({ termId: base, state: 'working' });
    subAgentManager.applyCmdTerminalSignal({ termId: `${base}#1`, state: 'idle' });
    expect(subAgentManager.getSub(subId)!.status).toBe('active');

    subAgentManager.applyCmdTerminalSignal({ termId: base, state: 'idle' });
    expect(subAgentManager.getSub(subId)!.status).toBe('idle');
  });

  it('닫은 pane 의 상태는 세션을 붙들지 않는다 — 유령 working 방지', () => {
    const { subId, base } = splitSession('agent-cmd-pane-4');

    subAgentManager.applyCmdTerminalSignal({ termId: `${base}#1`, state: 'working' });
    subAgentManager.applyCmdTerminalSignal({ termId: base, state: 'idle' });
    expect(subAgentManager.getSub(subId)!.status).toBe('active'); // #1 이 아직 돈다

    // pane '1' 을 닫는다(분할 해제) → 그 pane 의 'working' 도 함께 사라져야 한다.
    subAgentManager.setCmdPaneTree(subId, null);
    subAgentManager.applyCmdTerminalSignal({ termId: base, state: 'idle' });
    expect(subAgentManager.getSub(subId)!.status).toBe('idle');
  });
});

describe('setCmdPaneTree', () => {
  it('같은 트리를 다시 넣으면 변경 없음으로 답한다(불필요한 저장·전파 방지)', () => {
    const sub = newSub('agent-cmd-pane-5');
    const tree = splitCmdPane(null, '0', '1', 'row');

    expect(subAgentManager.setCmdPaneTree(sub.id, tree)).toBe(true);
    expect(subAgentManager.setCmdPaneTree(sub.id, tree)).toBe(false);
    expect(subAgentManager.setCmdPaneTree(sub.id, null)).toBe(true);
  });

  it('없는 세션에는 조용히 실패한다', () => {
    expect(subAgentManager.setCmdPaneTree('sub-does-not-exist', null)).toBe(false);
  });
});
