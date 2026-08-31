import {
  VERIFICATION_DEMO_STEPS_MAX,
  VERIFICATION_DEMO_STEP_TEXT_MAX,
  VERIFICATION_DEMO_LABEL_MAX,
} from '@vibisual/shared';
import type { VerificationDemo, VerificationDemoStep } from '@vibisual/shared';

// §5.5 #17-35 ⑨ — 시연(재현 절차)의 순수 계산 한 벌.
//
// 시연 창·검증 뷰·저장 경로가 **같은 답**을 봐야 한다: 창에서 본 단계 순서와 실제로 서버에 저장되는
// 순서가 어긋나면 그 즉시 못 믿는 화면이 된다. 그래서 계산은 여기 한 곳에만 두고 단위 테스트로 굳힌다
// (`playtestClip` 이 같은 이유로 §5.9 에 사는 것과 같은 자리).
//
// 화면도 시각도 보지 않는다 — 전부 입력 → 출력이라 통째로 시험된다.

/** 클립 안 시각 `ms` 를 `0:03` 로. 단계 문장과 붙는 그림이 같은 순간을 가리키게 하는 표시. */
export function formatDemoTime(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/**
 * 단계 하나를 넣는다 — **시각 순서로 꽂고** 상한을 넘으면 넣지 않는다.
 *
 * 사용자는 되돌려 보며 아무 지점에서나 단계를 적으므로(뒤로 갔다가 다시 앞으로) 입력 순서가 곧
 * 시간 순서가 아니다. 프롬프트는 "1. 2. 3." 으로 나가는데 그 번호가 시간과 어긋나면 재현이 뒤집힌다.
 */
export function insertDemoStep(
  steps: readonly VerificationDemoStep[],
  step: VerificationDemoStep,
  max: number = VERIFICATION_DEMO_STEPS_MAX,
): VerificationDemoStep[] {
  const text = step.text.trim().slice(0, VERIFICATION_DEMO_STEP_TEXT_MAX);
  if (!text) return [...steps];
  if (steps.length >= max) return [...steps];
  const atMs = Number.isFinite(step.atMs) && step.atMs > 0 ? Math.round(step.atMs) : 0;
  const next = [...steps, { atMs, text }];
  // 같은 시각이면 나중에 적은 것이 뒤로(안정 정렬) — 한 지점에서 두 줄을 적는 흔한 경우.
  next.sort((a, b) => a.atMs - b.atMs);
  return next;
}

/** 단계 한 줄 제거(창의 [×]). 범위 밖 인덱스는 그대로 돌려준다. */
export function removeDemoStep(steps: readonly VerificationDemoStep[], index: number): VerificationDemoStep[] {
  if (index < 0 || index >= steps.length) return [...steps];
  return steps.filter((_, i) => i !== index);
}

/**
 * 시연 이름 기본값 — 소스 이름 + 시각.
 *
 * 사용자가 이름을 안 적어도 목록에서 **무엇을 찍은 것인지** 구별돼야 한다("demo" 여섯 줄 ❌).
 */
export function defaultDemoLabel(sourceName: string, at: number, locale?: string): string {
  let time = '';
  try {
    time = new Date(at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  } catch {
    time = '';
  }
  const name = sourceName.trim();
  const raw = name ? (time ? `${name} · ${time}` : name) : (time || 'demo');
  return raw.slice(0, VERIFICATION_DEMO_LABEL_MAX);
}

/**
 * 이 시연이 검증 프롬프트에 **실릴 만한 내용을 갖고 있는가**.
 *
 * 셋 다 비어 있으면(단계도 기대 결과도 그림도 없음) 실어 봐야 프롬프트에 블록만 늘고 뜻이 없다 —
 * 서버 `buildVerifyPrompt` 가 같은 판정을 하므로 화면도 같은 답을 보여야 한다(저장은 막지 않는다).
 */
export function demoHasContent(demo: Pick<VerificationDemo, 'steps' | 'expected' | 'frames'>): boolean {
  return demo.steps.length > 0 || !!demo.expected?.trim() || demo.frames.length > 0;
}

/** 목록 한 줄에 붙일 요약(`단계 3 · 그림 4`). 0 인 축은 적지 않는다 — 빈 숫자는 읽는 비용만 든다. */
export function demoSummaryParts(demo: Pick<VerificationDemo, 'steps' | 'frames'>): { steps: number; frames: number } {
  return { steps: demo.steps.length, frames: demo.frames.length };
}
