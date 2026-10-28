/**
 * §4 — 에이전트 개별 설정이 전역 기본값(Agent Defaults)과 어디서 갈라지는가. 두 화면이 같은 필드를 같은 모양으로 그려 눈으로는 못 가린다.
 * "미설정" 표기가 필드마다 달라(`effort: 'default'` · `isolation: 'none'` · `maxTurns: 0` · `autoCompact: ''` · `undefined` = 켬) 접힘 규칙을 shared 한 곳에 둔다.
 */

import type { AgentConfig, AgentDefinition, AgentEngineKind, UserDefaults } from './types.js';
import { AGENT_TOOLS_BACKFILL_GEN, DEFAULT_AGENT_CONFIG, backfillAgentTools, buildAgentsFlagJson, engineForProvider, providerForEngine } from './constants.js';

/**
 * 비교에서 빼는 축 — 버블마다 다른 게 정상인 정체성(`provider`·`executionMode`·`cliKind`)과 다른 화면이 채우는 값(`mcpServers`·`rulesHistory`·`presetId`).
 * `color` 를 넣으면 거의 모든 버블에 표식이 붙어 정보가 아니게 된다.
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
 * §4 (설정 3층) — 물려받지 않는 축(저장 때 비교 없이 남긴다). 위 목록과 `color` 하나 차이지만 질문이 다르다 — 저쪽은 표시, 이쪽은 저장.
 * `color` 는 설정 창에 칸이 있어 물려받는다(전역 색을 바꾸면 안 고친 버블이 따라온다). 여기 여섯은 칸이 없어 위층이 없다.
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
  // §5.3 #12-1-A — 도구별 확인 목록. 설정 창(전역 기본)에 칸이 없어 언제나 이 버블만의 값이다.
  'askTools',
  'maxTurns',
  'isolation',
  'effort',
  'memory',
  'subagentDepth',
  'maxBudgetUsd',
  'thinking',
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
  // §5.3 #9-1 (J~M) — 이 에이전트만의 토큰 절약. 전부 0 = 전역을 따름이라 기본값과 같으면 표식이 없다.
  'bashMaxOutputChars',
  'mcpMaxOutputTokens',
  'maxOutputTokens',
  'maxThinkingTokens',
  'autoCompactPct',
  'disableNonEssentialModelCalls',
  'skills',
] as const;

export type AgentConfigComparedField = (typeof AGENT_CONFIG_COMPARED_FIELDS)[number];

/** `maxTurns` 입력칸(`min=1`)이 0(미설정) 대신 보이는 수 — 저장분 0 과 칸의 3000 은 같은 뜻이다(안 접으면 새 에이전트에 표식이 붙는다). `AgentConfigPopup` 초기값과 같아야 한다. */
export const AGENT_MAX_TURNS_UI_FALLBACK = 3000;

/** 전역 기본값이 정하지 못하는(= 그 창에 칸이 없는) 축은 내장 기본이 곧 기본값이다. */
type AgentDefaultsSource = Pick<UserDefaults, 'agentConfig' | 'engineChoice' | 'engineConfigs' | 'projectEngineConfigs'> | null | undefined;

/**
 * 기본값 한 벌(3층 중 아래 둘) — `DEFAULT_AGENT_CONFIG` 위에 설정 창 프리셋. 자기 값이 없는 칸은 읽을 때마다 이것을 따라온다.
 * 키를 돌며 얹는다 — 스프레드는 `model: undefined` 같은 실재 키로 내장 기본을 지운다. 프리셋 도구는 얹기 전에 백필한다(뒤에 하면 세대 도장 때문에 건너뛰어 옛 11종이 48종을 가린다 — 실측).
 */
