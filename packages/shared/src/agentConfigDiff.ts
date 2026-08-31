/**
 * §4 — 에이전트 **개별 설정**이 **전역 기본값**(설정 창 › Agent Defaults)과 어디서 갈라지는가.
 *
 * 두 화면(`OptionsWindow` 의 Agent Defaults · 버블마다 열리는 `AgentConfigPopup`)은 같은 필드를
 * 같은 모양으로 그린다. 그래서 열어 놓고 보면 **어느 칸이 이 버블만의 값인지** 알 방법이 없었다 —
 * 전역을 바꿔 둔 뒤에도 옛 값을 그대로 쥔 에이전트가 화면상 구별되지 않는다.
 *
 * 판정을 shared 한 곳에 두는 이유는 **"미설정"의 표기가 필드마다 다르기 때문**이다
 * (`effort: 'default'` · `isolation: 'none'` · `maxTurns: 0` · `autoCompact: ''` ·
 * `forwardSubagentText: undefined` = 켬). 그 접힘 규칙이 화면 코드에 흩어지면 같은 값을 두고
 * 한쪽은 "다름", 다른 쪽은 "같음"이라 답하는 날이 온다.
 */

import type { AgentConfig, AgentDefinition, UserDefaults } from './types.js';
import { DEFAULT_AGENT_CONFIG, buildAgentsFlagJson } from './constants.js';

/**
 * 비교에서 빼는 축 — **버블마다 다른 게 정상**인 정체성과, 이 창이 만지지 않는 통과용 필드.
 *
 * `color` 를 넣으면 거의 모든 버블에 표식이 붙어 **신호가 아니게 된다**(v4.25 배지 교훈:
 * 모든 버블에 똑같이 붙는 표시는 참이어도 정보가 아니다). `provider`·`executionMode`·`cliKind`
 * 는 그 버블의 정체이고, `mcpServers`·`rulesHistory`·`presetId` 는 다른 화면이 채우는 값이다.
 */
export const AGENT_CONFIG_IDENTITY_FIELDS: readonly string[] = [
  'color',
  'presetId',
  'executionMode',
  'cliKind',
  'provider',
  'mcpServers',
  'rulesHistory',
];

/** 비교하는 축 — 이 배열의 **순서가 곧 요약 목록의 나열 순서**다(창의 위에서 아래). */
export const AGENT_CONFIG_COMPARED_FIELDS = [
  'model',
  'modelVersion',
  'contextWindow',
  'fastMode',
  'permissionMode',
  'permissionTimeoutPolicy',
  'customMode',
  'rules',
  'tools',
  'disallowedTools',
  'maxTurns',
  'isolation',
  'effort',
  'memory',
  'subagentDepth',
  'maxBudgetUsd',
  'fallbackModel',
  'autoCompact',
  'compactAfterTurn',
  'agentCanCompact',
  'settingSources',
  'excludeDynamicSystemPromptSections',
  'safeMode',
  'forwardSubagentText',
  'replayUserMessages',
  'promptSuggestions',
  'includeHookEvents',
  'betas',
  'agentDefinitions',
  'pluginDirs',
  'bashDefaultTimeoutMs',
  'bashMaxTimeoutMs',
  'skills',
] as const;

export type AgentConfigComparedField = (typeof AGENT_CONFIG_COMPARED_FIELDS)[number];

/**
 * `maxTurns` 입력칸이 **0(미설정)을 표현하지 못한다** — `min=1` 이라 빈 값 대신 이 숫자를 보여 준다.
 * 그래서 "저장분이 0" 과 "칸에 3000" 은 같은 뜻이며, 이 접힘이 없으면 **손대지도 않은 신규
 * 에이전트에 표식이 붙는다**(폼은 3000, 기본은 0). 창의 초기값(`AgentConfigPopup`)과 같은 수여야 한다.
 */
export const AGENT_MAX_TURNS_UI_FALLBACK = 3000;

/** 전역 기본값이 정하지 못하는(= 그 창에 칸이 없는) 축은 내장 기본이 곧 기본값이다. */
type AgentDefaultsSource = Pick<UserDefaults, 'agentConfig'> | null | undefined;

/**
 * 그 시점의 **기본값 한 벌**. `DEFAULT_AGENT_CONFIG` 위에 설정 창이 저장한 프리셋을 얹는다 —
 * `createCustomAgent` 가 신규 에이전트를 만들 때 쓰는 머지와 같은 규칙이어야 "새로 만든 직후에는
 * 표식이 하나도 없다"가 성립한다.
 *
 * 스프레드 대신 키를 돌며 얹는 이유: 프리셋에 `model: undefined` 같은 키가 실재하면 스프레드는
 * 내장 기본을 **지운다**(JSON 왕복에서는 지워지지만, 메모리로 건네받은 객체는 그렇지 않다).
 */
