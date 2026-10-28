import {
  VERIFICATION_DEMO_STEPS_MAX,
  VERIFICATION_DEMO_STEP_TEXT_MAX,
  VERIFICATION_DEMO_LABEL_MAX,
} from '@vibisual/shared';
import type { VerificationDemo, VerificationDemoStep } from '@vibisual/shared';
import type { ClipRange } from '../BubbleMap/playtestClip.js';

// §5.5 #17-35 ⑨ — 시연의 순수 계산 한 벌(시연 창·검증 뷰·저장 경로가 같은 단계 순서를 보게).

/** 클립 안 시각 `ms` 를 `0:03` 로. 단계 문장과 붙는 그림이 같은 순간을 가리키게 하는 표시. */
export function formatDemoTime(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/** 단계를 **시각 순서로 꽂고** 상한을 넘으면 넣지 않는다 — 되돌려 보며 아무 데서나 적어 입력 순서 ≠ 시간 순서다(번호가 어긋나면 재현이 뒤집힌다). */
export function insertDemoStep(
  steps: readonly VerificationDemoStep[],
  step: VerificationDemoStep,
  max: number = VERIFICATION_DEMO_STEPS_MAX,
): VerificationDemoStep[] {
  const text = step.text.trim().slice(0, VERIFICATION_DEMO_STEP_TEXT_MAX);
  if (!text) return [...steps];
  if (steps.length >= max) return [...steps];
  const atMs = Number.isFinite(step.atMs) && step.atMs > 0 ? Math.round(step.atMs) : 0;
  const next = [...steps, { ...step, atMs, text }];
  // 같은 시각이면 나중에 적은 것이 뒤로(안정 정렬) — 한 지점에서 두 줄을 적는 흔한 경우.
  next.sort((a, b) => a.atMs - b.atMs);
  return next;
}

/** 단계 한 줄 제거(창의 [×]). 범위 밖 인덱스는 그대로 돌려준다. */
export function removeDemoStep(steps: readonly VerificationDemoStep[], index: number): VerificationDemoStep[] {
  if (index < 0 || index >= steps.length) return [...steps];
  return steps.filter((_, i) => i !== index);
}

/** 편집 중에는 클립 절대 시각을 보관한다. 구간을 바꿔도 단계가 가리키는 실제 장면은 움직이지 않는다. */
export function demoStepsInRange(steps: readonly VerificationDemoStep[], range: ClipRange): VerificationDemoStep[] {
  return steps
    .filter((step) => step.atMs >= range.startMs && step.atMs <= range.endMs)
    .map((step) => ({ ...step, atMs: step.atMs - range.startMs }));
}

/** 시연 이름 기본값 — 소스 이름 + 시각(이름을 안 적어도 목록에서 구별되게). */
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

/** 검증 프롬프트에 실을 내용이 있는가(단계·기대 결과·그림 중 하나). 서버 `buildVerifyPrompt` 와 같은 판정이어야 한다(저장은 막지 않는다). */
export function demoHasContent(demo: Pick<VerificationDemo, 'steps' | 'expected' | 'frames'>): boolean {
  return demo.steps.length > 0 || !!demo.expected?.trim() || demo.frames.length > 0;
}

/** 목록 한 줄에 붙일 요약(`단계 3 · 그림 4`). 0 인 축은 적지 않는다 — 빈 숫자는 읽는 비용만 든다. */
export function demoSummaryParts(demo: Pick<VerificationDemo, 'steps' | 'frames'>): { steps: number; frames: number } {
  return { steps: demo.steps.length, frames: demo.frames.length };
}