export function resolveAgentDefaults(userDefaults?: AgentDefaultsSource, engine?: AgentEngineKind, projectPath?: string | null): AgentConfig {
  const merged: AgentConfig = {
    ...DEFAULT_AGENT_CONFIG,
    tools: [...DEFAULT_AGENT_CONFIG.tools],
    skills: [...DEFAULT_AGENT_CONFIG.skills],
  };
  const main = userDefaults?.engineChoice?.kind ?? engineForProvider(userDefaults?.agentConfig?.provider);
  const selected = engine ?? main;
  const global = selected === main ? userDefaults?.agentConfig : userDefaults?.engineConfigs?.[selected];
  const project = projectPath ? userDefaults?.projectEngineConfigs?.[projectPath]?.[selected] : undefined;
  const config = { ...global, ...project };
  if (selected !== 'claude') config.provider = { ...providerForEngine(selected)!, ...global?.provider, ...project?.provider };
  else delete config.provider;
  if (config.provider && !config.provider.modelId && global?.provider?.modelId) {
    config.provider.modelId = global.provider.modelId;
    config.provider.modelName = global.provider.modelName;
  }
  const preset = backfillAgentTools(config);
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
  // §4 (CLI 사양 추종) — 서브에이전트 정의는 객체 배열이라 `String(v)` 가 전부 `[object Object]` 로 접힌다.
  //   CLI 로 나가는 JSON 을 정본으로 비교한다(같은 인자를 내면 같은 설정).
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
    // **켬이 기본**인 축 — 끌 때만 값(false)이 남는다. 여기 있는 이름은 `isXxxEnabled`(shared)
    //   가 `value !== false` 로 판정하는 것과 **같은 집합**이어야 한다. 한쪽만 늘면 "체크는
    //   켜져 있는데 점이 붙는다"가 생기고, 그건 화면으로는 설명되지 않는 어긋남이다.
    case 'forwardSubagentText':
    case 'thinking':
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

/** 두 값이 그 필드 규칙상 다른가. `string` 이름도 받는다 — 저장 쪽이 객체 키를 돌아, 모르는 새 축도 일반 규칙으로 접혀야 조용히 사라지지 않는다. */
export function agentFieldDiffers(field: AgentConfigComparedField | string, a: unknown, b: unknown): boolean {
  return normalizeAgentFieldForCompare(field, a) !== normalizeAgentFieldForCompare(field, b);
}

/** 기본값과 갈라진 필드 이름(화면 순서). `skip` 은 그 창이 그리지 않는 축 — 세는 것과 그리는 것이 같아야 숫자가 점 수와 맞는다. */
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

// §4 (설정 3층) 에이전트 → 설정 창 → 내장. 저장은 갈라진 칸만(sparse), 읽을 때 세 층을 겹친다(`resolveAutoCompact` 규율의 확장).
// 안 건드린 칸은 설정 창을 따라가고 건드린 칸은 못 박힌다 — 생성 때 전역값을 통째로 복사하면 어느 칸이 사용자의 뜻인지 가릴 수 없다.

/** 세 층(내장 → 설정 창 → 이 에이전트)을 겹친 완성 설정. 늘 완전한 `AgentConfig` 라 스폰·화면·전선은 3층을 모른다(아는 곳은 저장소 하나). */
export function resolveAgentConfig(
  overrides?: Partial<AgentConfig> | null,
  userDefaults?: AgentDefaultsSource,
  projectPath?: string | null,
): AgentConfig {
  const merged = resolveAgentDefaults(userDefaults, overrides ? engineForProvider(overrides.provider) : undefined, projectPath);
  if (overrides) {
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) continue;
      (merged as unknown as Record<string, unknown>)[key] = Array.isArray(value) ? [...value] : value;
    }
  }
  if (overrides?.provider) {
    const inherited = resolveAgentDefaults(userDefaults, engineForProvider(overrides.provider), projectPath).provider;
    merged.provider = { ...inherited, ...overrides.provider };
    if (!overrides.provider.modelId && inherited?.modelId) {
      merged.provider.modelId = inherited.modelId;
      merged.provider.modelName = inherited.modelName;
    }
  }
  return merged;
}

/**
 * 위층과 갈라진 칸만 남긴다(저장분). 접힘은 화면 점과 같은 `agentFieldDiffers`(두 벌이면 점 없이 값이 못 박힌다), 넘어온 객체의 키를 돈다.
 * `toolsBackfillGen` 은 `tools` 의 도장이라 목록을 못 박은 설정만 갖는다(도장만 남으면 백필이 빈 목록으로 돈다).
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
    // Provider identity/usage stays local; unchanged Codex preferences keep inheriting.
    if (key === 'provider' && config.provider?.kind === 'codex-cli') {
      const provider = { ...config.provider };
      if (defaults.provider?.modelId && provider.modelId === defaults.provider.modelId) {
        provider.modelId = '';
        delete provider.modelName;
      }
      for (const field of ['reasoningEffort', 'webSearch', 'networkAccess', 'modelVerbosity', 'codexTools', 'reasoningSummary', 'personality', 'serviceTier', 'autoCompactTokenLimit'] as const) {
        if (JSON.stringify(provider[field]) === JSON.stringify(defaults.provider?.[field])) delete provider[field];
      }
      out[key] = provider;
      continue;
    }
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

/** 자기 값이 하나라도 있는가(= 손댔는가). 정체성 축은 세지 않는다 — CMD 버블은 태어날 때부터 가져, 세면 자동 동기화에서 빠진다. */
export function hasAgentConfigOverrides(overrides?: Partial<AgentConfig> | null): boolean {
  if (!overrides) return false;
  return Object.keys(overrides).some(
    (key) => key !== 'toolsBackfillGen' && !AGENT_CONFIG_NON_INHERITED_FIELDS.includes(key),
  );
}
