/**
 * §5.13 (Y) 40-12 — 앱 창의 **단계 표식**(코어 — 앱 이름을 모른다. 이름은 실행 때 값으로만 온다).
 *
 * 앱을 여는 누름(`open:<appId>`) · 앱 화면 청크를 받기 시작한 때(`shell-start:<appId>`) · 다 받은 때(`shell-ready:<appId>`)를
 * `performance.mark` 로 남긴다. 앱 쪽 계측이 이 표식부터 자기 첫 그림까지를 잰다. 표식은 개발 도구 성능
 * 탭에도 그대로 보이고, 남기는 비용은 사실상 0 이다(계측을 켜지 않으면 아무도 읽지 않는다).
 */
const PREFIX = 'vibisual-app:';

export function markAppTiming(name: string): void {
  try {
    if (typeof performance !== 'undefined' && typeof performance.mark === 'function') performance.mark(`${PREFIX}${name}`);
  } catch { /* 계측은 동작에 영향을 주지 않는다 */ }
}

/** 그 표식의 마지막 시각(ms — performance 기준). 없으면 undefined. */
export function appTimingAt(name: string): number | undefined {
  try {
    return typeof performance === 'undefined' ? undefined : performance.getEntriesByName(`${PREFIX}${name}`).at(-1)?.startTime;
  } catch {
    return undefined;
  }
}
