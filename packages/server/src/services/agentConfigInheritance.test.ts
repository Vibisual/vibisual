import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AgentConfig, ProjectCheckpoint, UserDefaults } from '@vibisual/shared';
import { AGENT_TOOLS_BACKFILL_GEN, AVAILABLE_AGENT_TOOLS, DEFAULT_AGENT_CONFIG } from '@vibisual/shared';

/**
 * §4 (설정 3층) — 에이전트 설정이 **에이전트 → 설정 창 → 내장** 순으로 해소되는지 고정한다.
 *
 * 조용히 깨지는 자리가 넷이고, 넷 다 화면에는 정상으로 보인다:
 *
 *  (1) **씨앗으로 되돌아감** — 생성 시점에 전역 기본값을 복사해 넣으면 그 뒤로 설정 창을 고쳐도
 *      이미 있는 버블에 닿지 않는다(판올림 전 동작). 저장분이 "그때의 전역값 한 벌"이라
 *      어느 칸이 사용자의 뜻인지 구분할 데이터가 사라지는 것이 근본 원인이다.
 *  (2) **자동 동기화가 설정을 덮음** — 관측한 모델을 저장분에 써 넣으면서 도구 목록까지
 *      내장 기본으로 되돌리던 자리. 생성은 전역을 넣고 스냅샷은 내장으로 덮어, 설정 창의
 *      도구 선택이 신규 에이전트에서 한 번도 살아남지 못했다(실측 전역 11 · 저장분 22).
 *  (3) **전역 프리셋 백필 누락** — 도구 백필이 에이전트 설정에만 돌아, 판올림 전에 골라 둔
 *      전역 목록이 앞으로 만들 모든 에이전트의 상한이 됐다(실측 11/48). 게다가 씨앗에는
 *      현행 세대 도장이 함께 찍혀 어느 복원에서도 회복되지 않았다.
 *  (4) **구버전 저장분 마이그레이션** — 완성본만 있는 옛 체크포인트를 옮길 때 지금 동작이
 *      바뀌면 안 된다(갈라져 있던 칸은 갈라진 채, 같던 칸은 위층을 따라).
 */

/** 이 테스트가 흉내내는 설정 창의 전역 기본값. 실제 `~/.vibisual/user-defaults.json` 은 읽지 않는다. */
const globalDefaults: { value: UserDefaults } = { value: { updatedAt: 1 } };

function setGlobalDefaults(agentConfig: UserDefaults['agentConfig']): void {
  globalDefaults.value = { agentConfig, updatedAt: (globalDefaults.value.updatedAt ?? 0) + 1 };
}

vi.mock('./userDefaultsService.js', () => ({
  userDefaultsService: { get: () => globalDefaults.value, subscribe: () => () => {} },
}));

const { ProjectGraph } = await import('./projectGraph.js');

/** 창이 저장하는 것과 같은 모양 — 완성본 한 벌(서버가 갈라진 칸만 남긴다). */
function fullConfig(graph: InstanceType<typeof ProjectGraph>, agentId: string, patch: Partial<AgentConfig>): AgentConfig {
  const base = graph.getAgentConfig(agentId);
  if (!base) throw new Error(`no config for ${agentId}`);
  return { ...base, ...patch };
}

beforeEach(() => {
  globalDefaults.value = { updatedAt: 1 };
});

