import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useGraphStore } from '../../stores/graphStore.js';
import { normalizeUsagePct, usageTextToneClass } from '../../utils/usageLimits.js';
import { UsagePopup } from '../Panel/UsagePopup.js';

// SCENARIO.md §4 v1.50 / v3.60 — 헤더 사용량 필.
//
// 에이전트 상태 배지(`2/14`) **왼쪽**에 현재 세션(5시간 창) 사용률을 상시 노출한다.
// 링 하나 + 숫자 하나로 폭을 고정하고, 색만 임계에 따라 바뀐다(§4 v1.50 게이지와 같은 기준).
// 클릭하면 사용량 전체(5h/7d·리셋 카운트다운·수집기 스위치)를 팝업으로 연다.
//
// 데이터가 아직 없을 때도 **숨기지 않는다** — 필이 사라지면 수집기를 켤 입구도 같이
// 사라지기 때문. 그 상태에선 dim 한 `--%` 로 두고, 팝업이 켜는 법을 안내한다.

/** 사용률 링 — 24×24 SVG. stroke-dasharray 로 원주를 채운다(이모지·이미지 ❌). */
function UsageRing({ pct, className }: { pct: number | null; className?: string }): React.JSX.Element {
  const r = 8;
  const circumference = 2 * Math.PI * r;
  const filled = pct === null ? 0 : (Math.max(0, Math.min(100, pct)) / 100) * circumference;
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r={r} fill="none" stroke="currentColor" strokeWidth="2.5" className="text-white/15" />
      {pct !== null && (
        <circle
          cx="10"
          cy="10"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference - filled}`}
          // 12시 방향에서 시계방향으로 차오르게.
          transform="rotate(-90 10 10)"
          className="transition-[stroke-dasharray] duration-500"
        />
      )}
    </svg>
  );
}

export function UsagePill(): React.JSX.Element {
  const { t } = useTranslation();
  const rateLimits = useGraphStore((s) => s.rateLimits);
  const [open, setOpen] = useState(false);

  const pct =
    rateLimits && typeof rateLimits.used5h === 'number'
      ? normalizeUsagePct(rateLimits.used5h)
      : null;

  const tone = pct === null ? 'text-gray-500' : usageTextToneClass(pct);
  const label = pct === null ? t('header.usage.noData') : `${Math.round(pct)}%`;
  const title = pct === null ? t('header.usage.tooltipNoData') : t('header.usage.tooltip', { percent: Math.round(pct) });

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={title}
        aria-label={title}
        className={`app-nodrag flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[12px] font-medium tabular-nums tracking-tight transition-colors duration-150 max-md:hidden hover:bg-white/[0.08] ${tone}`}
      >
        <UsageRing pct={pct} />
        <span>{label}</span>
      </button>

      {/* Header 의 backdrop-filter 가 fixed 자식의 containing block 이 되므로(§7.7 v1.99 ServerLogPopup
          와 동일한 함정) 팝업은 body 로 portal 해서 화면 전체를 덮게 한다. */}
      {open && createPortal(<UsagePopup onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}
