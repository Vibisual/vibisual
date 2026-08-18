/**
 * §5.11 v4.67 훅 세션 집행 판정의 **행동** 고정.
 *
 * 이 판정은 집행 주입 네 지점 중 유일하게 동작 검사가 없던 자리다. 배선 검사(`mounted.test.ts`)는
 * 서버 소스에 이름이 있는지만 보므로, 프로젝트 판정이 어긋나 **늘 빈 문자열**을 돌려줘도 초록이었다.
 * 그 상태는 화면에서도 안 보인다 — 외부 세션에 집행이 안 실렸다는 것은 아무 데도 안 뜬다.
 */
import { describe, it, expect } from 'vitest';
import { buildHookEnforcementBlock, type HookEnforcementDeps } from './hookEnforcement.js';

const BLOCK = '## 규칙\n- 하라.\n';

function deps(patch: Partial<HookEnforcementDeps> = {}): HookEnforcementDeps {
  return {
    agentBySession: () => ({ id: 'agent-1', label: 'Agent', customCreated: false }),
    projectPathForAgent: () => 'C:/repo/alpha',
    agentCwd: () => null,
    buildSection: () => BLOCK,
    log: () => {},
    ...patch,
  };
}

describe('훅 세션 집행 판정', () => {
  it('외부 세션에는 집행을 싣는다 — 이 경로가 없으면 사용자가 직접 돌리는 세션엔 한 글자도 안 간다', () => {
    expect(buildHookEnforcementBlock({ session_id: 's1', cwd: 'C:/repo/alpha' }, deps())).toBe(BLOCK);
  });

  it('우리가 띄운 세션에는 안 싣는다 — 프롬프트에 이미 있어 같은 블록이 매 턴 두 번 실린다', () => {
    const d = deps({ agentBySession: () => ({ id: 'agent-1', label: 'A', customCreated: true }) });
    expect(buildHookEnforcementBlock({ session_id: 's1', cwd: 'C:/repo/alpha' }, d)).toBe('');
  });

  it('프로젝트는 그래프 답이 우선이다 — 워크트리에서 돌면 cwd 는 켬/끔 키와 다르다', () => {
    let seen = '';
    const d = deps({
      projectPathForAgent: () => 'C:/repo/alpha',
      buildSection: (req) => { seen = req.projectPath; return BLOCK; },
    });
    buildHookEnforcementBlock({ session_id: 's1', cwd: 'C:/repo/alpha/.worktrees/x' }, d);
    expect(seen).toBe('C:/repo/alpha');
  });

  it('그래프가 프로젝트를 모르면 세션 cwd 로 떨어진다', () => {
    let seen = '';
    const d = deps({
      agentBySession: () => null,
      projectPathForAgent: () => null,
      agentCwd: () => 'C:/repo/beta',
      buildSection: (req) => { seen = req.projectPath; return BLOCK; },
    });
    buildHookEnforcementBlock({ session_id: 's1', cwd: 'C:/repo/gamma' }, d);
    expect(seen).toBe('C:/repo/beta');
  });

  it('그것도 없으면 훅이 준 cwd 를 쓴다', () => {
    let seen = '';
    const d = deps({
      agentBySession: () => null,
      projectPathForAgent: () => null,
      agentCwd: () => null,
      buildSection: (req) => { seen = req.projectPath; return BLOCK; },
    });
    buildHookEnforcementBlock({ session_id: 's1', cwd: 'C:/repo/gamma' }, d);
    expect(seen).toBe('C:/repo/gamma');
  });

  it('프로젝트를 끝내 모르면 아무것도 만들지 않는다 — 켬/끔 판정 자체가 불가능하다', () => {
    let called = false;
    const d = deps({
      agentBySession: () => null,
      projectPathForAgent: () => null,
      agentCwd: () => null,
      buildSection: () => { called = true; return BLOCK; },
    });
    expect(buildHookEnforcementBlock({ session_id: 's1' }, d)).toBe('');
    expect(called).toBe(false);
  });

  it('조립이 던져도 그 턴은 살아남는다 — 여기서 던지면 프롬프트 자체가 안 나간다', () => {
    let logged = false;
    const d = deps({
      buildSection: () => { throw new Error('boom'); },
      log: () => { logged = true; },
    });
    expect(buildHookEnforcementBlock({ session_id: 's1', cwd: 'C:/repo/alpha' }, d)).toBe('');
    expect(logged).toBe(true);
  });

  it('외부 세션으로 넘긴다고 표시한다 — customCreated 를 켜 보내면 조립부가 우리 세션으로 오인한다', () => {
    let seen: boolean | undefined;
    const d = deps({ buildSection: (req) => { seen = req.customCreated; return BLOCK; } });
    buildHookEnforcementBlock({ session_id: 's1', cwd: 'C:/repo/alpha' }, d);
    expect(seen).toBe(false);
  });
});