describe('§4 설정 3층 — 안 건드린 칸은 설정 창을 따라간다', () => {
  it('이미 만들어져 있던 에이전트도 설정 창 변경을 따라간다', () => {
    const graph = new ProjectGraph();
    const agent = graph.createCustomAgent('Follower');

    // 만들 때는 전역이 비어 있었다 → 내장 기본.
    expect(graph.getAgentConfig(agent.id)?.model).toBe(DEFAULT_AGENT_CONFIG.model);

    // 만든 **뒤에** 설정 창을 고친다. 종전에는 이 시점 이후로 영영 닿지 않았다.
    setGlobalDefaults({ model: 'sonnet', effort: 'high' });

    expect(graph.getAgentConfig(agent.id)?.model).toBe('sonnet');
    expect(graph.getAgentConfig(agent.id)?.effort).toBe('high');
  });

  it('개별로 고친 칸은 그 에이전트에 못 박히고, 나머지는 계속 따라간다', () => {
    const graph = new ProjectGraph();
    setGlobalDefaults({ model: 'sonnet', effort: 'high' });
    const agent = graph.createCustomAgent('Pinned');

    graph.setAgentConfig(agent.id, fullConfig(graph, agent.id, { model: 'opus' }));

    // 못 박은 칸 하나만 저장된다.
    expect(graph.getAgentConfigOverrides(agent.id)).toEqual({ model: 'opus' });

    // 전역을 다시 바꿔도 못 박은 칸은 그대로, 안 건드린 칸은 따라간다.
    setGlobalDefaults({ model: 'haiku', effort: 'max' });
    expect(graph.getAgentConfig(agent.id)?.model).toBe('opus');
    expect(graph.getAgentConfig(agent.id)?.effort).toBe('max');
  });

  it('창을 열어 아무것도 안 고치고 저장하면 못 박히는 칸이 없다', () => {
    const graph = new ProjectGraph();
    setGlobalDefaults({ model: 'sonnet', permissionMode: 'acceptEdits' });
    const agent = graph.createCustomAgent('Untouched');

    // 종전에는 이 한 번으로 그 시점 전역값 한 벌이 통째로 굳었다.
    graph.setAgentConfig(agent.id, fullConfig(graph, agent.id, {}));

    expect(graph.getAgentConfigOverrides(agent.id)).toEqual({});
    setGlobalDefaults({ model: 'haiku', permissionMode: 'plan' });
    expect(graph.getAgentConfig(agent.id)?.model).toBe('haiku');
    expect(graph.getAgentConfig(agent.id)?.permissionMode).toBe('plan');
  });

  it('못 박은 칸을 기본값으로 되돌리면 다시 위층을 따른다', () => {
    const graph = new ProjectGraph();
    setGlobalDefaults({ model: 'sonnet' });
    const agent = graph.createCustomAgent('Reverted');

    graph.setAgentConfig(agent.id, fullConfig(graph, agent.id, { model: 'opus' }));
    expect(graph.getAgentConfigOverrides(agent.id)).toEqual({ model: 'opus' });

    graph.setAgentConfig(agent.id, fullConfig(graph, agent.id, { model: 'sonnet' }));
    expect(graph.getAgentConfigOverrides(agent.id)).toEqual({});
  });

  it('CMD·로컬 버블의 정체성은 위층이 정할 수 없으므로 태어날 때부터 못 박힌다', () => {
    const graph = new ProjectGraph();
    const cmd = graph.createCustomAgent('Term', undefined, null, { executionMode: 'interactive-terminal' });

    expect(graph.getAgentConfigOverrides(cmd.id)?.executionMode).toBe('interactive-terminal');
    // 정체성만으로는 "사용자가 손댔다"가 되지 않는다(만들자마자 자동 동기화에서 빠지면 안 된다).
    expect(graph.getAgentConfig(cmd.id)?.executionMode).toBe('interactive-terminal');
  });
});

describe('§4 설정 3층 — 도구 목록', () => {
  it('전역 프리셋의 옛 도구 목록도 백필을 받는다(신규 에이전트가 도구를 잃지 않는다)', () => {
    const graph = new ProjectGraph();
    // 판올림 전에 저장된 모양 — 짧은 목록 + 세대 도장 없음.
    setGlobalDefaults({ tools: ['Read', 'Bash'] });
    const agent = graph.createCustomAgent('Toolful');

    const tools = graph.getAgentConfig(agent.id)?.tools ?? [];
    expect(tools).toEqual(expect.arrayContaining([...AVAILABLE_AGENT_TOOLS]));
    expect(tools).toContain('TodoWrite');
  });

  it('사용자가 전역에서 고른 도구 목록이 자동 동기화로 되돌아가지 않는다', () => {
    const graph = new ProjectGraph();
    // 세대 도장이 찍힌 = "이 목록은 지금 화면에서 직접 고른 것" 이라는 뜻.
    setGlobalDefaults({ tools: ['Read', 'Bash'], toolsBackfillGen: AGENT_TOOLS_BACKFILL_GEN });
    const agent = graph.createCustomAgent('Narrow');

    // 종전에는 이 스냅샷이 도구를 내장 전체 목록으로 되돌렸다("tools reset to all").
    graph.getSnapshot();

    expect(graph.getAgentConfig(agent.id)?.tools).toEqual(['Read', 'Bash']);
  });
});

