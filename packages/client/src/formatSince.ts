/**
 * formatSince.ts — epoch ms 를 "방금 전 / 5m ago / 3h ago / 12d ago" 로.
 *
 * 원래 `DetailPanel` 안에 살던 함수다. §5.5 #17-33 ⑦ 이 플러그인 창에서 **"마켓을 마지막으로
 * 언제 끌어왔나"** 를 같은 모양으로 적어야 해서 밖으로 꺼냈다 — 두 벌로 두면 한쪽만 고쳐져
 * 같은 화면 안에서 시간이 다르게 읽힌다.
 *
 * i18n 키는 옮기지 않았다(`panel.detailPanel.*`). 이 문자열들은 이미 12개 로케일에 다 있고,
 * 키를 옮기면 그 12벌을 전부 다시 손봐야 하는데 얻는 것이 없다.
 */

/** i18n `t` 의 최소 모양 — 이 모듈은 react-i18next 를 알 필요가 없다(테스트가 쉬워진다). */
export type TranslateFn = (key: string, opts?: Record<string, unknown>) => string;

/**
 * @param ts  잰 시각(epoch ms)
 * @param t   번역 함수
 * @param now 지금(테스트에서 고정할 수 있게 인자로 받는다 — `Date.now()` 를 안에서 읽으면
 *            이 함수의 경계값은 영영 시험할 수 없다)
 */
export function formatSince(ts: number, t: TranslateFn, now: number = Date.now()): string {
  const diff = now - ts;
  if (diff < 60_000) return t('panel.detailPanel.justNow');
  if (diff < 3_600_000) return t('panel.detailPanel.minutesAgo', { n: Math.floor(diff / 60_000) });
  if (diff < 86_400_000) return t('panel.detailPanel.hoursAgo', { n: Math.floor(diff / 3_600_000) });
  return t('panel.detailPanel.daysAgo', { n: Math.floor(diff / 86_400_000) });
}
