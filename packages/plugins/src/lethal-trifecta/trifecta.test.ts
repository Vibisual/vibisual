/**
 * §5.11 v3.88 — 치명적 3요소 판정 고정 테스트.
 *
 * 판정은 순수 함수라 UI 없이 조합만으로 전부 검증된다(기하 계산을 전용 단위 테스트로 묶는 것과 같은 이유).
 * 특히 "Bash 가 잠긴 도구라 ⓑ·ⓒ를 동시에 켠다"는 성질이 회귀로 사라지지 않게 못 박는다.
 */
import { describe, it, expect } from 'vitest';
import type { AgentConfig } from '@vibisual/shared';
import { judgeTrifecta, effectiveTools } from './trifecta.js';

function makeConfig(patch: Partial<AgentConfig> = {}): AgentConfig {
  return {
    model: 'sonnet',
    tools: ['Read', 'Grep', 'Glob', 'Bash'],
    permissionMode: 'default',
    skills: [],
    ...patch,
  };
}

describe('effectiveTools', () => {
  it('잠긴 Bash 는 tools 에서 빠져 있어도 실효 집합에 들어간다 (서버가 자동 포함하므로)', () => {
    const tools = effectiveTools(makeConfig({ tools: ['Read'] }));
    expect(tools.has('Bash')).toBe(true);
  });

  it('disallowedTools 는 마지막에 적용돼 잠긴 도구도 이긴다 (CLI 가 실제로 차단)', () => {
    const tools = effectiveTools(makeConfig({ tools: ['Read', 'Bash'], disallowedTools: ['Bash'] }));
    expect(tools.has('Bash')).toBe(false);
  });

  it('config 가 없으면 잠긴 도구만 남는다', () => {
    expect([...effectiveTools(undefined)]).toEqual(['Bash']);
  });
});

describe('judgeTrifecta — 다리 성립', () => {
  it('Read + Bash 만으로 세 다리가 전부 선다 (Bash 하나가 ⓑ·ⓒ 동시 점등)', () => {
    const v = judgeTrifecta(makeConfig({ tools: ['Read', 'Bash'] }));
    expect(v.count).toBe(3);
    expect(v.legs.untrusted.tools).toContain('Bash');
    expect(v.legs.egress.tools).toContain('Bash');
  });

  it('읽기 도구가 하나도 없으면 ⓐ가 끊긴다', () => {
    const v = judgeTrifecta(makeConfig({ tools: ['Bash'], disallowedTools: ['Read', 'Grep', 'Glob'] }));
    expect(v.legs.data.state).toBe('closed');
    expect(v.level).toBe('safe');
    expect(v.count).toBe(2);
  });

  it('Bash·WebFetch 를 모두 막으면 ⓒ가 끊긴다 (가장 싼 절단)', () => {
    const v = judgeTrifecta(makeConfig({
      tools: ['Read', 'Grep', 'Glob', 'Bash', 'WebFetch'],
      disallowedTools: ['Bash', 'WebFetch'],
    }));
    expect(v.legs.egress.state).toBe('closed');
    expect(v.level).toBe('safe');
    expect(v.cheapestCut).toBeNull();
  });

  it('WebSearch 는 ⓑ만 켜고 ⓒ는 켜지 않는다 (가져오기 전용)', () => {
    const v = judgeTrifecta(makeConfig({
      tools: ['Read', 'WebSearch', 'Bash'],
      disallowedTools: ['Bash'],
    }));
    expect(v.legs.untrusted.tools).toEqual(['WebSearch']);
    expect(v.legs.egress.state).toBe('closed');
  });
});

describe('judgeTrifecta — permissionMode 등급', () => {
  it('default 는 실행계 다리를 gated 로 낮춰 경고까지 가지 않는다', () => {
    const v = judgeTrifecta(makeConfig({ permissionMode: 'default' }));
    expect(v.legs.untrusted.state).toBe('gated');
    expect(v.legs.egress.state).toBe('gated');
    expect(v.level).toBe('caution');
    expect(v.unattended).toBe(false);
  });

  it('acceptEdits 도 Bash 는 여전히 승인 대상이라 gated', () => {
    const v = judgeTrifecta(makeConfig({ permissionMode: 'acceptEdits' }));
    expect(v.legs.egress.state).toBe('gated');
    expect(v.level).toBe('caution');
  });

  it('bypassPermissions 는 셋 다 open → critical', () => {
    const v = judgeTrifecta(makeConfig({ permissionMode: 'bypassPermissions' }));
    expect(v.level).toBe('critical');
    expect(v.unattended).toBe(true);
    expect(v.cheapestCut).toBe('egress');
  });

  it('plan 은 실행이 없어 ⓑ·ⓒ가 끊기고 읽기만 남는다', () => {
    const v = judgeTrifecta(makeConfig({ permissionMode: 'plan' }));
    expect(v.legs.data.state).toBe('open');
    expect(v.legs.untrusted.state).toBe('closed');
    expect(v.legs.egress.state).toBe('closed');
    expect(v.level).toBe('safe');
    expect(v.count).toBe(1);
  });
});

describe('judgeTrifecta — 격리는 판정과 분리', () => {
  it('worktree 격리는 다리 등급을 바꾸지 않고 isolated 플래그만 세운다', () => {
    const plain = judgeTrifecta(makeConfig({ permissionMode: 'bypassPermissions' }));
    const isolated = judgeTrifecta(makeConfig({ permissionMode: 'bypassPermissions', isolation: 'worktree' }));
    expect(isolated.isolated).toBe(true);
    expect(plain.isolated).toBe(false);
    expect(isolated.level).toBe(plain.level);
    expect(isolated.count).toBe(plain.count);
  });
});
