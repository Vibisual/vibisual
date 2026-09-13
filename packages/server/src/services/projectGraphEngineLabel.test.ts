import { describe, expect, it } from 'vitest';
import { CODEX_AGENT_COLOR } from '@vibisual/shared';
import { ProjectGraph } from './projectGraph.js';

/**
 * §5.25 (B) — **엔진마다 자기 이름으로 태어난다.**
 *
 * 종전 `createCustomAgent` 는 `options.provider` 가 **있기만 하면** 로컬로 봤다. 코덱스가
 * 같은 축(`AgentConfig.provider`)에 두 번째 값으로 실려 들어오면서, 모델을 아직 안 문 코덱스
 * 버블이 `All Model N` 이라는 **남의 엔진 이름**을 달고 태어났다 — 캔버스가 정체를 거짓으로
 * 말하는 자리다(§5.19 (G) 가 All Model 배지에 대해 세운 것과 같은 규율).
 *
 * 그리고 엔진 축이 없는 에이전트는 실제로 클로드가 도는 것이므로 이름도 `Claude Agent N` 이다.
 * "Custom" 은 엔진이 하나뿐이던 시절의 이름이라 무엇으로 도는지를 말해 주지 않는다.
 */

const PROJECT_CWD = '/tmp/example-engine-label';

function makeGraph(): { graph: ProjectGraph; projectName: string } {
  const graph = new ProjectGraph();
  const info = graph.registerProject(PROJECT_CWD);
  return { graph, projectName: info.name };
}

describe('§5.25 (B) 엔진별 기본 라벨', () => {
  it('모델을 안 문 코덱스 버블은 Codex Agent 로 태어난다 (All Model 이 아니다)', () => {
    const { graph, projectName } = makeGraph();
    const agent = graph.createCustomAgent('', { x: 1, y: 2 }, projectName, {
      provider: { kind: 'codex-cli', modelId: '' },
    });

    expect(agent.label).toMatch(/^Codex Agent \d+$/);
    // 회귀의 정체 — 여기 `All Model` 이 나오면 남의 엔진 이름을 단 것이다.
    expect(agent.label).not.toContain('All Model');
    // 이름만 Codex가 아니어야 한다. provider가 저장돼야 전역 Claude 기본값을 상속하지 않고
    // Codex runner와 모델 선택 흐름으로 들어간다.
    expect(graph.getSnapshot().agentConfigs?.[agent.id]?.provider).toEqual({
      kind: 'codex-cli',
      modelId: '',
    });
    expect(graph.getSnapshot().agentConfigs?.[agent.id]?.color).toBe(CODEX_AGENT_COLOR);
  });

  it('모델명을 함께 주면 코덱스도 그 모델명이 라벨을 잇는다', () => {
    const { graph, projectName } = makeGraph();
    const agent = graph.createCustomAgent('', { x: 3, y: 4 }, projectName, {
      provider: { kind: 'codex-cli', modelId: 'gpt-5-codex', modelName: 'GPT-5 Codex' },
    });

    expect(agent.label).toBe('GPT-5 Codex');
  });

  it('모델을 안 문 로컬 버블은 종전대로 All Model 로 남는다 (§5.19 (B) 무변경)', () => {
    const { graph, projectName } = makeGraph();
    const agent = graph.createCustomAgent('', { x: 5, y: 6 }, projectName, {
      provider: { kind: 'local-llama', modelId: '' },
    });

    expect(agent.label).toMatch(/^All Model \d+$/);
  });

  it('엔진 축이 없으면 Claude Agent, 터미널이면 종전대로 CMD Agent', () => {
    const { graph, projectName } = makeGraph();
    const plain = graph.createCustomAgent('', { x: 0, y: 0 }, projectName);
    const cmd = graph.createCustomAgent('', { x: 1, y: 1 }, projectName, {
      executionMode: 'interactive-terminal',
    });

    expect(plain.label).toMatch(/^Claude Agent \d+$/);
    expect(cmd.label).toMatch(/^CMD Agent \d+$/);
  });

  it('사용자가 준 이름은 어떤 엔진에서도 그대로다', () => {
    const { graph, projectName } = makeGraph();
    const named = graph.createCustomAgent('내 리뷰어', { x: 7, y: 8 }, projectName, {
      provider: { kind: 'codex-cli', modelId: '' },
    });

    expect(named.label).toBe('내 리뷰어');
  });
});
