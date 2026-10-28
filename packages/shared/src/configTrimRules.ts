/**
 * §5.3 #10-5 — 설정 덜어내기 규칙 표(이 턴에 뗄 수 있는 `AgentConfig` 칸). 모델·CLI 가 바뀌면 `CONFIG_TRIM_RULES` 의 그 줄만 고친다.
 * 보수적: 재료 없음(`'unknown'`)·보호 칸·꺼진 규칙은 덜지 않고 배제 목록으로. **저장된 설정은 고치지 않는다** — 얕은 사본만 깎아 그 턴 스폰에 쓴다.
 */

import type {
  AgentConfig,
  ConfigTrimExclusion,
  ConfigTrimKeepReason,
  ConfigTrimReason,
  ConfigTrimRemoval,
  ConfigTrimRuleId,
} from './types.js';
import { DEFAULT_AGENT_CONFIG, isOpusModel, supportsFastMode } from './constants.js';

/** 덜어낸 값을 화면·체크포인트에 적을 때의 글자 상한. 긴 배열·규칙문을 통째로 지고 다니지 않는다. */
export const CONFIG_TRIM_VALUE_MAX = 200;

/** 이 턴의 사정 — 서버가 모아 넘긴다. 모르는 칸은 **넣지 않는다**(넣지 않으면 그 규칙은 `'unknown'`). */
export interface ConfigTrimContext {
  /** 이 턴이 도는 엔진. 로컬 모델은 CLI 인자 축이 없어 이 기능이 아예 돌지 않는다. */
  engine: 'claude' | 'codex';
  /** 이 턴의 실행 모드. 없으면 헤드리스로 본다(`AgentConfig.executionMode` 기본값과 같다). */
  executionMode?: 'headless' | 'interactive-terminal';
  /** 지금 고른 모델이 Opus 계열인가. 모르면 생략 — `contextWindow` 규칙이 `'unknown'` 이 된다. */
  opusModel?: boolean;
  /** 지금 고른 모델이 Fast 모드를 받는가. 모르면 생략. */
  supportsFastMode?: boolean;
  /**
   * 설치된 CLI 가 실제로 받아들이는 풀 모델 ID 목록.
   * **확인된 진짜 목록일 때만** 넘긴다 — 시드 목록으로 모델 핀을 지우면 안 된다.
   */
  knownModelIds?: readonly string[];
  /** CLI 도움말이 밝힌 effort 등급. **CLI 에서 읽어낸 것일 때만** 넘긴다. */
  knownEfforts?: readonly string[];
  /** 지금 인증 방식. 구독이면 베타 플래그는 CLI 가 경고 한 줄과 함께 버린다. 모르면 생략. */
  authKind?: 'subscription' | 'api-key';
  /** 사용자가 꺼 둔 규칙 id. 꺼 둔 규칙은 배제 목록에 `'rule-off'` 로 선다. */
  disabledRules?: readonly ConfigTrimRuleId[];
}

/** 표 한 줄 — 칸 하나를 언제, 왜 덜어낼지. */
export interface ConfigTrimRule {
  /** 규칙 이름. 화면 번역 키(`ide.configTrim.rule.<id>`)·저장·끄기 목록이 전부 이 값을 쓴다. */
  id: ConfigTrimRuleId;
  /** 이 규칙이 보는 `AgentConfig` 칸. */
  field: keyof AgentConfig;
  /** 덜어낸 까닭 갈래 — 화면이 목록을 이 값으로 묶는다. */
  reason: ConfigTrimReason;
  /** `true` 지운다 · `false` 그대로 · `'unknown'` 재료 없음 — 덜지 않고 배제 목록에 사유와 함께. */
  match(config: Readonly<AgentConfig>, ctx: ConfigTrimContext): boolean | 'unknown';
}

