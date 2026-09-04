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
  AGENT_TOOLS_BACKFILL_GEN,
  DEFAULT_AGENT_CONFIG,
  diffAgentConfigFromDefaults,
  hasAgentConfigOverrides,
  resolveAgentConfig,
  resolveAgentDefaults,
  sparsifyAgentConfig,
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
    // §4 (설정 3층) — 세대 도장이 있어야 "직접 고른 목록"이다. 없으면 백필이 한 번 채운다
    //   (그게 없어서 판올림 전 프리셋이 48종 목록을 가렸다 — 저장 경로가 이 도장을 찍는다).
    const defaults = resolveAgentDefaults({
      agentConfig: { tools: ['Read', 'Bash', 'Edit'], toolsBackfillGen: AGENT_TOOLS_BACKFILL_GEN, skills: ['a', 'b'] },
    });
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

  it('확장 사고도 켬이 기본이라 껐을 때만 다르다 — 그리고 그때만 저장된다', () => {
    const defaults = resolveAgentDefaults(undefined);
    expect(diffAgentConfigFromDefaults(saved({ thinking: undefined }), defaults)).toEqual([]);
    expect(diffAgentConfigFromDefaults(saved({ thinking: true }), defaults)).toEqual([]);
    expect(diffAgentConfigFromDefaults(saved({ thinking: false }), defaults)).toEqual(['thinking']);
    // 점이 붙는 칸이 곧 못 박히는 칸이다(§4 설정 3층) — 두 판정이 갈라지면 화면으로는 안 보인다.
    expect(sparsifyAgentConfig(saved({ thinking: true }), defaults)).not.toHaveProperty('thinking');
    expect(sparsifyAgentConfig(saved({ thinking: false }), defaults).thinking).toBe(false);
  });

  it('전역에서 사고를 끄면 안 건드린 에이전트도 따라 꺼진다 — 되켠 칸만 갈라진다', () => {
    const defaults = resolveAgentDefaults({ agentConfig: { thinking: false } });
    expect(resolveAgentConfig({}, { agentConfig: { thinking: false } }).thinking).toBe(false);
    expect(diffAgentConfigFromDefaults(saved({ thinking: false }), defaults)).toEqual([]);
    expect(diffAgentConfigFromDefaults(saved({ thinking: true }), defaults)).toEqual(['thinking']);
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

/**
 * §4 (설정 3층) — 저장은 **갈라진 칸만**, 읽기는 **세 층을 겹쳐서**.
 *
 * 점을 찍는 것과 저장하는 것이 **같은 판정**이어야 한다. 두 벌이 되면 "점은 없는데 값은 못 박혀
 * 있다"가 생기고, 그건 사용자가 화면으로는 절대 눈치챌 수 없는 어긋남이다.
 */
describe('갈라진 칸만 저장한다', () => {
  it('점이 붙은 칸이 곧 저장되는 칸이다', () => {
    const defaults = resolveAgentDefaults({ agentConfig: { model: 'sonnet' } });
    const config = saved({ model: 'sonnet', effort: 'high', maxTurns: 10 });

    const dotted = diffAgentConfigFromDefaults(config, defaults);
    const stored = Object.keys(sparsifyAgentConfig(config, defaults)).filter((k) => k !== 'toolsBackfillGen');

    expect(stored.sort()).toEqual([...dotted].sort());
  });

  it('손대지 않은 설정은 아무것도 저장하지 않는다', () => {
    const defaults = resolveAgentDefaults({ agentConfig: { model: 'sonnet', effort: 'high' } });
    expect(sparsifyAgentConfig({ ...defaults }, defaults)).toEqual({});
  });

  it('겹치면 원래 완성본으로 돌아온다(왕복 동등)', () => {
    const defaults = resolveAgentDefaults({ agentConfig: { model: 'sonnet' } });
    const config = saved({ model: 'opus', safeMode: true, maxTurns: 7 });

    const resolved = resolveAgentConfig(sparsifyAgentConfig(config, defaults), { agentConfig: { model: 'sonnet' } });

    expect(resolved.model).toBe('opus');
    expect(resolved.safeMode).toBe(true);
    expect(resolved.maxTurns).toBe(7);
  });

  it('위층이 정할 수 없는 정체성은 기본값과 같아 보여도 남긴다', () => {
    const defaults = resolveAgentDefaults(undefined);
    const stored = sparsifyAgentConfig({ ...defaults, executionMode: 'interactive-terminal' }, defaults);

    expect(stored.executionMode).toBe('interactive-terminal');
    // 정체성만으로는 "손댔다"가 아니다 — CMD 버블은 태어날 때부터 그것을 갖는다.
    expect(hasAgentConfigOverrides(stored)).toBe(false);
  });

  it('도구를 못 박으면 세대 도장이 함께 남는다(다음 판올림의 백필 대상)', () => {
    const defaults = resolveAgentDefaults(undefined);
    const stored = sparsifyAgentConfig({ ...defaults, tools: ['Read'] }, defaults);

    expect(stored.tools).toEqual(['Read']);
    expect(stored.toolsBackfillGen).toBe(AGENT_TOOLS_BACKFILL_GEN);
  });

  it('점을 안 찍는 색도 갈라지면 저장된다 — 두 목록이 묻는 질문이 다르다', () => {
    // `color` 는 점 목록에서만 빠진다(모든 버블에 붙으면 정보가 아니다). 저장에서는 빠지지
    // 않으므로 ① 고른 색은 그 버블에 못 박히고 ② 안 고른 버블은 전역 색을 따라간다.
    const defaults = resolveAgentDefaults({ agentConfig: { color: '#111111' } });

    expect(diffAgentConfigFromDefaults(saved({ color: '#ff0000' }), defaults)).toEqual([]);
    expect(sparsifyAgentConfig(saved({ color: '#ff0000' }), defaults).color).toBe('#ff0000');
    expect(sparsifyAgentConfig(saved({ color: '#111111' }), defaults).color).toBeUndefined();
  });
});