export function resolveAgentDefaults(userDefaults?: AgentDefaultsSource): AgentConfig {
  const merged: AgentConfig = {
    ...DEFAULT_AGENT_CONFIG,
    tools: [...DEFAULT_AGENT_CONFIG.tools],
    skills: [...DEFAULT_AGENT_CONFIG.skills],
  };
  const preset = userDefaults?.agentConfig;
  if (preset) {
    for (const [key, value] of Object.entries(preset)) {
      if (value === undefined) continue;
      (merged as unknown as Record<string, unknown>)[key] = Array.isArray(value) ? [...value] : value;
    }
  }
  return merged;
}

/**
 * 한 필드를 **비교 가능한 문자열**로 접는다. 여기서 하는 일은 셋뿐이다 —
 * ① 미설정의 여러 표기를 하나로, ② 배열은 **집합**으로(순서는 뜻이 없다), ③ 나머지는 문자열로.
 */
export function normalizeAgentFieldForCompare(field: AgentConfigComparedField, value: unknown): string {
  // §4 (CLI 사양 추종) — 서브에이전트 정의는 **객체 배열**이라 아래 `String(v)` 접기가 통하지 않는다
  //   (전부 `[object Object]` 가 되어 서로 다른 정의가 같아 보인다). 대신 **CLI 로 나가는 그 JSON**
  //   을 정본으로 삼는다 — 같은 인자를 만들어 내는 두 설정은 실제로 같은 설정이다(빈 항목·이름
  //   다듬기·중복 제거가 이미 그 안에서 접힌다).
  if (field === 'agentDefinitions') {
    return buildAgentsFlagJson(value as AgentDefinition[] | undefined) ?? '';
  }
  if (Array.isArray(value)) {
    // 빈 목록은 **미설정과 같은 뜻**이다 — 창이 그렇게 저장한다(빈 칩 목록은 undefined 로 나간다).
    return value.length === 0 ? '' : JSON.stringify([...value].map((v) => String(v)).sort());
  }
  switch (field) {
    // 'default' = 오버라이드 없음. 드롭다운이 그 뜻으로 고르는 값이라 undefined 와 같다.
    case 'effort':
    case 'memory':
      return value === undefined || value === 'default' ? '' : String(value);
    case 'isolation':
      return value === undefined || value === 'none' ? '' : String(value);
    case 'customMode':
      return value === undefined || value === 'none' ? '' : String(value);
    // 'allow' 가 기본이라 저장되지 않는다 — 저장분에 없으면 allow 다.
    case 'permissionTimeoutPolicy':
      return value === 'deny' ? 'deny' : '';
    // 1M 이 기본이고 opt-out 만 저장한다.
    case 'contextWindow':
      return value === '200k' ? '200k' : '';
    // 유일하게 **켬이 기본**인 축 — 끌 때만 값(false)이 남는다.
    case 'forwardSubagentText':
      return value === false ? 'off' : '';
    // 칸이 0 을 표현하지 못한다(위 상수 주석).
    case 'maxTurns': {
      const n = typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : AGENT_MAX_TURNS_UI_FALLBACK;
      return String(n);
    }
    default:
      break;
  }
  if (value === undefined || value === null) return '';
  if (typeof value === 'boolean') return value ? 'on' : '';
  // 나머지 숫자는 전부 "0 = 미설정"(턴 깊이·예산·Bash 타임아웃).
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? String(value) : '';
  if (typeof value === 'string') return value.trim();
  return JSON.stringify(value);
}

/** 두 값이 그 필드의 규칙상 다른가. */
export function agentFieldDiffers(field: AgentConfigComparedField, a: unknown, b: unknown): boolean {
  return normalizeAgentFieldForCompare(field, a) !== normalizeAgentFieldForCompare(field, b);
}

/**
 * 기본값과 갈라진 필드 이름만 **화면 순서대로** 돌려준다.
 *
 * `skip` 은 **그 창이 지금 그리지 않는 축**을 빼는 자리다(로컬 버블의 CLI 옵션처럼). 화면에 점이
 * 3개인데 머리의 숫자가 5 면 그 숫자는 설명이 아니라 수수께끼가 된다 — 세는 것과 그리는 것이
 * 같아야 한다.
 */
export function diffAgentConfigFromDefaults(
  config: Partial<AgentConfig> | null | undefined,
  defaults: AgentConfig,
  options?: { skip?: Iterable<string> },
): AgentConfigComparedField[] {
  if (!config) return [];
  const skip = options?.skip ? new Set(options.skip) : null;
  const out: AgentConfigComparedField[] = [];
  for (const field of AGENT_CONFIG_COMPARED_FIELDS) {
    if (skip?.has(field)) continue;
    if (AGENT_CONFIG_IDENTITY_FIELDS.includes(field)) continue;
    if (agentFieldDiffers(field, (config as Record<string, unknown>)[field], (defaults as unknown as Record<string, unknown>)[field])) {
      out.push(field);
    }
  }
  return out;
}