/** 손대지 않는 칸 — 규칙과 무관하게 남는다(배제 목록엔 값이 든 칸만 선다). */
export const CONFIG_TRIM_PROTECTED: readonly { field: keyof AgentConfig; keep: ConfigTrimKeepReason }[] = [
  // 타입이 요구하는 네 칸 — 없으면 설정이 아니다.
  { field: 'model', keep: 'required' },
  { field: 'tools', keep: 'required' },
  { field: 'permissionMode', keep: 'required' },
  { field: 'skills', keep: 'required' },
  // 건드리면 이 턴이 실제로 다르게 도는 축 — 권한·도구·격리·엔진.
  { field: 'provider', keep: 'unsafe' },
  { field: 'executionMode', keep: 'unsafe' },
  { field: 'isolation', keep: 'unsafe' },
  { field: 'disallowedTools', keep: 'unsafe' },
  { field: 'askTools', keep: 'unsafe' },
  { field: 'mcpServers', keep: 'unsafe' },
  { field: 'memory', keep: 'unsafe' },
  { field: 'safeMode', keep: 'unsafe' },
  { field: 'settingSources', keep: 'unsafe' },
  { field: 'pluginDirs', keep: 'unsafe' },
  { field: 'subagentDepth', keep: 'unsafe' },
  { field: 'agentCanCompact', keep: 'unsafe' },
  { field: 'autoCompact', keep: 'unsafe' },
  { field: 'autoCompactPct', keep: 'unsafe' },
  // 떼면 도구 backfill 이 다시 돈다 — 값이 아니라 표식이라 무르면 안 된다.
  { field: 'toolsBackfillGen', keep: 'unsafe' },
  // 사용자가 손으로 적어 넣은 칸 — 우리가 무를 자리가 아니다.
  { field: 'rules', keep: 'user-set' },
  { field: 'rulesHistory', keep: 'user-set' },
  { field: 'color', keep: 'user-set' },
  { field: 'bashDefaultTimeoutMs', keep: 'user-set' },
  { field: 'bashMaxTimeoutMs', keep: 'user-set' },
  { field: 'bashMaxOutputChars', keep: 'user-set' },
  { field: 'maxOutputTokens', keep: 'user-set' },
  { field: 'maxThinkingTokens', keep: 'user-set' },
  { field: 'excludeDynamicSystemPromptSections', keep: 'user-set' },
  { field: 'includeHookEvents', keep: 'user-set' },
  { field: 'replayUserMessages', keep: 'user-set' },
  { field: 'promptSuggestions', keep: 'user-set' },
  { field: 'disableNonEssentialModelCalls', keep: 'user-set' },
];

const PROTECTED_FIELDS = new Set<string>(CONFIG_TRIM_PROTECTED.map((p) => p.field as string));

/** 빈 배열은 값이 없는 것과 같다 — 붙여 봐야 CLI 가 받는 게 없다. */
function emptyList(v: unknown): boolean {
  return Array.isArray(v) && v.length === 0;
}

