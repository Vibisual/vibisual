/**
 * §5.5 — IDE 상태바 한 줄의 주어를 하나로 고정하고 칸이 사라지지 않게 한다. `agent.*` = 버블 값(최근 sub + 전 sub 토큰 합), `activeSession.*` = 고른 세션.
 * ① 세션 탭을 골랐으면 그 세션만 — 칸별 `activeSession?.X ?? agent.X` 폴백이면 세션을 넘겨도 숫자가 안 변한다.
 * ② 모르면 `0`, 칸은 남긴다 — 지우면 옆 칸이 밀렸다 돌아온다. `used`/`max` 는 한 출처에서 짝으로(섞으면 비율이 거짓).
 * 허용 폴백은 둘(다른 세션 값이 아니다): 모델 = 이 에이전트의 설정 모델, 창 크기 = 그 모델의 창 크기(레지스트리).
 */
import {
  isThinkingAlwaysOnModel,
  isThinkingEnabled,
  resolveCmdCliKind,
  type CodexEffectiveConfig,
  type CodexModelEntry,
  type ModelRegistry,
} from '@vibisual/shared';
import { resolveCodexInherited } from '../Codex/codexModelEntry.js';

export interface StatusBarScopeSource {
  /** 마지막 턴이 실제로 쓴 모델(세션) 또는 버블에 채워진 모델. */
  modelName?: string;
  contextUsed?: number;
  contextMax?: number;
  totalInputTokens?: number;
  totalOutputTokens?: number;
}

/** 컨텍스트만 보는 호출부용 좁은 모양. */
export type StatusBarContextSource = Pick<StatusBarScopeSource, 'contextUsed' | 'contextMax'>;

export interface StatusBarContext {
  used: number;
  max: number;
}

export interface StatusBarUsage {
  /**
   * 이 줄이 말하는 주어. `'session'` 이면 숫자가 **고른 세션 하나**의 것이고, `'agent'` 이면
   * 버블 값이다. 화면 문구(툴팁)가 "이 세션"이라고 말할지 "이 에이전트"라고 말할지를 가른다.
   */
  scope: 'session' | 'agent';
  /** 모를 수 있는 유일한 칸 — 숫자가 아니라 이름이라 `0` 으로 대신할 수 없다. 호출부가 "모름"을 적는다. */
  model?: string;
  /** **항상 있다.** 모르면 `{ used: 0, max: 0 }` — 칸을 지우지 않는다(규칙 ②). */
  context: StatusBarContext;
  inputTokens: number;
  outputTokens: number;
}

/** 컨텍스트 창 크기를 실제로 아는 출처인가. `0`/`undefined` 는 "못 쟀다"는 뜻이라 쓰지 않는다. */
function hasContext(src: StatusBarContextSource | null | undefined): src is StatusBarContextSource {
  return !!src && typeof src.contextMax === 'number' && src.contextMax > 0;
}

/**
 * 그릴 컨텍스트 한 쌍(`used`/`max`). **세션을 골랐으면 세션 것만** 본다 — 세션을 안 골랐을 때만
 * 버블 값을 쓴다. 실측이 없으면 `fallbackMax`(그 모델의 창 크기)로 칸을 채우고, 그것마저 없으면
 * `{0, 0}` 을 돌려준다. **`null` 을 돌려주지 않는다** — 칸이 사라지면 줄이 흔들린다(규칙 ②).
 */
export function resolveStatusBarContext(
  agent: StatusBarContextSource,
  activeSession: StatusBarContextSource | null | undefined,
  fallbackMax = 0,
): StatusBarContext {
  const src: StatusBarContextSource = activeSession ?? agent;
  if (!hasContext(src)) return { used: 0, max: fallbackMax > 0 ? fallbackMax : 0 };
  return { used: src.contextUsed ?? 0, max: src.contextMax as number };
}

/** 모델 칸 — 고른 세션의 실측 모델 → 이 에이전트의 설정 모델(다른 세션 실측 ❌). 창 크기 폴백이 이 값에 매여 따로 뺐다. */
export function resolveStatusBarModel(
  agent: StatusBarScopeSource,
  activeSession: StatusBarScopeSource | null | undefined,
  configuredModel?: string,
): string | undefined {
  const src: StatusBarScopeSource = activeSession ?? agent;
  return src.modelName ?? configuredModel;
}

