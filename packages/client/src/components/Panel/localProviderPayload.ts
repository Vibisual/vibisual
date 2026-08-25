import type { AgentProvider } from '@vibisual/shared';
import { LOCAL_CONTEXT_MAX, LOCAL_CONTEXT_MIN } from '@vibisual/shared';

/**
 * §5.19 (G) — 설정 창이 만지는 로컬 프로바이더 칸들(입력 중인 **문자열** 그대로).
 *
 * 숫자로 들고 있으면 지우는 도중의 빈 칸이 0 으로 튀어, 사용자가 값을 고치려고 지운 순간
 * "온도 0" 이 저장된다. 그래서 화면은 문자열을 들고 저장할 때 한 번만 굳힌다.
 */
export interface LocalProviderDraft {
  /** 대화 창 크기(토큰). 빈 칸·숫자가 아니면 미설정 = 엔진 기본값. */
  contextDraft: string;
  /** 샘플링 온도. 빈 칸이면 미설정 = 엔진 기본값(**`0` 과 다르다** — 0 은 사용자가 정한 값이다). */
  temperatureDraft: string;
  /** §5.19 (H) — 도구 판정을 지운다. 다음 턴이 도구를 한 번 더 실어 보내 다시 물어본다. */
  retryToolSupport: boolean;
}

/**
 * §5.19 (G) — **저장 순간의 최신 프로바이더**(`live`) 위에 이 창이 만진 칸만 얹는다.
 *
 * `live` 를 바닥에 깔아야 하는 이유: 창이 열려 있는 동안에도 왕복은 `contextUsed`·`contextLimit`·
 * `tokensIn/Out` 을 갱신한다. 창을 연 시점의 사본을 되돌려 보내면 그 값들이 **뒤로 가서**
 * 문맥 게이지가 줄어들고 누적 토큰이 깎인다(사용자에게는 계측이 고장 난 것으로 보인다).
 */
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
