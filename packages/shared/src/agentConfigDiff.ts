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
import { AGENT_TOOLS_BACKFILL_GEN, DEFAULT_AGENT_CONFIG, backfillAgentTools, buildAgentsFlagJson } from './constants.js';

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

/**
 * §4 (설정 3층) — **위층에서 물려받지 않는 축.** 저장할 때 비교 없이 그대로 남긴다.
 *
 * 위 `AGENT_CONFIG_IDENTITY_FIELDS` 와 **한 글자 차이(`color`)** 라 헷갈리기 쉬운데, 두 목록은
 * 묻는 질문이 다르다. 저쪽은 "화면에 점을 찍을까"(표시)이고 이쪽은 "이 값을 이 버블에
 * 못 박을까"(저장)다. `color` 는 설정 창에 칸이 **있으므로** 물려받는 축이다 — 그래서 저장에서는
 * 빠지고(전역 색을 바꾸면 안 고친 버블이 따라온다), 표시에서만 빠진다(모든 버블에 점이 붙으면
 * 그 점은 정보가 아니다). 반대로 여기 있는 여섯은 설정 창에 칸이 없어 **물려받을 위층이 없다**.
 */
export const AGENT_CONFIG_NON_INHERITED_FIELDS: readonly string[] = [
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
 * 그 시점의 **기본값 한 벌**(= 3층 중 아래 두 층). `DEFAULT_AGENT_CONFIG` 위에 설정 창이 저장한
 * 프리셋을 얹는다. 자기 값이 없는 에이전트는 **읽을 때마다** 이 결과를 그대로 쓰므로, 설정 창을
 * 고치면 이미 만들어져 있던 버블도 함께 따라온다.
 *
 * 스프레드 대신 키를 돌며 얹는 이유: 프리셋에 `model: undefined` 같은 키가 실재하면 스프레드는
 * 내장 기본을 **지운다**(JSON 왕복에서는 지워지지만, 메모리로 건네받은 객체는 그렇지 않다).
 *
 * 프리셋의 도구 목록을 **얹기 전에** 백필하는 이유는 순서 때문이다 — 내장 기본을 깐 뒤에는
 * 현행 세대 도장이 이미 찍혀 있어 백필이 "이미 돌았다"고 판단한다. 그래서 판올림 전에 저장된
 * 11종짜리 프리셋이 48종 목록을 가리고도 아무 검사에 걸리지 않았다(실측).
 */
export function resolveAgentDefaults(userDefaults?: AgentDefaultsSource): AgentConfig {
  const merged: AgentConfig = {
    ...DEFAULT_AGENT_CONFIG,
    tools: [...DEFAULT_AGENT_CONFIG.tools],
    skills: [...DEFAULT_AGENT_CONFIG.skills],
  };
  const preset = userDefaults?.agentConfig ? backfillAgentTools(userDefaults.agentConfig) : undefined;
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
export function normalizeAgentFieldForCompare(field: AgentConfigComparedField | string, value: unknown): string {
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

/**
 * 두 값이 그 필드의 규칙상 다른가.
 *
 * 이름을 `string` 으로도 받는 이유는 **저장 쪽이 목록이 아니라 객체의 키를 돈다**는 데 있다
 * (`sparsifyAgentConfig`). 비교 목록에 넣는 것을 잊은 새 축이 "언제나 기본값과 같다"로 접혀
 * 조용히 사라지는 일을 막는다 — 모르는 이름은 아래 일반 접힘 규칙을 그대로 탄다.
 */
export function agentFieldDiffers(field: AgentConfigComparedField | string, a: unknown, b: unknown): boolean {
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

// ─── §4 (설정 3층) 에이전트 → 설정 창 → 내장 ────────────────────────────────
//
// 종전에는 층이 **없었다**. 전역 기본값은 `createCustomAgent` 가 버블을 만드는 그 순간
// 전체를 복사해 넣는 **씨앗**이었고(그래서 SSOT §4 v2.42 가 "기존 에이전트엔 영향 ❌" 이라
// 적었다), 그 뒤로 설정 창을 아무리 고쳐도 이미 있는 버블에는 닿지 않았다. 저장분이 "내가
// 고른 것"이 아니라 "그때의 전역값 한 벌"이라 **어느 칸이 사용자의 뜻인지 구분할 데이터가
// 없었던 것**이 원인이다.
//
// 이제 저장하는 것은 **갈라진 칸만**(sparse)이고, 읽는 순간 세 층을 겹쳐 완성한다 —
// `--autocompact` 하나만 쓰던 `resolveAutoCompact` 의 규율을 설정 전체로 넓힌 것이다.
// 그 결과 "안 건드린 칸은 설정 창을 따라가고, 건드린 칸은 그 버블에 못 박힌다"가 성립한다.

/**
 * 세 층을 겹쳐 **그 에이전트의 완성된 설정**을 만든다: 내장 → 설정 창 → 이 에이전트.
 *
 * 반환값은 항상 완전한 `AgentConfig` 라, 이 함수를 거친 뒤로는 종전과 똑같은 객체를 다룬다
 * (스폰 인자 조립·화면·전선 어디도 3층을 알 필요가 없다 — 아는 곳은 저장소 하나다).
 */
export function resolveAgentConfig(
  overrides?: Partial<AgentConfig> | null,
  userDefaults?: AgentDefaultsSource,
): AgentConfig {
  const merged = resolveAgentDefaults(userDefaults);
  if (overrides) {
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) continue;
      (merged as unknown as Record<string, unknown>)[key] = Array.isArray(value) ? [...value] : value;
    }
  }
  return merged;
}

/**
 * 완성된 설정에서 **위층과 갈라진 칸만** 남긴다. 저장되는 것은 이 결과다.
 *
 * 접힘 규칙은 화면의 점을 찍는 것과 **같은 함수**를 쓴다(`agentFieldDiffers`) — 두 벌이 되면
 * "점은 없는데 값은 못 박혀 있다"가 생기고, 그건 사용자가 화면으로는 절대 눈치챌 수 없는
 * 어긋남이다. 목록이 아니라 **넘어온 객체의 키**를 도는 이유는 §4 규약과 같다: 비교 목록에
 * 넣는 것을 잊은 새 축이 조용히 사라지는 쪽보다, 모르는 축을 일반 규칙으로 접는 쪽이 안전하다.
 *
 * `toolsBackfillGen` 은 값이 아니라 `tools` 에 붙는 **도장**이라 따로 다룬다 — 목록을 못 박은
 * 설정만 그 도장을 갖는다(도장만 남으면 다음 판올림의 백필이 채울 목록이 없는 채로 돈다).
 */
export function sparsifyAgentConfig(
  config: Partial<AgentConfig> | null | undefined,
  defaults: AgentConfig,
): Partial<AgentConfig> {
  if (!config) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (value === undefined) continue;
    if (key === 'toolsBackfillGen') continue;
    if (AGENT_CONFIG_NON_INHERITED_FIELDS.includes(key)) {
      out[key] = Array.isArray(value) ? [...value] : value;
      continue;
    }
    if (agentFieldDiffers(key, value, (defaults as unknown as Record<string, unknown>)[key])) {
      out[key] = Array.isArray(value) ? [...value] : value;
    }
  }
  if (Array.isArray(out['tools'])) {
    out['toolsBackfillGen'] = config.toolsBackfillGen ?? AGENT_TOOLS_BACKFILL_GEN;
  }
  return out as Partial<AgentConfig>;
}

/**
 * 이 에이전트가 **자기 값을 하나라도 갖고 있는가**(= 사용자가 손댔는가).
 *
 * 정체성 축(`provider`·`executionMode` …)은 세지 않는다 — CMD 버블은 태어날 때부터 그것을
 * 갖는데, 그걸 "손댔다"로 세면 만들자마자 자동 동기화에서 빠져 버린다.
 */
export function hasAgentConfigOverrides(overrides?: Partial<AgentConfig> | null): boolean {
  if (!overrides) return false;
  return Object.keys(overrides).some(
    (key) => key !== 'toolsBackfillGen' && !AGENT_CONFIG_NON_INHERITED_FIELDS.includes(key),
  );
}
