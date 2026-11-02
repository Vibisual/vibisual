/**
 * §4 — 에이전트 개별 설정이 전역 기본값(Agent Defaults)과 어디서 갈라지는가. 두 화면이 같은 필드를 같은 모양으로 그려 눈으로는 못 가린다.
 * "미설정" 표기가 필드마다 달라(`effort: 'default'` · `isolation: 'none'` · `maxTurns: 0` · `autoCompact: ''` · `undefined` = 켬) 접힘 규칙을 shared 한 곳에 둔다.
 */

import type { AgentConfig, AgentDefinition, AgentEngineKind, AgentProvider, UserDefaults } from './types.js';
import { AGENT_TOOLS_BACKFILL_GEN, DEFAULT_AGENT_CONFIG, backfillAgentTools, buildAgentsFlagJson, engineForProvider, providerForEngine } from './constants.js';
import { normalizePathShape, pathKey, type PlatformName } from './pathCase.js';

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
 * §5.25 — 프로젝트 칸(`projectEngineConfigs`)은 폴더 경로가 키다. 저장한 쪽(화면 — 원래 표기)과 찾는 쪽(서버 — 접힌 키 ·
 * 드라이브 문자 `c:`/`C:`)의 표기가 달라 정확히 같은 키만 보면 저장한 설정이 조용히 빠진다. 같은 키 → 그 플랫폼 규칙(`pathKey`) 순으로 찾는다.
 * `platform` 을 모르면 모양만 맞춘다 — 대소문자를 접으면 linux 에서 다른 폴더의 설정을 빌려 온다.
 */
export function findProjectEngineConfigs(
  map: UserDefaults['projectEngineConfigs'],
  projectPath: string | null | undefined,
  platform?: PlatformName,
): Partial<Record<AgentEngineKind, Partial<AgentConfig>>> | undefined {
  if (!map || !projectPath) return undefined;
  const exact = map[projectPath];
  if (exact) return exact;
  const keyOf = (p: string): string => (platform ? pathKey(p, platform) : normalizePathShape(p));
  const want = keyOf(projectPath);
  for (const [key, value] of Object.entries(map)) {
    if (value && keyOf(key) === want) return value;
  }
  return undefined;
}

/**
 * 기본값 한 벌(3층 중 아래 둘) — `DEFAULT_AGENT_CONFIG` 위에 설정 창 프리셋. 자기 값이 없는 칸은 읽을 때마다 이것을 따라온다.
 * 키를 돌며 얹는다 — 스프레드는 `model: undefined` 같은 실재 키로 내장 기본을 지운다. 프리셋 도구는 얹기 전에 백필한다(뒤에 하면 세대 도장 때문에 건너뛰어 옛 11종이 48종을 가린다 — 실측).
 */
export function resolveAgentDefaults(userDefaults?: AgentDefaultsSource, engine?: AgentEngineKind, projectPath?: string | null, platform?: PlatformName): AgentConfig {
  const merged: AgentConfig = {
    ...DEFAULT_AGENT_CONFIG,
    tools: [...DEFAULT_AGENT_CONFIG.tools],
    skills: [...DEFAULT_AGENT_CONFIG.skills],
  };
  const main = userDefaults?.engineChoice?.kind ?? engineForProvider(userDefaults?.agentConfig?.provider);
  const selected = engine ?? main;
  const global = selected === main ? userDefaults?.agentConfig : userDefaults?.engineConfigs?.[selected];
  const project = findProjectEngineConfigs(userDefaults?.projectEngineConfigs, projectPath, platform)?.[selected];
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

// §4 (설정 3층) 에이전트 → 설정 창 → 내장. 저장은 이 버블이 정한 칸만(sparse), 읽을 때 세 층을 겹친다(`resolveAutoCompact` 규율의 확장).
// 안 건드린 칸은 설정 창을 따라가고 건드린 칸은 못 박힌다 — 생성 때 전역값을 통째로 복사하면 어느 칸이 사용자의 뜻인지 가릴 수 없다.

/** 세 층(내장 → 설정 창 → 이 에이전트)을 겹친 완성 설정. 늘 완전한 `AgentConfig` 라 스폰·화면·전선은 3층을 모른다(아는 곳은 저장소 하나). */
export function resolveAgentConfig(
  overrides?: Partial<AgentConfig> | null,
  userDefaults?: AgentDefaultsSource,
  projectPath?: string | null,
  platform?: PlatformName,
): AgentConfig {
  const merged = resolveAgentDefaults(userDefaults, overrides ? engineForProvider(overrides.provider) : undefined, projectPath, platform);
  if (overrides) {
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) continue;
      (merged as unknown as Record<string, unknown>)[key] = Array.isArray(value) ? [...value] : value;
    }
  }
  if (overrides?.provider) {
    const inherited = resolveAgentDefaults(userDefaults, engineForProvider(overrides.provider), projectPath, platform).provider;
    merged.provider = { ...inherited, ...overrides.provider };
    if (!overrides.provider.modelId && inherited?.modelId) {
      merged.provider.modelId = inherited.modelId;
      merged.provider.modelName = inherited.modelName;
    }
  }
  return merged;
}

