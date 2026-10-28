import { CODEX_DEFAULT_LABEL_RE } from '@vibisual/shared';
import type {
  AgentConfig,
  AgentProvider,
  CodexAuthStatus,
  CodexConfigLayerSource,
  CodexEffectiveConfig,
  CodexModelEntry,
  CodexSetupState,
} from '@vibisual/shared';

/** §5.25 (B)(G)(J) — 코덱스 버블 판정을 모은 한 곳 — 화면마다 따로 쓰면 버블·패널이 `config.model`(기본 `opus`)로 정체를 잘못 말한다(§5.19 (G)). */

/** §5.25 (B) — 코덱스 버블을 눌렀을 때 갈리는 갈래. */
export type CodexEntryDecision =
  /** CLI와 인증이 준비됐다 — 명시 모델 또는 CLI 기본값으로 IDE에 진입한다. */
  | { kind: 'ide' }
  /** CLI 가 없다 — 설치 게이트. */
  | { kind: 'setup' }
  /** CLI 는 있는데 로그인이 안 됐다 — 로그인 창. */
  | { kind: 'login' };

/** CLI 가 명시적으로 신고한 기본 모델(표시용). 목록 순서·조회 실패·모델 은퇴로 사용자 선택이나 빈 상속값을 바꾸지 않는다. */
export function pickDefaultCodexModel(models: readonly CodexModelEntry[]): CodexModelEntry | null {
  return models.find((model) => model.isDefault === true) ?? null;
}

/** §5.25 (B) — 코덱스가 아니면 방어적으로 `ide`(클로드 버블 앞에 설치 창 ❌). `auth.error`(모름)로는 로그인 창을 띄우지 않는다(§5.25 (E)). */
export function resolveCodexEntry(
  config: AgentConfig | undefined,
  input: {
    setup: CodexSetupState | null | undefined;
    auth: CodexAuthStatus | null | undefined;
    models: readonly CodexModelEntry[] | undefined;
  },
): CodexEntryDecision {
  const provider = codexProviderOf(config);
  if (!provider) return { kind: 'ide' };
  if (input.setup && input.setup.phase !== 'ready') return { kind: 'setup' };
  if (input.auth && !input.auth.loggedIn && !input.auth.error) return { kind: 'login' };

  // 카탈로그는 선택지일 뿐이다. 명시값은 -m으로, 빈 값은 CLI 상속으로 그대로 실행한다.
  // 목록 밖 모델의 실행 가능 여부도 CLI가 답한다. 여기서 다른 모델로 바꾸면 안 된다.
  return { kind: 'ide' };
}

/** §5.25 (J) — null 이면 부르는 쪽은 기존 표기(클로드·All Model)를 쓴다. */
export function codexProviderOf(config: AgentConfig | null | undefined): AgentProvider | null {
  const provider = config?.provider;
  return provider?.kind === 'codex-cli' ? provider : null;
}

/** §5.25 (J) — 좁은 자리의 정체 한 줄: 고른 모델 이름, 안 골랐으면 제품 이름만. */
export function codexModelLabelOf(provider: AgentProvider | null, codexLabel: string): string | null {
  if (!provider) return null;
  return provider.modelName || provider.modelId || codexLabel;
}

/** §5.25 (G) — 모르는 모델이면 빈 배열 — 화면은 강도 칸을 그리지 않는다(고를 수 없는 값을 보이지 않는다, §4). */
export function codexReasoningLevelsOf(slug: string | undefined, models: readonly CodexModelEntry[] | undefined): string[] {
  if (!slug) return [];
  return models?.find((m) => m.slug === slug)?.reasoningLevels ?? [];
}

/** §5.25 (B) — 기본 이름(`Codex 3`)이면 모델을 물 때 그 이름이 라벨을 잇고, 직접 바꾼 이름은 건드리지 않는다(All Model 과 같은 규약). */
export function isDefaultCodexLabel(label: string | undefined): boolean {
  return !!label && CODEX_DEFAULT_LABEL_RE.test(label.trim());
}

