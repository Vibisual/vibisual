/**
 * §5.11 v3.88 — 2차 배치 플러그인 판정 고정 테스트.
 *
 * 전부 순수 함수라 UI 없이 조합만으로 검증된다. 특히 "배지가 상시 점등되면 신호가 죽는다"는 규율이
 * 회귀로 무너지지 않게, **언제 조용해야 하는지**를 함께 못 박는다.
 */
import { describe, it, expect } from 'vitest';
import type { AgentConfig, AgentEvent, SubAgent } from '@vibisual/shared';
import { judgeLeastPrivilege } from './least-privilege/leastPrivilege.js';
import { judgeBlastRadius } from './sdk/judgments/blastRadius.js';
import { judgeAutonomy } from './autonomy-level/index.js';
import { computeLongHorizon } from './long-horizon/index.js';
import { judgeRogue } from './rogue-agent/index.js';

function cfg(patch: Partial<AgentConfig> = {}): AgentConfig {
  return { model: 'sonnet', tools: ['Read', 'Grep', 'Glob', 'Bash'], permissionMode: 'default', skills: [], ...patch };
}

describe('least-privilege', () => {
  it('읽기 도구만 있으면 강한 도구는 잠긴 Bash 하나뿐이다', () => {
    const v = judgeLeastPrivilege(cfg({ tools: ['Read', 'Grep'] }));
    expect(v.byClass.mutating).toEqual(['Bash']);
    expect(v.powerCount).toBe(1);
    expect(v.level).toBe('tight');
  });

  it('쓰기 + 외부 도구가 모두 붙으면 wide 로 올라간다', () => {
    const v = judgeLeastPrivilege(cfg({ tools: ['Read', 'Write', 'Edit', 'Bash', 'WebFetch', 'WebSearch'] }));
    expect(v.powerCount).toBe(5);
    expect(v.level).toBe('wide');
  });

  it('차단한 도구는 denied 로 잡히고 실효 집합에서 빠진다', () => {
    const v = judgeLeastPrivilege(cfg({ tools: ['Read', 'Write', 'Bash'], disallowedTools: ['Write'] }));
    expect(v.denied).toEqual(['Write']);
    expect(v.byClass.mutating).not.toContain('Write');
  });

  it('잠긴 Bash 는 locked 로 따로 보고된다 (왜 못 끄는지 설명하기 위함)', () => {
    expect(judgeLeastPrivilege(cfg()).locked).toEqual(['Bash']);
  });
});

describe('blast-radius', () => {
  it('읽기+실행+전송이면 반경이 크다', () => {
    const v = judgeBlastRadius(cfg({ tools: ['Read', 'Write', 'Bash'] }));
    expect(v.canWrite).toBe(true);
    expect(v.canSend).toBe(true);
    expect(v.level).toBe('large');
  });

  it('격리(worktree)는 반경을 한 단계 깎는다 — 치명적 3요소와 달리 여기서는 감쇄가 맞다', () => {
    const plain = judgeBlastRadius(cfg({ tools: ['Read', 'Write', 'Bash'] }));
    const iso = judgeBlastRadius(cfg({ tools: ['Read', 'Write', 'Bash'], isolation: 'worktree' }));
    expect(iso.score).toBe(plain.score - 1);
  });

  it('점수는 0 아래로 내려가지 않는다', () => {
    const v = judgeBlastRadius(cfg({ tools: [], disallowedTools: ['Bash'], isolation: 'worktree' }));
    expect(v.score).toBe(0);
    expect(v.level).toBe('small');
  });
});

describe('autonomy-level', () => {
  it('plan=제안만 / default=승인 후 / bypassPermissions=자율', () => {
    expect(judgeAutonomy(cfg({ permissionMode: 'plan' })).level).toBe('suggest');
    expect(judgeAutonomy(cfg({ permissionMode: 'default' })).level).toBe('approve');
    expect(judgeAutonomy(cfg({ permissionMode: 'acceptEdits' })).level).toBe('approve');
    expect(judgeAutonomy(cfg({ permissionMode: 'bypassPermissions' })).level).toBe('autonomous');
  });

  it('무응답 정책 기본값은 자동 허용 — 자리를 비우면 사실상 자율이 된다', () => {
    expect(judgeAutonomy(cfg()).autoAllowOnTimeout).toBe(true);
    expect(judgeAutonomy(cfg({ permissionTimeoutPolicy: 'deny' })).autoAllowOnTimeout).toBe(false);
  });
});

describe('long-horizon', () => {
  const ev = (ts: number, todos?: AgentEvent['todos']): AgentEvent =>
    ({ id: String(ts), message: 'm', timestamp: ts, source: 'user', ...(todos ? { todos } : {}) });

  it('이벤트가 없으면 전부 0 이고 short 다', () => {
    const s = computeLongHorizon(undefined, 1_000_000);
    expect(s.turns).toBe(0);
    expect(s.elapsedMs).toBe(0);
    expect(s.level).toBe('short');
  });

  it('턴이 문턱을 넘으면 등급이 오른다', () => {
    const many = Array.from({ length: 20 }, (_, i) => ev(1000 + i));
    expect(computeLongHorizon(many, 2000).level).toBe('long');
    const lots = Array.from({ length: 45 }, (_, i) => ev(1000 + i));
    expect(computeLongHorizon(lots, 2000).level).toBe('verylong');
  });

  it('할일 진행률은 마지막으로 기록된 목록에서 읽는다', () => {
    const events = [
      ev(1000, [{ content: 'a', status: 'completed' }, { content: 'b', status: 'pending' }]),
      ev(2000, [{ content: 'a', status: 'completed' }, { content: 'b', status: 'completed' }]),
      ev(3000),
    ];
    const s = computeLongHorizon(events, 4000);
    expect(s.todoDone).toBe(2);
    expect(s.todoTotal).toBe(2);
    expect(s.elapsedMs).toBe(3000);
  });
});

describe('rogue-agent', () => {
  const sub = (status: string, lastActivityAt: number): SubAgent =>
    ({ id: 's', sessionId: 's', label: 'Sub', parentAgentId: 'a', status: status as SubAgent['status'], createdAt: 0, lastActivityAt });

  const NOW = 10 * 60 * 60_000;

  it('세션이 살아 있고 오래 조용하면 잊힌 것으로 본다', () => {
    const v = judgeRogue([sub('running', NOW - 7 * 60 * 60_000)], NOW);
    expect(v.level).toBe('forgotten');
    expect(v.liveSessions).toBe(1);
  });

  it('세션이 끝났으면 오래 조용해도 정상이다 — 유휴가 곧 이상은 아니다', () => {
    const v = judgeRogue([sub('completed', NOW - 7 * 60 * 60_000)], NOW);
    expect(v.level).toBe('active');
    expect(v.liveSessions).toBe(0);
  });

  it('방금 움직였으면 활동 중', () => {
    expect(judgeRogue([sub('running', NOW - 60_000)], NOW).level).toBe('active');
  });

  it('세션이 없으면 조용해도 경보하지 않는다', () => {
    const v = judgeRogue([], NOW);
    expect(v.level).toBe('active');
    expect(v.idleMs).toBe(0);
  });
});
