import { describe, expect, it } from 'vitest';
import { normalizeAgentProvider } from '@vibisual/shared';
import { ProjectGraph } from './projectGraph.js';

/**
 * §5.19 — All Model(로컬 LLM) 버블의 두 가지를 못 박는다.
 *
 * ① **`provider` 가 껐다 켜도 살아남는가.** 이 축은 `AgentConfig` 안에 살아서 기존
 *    agentConfigs 영속 경로를 그대로 탄다 — "공짜로 따라온다"는 그 전제가 실제로 맞는지
 *    왕복으로 확인한다. 틀리면 사용자가 고른 모델이 재시작마다 사라진다.
 *
 * ② **기존 커스텀·CMD 에이전트가 그대로인가.** 이 기능의 조건은 "기존 Claude 경로 무영향"
 *    이었다. provider 를 주지 않은 에이전트의 설정에 이 축이 새어 들어오면 안 된다.
 */

const PROJECT_CWD = '/tmp/example-local-provider';

function makeGraph(): { graph: ProjectGraph; projectName: string } {
  const graph = new ProjectGraph();
  // 프로젝트가 등록돼 있어야 toProjectCheckpoint 의 이름 필터를 통과한다.
  const info = graph.registerProject(PROJECT_CWD);
  return { graph, projectName: info.name };
}

describe('§5.19 All Model — provider 축', () => {
  it('provider 를 주면 그 설정과 모델명 라벨이 함께 baked 된다', () => {
    const { graph, projectName } = makeGraph();
    const agent = graph.createCustomAgent('', { x: 5, y: 6 }, projectName, {
      provider: { kind: 'local-llama', modelId: 'qwen-coder-q4', modelName: 'Qwen Coder Q4' },
    });

    // 라벨의 주인공은 에이전트 번호가 아니라 모델명이다.
    expect(agent.label).toBe('Qwen Coder Q4');

    const config = graph.getSnapshot().agentConfigs?.[agent.id];
    expect(config?.provider).toEqual({
      kind: 'local-llama',
      modelId: 'qwen-coder-q4',
      modelName: 'Qwen Coder Q4',
    });
  });

  it('provider 없이 만든 에이전트에는 이 축이 새어 들어오지 않는다(기존 경로 무영향)', () => {
    const { graph, projectName } = makeGraph();
    const plain = graph.createCustomAgent('', { x: 0, y: 0 }, projectName);
    const cmd = graph.createCustomAgent('', { x: 1, y: 1 }, projectName, {
      executionMode: 'interactive-terminal',
    });

    const configs = graph.getSnapshot().agentConfigs ?? {};
    expect(configs[plain.id]?.provider).toBeUndefined();
    expect(configs[cmd.id]?.provider).toBeUndefined();
    // CMD 의 정체성은 종전 그대로여야 한다.
    expect(configs[cmd.id]?.executionMode).toBe('interactive-terminal');
  });

  it('모델 없이 만든 버블도 All Model 로 남는다 — 진입 순서 역전(§5.19 (B))', () => {
    const { graph, projectName } = makeGraph();
    const agent = graph.createCustomAgent('', { x: 1, y: 2 }, projectName, {
      provider: { kind: 'local-llama', modelId: '' },
    });

    // 아직 아무것도 안 문 버블 — 죽은 버블이 아니라 준비 중인 버블이다.
    expect(agent.label).toMatch(/^All Model [0-9]+$/);
    const config = graph.getSnapshot().agentConfigs?.[agent.id];
    expect(config?.provider?.kind).toBe('local-llama');
    expect(config?.provider?.modelId).toBe('');
  });

  it('모델을 매는 순간 라벨의 주인공이 모델명으로 바뀐다', () => {
    const { graph, projectName } = makeGraph();
    const agent = graph.createCustomAgent('', { x: 0, y: 0 }, projectName, {
      provider: { kind: 'local-llama', modelId: '' },
    });
    const base = graph.getSnapshot().agentConfigs?.[agent.id];
    expect(base).toBeDefined();

    graph.setAgentConfig(agent.id, {
      ...base!,
      provider: { kind: 'local-llama', modelId: 'qwen-q4', modelName: 'Qwen Q4' },
    });

    expect(graph.getSnapshot().agents.find((a) => a.id === agent.id)?.label).toBe('Qwen Q4');
  });

  it('사용자가 직접 바꾼 이름은 모델을 매도 그대로다', () => {
    const { graph, projectName } = makeGraph();
    const agent = graph.createCustomAgent('', { x: 0, y: 0 }, projectName, {
      provider: { kind: 'local-llama', modelId: '' },
    });
    graph.updateBubbleLabel(agent.id, '번역 담당');
    const base = graph.getSnapshot().agentConfigs?.[agent.id];

    graph.setAgentConfig(agent.id, {
      ...base!,
      provider: { kind: 'local-llama', modelId: 'qwen-q4', modelName: 'Qwen Q4' },
    });

    expect(graph.getSnapshot().agents.find((a) => a.id === agent.id)?.label).toBe('번역 담당');
  });

  it('모델을 바꾸는 것만으로는 라벨을 다시 건드리지 않는다', () => {
    const { graph, projectName } = makeGraph();
    const agent = graph.createCustomAgent('', { x: 0, y: 0 }, projectName, {
      provider: { kind: 'local-llama', modelId: 'first', modelName: 'First Model' },
    });
    const base = graph.getSnapshot().agentConfigs?.[agent.id];

    graph.setAgentConfig(agent.id, {
      ...base!,
      provider: { kind: 'local-llama', modelId: 'second', modelName: 'Second Model' },
    });

    // 처음 명명된 이름이 곧 사용자가 보고 있던 이름이다 — 모델을 갈아탄다고 이름이 튀면 안 된다.
    expect(graph.getSnapshot().agents.find((a) => a.id === agent.id)?.label).toBe('First Model');
  });

  it('normalizeAgentProvider: 모델 없는 provider 를 버리지 않는다(설정 저장이 정체를 지우던 자리)', () => {
    expect(normalizeAgentProvider({ kind: 'local-llama' })).toEqual({ kind: 'local-llama', modelId: '' });
    expect(normalizeAgentProvider({ kind: 'local-llama', modelId: ' q4 ', modelName: ' Q4 ' }))
      .toEqual({ kind: 'local-llama', modelId: 'q4', modelName: 'Q4' });
    // 클로드 버블(축 없음)은 그대로 없음이어야 한다.
    expect(normalizeAgentProvider(undefined)).toBeUndefined();
    expect(normalizeAgentProvider({ kind: 'openai' })).toBeUndefined();
  });

  it('껐다 켜도 고른 모델이 남는다 — 체크포인트 왕복', () => {
    const { graph, projectName } = makeGraph();
    const agent = graph.createCustomAgent('', { x: 9, y: 9 }, projectName, {
      provider: { kind: 'local-llama', modelId: 'llama-8b-q5', modelName: 'Llama 8B Q5', contextSize: 8192 },
    });

    const cp = graph.toProjectCheckpoint(projectName);

    // 새 인스턴스로 복원 — 재시작을 흉내낸다.
    const fresh = new ProjectGraph();
    fresh.restoreFromCheckpoint(cp);

    const restored = fresh.getSnapshot().agentConfigs?.[agent.id];
    expect(restored?.provider?.modelId).toBe('llama-8b-q5');
    expect(restored?.provider?.modelName).toBe('Llama 8B Q5');
    expect(restored?.provider?.contextSize).toBe(8192);
  });
});
