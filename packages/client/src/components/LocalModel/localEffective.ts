import { useEffect, useState } from 'react';
import { LOCAL_DEFAULT_CONTEXT_SIZE, type LocalSamplingInfo } from '@vibisual/shared';
import type { TranslateFn } from '../../formatSince.js';

/**
 * §5.25 (G-2) — 로컬 모델의 온도·문맥 칸을 **비워 두었을 때 실제로 쓰이는 값**을 칸에 적는다.
 *
 * 에이전트 설정 창과 설정 창(Agent 기본값)이 같은 조회·같은 문구를 쓴다 — 한쪽만 "엔진 기본값" 같은
 * 말로 되돌아가지 않게. 값은 서버(`GET /api/local-llm/models/:id/sampling`)가 올라간 엔진 → 모델 파일 →
 * 엔진 `--help` 순서로 읽은 것이고, 못 읽었으면 숫자를 지어내지 않는다.
 */

/** 모델을 아직 안 골랐을 때 — 온도는 모델이 정하니 모르고, 문맥은 깎을 학습 길이가 없어 우리 크기 그대로다. */
const NO_MODEL: LocalSamplingInfo = {
  temperature: null,
  source: null,
  context: { tokens: LOCAL_DEFAULT_CONTEXT_SIZE, source: 'builtin' },
};

/** 모델이 바뀌면 다시 묻는다. 묻는 중이면 `null`. */
export function useLocalSampling(modelId: string): LocalSamplingInfo | null {
  const [state, setState] = useState<{ id: string; info: LocalSamplingInfo } | null>(null);
  useEffect(() => {
    if (!modelId) return;
    let alive = true;
    fetch(`/api/local-llm/models/${encodeURIComponent(modelId)}/sampling`)
      .then((r) => (r.ok ? (r.json() as Promise<LocalSamplingInfo>) : Promise.reject(new Error(String(r.status)))))
      .then((info) => { if (alive) setState({ id: modelId, info }); })
      .catch(() => { if (alive) setState({ id: modelId, info: { temperature: null, source: null } }); });
    return () => { alive = false; };
  }, [modelId]);
  if (!modelId) return NO_MODEL;
  return state?.id === modelId ? state.info : null;
}

export interface EffectivePlaceholder {
  text: string;
  /** 그 값을 어디서 읽었는지 — 칸의 `title` 로 건다. */
  title?: string;
}

export function localTemperaturePlaceholder(t: TranslateFn, info: LocalSamplingInfo | null): EffectivePlaceholder {
  if (!info) return { text: t('panel.options.account.checking') };
  if (info.temperature === null || info.source === null) return { text: t('panel.agentConfig.effective.unknown') };
  return {
    text: t('panel.agentConfig.effective.resolved', {
      value: String(info.temperature),
      source: t(`panel.agentConfig.local.source.${info.source}`),
    }),
    title: t(`panel.agentConfig.local.temperatureSourceTip.${info.source}`),
  };
}

export function localContextPlaceholder(t: TranslateFn, info: LocalSamplingInfo | null): EffectivePlaceholder {
  if (!info) return { text: t('panel.options.account.checking') };
  // 조회가 실패하면 문맥은 모른다 — 우리 크기를 적어 두면 학습 길이로 깎인 모델에서 거짓말이 된다.
  if (!info.context) return { text: '' };
  const { tokens, source } = info.context;
  return {
    text: t('panel.agentConfig.effective.resolved', {
      value: String(tokens),
      source: source === 'loaded'
        ? t('panel.agentConfig.local.source.loaded')
        : source === 'model'
          ? t('panel.agentConfig.local.source.trained')
          : t('panel.agentConfig.effective.sourceBuiltin'),
    }),
    title: t(`panel.agentConfig.local.contextSourceTip.${source}`),
  };
}