describe('§4 설정 3층 — 영속화', () => {
  it('저장분은 갈라진 칸만 담고, 구버전용 완성본 사본도 함께 남는다', () => {
    const graph = new ProjectGraph();
    const project = graph.registerProject(process.cwd());
    setGlobalDefaults({ model: 'sonnet' });
    const agent = graph.createCustomAgent('Saved', undefined, project.name);
    graph.setAgentConfig(agent.id, fullConfig(graph, agent.id, { maxTurns: 42 }));

    const cp = graph.toProjectCheckpoint(project.name);
    expect(cp?.agentConfigOverrides?.[agent.id]).toEqual({ maxTurns: 42 });
    // 되돌아간 구버전 앱은 이 사본만 읽는다 — 빼면 그 사용자의 에이전트가 전부 내장 기본이 된다.
    expect(cp?.agentConfigs?.[agent.id]?.maxTurns).toBe(42);
    expect(cp?.agentConfigs?.[agent.id]?.model).toBe('sonnet');
  });

  it('갈라진 칸만 담긴 저장분을 왕복해도 못 박은 값과 따라가는 값이 그대로다', () => {
    const graph = new ProjectGraph();
    const project = graph.registerProject(process.cwd());
    setGlobalDefaults({ model: 'sonnet', effort: 'high' });
    const agent = graph.createCustomAgent('RoundTrip', undefined, project.name);
    graph.setAgentConfig(agent.id, fullConfig(graph, agent.id, { model: 'opus' }));
    const cp = graph.toProjectCheckpoint(project.name)!;

    const restored = new ProjectGraph();
    restored.restoreFromCheckpoint(cp);

    expect(restored.getAgentConfig(agent.id)?.model).toBe('opus');
    setGlobalDefaults({ model: 'haiku', effort: 'max' });
    expect(restored.getAgentConfig(agent.id)?.model).toBe('opus');
    expect(restored.getAgentConfig(agent.id)?.effort).toBe('max');
  });

  it('판올림 전 저장분(완성본만)을 열어도 지금 동작이 바뀌지 않는다', () => {
    const graph = new ProjectGraph();
    const project = graph.registerProject(process.cwd());
    const agent = graph.createCustomAgent('Legacy', undefined, project.name);
    const cp = graph.toProjectCheckpoint(project.name)!;

    // 옛 모양으로 되돌린다 — 완성본 한 벌만 있고 갈라진 칸 필드는 없다.
    const legacy: ProjectCheckpoint = {
      ...cp,
      agentConfigOverrides: undefined,
      agentConfigs: {
        [agent.id]: { ...DEFAULT_AGENT_CONFIG, model: 'opus', effort: 'high', tools: ['Read'], toolsBackfillGen: undefined },
      },
    };

    setGlobalDefaults({ model: 'sonnet' });
    const restored = new ProjectGraph();
    restored.restoreFromCheckpoint(legacy);

    // 기본값과 **달랐던** 칸은 갈라진 채 남아 계속 그 값으로 돈다.
    expect(restored.getAgentConfig(agent.id)?.model).toBe('opus');
    expect(restored.getAgentConfig(agent.id)?.effort).toBe('high');
    // 옛 저장분의 짧은 도구 목록은 **옮기기 전에** 백필된다(짧은 목록이 못 박히면 영영 못 받는다).
    expect(restored.getAgentConfig(agent.id)?.tools).toContain('TodoWrite');
  });

  it('전역과 같던 칸은 마이그레이션 뒤 위층을 따라간다', () => {
    const graph = new ProjectGraph();
    const project = graph.registerProject(process.cwd());
    const agent = graph.createCustomAgent('Same', undefined, project.name);
    const cp = graph.toProjectCheckpoint(project.name)!;

    setGlobalDefaults({ model: 'sonnet' });
    const legacy: ProjectCheckpoint = {
      ...cp,
      agentConfigOverrides: undefined,
      // 저장분의 값이 지금 전역값과 같다 = 사용자가 고른 게 아니라 그때의 전역값이었다.
      agentConfigs: { [agent.id]: { ...DEFAULT_AGENT_CONFIG, model: 'sonnet' } },
    };
    const restored = new ProjectGraph();
    restored.restoreFromCheckpoint(legacy);

    expect(restored.getAgentConfigOverrides(agent.id)?.model).toBeUndefined();
    setGlobalDefaults({ model: 'haiku' });
    expect(restored.getAgentConfig(agent.id)?.model).toBe('haiku');
  });
});