export interface StatusBarUsageOptions {
  /**
   * 이 에이전트에 설정된 모델(별칭 해소 후). 아직 한 턴도 안 돈 세션의 모델 칸에만 쓰인다.
   * 다른 세션의 실측 모델은 절대 여기 넣지 마라.
   */
  configuredModel?: string;
  /** 실측 창 크기가 없을 때 쓸 그 모델의 창 크기(`getModelContextLimit`). 모르면 생략. */
  fallbackContextMax?: number;
}

/** 세션 종속 칸 전부(모델·컨텍스트·입출력 토큰)를 한 주어로 고른다 — 칸별 폴백도 칸 지우기도 하지 않는다. */
export function resolveStatusBarUsage(
  agent: StatusBarScopeSource,
  activeSession: StatusBarScopeSource | null | undefined,
  opts: StatusBarUsageOptions = {},
): StatusBarUsage {
  const src: StatusBarScopeSource = activeSession ?? agent;
  return {
    scope: activeSession ? 'session' : 'agent',
    model: resolveStatusBarModel(agent, activeSession, opts.configuredModel),
    context: resolveStatusBarContext(agent, activeSession, opts.fallbackContextMax),
    inputTokens: src.totalInputTokens ?? 0,
    outputTokens: src.totalOutputTokens ?? 0,
  };
}

/**
 * §4 (Thinking on/off) — 「확장 사고 꺼짐」을 띄울 것인가(끄면 스폰 설정에 `alwaysThinkingEnabled: false` 가 실리는데 설정 창 말고는 안 보인다).
 * 끔만 신고한다(`undefined` = 켬), 판정은 서버 설정 조립과 같은 `isThinkingEnabled`. 설정이 그 턴에 안 닿으면 안 띄운다(§5.19 (G)) —
 * 훅 버블 · 프로바이더 버블(클로드 settings 키라 안 읽는다) · 클로드가 아닌 CMD(`managed === false`) · 사고를 끌 수 없는 모델(`isThinkingAlwaysOnModel`).
 */
export function resolveStatusBarThinkingOff(input: {
  /** 우리가 띄운 버블인가. 훅 버블이면 `false`. */
  isCustom: boolean;
  /** 프로바이더 버블이면 그 갈래. 클로드 경로면 `undefined`. */
  providerKind?: string;
  /** CMD 버블의 CLI 갈래. 헤드리스 버블은 `undefined`(= 클로드). */
  cliKind?: string;
  /** 이 에이전트에 실린 값(스냅샷 `agentConfigs` — 서버가 이미 3층을 겹쳐 준 완성본). */
  agentThinking?: boolean;
  /** 설정 창 전역 기본값. **그 에이전트를 아예 모를 때만** 쓰인다. */
  userDefaultThinking?: boolean;
  /** 모델 칸이 적는 모델(세션 실측 → 설정 모델). 풀ID 든 alias 든 된다. */
  model?: string;
  /** alias 를 최신 풀ID 로 풀 레지스트리. */
  registry?: ModelRegistry | null;
}): boolean {
  if (!input.isCustom) return false;
  if (input.providerKind) return false;
  if (!resolveCmdCliKind(input.cliKind).managed) return false;
  if (isThinkingAlwaysOnModel(input.model, input.registry)) return false;
  return !isThinkingEnabled(input.agentThinking ?? input.userDefaultThinking);
}

/**
 * §4 (상태바 모델 칸 ①) — 모델 칸 옆에 적는 **추론 강도** 한 조각.
 *
 * - `level` — 이 값이 다음 턴에 실린다(클로드 `--effort <값>` · 코덱스 `reasoningEffort`).
 * - `unknown` — 설정에도 세션 기록에도 강도가 없다. 실제 값을 추측하지 않는다.
 */
export type StatusBarEffort =
  | { kind: 'level'; value: string }
  | { kind: 'unknown' };