/** 규칙 표 — 위에서 아래로, 한 칸엔 먼저 걸린 하나만. 새 줄을 넣으면 `ConfigTrimRuleId`(types.ts)·`ide.configTrim.rule.<id>`(en.json)도 늘린다. */
export const CONFIG_TRIM_RULES: readonly ConfigTrimRule[] = [
  // --- 저장만 되고 본체가 없는 칸 (타입 주석에 그렇게 적혀 있다) ---------------------
  {
    // `presetId` 는 "어느 프리셋에서 왔나" 를 남기는 메타일 뿐 CLI 로 나가지 않는다.
    id: 'preset-meta', field: 'presetId', reason: 'not-implemented',
    match: (c) => typeof c.presetId === 'string',
  },
  {
    // `customMode` 의 'review'/'debug' 는 placeholder 다. 'conti' 만 본체가 있다.
    id: 'custom-mode-placeholder', field: 'customMode', reason: 'not-implemented',
    match: (c) => c.customMode === 'review' || c.customMode === 'debug',
  },

  // --- 지금 고른 모델/CLI 가 받지 않는 칸 -------------------------------------------
  {
    // 사라진 모델 핀. 확인된 목록이 있을 때만 판정한다.
    id: 'model-version-gone', field: 'modelVersion', reason: 'not-accepted',
    match: (c, ctx) => {
      if (typeof c.modelVersion !== 'string' || c.modelVersion === '') return false;
      if (!ctx.knownModelIds || ctx.knownModelIds.length === 0) return 'unknown';
      return !ctx.knownModelIds.includes(c.modelVersion);
    },
  },
  {
    // 죽은 effort 등급. CLI 도움말에서 읽어낸 목록이 있을 때만 판정한다.
    id: 'effort-gone', field: 'effort', reason: 'not-accepted',
    match: (c, ctx) => {
      if (typeof c.effort !== 'string' || c.effort === '' || c.effort === 'default') return false;
      if (!ctx.knownEfforts || ctx.knownEfforts.length === 0) return 'unknown';
      return !ctx.knownEfforts.includes(c.effort);
    },
  },

  // --- 값이 기본값과 같은 칸 (붙여 봐야 결과가 같다) --------------------------------
  {
    id: 'effort-default', field: 'effort', reason: 'same-as-default',
    match: (c) => c.effort === 'default' || c.effort === '',
  },
  {
    id: 'max-turns-default', field: 'maxTurns', reason: 'same-as-default',
    match: (c) => c.maxTurns === DEFAULT_AGENT_CONFIG.maxTurns,
  },
  {
    // `undefined` 또는 0 = 무제한. 0 은 안 적은 것과 같다.
    id: 'max-budget-unlimited', field: 'maxBudgetUsd', reason: 'same-as-default',
    match: (c) => c.maxBudgetUsd === 0,
  },
  {
    id: 'fallback-model-empty', field: 'fallbackModel', reason: 'same-as-default',
    match: (c) => c.fallbackModel === '',
  },
  {
    // 기본이 켬이다 — 켬일 때 `true` 를 써 넣으면 CLI 인자만 한 칸 늘어난다.
    id: 'thinking-on-default', field: 'thinking', reason: 'same-as-default',
    match: (c) => c.thinking === true,
  },
  {
    id: 'forward-subagent-text-on-default', field: 'forwardSubagentText', reason: 'same-as-default',
    match: (c) => c.forwardSubagentText === true,
  },
  {
    id: 'fast-mode-off-default', field: 'fastMode', reason: 'same-as-default',
    match: (c) => c.fastMode === false,
  },
  {
    // 'allow' 가 기본(=undefined 취급)이다.
    id: 'permission-timeout-default', field: 'permissionTimeoutPolicy', reason: 'same-as-default',
    match: (c) => c.permissionTimeoutPolicy === 'allow',
  },
  {
    id: 'betas-empty', field: 'betas', reason: 'same-as-default',
    match: (c) => emptyList(c.betas),
  },
  {
    id: 'agent-definitions-empty', field: 'agentDefinitions', reason: 'same-as-default',
    match: (c) => emptyList(c.agentDefinitions),
  },

  // --- 그 칸이 걸리는 길이 이 턴에 없는 칸 ------------------------------------------
  {
    // `contextWindow` 는 Opus 패밀리일 때만 접미사로 나간다. Opus 밖에서는 어떤 값이든 무시된다.
    id: 'context-window-non-opus', field: 'contextWindow', reason: 'no-effect-here',
    match: (c, ctx) => {
      if (c.contextWindow === undefined) return false;
      if (ctx.opusModel === undefined) return 'unknown';
      return ctx.opusModel === false;
    },
  },
  {
    // Fast 모드는 그 계열에서만 의미가 있다. 그 밖에서는 CLI 가 사유도 없이 조용히 버린다.
    id: 'fast-mode-unsupported', field: 'fastMode', reason: 'no-effect-here',
    match: (c, ctx) => {
      if (c.fastMode !== true) return false;
      if (ctx.supportsFastMode === undefined) return 'unknown';
      return ctx.supportsFastMode === false;
    },
  },
  {
    // 베타 플래그는 API 키 사용자 전용이다. 구독 인증에서는 CLI 가 경고 한 줄과 함께 무시한다.
    id: 'betas-subscription', field: 'betas', reason: 'no-effect-here',
    match: (c, ctx) => {
      if (!Array.isArray(c.betas) || c.betas.length === 0) return false;
      if (ctx.authKind === undefined) return 'unknown';
      return ctx.authKind === 'subscription';
    },
  },
  {
    // `cliKind` 는 인터랙티브 터미널이 어떤 CLI 를 띄울지 고르는 칸이다. 헤드리스 턴은 무시한다.
    id: 'cli-kind-headless', field: 'cliKind', reason: 'no-effect-here',
    match: (c, ctx) => c.cliKind !== undefined && (ctx.executionMode ?? 'headless') === 'headless',
  },
  {
    // MCP 서버를 안 붙인 에이전트에 MCP 출력 상한은 아무 효과가 없다.
    id: 'mcp-output-without-mcp', field: 'mcpMaxOutputTokens', reason: 'no-effect-here',
    match: (c) => c.mcpMaxOutputTokens !== undefined && (c.mcpServers?.length ?? 0) === 0,
  },
  {
    // Task 도구가 목록에 없으면 서브에이전트 정의를 넘겨도 부를 방법이 없다.
    id: 'agent-definitions-without-task', field: 'agentDefinitions', reason: 'no-effect-here',
    match: (c) => Array.isArray(c.agentDefinitions) && c.agentDefinitions.length > 0
      && !c.tools.includes('Task'),
  },
  {
    // 권한 팝업이 아예 안 뜨는 모드에서는 팝업 만료 정책이 걸릴 자리가 없다.
    id: 'permission-timeout-moot', field: 'permissionTimeoutPolicy', reason: 'no-effect-here',
    match: (c) => c.permissionTimeoutPolicy !== undefined
      && (c.permissionMode === 'bypassPermissions' || c.permissionMode === 'plan'),
  },
];

/** 규칙 id -> 규칙. 화면이 끄기 목록을 그릴 때 쓴다. */
export const CONFIG_TRIM_RULE_BY_ID: Readonly<Record<string, ConfigTrimRule>> =
  Object.fromEntries(CONFIG_TRIM_RULES.map((r) => [r.id, r]));

