import { useTranslation } from 'react-i18next';

import {
  clampUsagePct,
  usageBarToneClass,
  usageTextToneClass,
} from '../../utils/usageLimits.js';

/** 사용량 게이지 — 두 탭이 함께 쓴다(복제하면 색 임계가 갈라진다). `undefined` 는 `--%` — 모르는 것과 0% 는 다르다. */

/** 남은 시간 → "4시간 28분" / "12분". 초 단위는 버린다(1초마다 숫자가 튀지 않게 분 단위 표기). */
function useCountdownLabel(resetAt: number | undefined, now: number | undefined): string | null {
  const { t } = useTranslation();
  if (!resetAt || now === undefined) return null;
  const remainMs = resetAt - now;
  if (remainMs <= 0) return t('panel.usage.resettingNow');
  const totalMinutes = Math.floor(remainMs / 60_000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  const span = days > 0
    ? t('panel.usage.spanDh', { d: days, h: hours })
    : hours > 0
      ? t('panel.usage.spanHm', { h: hours, m: minutes })
      : t('panel.usage.spanM', { m: minutes });
  return t('panel.usage.resetsIn', { span });
}

export function LimitGauge({
  label,
  used,
  resetAt,
  now,
  subdued,
  hint,
  showRemaining,
}: {
  label: string;
  used: number | undefined;
  /** 구독 한도처럼 리셋 시각이 있는 줄에만. 자원 게이지는 리셋되지 않으므로 비운다. */
  resetAt?: number;
  now?: number;
  /** 모델별 한도처럼 부차적인 줄은 한 단계 작게 그린다. */
  subdued?: boolean;
  /** 게이지 아래 작은 한 줄. 카운트다운이 있으면 그쪽이 자리를 갖는다. */
  hint?: string;
  /** Account allowances show both used and remaining amounts; hardware meters keep their current form. */
  showRemaining?: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const countdown = useCountdownLabel(resetAt, now);
  const pct = typeof used === 'number' ? clampUsagePct(used) : null;
  const footnote = countdown ?? hint ?? null;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className={`min-w-0 truncate font-semibold ${subdued ? 'text-[12px] text-gray-400' : 'text-xs text-gray-200'}`}>
          {label}
        </span>
        <span className={`font-mono font-bold tabular-nums ${subdued ? 'text-sm' : 'text-lg'} ${
          pct === null ? 'text-gray-600' : usageTextToneClass(pct)
        }`}>
          {pct === null ? t('panel.usage.noValue') : showRemaining
            ? t('panel.usage.usedPercent', { percent: pct.toFixed(0) }) : `${pct.toFixed(0)}%`}
        </span>
      </div>
      <div className={`overflow-hidden rounded-full bg-gray-700/70 ${subdued ? 'h-1.5' : 'h-2'}`}>
        {pct !== null && (
          <div className={`h-full transition-all duration-500 ${usageBarToneClass(pct)}`} style={{ width: `${pct}%` }} />
        )}
      </div>
      {(footnote || (showRemaining && pct !== null)) && <div className="flex flex-wrap justify-between gap-x-2 gap-y-1 text-[12px] text-gray-400">
        {showRemaining && pct !== null && <span>{t('panel.usage.remainingPercent', { percent: (100 - pct).toFixed(0) })}</span>}
        {footnote && <span>{footnote}</span>}
      </div>}
    </div>
  );
}
