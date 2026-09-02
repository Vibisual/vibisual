/**
 * stepTraceText.ts — §5.5 #17-39 단계 자국의 **문구 조립**(순수 로직).
 *
 * `turnSteps.ts` 가 숫자를 정하고, 이 파일이 그 숫자를 로케일 문장으로 만든다. 두 탭(Sub·메인)이
 * **같은 함수**를 쓰므로 같은 대화가 탭에 따라 다르게 적히지 않는다(#17-12 ⑦ 과 같은 이유).
 *
 * i18next 를 import 하지 않고 `t` 를 인자로 받는다 — React 없이 Vitest 로 문구 규칙을 검증하기 위함
 * (클라 테스트에는 DOM 이 없다).
 */
import { describeStepDuration, TRACE_SHOW_MS, type StepDuration } from './turnSteps.js';

/** i18next `t` 와 같은 모양만 요구한다(라이브러리 결합 ❌). */
export type TranslateFn = (key: string, opts?: Record<string, unknown>) => string;

/** 자국 문구를 잇는 가운뎃점. 로케일과 무관한 기호라 문자열 파일에 두지 않는다. */
export const TRACE_SEP = ' · ';

const KEY = 'ide.stepTrace';

/** 숫자에 천 단위 구분을 넣는다. 앱 로케일을 받는 이유는 OS 로케일과 다를 수 있어서다. */
function num(value: number, locale: string): string {
  return value.toLocaleString(locale);
}

/** `StepDuration` → 로케일 문장(`1분 13초` / `1초 미만`). */
export function durationText(t: TranslateFn, d: StepDuration): string {
  switch (d.kind) {
    case 'under':   return t(`${KEY}.underSec`);
    case 'sec':     return t(`${KEY}.sec`, { sec: d.sec });
    case 'minSec':  return t(`${KEY}.minSec`, { min: d.min, sec: d.sec });
    case 'hourMin': return t(`${KEY}.hourMin`, { hour: d.hour, min: d.min });
  }
}

/** 경과(ms) → 로케일 문장. 호출측이 `describeStepDuration` 을 따로 부르지 않게 하는 지름길. */
export function elapsedText(t: TranslateFn, ms: number): string {
  return durationText(t, describeStepDuration(ms));
}

/**
 * 사고 자국 — 사진 그대로의 형태. `1분 13초 동안 사고함 · 4,182자`
 * 분량은 **셌을 때만** 붙인다(0자면 붙일 말이 없다).
 */
export function thinkTraceText(t: TranslateFn, locale: string, ms: number, chars: number): string {
  const head = t(`${KEY}.thought`, { duration: elapsedText(t, ms) });
  if (chars <= 0) return head;
  return head + TRACE_SEP + t(`${KEY}.chars`, { value: num(chars, locale) });
}

/**
 * 작성 자국 — 본문 말풍선 아래 한 줄. `1,904자 작성 · 21초`
 * 걸린 시간은 **뜻이 생길 때만** 붙인다(`1초 미만 작성`은 알려 주는 것이 없다).
 */
export function writeTraceText(t: TranslateFn, locale: string, ms: number, chars: number): string {
  const head = t(`${KEY}.wrote`, { value: num(chars, locale) });
  if (ms < TRACE_SHOW_MS) return head;
  return head + TRACE_SEP + elapsedText(t, ms);
}

/**
 * 도구 묶음 헤더에 붙는 경과 — `38초`. 잴 수 없으면(호출 하나뿐이라 폭이 0) 빈 문자열을 돌려
 * 호출측이 아무것도 붙이지 않게 한다(`0초` 는 알려 주는 것이 없다).
 */
export function toolElapsedText(t: TranslateFn, ms: number): string {
  return ms < TRACE_SHOW_MS ? '' : elapsedText(t, ms);
}