/**
 * §4 (설정 3층) — 개별 저장의 기준선: 저장 직전 그 버블의 저장분·완성본. 위층과만 대조하면 고른 값이 그때 전역과 같다는 이유로 빠지고,
 * 다시 저장할 때 못 박아 둔 칸도 빠져 설정 창·내장 기본이 바뀌면 개별 설정이 따라 바뀐다. 창은 완성본으로 열리므로 완성본과 다른 칸이 곧 바꾼 칸이다.
 */
export interface AgentConfigSaveBaseline {
  overrides?: Partial<AgentConfig> | null;
  resolved?: AgentConfig | null;
}

/** 코덱스 하위 칸 중 위층(설정 창·프로젝트 칸)을 물려받는 것. */
const CODEX_INHERITED_PROVIDER_FIELDS = ['reasoningEffort', 'webSearch', 'networkAccess', 'modelVerbosity', 'codexTools', 'reasoningSummary', 'personality', 'serviceTier', 'autoCompactTokenLimit'] as const;

/** 코덱스 하위 칸의 비교 열쇠 — 키 순서와 빈 값(`undefined`·`''`·`{}`)의 표기 차이를 접는다(창은 빈 도구 정책을 `{}` 로 싣는다). */
function codexFieldKey(value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'object' && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return entries.length > 0 ? JSON.stringify(entries) : '';
  }
  return JSON.stringify(value);
}

/** 코덱스 `provider` 저장분 — 정체·사용량은 그대로, 물려받는 칸은 아래 셋(위층과 다름·이미 못 박힘·이번에 바꿈) 중 하나일 때만. 빈 모델 = 물려받기. */
function sparsifyCodexProvider(provider: AgentProvider, inherited: AgentProvider | undefined, baseline?: AgentConfigSaveBaseline | null): AgentProvider {
  const out: AgentProvider = { ...provider };
  const pinned = baseline?.overrides?.provider?.kind === 'codex-cli' ? baseline.overrides.provider : undefined;
  const before = baseline?.resolved?.provider?.kind === 'codex-cli' ? baseline.resolved.provider : undefined;
  const modelChanged = before !== undefined && (out.modelId ?? '') !== (before.modelId ?? '');
  if (inherited?.modelId && out.modelId === inherited.modelId && !pinned?.modelId && !modelChanged) {
    out.modelId = '';
    delete out.modelName;
  }
  for (const field of CODEX_INHERITED_PROVIDER_FIELDS) {
    if (out[field] === undefined) {
      delete out[field];
      continue;
    }
    const key = codexFieldKey(out[field]);
    // 비운 것도 바꾼 것이다(도구 정책 `{}` = 이 버블은 제한 없음). 비운 강도처럼 키가 빠진 칸은 남겨도 없는 칸이라 물려받는다.
    const keep = key !== codexFieldKey(inherited?.[field])
      || (key !== '' && pinned !== undefined && codexFieldKey(pinned[field]) !== '')
      // 이미 저장한 `{}` 는 제한 없음이라는 선택이다 — 위층도 비워졌다고 상속으로 되돌리지 않는다.
      || (field === 'codexTools' && pinned?.codexTools !== undefined)
      || (before !== undefined && key !== codexFieldKey(before[field]));
    if (!keep) delete out[field];
  }
  return out;
}

/**
 * 저장분을 만든다. 칸이 남는 조건은 셋 중 하나 — 위층과 다르다 · `baseline` 에서 이미 못 박혀 있다 · `baseline` 완성본과 달라졌다(이번에 바꿨다).
 * `baseline` 이 없으면 위층 대조뿐이다(설정 창 프로젝트 칸·옛 완성본 이관 — 무엇을 골랐는지 남아 있지 않거나 위층과 다른 것만 적는 자리).
 * 값이 `undefined` 인 칸은 오지 않은 것이라 위층을 따른다. `toolsBackfillGen` 은 `tools` 의 도장이라 목록을 못 박은 설정만 갖는다(도장만 남으면 백필이 빈 목록으로 돈다).
 */
export function sparsifyAgentConfig(
  config: Partial<AgentConfig> | null | undefined,
  defaults: AgentConfig,
  baseline?: AgentConfigSaveBaseline | null,
): Partial<AgentConfig> {
  if (!config) return {};
  const inherited = defaults as unknown as Record<string, unknown>;
  const pinned = baseline?.overrides as Record<string, unknown> | null | undefined;
  const before = baseline?.resolved as unknown as Record<string, unknown> | null | undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (value === undefined) continue;
    if (key === 'toolsBackfillGen') continue;
    if (key === 'provider' && config.provider?.kind === 'codex-cli') {
      out[key] = sparsifyCodexProvider(config.provider, defaults.provider, baseline);
      continue;
    }
    if (AGENT_CONFIG_NON_INHERITED_FIELDS.includes(key)) {
      out[key] = Array.isArray(value) ? [...value] : value;
      continue;
    }
    const keep = agentFieldDiffers(key, value, inherited[key])
      || (pinned != null && pinned[key] != null)
      || (before != null && agentFieldDiffers(key, value, before[key]));
    if (keep) out[key] = Array.isArray(value) ? [...value] : value;
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