/**
 * §4 (상태바 모델 칸 ①) — 모델 칸에 적을 추론 강도(안 그리면 `null`). 클로드 = 3층을 겹친 `AgentConfig.effort`, `'default'`·빈 값이면 `unknown`
 * (`buildConfigArgs` 가 `--effort` 를 안 붙이는 조건과 같게). 코덱스 = `provider.reasoningEffort` → 프로젝트·전역 → config.toml → 같은 모델의 세션 실측 → 모델 기본값
 * (파일을 못 읽었으면 모델 기본값으로 덮어 추측하지 않는다). 훅·로컬·클로드가 아닌 CMD 는 안 그린다(§5.19 (G)).
 */
export function resolveStatusBarEffort(input: {
  /** 우리가 띄운 버블인가. 훅 버블이면 `false`. */
  isCustom: boolean;
  /** 프로바이더 버블이면 그 갈래. 클로드 경로면 `undefined`. */
  providerKind?: string;
  /** CMD 버블의 CLI 갈래. 헤드리스 버블은 `undefined`(= 클로드). */
  cliKind?: string;
  /** 이 에이전트에 실린 값(스냅샷 `agentConfigs` — 서버가 이미 3층을 겹쳐 준 완성본). */
  agentEffort?: string;
  /** 설정 창 전역 기본값. **그 에이전트를 아예 모를 때만** 쓰인다. */
  userDefaultEffort?: string;
  /** 코덱스 버블의 `provider.reasoningEffort`. */
  codexEffort?: string;
  /** 개별 값이 없을 때 상속할 Vibisual 프로젝트 → 전역 기본값. */
  inheritedCodexEffort?: string;
  /** 설정 창과 같은 작업 폴더에서 읽은 Codex 설정 파일. */
  codexConfig?: CodexEffectiveConfig | 'failed' | null;
  /** 다음 턴에 선택된 모델의 카탈로그 항목. */
  codexModel?: CodexModelEntry;
  /** 선택한 세션에서 확인된 강도. 다른 세션이나 버블의 값을 빌려오지 않는다. */
  sessionEffort?: string;
  sessionModel?: string;
  /** 다음 턴에 선택된 코덱스 모델. 모델을 바꿨으면 옛 모델의 실측 강도를 쓰지 않는다. */
  providerModelId?: string;
}): StatusBarEffort | null {
  if (!input.isCustom) return null;
  if (input.providerKind === 'codex-cli') {
    for (const effort of [input.codexEffort, input.inheritedCodexEffort]) {
      const configured = effort?.trim();
      if (configured && configured !== 'default') return { kind: 'level', value: configured };
    }
    const inherited = resolveCodexInherited('reasoningEffort', {
      config: input.codexConfig === 'failed' ? null : input.codexConfig,
      model: input.codexModel,
      modelsLoaded: true,
      sandbox: '', // Sandbox does not affect reasoning effort.
    });
    if (inherited.kind === 'layer') return { kind: 'level', value: inherited.value };
    const sameModel = !input.providerModelId || !input.sessionModel || input.providerModelId === input.sessionModel;
    const observed = sameModel ? input.sessionEffort?.trim() : undefined;
    if (observed && observed !== 'default') return { kind: 'level', value: observed };
    return inherited.kind === 'model' ? { kind: 'level', value: inherited.value } : { kind: 'unknown' };
  }
  if (input.providerKind) return null;
  if (!resolveCmdCliKind(input.cliKind).managed) return null;
  const level = (input.agentEffort ?? input.userDefaultEffort)?.trim();
  return level && level !== 'default' ? { kind: 'level', value: level } : { kind: 'unknown' };
}

/**
 * §4 (상태바 모델 칸 ②) — 모델 칸을 누를 수 있는가(설정창 모델 구역이 뜬다). 모델 설정이 그 턴에 닿는 우리 버블만 — 훅·클로드가 아닌 CMD 는 글자로만,
 * 프로바이더 버블(코덱스·로컬)은 `cliKind` 가 없어 누를 수 있다.
 */
export function canOpenModelQuickSwitch(input: {
  isCustom: boolean;
  /** CMD 버블의 CLI 갈래. 헤드리스 버블은 `undefined`(= 클로드). */
  cliKind?: string;
}): boolean {
  return input.isCustom && resolveCmdCliKind(input.cliKind).managed;
}