/** 값 한 개를 사람이 읽는 한 줄로. 길면 잘라서 말줄임표를 붙인다. */
export function describeConfigValue(v: unknown): string {
  let s: string;
  if (typeof v === 'string') s = v;
  else if (v === undefined) s = 'undefined';
  else {
    try { s = JSON.stringify(v) ?? String(v); } catch { s = String(v); }
  }
  s = s.replace(/\s+/g, ' ').trim();
  // 말줄임표까지 **넣어서** 상한이다 — 저장 쪽 `clip()` 이 다시 자르면 왕복마다 두 글자가 달라진다.
  return s.length > CONFIG_TRIM_VALUE_MAX ? `${s.slice(0, CONFIG_TRIM_VALUE_MAX - 3)}...` : s;
}

/** 한 턴 판정 결과 — 덜어낸 사본과 두 목록. */
export interface ConfigTrimResult {
  /** 이 턴에만 쓰는 **사본**. 원본 `AgentConfig` 은 손대지 않았다. */
  config: AgentConfig;
  /** 실제로 사본에서 덜어낸 칸들. */
  trimmed: ConfigTrimRemoval[];
  /** 덜어내지 않고 남긴 칸들과 그 사유. */
  excluded: ConfigTrimExclusion[];
}

/** 규칙 표로 사본을 깎는다(원본 읽기만). 보호 칸을 먼저 배제 목록에 세우고, 이미 덜어진 칸의 남은 규칙은 건너뛴다. */
export function computeConfigTrim(
  config: Readonly<AgentConfig>,
  ctx: ConfigTrimContext,
): ConfigTrimResult {
  const copy: AgentConfig = { ...config };
  const trimmed: ConfigTrimRemoval[] = [];
  const excluded: ConfigTrimExclusion[] = [];
  const off = new Set<string>(ctx.disabledRules ?? []);
  const done = new Set<string>();
  const seenExcl = new Set<string>();
  const src = config as unknown as Record<string, unknown>;

  const pushExcl = (field: string, keep: ConfigTrimKeepReason, ruleId?: ConfigTrimRuleId): void => {
    const k = `${field}|${keep}|${ruleId ?? ''}`;
    if (seenExcl.has(k)) return;
    seenExcl.add(k);
    excluded.push(ruleId === undefined ? { field, keep } : { field, keep, ruleId });
  };

  for (const p of CONFIG_TRIM_PROTECTED) {
    if (src[p.field as string] === undefined) continue;
    pushExcl(p.field as string, p.keep);
  }

  for (const rule of CONFIG_TRIM_RULES) {
    const field = rule.field as string;
    if (PROTECTED_FIELDS.has(field)) continue;           // 표가 뭐라 하든 손대지 않는다.
    if (done.has(field)) continue;                       // 이미 덜어낸 칸.
    const before = src[field];
    if (before === undefined) continue;                  // 없는 칸은 덜어낼 것도 없다.
    if (off.has(rule.id)) { pushExcl(field, 'rule-off', rule.id); continue; }

    let hit: boolean | 'unknown';
    try {
      hit = rule.match(config, ctx);
    } catch {
      hit = 'unknown';                                   // 규칙이 터지면 모른다고 본다 — 두는 쪽.
    }
    if (hit === 'unknown') { pushExcl(field, 'unknown', rule.id); continue; }
    if (hit !== true) continue;

    delete (copy as unknown as Record<string, unknown>)[field];
    done.add(field);
    trimmed.push({ field, ruleId: rule.id, reason: rule.reason, before: describeConfigValue(before) });
  }

  return { config: copy, trimmed, excluded };
}

/** `undefined` 는 키를 넣지 않는다 — "모른다"와 "없다"를 섞지 않게. */
export function configTrimContextOf(input: {
  engine: 'claude' | 'codex';
  config: Readonly<AgentConfig>;
  knownModelIds?: readonly string[] | undefined;
  knownEfforts?: readonly string[] | undefined;
  authKind?: 'subscription' | 'api-key' | undefined;
  disabledRules?: readonly ConfigTrimRuleId[] | undefined;
}): ConfigTrimContext {
  const modelId = input.config.modelVersion ?? input.config.model;
  const ctx: ConfigTrimContext = { engine: input.engine };
  if (input.config.executionMode !== undefined) ctx.executionMode = input.config.executionMode;
  if (typeof modelId === 'string' && modelId !== '') {
    ctx.opusModel = isOpusModel(modelId);
    ctx.supportsFastMode = supportsFastMode(modelId);
  }
  if (input.knownModelIds && input.knownModelIds.length > 0) ctx.knownModelIds = input.knownModelIds;
  if (input.knownEfforts && input.knownEfforts.length > 0) ctx.knownEfforts = input.knownEfforts;
  if (input.authKind !== undefined) ctx.authKind = input.authKind;
  if (input.disabledRules && input.disabledRules.length > 0) ctx.disabledRules = input.disabledRules;
  return ctx;
}