/** §5.25 (G-2) — 설정 창에서 비워 두면 코덱스가 스스로 채우는 칸. */
export type CodexInheritedField = 'reasoningEffort' | 'modelVerbosity' | 'webSearch' | 'networkAccess';

/** §5.25 (G-2) — 비워 둔 칸에 **실제로 적용되는 값**과 그 근거. */
export type CodexInheritedValue =
  /** 설정 파일 한 겹에 적혀 있다(프로필 · 프로젝트 · 사용자 · 시스템). */
  | { kind: 'layer'; value: string; source: CodexConfigLayerSource; path: string; profile?: string }
  /** 어느 파일에도 없어 모델이 신고한 값을 쓴다(`models_cache.json`). */
  | { kind: 'model'; value: string }
  /** 파일에도 모델에도 없어 코덱스가 정한 값을 쓴다(공개 설정 문서). */
  | { kind: 'builtin'; value: string }
  /** 도구 위임 연결이 이 턴의 웹 검색을 끈다(`codexEdgeOverrides` 가 맨 뒤에 싣는다). */
  | { kind: 'delegation'; value: string }
  /** 이 모델은 그 키를 받지 않는다 — 값이 적용되지 않는다. */
  | { kind: 'unsupported' }
  /** 아직 읽는 중. */
  | { kind: 'loading' }
  /** 읽었는데 근거가 없다 — 값을 지어내지 않는다. */
  | { kind: 'unresolved' };

/**
 * §5.25 (G-2) — 칸을 비워 두면(`-c` 없음) 코덱스가 쓰는 값. 코덱스 공개 설정 문서의 우선순위: 설정 파일 겹 → 모델 기본 → 내장 기본.
 * 내장 기본은 문서에 적힌 것만 — `web_search` 는 `danger-full-access` 면 `live` 아니면 `cached`, `network_access` 는 `false`.
 */
export function resolveCodexInherited(
  field: CodexInheritedField,
  input: {
    config: CodexEffectiveConfig | null | undefined;
    model: CodexModelEntry | undefined;
    modelsLoaded: boolean;
    sandbox: string;
    /** 이 버블에서 나가는 연결이 도구 위임으로 도구를 걷어 가는가. */
    delegation?: boolean;
  },
): CodexInheritedValue {
  if (field === 'webSearch' && input.delegation) return { kind: 'delegation', value: 'disabled' };
  // 말투를 받지 않는 모델에는 파일에 적힌 값도 실리지 않는다(코덱스가 무시한다) — 그 사실이 먼저다.
  if (field === 'modelVerbosity' && input.model?.supportsVerbosity === false) return { kind: 'unsupported' };
  if (!input.config) return { kind: 'loading' };
  for (const layer of input.config.layers) {
    const raw = layer.values[field];
    if (raw === undefined) continue;
    const value = typeof raw === 'boolean' ? String(raw) : raw;
    return {
      kind: 'layer',
      value,
      source: layer.source,
      path: layer.path,
      ...(layer.profile ? { profile: layer.profile } : {}),
    };
  }
  switch (field) {
    case 'reasoningEffort':
      if (input.model?.defaultReasoningLevel) return { kind: 'model', value: input.model.defaultReasoningLevel };
      return input.modelsLoaded ? { kind: 'unresolved' } : { kind: 'loading' };
    case 'modelVerbosity':
      if (input.model?.defaultVerbosity) return { kind: 'model', value: input.model.defaultVerbosity };
      return input.modelsLoaded ? { kind: 'unresolved' } : { kind: 'loading' };
    case 'webSearch':
      return { kind: 'builtin', value: input.sandbox === 'danger-full-access' ? 'live' : 'cached' };
    case 'networkAccess':
      return { kind: 'builtin', value: 'false' };
  }
}
