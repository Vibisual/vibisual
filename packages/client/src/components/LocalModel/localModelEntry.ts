import type { AgentConfig, LocalLlmState, LocalModelEntry } from '@vibisual/shared';

/**
 * §5.19 (B) — All Model 버블을 눌렀을 때 갈리는 세 갈래.
 *
 * 진입 순서가 뒤집히면서(버블이 먼저 생기고 준비는 그 뒤) "지금 이 버블은 말을 걸 수 있는가"를
 * 누를 때마다 판정해야 한다. 그 판정은 **디스크의 실물**(엔진 파일·받아 둔 모델)만 본다 —
 * 설치 플래그를 믿었다가 사용자가 폴더를 지우면 첫 대화에서 죽는다.
 */
export type LocalEntryDecision =
  /** 엔진이 있고 이 버블이 문 모델도 실물로 있다 — 곧장 IDE. */
  | { kind: 'ide' }
  /** 쓸 수 있는 모델은 있는데 이 버블이 아직 아무것도 안 물었다 — 매고 나서 IDE. */
  | { kind: 'bind'; model: LocalModelEntry }
  /** 엔진이 없거나 받아 둔 모델이 하나도 없다 — 그 버블에 매인 설치 창. */
  | { kind: 'setup' };

/**
 * 받아 둔 모델 중 **가장 최근에 받은 것**. 아직 아무것도 안 문 버블이 자동으로 물 모델이다.
 * (방금 받아 놓고 그것 때문에 버블을 만든 사람이 절대다수라, 마지막에 받은 것이 지금 쓰려던 것이다.)
 */
export function pickDefaultModel(models: readonly LocalModelEntry[]): LocalModelEntry | null {
  let best: LocalModelEntry | null = null;
  for (const m of models) {
    if (!best || m.downloadedAt > best.downloadedAt) best = m;
  }
  return best;
}

/**
 * §5.19 (B) — 이 버블을 누르면 무엇이 열려야 하는가.
 *
 * `config.provider` 가 없으면 이 함수를 부를 일이 없다(= 클로드 버블). 그래도 방어적으로
 * `ide` 를 돌려준다 — 판정이 틀렸다고 클로드 버블 앞에 설치 창을 띄우면 안 된다.
 */
export function resolveLocalEntry(
  config: AgentConfig | undefined,
  local: LocalLlmState | null | undefined,
): LocalEntryDecision {
  const provider = config?.provider;
  if (!provider) return { kind: 'ide' };
  if (!local?.engine?.installed) return { kind: 'setup' };

  const models = local.models ?? [];
  if (models.length === 0) return { kind: 'setup' };

  // 이 버블이 문 모델이 아직 디스크에 있으면 그대로 간다(사용자가 지웠으면 아래로 떨어진다).
  if (provider.modelId && models.some((m) => m.id === provider.modelId)) return { kind: 'ide' };

  const fallback = pickDefaultModel(models);
  return fallback ? { kind: 'bind', model: fallback } : { kind: 'setup' };
}
