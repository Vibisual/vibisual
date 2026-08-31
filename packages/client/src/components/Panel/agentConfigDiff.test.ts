/**
 * §4 — "이 칸은 전역 기본값과 다르다" 표식의 판정 회귀.
 *
 * 이 표식이 지켜야 하는 성질은 딱 둘이다 — ① **손대지 않은 에이전트에는 하나도 붙지 않는다**
 * (붙는 순간 신호가 아니라 배경 소음이 된다), ② 사용자가 실제로 바꾼 칸에는 **빠짐없이** 붙는다.
 */

import { describe, it, expect } from 'vitest';
import {
  AGENT_CONFIG_COMPARED_FIELDS,
  AGENT_MAX_TURNS_UI_FALLBACK,
  DEFAULT_AGENT_CONFIG,
  diffAgentConfigFromDefaults,
  resolveAgentDefaults,
  type AgentConfig,
} from '@vibisual/shared';
import popupSource from './AgentConfigPopup.tsx?raw';

/** 창이 저장하는 모양(`buildPayload`)에 가까운 최소 config. */
function saved(patch: Partial<AgentConfig> = {}): AgentConfig {
  return { ...DEFAULT_AGENT_CONFIG, tools: [...DEFAULT_AGENT_CONFIG.tools], skills: [], ...patch };
}

