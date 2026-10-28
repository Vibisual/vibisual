import type { AgentProvider } from '@vibisual/shared';
import { LOCAL_CONTEXT_MAX, LOCAL_CONTEXT_MIN } from '@vibisual/shared';

/** §5.19 (G) — 입력 중 문자열 그대로 든다(숫자면 지우는 도중 빈 칸이 "온도 0" 으로 저장된다). 저장 때 한 번 굳힌다. */
export interface LocalProviderDraft {
  /** 대화 창 크기(토큰). 빈 칸·숫자가 아니면 미설정 = 엔진 기본값. */
  contextDraft: string;
  /** 샘플링 온도. 빈 칸이면 미설정 = 엔진 기본값(**`0` 과 다르다** — 0 은 사용자가 정한 값이다). */
  temperatureDraft: string;
  /** §5.19 (H) — 도구 판정을 지운다. 다음 턴이 도구를 한 번 더 실어 보내 다시 물어본다. */
  retryToolSupport: boolean;
}

/** §5.19 (G) — 저장 순간의 `live` 위에 만진 칸만 얹는다(연 시점 사본이면 게이지·누적 토큰이 뒤로 간다). */
export function applyLocalProviderDraft(live: AgentProvider, draft: LocalProviderDraft): AgentProvider {
  const next: AgentProvider = { ...live };

  const ctx = Number(draft.contextDraft.trim());
  next.contextSize = draft.contextDraft.trim() !== '' && Number.isFinite(ctx) && ctx > 0
    ? Math.min(LOCAL_CONTEXT_MAX, Math.max(LOCAL_CONTEXT_MIN, Math.round(ctx)))
    : undefined;

  const temp = Number(draft.temperatureDraft.trim());
  next.temperature = draft.temperatureDraft.trim() !== '' && Number.isFinite(temp) ? temp : undefined;

  if (draft.retryToolSupport) next.toolSupport = undefined;

  return next;
}
