/** §5.13 (Y) 40-12 — 앱 창 단계 표식(`open:` · `shell-start:` · `shell-ready:<appId>`)을 `performance.mark` 로 — 앱 계측이 여기부터 첫 그림까지 잰다(비용 사실상 0). */
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