describe('전역 기본값과의 차이 판정', () => {
  it('설정 창을 한 번도 만지지 않았으면 다른 칸이 없다', () => {
    const defaults = resolveAgentDefaults(undefined);
    expect(diffAgentConfigFromDefaults(saved(), defaults)).toEqual([]);
  });

  it('신규 에이전트가 물려받은 프리셋 그대로면 다른 칸이 없다', () => {
    // `createCustomAgent` 가 쓰는 머지와 같은 규칙이어야 성립한다.
    const userDefaults = { agentConfig: { model: 'sonnet', effort: 'high', maxTurns: 500 } };
    const defaults = resolveAgentDefaults(userDefaults);
    expect(diffAgentConfigFromDefaults(saved({ model: 'sonnet', effort: 'high', maxTurns: 500 }), defaults)).toEqual([]);
  });

  it('전역을 바꾼 뒤 옛 값을 쥔 에이전트는 그 칸만 다르다', () => {
    const defaults = resolveAgentDefaults({ agentConfig: { model: 'sonnet' } });
    expect(diffAgentConfigFromDefaults(saved({ model: 'opus' }), defaults)).toEqual(['model']);
  });

  it('최대 턴 칸의 3000 은 "미설정"과 같은 뜻이다', () => {
    // 입력칸이 0 을 표현하지 못해 창이 이 숫자를 보여 준다 — 접지 않으면 갓 만든 에이전트에 점이 뜬다.
    const defaults = resolveAgentDefaults(undefined);
    expect(defaults.maxTurns).toBe(0);
    expect(diffAgentConfigFromDefaults(saved({ maxTurns: AGENT_MAX_TURNS_UI_FALLBACK }), defaults)).toEqual([]);
    expect(diffAgentConfigFromDefaults(saved({ maxTurns: 200 }), defaults)).toEqual(['maxTurns']);
  });

  it('도구·스킬은 집합으로 본다 — 순서는 뜻이 없다', () => {
    const defaults = resolveAgentDefaults({ agentConfig: { tools: ['Read', 'Bash', 'Edit'], skills: ['a', 'b'] } });
    expect(diffAgentConfigFromDefaults(saved({ tools: ['Edit', 'Read', 'Bash'], skills: ['b', 'a'] }), defaults)).toEqual([]);
    expect(diffAgentConfigFromDefaults(saved({ tools: ['Read', 'Bash'], skills: ['a', 'b'] }), defaults)).toEqual(['tools']);
  });

  it('버블 색은 세지 않는다 — 버블마다 다른 게 정상이라 모두에 점이 붙는다', () => {
    const defaults = resolveAgentDefaults({ agentConfig: { color: '#111111' } });
    expect(diffAgentConfigFromDefaults(saved({ color: '#ff0000' }), defaults)).toEqual([]);
  });

  it('미설정의 여러 표기를 하나로 접는다', () => {
    const defaults = resolveAgentDefaults(undefined);
    const same = saved({
      effort: 'default',
      isolation: 'none',
      memory: 'default',
      customMode: 'none',
      permissionTimeoutPolicy: 'allow',
      autoCompact: '',
      fallbackModel: '   ',
      subagentDepth: 0,
      maxBudgetUsd: 0,
      bashDefaultTimeoutMs: 0,
      bashMaxTimeoutMs: 0,
      settingSources: [],
      betas: [],
      disallowedTools: [],
      safeMode: false,
      fastMode: false,
      // 'default'(기억 축의 "지정 안 함")는 창의 표시값이라 저장 타입에는 없다 — 옛 저장분이나
      //   손으로 넣은 값으로 섞여 들어와도 미설정으로 접히는지까지 함께 고정한다.
    } as unknown as Partial<AgentConfig>);
    expect(diffAgentConfigFromDefaults(same, defaults)).toEqual([]);
  });

  it('1M 창은 기본이고 200k 로 내린 것만 다르다', () => {
    const defaults = resolveAgentDefaults(undefined);
    expect(diffAgentConfigFromDefaults(saved({ contextWindow: undefined }), defaults)).toEqual([]);
    expect(diffAgentConfigFromDefaults(saved({ contextWindow: '200k' }), defaults)).toEqual(['contextWindow']);
  });

  it('서브에이전트 출력은 켬이 기본이라 껐을 때만 다르다', () => {
    const defaults = resolveAgentDefaults(undefined);
    expect(diffAgentConfigFromDefaults(saved({ forwardSubagentText: undefined }), defaults)).toEqual([]);
    expect(diffAgentConfigFromDefaults(saved({ forwardSubagentText: false }), defaults)).toEqual(['forwardSubagentText']);
  });

  it('창이 그리지 않는 축은 세지 않는다', () => {
    const defaults = resolveAgentDefaults({ agentConfig: { model: 'sonnet', effort: 'high' } });
    const config = saved({ model: 'opus', effort: 'low' });
    expect(diffAgentConfigFromDefaults(config, defaults)).toEqual(['model', 'effort']);
    expect(diffAgentConfigFromDefaults(config, defaults, { skip: ['model'] })).toEqual(['effort']);
  });

  it('프리셋의 undefined 키가 내장 기본을 지우지 않는다', () => {
    const defaults = resolveAgentDefaults({ agentConfig: { model: undefined, tools: undefined } });
    expect(defaults.model).toBe(DEFAULT_AGENT_CONFIG.model);
    expect(defaults.tools).toEqual(DEFAULT_AGENT_CONFIG.tools);
  });

  it('여러 칸이 갈리면 창의 위에서 아래 순서로 준다', () => {
    const defaults = resolveAgentDefaults(undefined);
    const out = diffAgentConfigFromDefaults(saved({ safeMode: true, model: 'sonnet', maxTurns: 10 }), defaults);
    expect(out).toEqual(['model', 'maxTurns', 'safeMode']);
  });
});

describe('설정 창이 모든 축에 표식을 달았는가', () => {
  // 축을 새로 열면서 점 붙이기를 잊으면, 그 칸만 조용히 "기본값과 같은 것처럼" 보인다.
  it('비교하는 모든 필드에 점이 붙어 있다', () => {
    const missing = AGENT_CONFIG_COMPARED_FIELDS.filter((f) => !popupSource.includes(`diffDot('${f}')`));
    expect(missing).toEqual([]);
  });

  it('머리의 요약은 화면과 같은 목록을 센다', () => {
    expect(popupSource).toContain('diffFields.length > 0');
    expect(popupSource).toContain('hiddenDiffFields');
  });
});
