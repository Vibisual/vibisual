/**
 * formatSince.ts — epoch ms 를 "방금 전 / 5m ago / 3h ago / 12d ago" 로.
 * `DetailPanel` 과 플러그인 창(§5.5 #17-33 ⑦ 마켓을 마지막으로 끌어온 때)이 함께 쓴다 — 두 벌이면 한쪽만 고쳐져 같은 화면에서 시간이 다르게 읽힌다.
 * i18n 키는 `panel.detailPanel.*` 그대로 둔다(12개 로케일에 이미 있다 — 옮겨 얻는 것이 없다).
 */

/** i18n `t` 의 최소 모양 — 이 모듈은 react-i18next 를 알 필요가 없다(테스트가 쉬워진다). */
export type TranslateFn = (key: string, opts?: Record<string, unknown>) => string;

/**
 * @param ts  잰 시각(epoch ms)
 * @param t   번역 함수
 * @param now 지금 — 인자로 받아야 시험에서 고정된다(안에서 `Date.now()` 를 읽으면 경계값을 시험할 수 없다)
 */
export function formatSince(ts: number, t: TranslateFn, now: number = Date.now()): string {
  const diff = now - ts;
  if (diff < 60_000) return t('panel.detailPanel.justNow');
  if (diff < 3_600_000) return t('panel.detailPanel.minutesAgo', { n: Math.floor(diff / 60_000) });
  if (diff < 86_400_000) return t('panel.detailPanel.hoursAgo', { n: Math.floor(diff / 3_600_000) });
  return t('panel.detailPanel.daysAgo', { n: Math.floor(diff / 86_400_000) });
}
