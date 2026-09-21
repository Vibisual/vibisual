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

/**
 * §5.25 (B)(G)(J) — **코덱스 버블에 대한 판정을 모아 둔 한 곳.**
 *
 * `localModelEntry.ts` 가 All Model 에 대해 하는 일의 코덱스 판이다. 판정을 화면마다 따로 쓰면
 * 한쪽만 고쳐지는 날이 오고, All Model 버블이 자기 정체를 클로드로 말하던 사고(§5.19 (G))가
 * 정확히 그 자리였다 — 설정 창은 프로바이더에 맞췄는데 버블과 오른쪽 패널에는 `config.model`
 * (기본값 `opus`)이 그대로 남아 있었다.
 */

/** §5.25 (B) — 코덱스 버블을 눌렀을 때 갈리는 갈래. */
export type CodexEntryDecision =
  /** CLI와 인증이 준비됐다 — 명시 모델 또는 CLI 기본값으로 IDE에 진입한다. */
  | { kind: 'ide' }
  /** 쓸 수 있는 모델은 있는데 이 버블이 아직 아무것도 안 물었다 — 매고 나서 IDE. */
  | { kind: 'bind'; model: CodexModelEntry }
  /** CLI 가 없다 — 설치 게이트. */
  | { kind: 'setup' }
  /** CLI 는 있는데 로그인이 안 됐다 — 로그인 창. */
  | { kind: 'login' };

/**
 * 목록에서 기본으로 물릴 모델.
 *
 * **첫 항목이다.** 코덱스가 캐시에 적어 준 순서가 곧 그쪽이 권하는 순서라, 우리가 이름으로
 * 다시 줄 세우면 CLI 가 기본을 바꾼 날 우리만 옛 모델을 고르게 된다(§5.19 가 "마지막에 받은 것"
 * 을 고른 것과 근거는 같다 — 그쪽은 디스크가, 이쪽은 발행처가 순서를 안다).
 */
export function pickDefaultCodexModel(models: readonly CodexModelEntry[]): CodexModelEntry | null {
  return models[0] ?? null;
}

/**
 * §5.25 (B) — 이 버블을 누르면 무엇이 열려야 하는가.
 *
 * `config.provider` 가 코덱스가 아니면 이 함수를 부를 일이 없다. 그래도 방어적으로 `ide` 를
 * 돌려준다 — 판정이 틀렸다고 클로드 버블 앞에 설치 창을 띄우면 안 된다.
 *
 * **"모름"으로 로그인 창을 띄우지 않는다**: `auth.error` 가 있는 상태는 로그아웃이 아니라 판정
 * 불가라, 그때 모달을 세우면 멀쩡히 일하던 사용자를 막는다(§5.25 (E) · 클로드 쪽과 같은 규칙).
 */
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

  const models = input.models ?? [];
  // 이 버블이 문 모델이 목록에 남아 있으면 그대로 간다.
  if (provider.modelId && models.some((m) => m.slug === provider.modelId)) return { kind: 'ide' };
  // 새 설치에는 모델 캐시가 없을 수 있다. 설치 화면으로 돌리면 첫 실행이 캐시를 만들 기회도
  // 없어지므로, 빈 모델은 runner가 -m을 생략해 CLI 기본값으로 실행한다.
  if (models.length === 0) return { kind: 'ide' };

  const fallback = pickDefaultCodexModel(models);
  return fallback ? { kind: 'bind', model: fallback } : { kind: 'ide' };
}

/**
 * §5.25 (J) — 이 설정이 **코덱스 프로바이더**인가. 맞으면 그 프로바이더를, 아니면 null.
 * 부르는 쪽은 null 이면 종전 표기(클로드 · All Model)를 그대로 쓰면 된다.
 */
export function codexProviderOf(config: AgentConfig | null | undefined): AgentProvider | null {
  const provider = config?.provider;
  return provider?.kind === 'codex-cli' ? provider : null;
}

/**
 * §5.25 (J) — 좁은 자리(버블 하단 · 패널 한 줄)에 적을 **정체 한 줄**.
 *
 * 문 모델이 있으면 그 이름이고, 아직 안 골랐으면 그 사실이 곧 상태라 제품 이름만 적는다
 * (자세한 것은 그 버블이 여는 설치·로그인 창이 말한다).
 */
export function codexModelLabelOf(provider: AgentProvider | null, codexLabel: string): string | null {
  if (!provider) return null;
  return provider.modelName || provider.modelId || codexLabel;
}

/**
 * §5.25 (G) — 이 모델이 신고한 추론 강도 단계.
 *
 * **모르는 모델이면 빈 배열**이라 화면은 강도 칸을 아예 그리지 않는다 — 고를 수 없는 값을
 * 보이면 사용자는 그것을 고를 수 있는 것으로 읽는다(§4 v2.38 이 모델 목록에 대해 세운 규칙).
 */
export function codexReasoningLevelsOf(slug: string | undefined, models: readonly CodexModelEntry[] | undefined): string[] {
  if (!slug) return [];
  return models?.find((m) => m.slug === slug)?.reasoningLevels ?? [];
}

/**
 * §5.25 (B) — 이 라벨이 아직 사용자가 손대지 않은 기본 이름인가(`Codex 3`).
 *
 * All Model 과 같은 규약 — 기본 이름이면 모델을 물 때 그 이름이 라벨을 잇고, 사용자가 직접
 * 바꾼 이름은 건드리지 않는다.
 */
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
 * §5.25 (G-2) — 칸을 비워 두면(`-c` 를 싣지 않으면) 코덱스가 쓰는 값.
 *
 * 순서는 코덱스 공개 설정 문서의 우선순위 그대로다: `-c`(비웠으니 없음) → 서버가 이기는 순서로
 * 준 설정 파일 겹 → 모델이 신고한 기본 → 코덱스 내장 기본. 내장 기본은 문서에 적힌 것만 쓴다 —
 * `web_search` 는 샌드박스가 `danger-full-access` 면 `live`, 아니면 `cached`, `network_access` 는 `false`.
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
