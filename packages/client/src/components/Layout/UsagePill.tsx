import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useGraphStore } from '../../stores/graphStore.js';
import { clampUsagePct, usageTextToneClass } from '../../utils/usageLimits.js';
import { UsagePopup } from '../Panel/UsagePopup.js';

// SCENARIO.md §4 v1.50 / v3.60 — 헤더 사용량 필.
//
// 에이전트 상태 배지(`2/14`) **왼쪽**에 현재 세션(5시간 창) 사용률을 상시 노출한다.
// v3.61 — 링 옆 별도 숫자를 없애고 **원 안에 숫자만** 넣는다(사용자 요청: "깔끔하게 원 안에
// 숫자, 퍼센트 사이즈도 작게"). 폭이 20px 고정이라 헤더 우측 클러스터가 늘어나지 않는다.
// 색만 임계에 따라 바뀐다(§4 v1.50 게이지와 같은 기준). 클릭하면 사용량 팝업.
//
// 데이터가 아직 없을 때도 **숨기지 않는다** — 필이 사라지면 수집기를 켤 입구도 같이
// 사라지기 때문. 그 상태에선 dim 한 빈 링 + `-` 로 두고, 왜 비었는지는 팝업이 설명한다.
//
// §4 — 값은 이제 대화형 세션 없이도 들어온다. 서버가 `claude -p "/usage"` 를 주기적으로
// 돌려(모델 호출 0턴 = 과금 없음) 받아 오고, statusLine 수집기는 대화형 세션이 떠 있는 동안
// 그 사이를 더 촘촘히 메우는 보조가 됐다. 그래서 `-` 는 "켜라"가 아니라 대개 "곧 들어온다"다.

/** 사용률 링 + 원 안 숫자. 이모지·이미지 ❌ — 순수 SVG. */
function UsageRing({ pct }: { pct: number | null }): React.JSX.Element {
  const r = 8;
  const circumference = 2 * Math.PI * r;
  const filled = pct === null ? 0 : (Math.max(0, Math.min(100, pct)) / 100) * circumference;
  const value = pct === null ? '-' : String(Math.round(pct));

  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      {/* 트랙 */}
      <circle cx="10" cy="10" r={r} fill="none" stroke="currentColor" strokeWidth="2" className="text-white/15" />
      {/* 채움 — 12시 방향에서 시계방향으로 */}
      {pct !== null && (
        <circle
          cx="10"
          cy="10"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference - filled}`}
          transform="rotate(-90 10 10)"
          className="transition-[stroke-dasharray] duration-500"
        />
      )}
      {/* 원 안 숫자 — 링 안쪽 지름이 12px 이라 3자리(100)까지 들어가도록 작게 잡는다.
          단위(%)는 링 자체가 이미 비율을 뜻하므로 생략(툴팁에 전체 문장이 있다). */}
      <text
        x="10"
        y="10"
        textAnchor="middle"
        dominantBaseline="central"
        fill="currentColor"
        className="font-semibold tabular-nums"
        style={{ fontSize: value.length >= 3 ? '6.5px' : '7.5px', letterSpacing: '-0.2px' }}
      >
        {value}
      </text>
    </svg>
  );
}

export function UsagePill(): React.JSX.Element {
  const { t } = useTranslation();
  const claudeUsage = useGraphStore((s) => s.claudeUsage);
  const rateLimits = useGraphStore((s) => s.rateLimits);
  const [open, setOpen] = useState(false);

  // §4 — 1차 = 서버가 조립한 세션 한도(`claude -p "/usage"` probe 와 statusLine 중 더 최근 것).
  //   그마저 비면 statusLine 이 밀어준 §4 v1.50 원본 값으로 폴백.
  const session = claudeUsage?.limits.find((l) => l.kind === 'session' || l.group === 'session');
  const raw = session?.percent ?? rateLimits?.used5h;
  const pct = typeof raw === 'number' ? clampUsagePct(raw) : null;

  const tone = pct === null ? 'text-gray-500' : usageTextToneClass(pct);
  // 값이 없을 때 "켜라" 와 "기다리는 중" 을 구분한다 — 수집기가 이미 켜져 있는데 "클릭해서
  // 켜기" 라고 하면 사용자가 켜진 스위치를 다시 누르게 된다(§4 v3.60 재설치 사고의 출발점).
  const title = pct !== null
    ? t('header.usage.tooltip', { percent: Math.round(pct) })
    : claudeUsage?.error === 'cli-unavailable'
      ? t('header.usage.tooltipCliUnavailable')
      : claudeUsage?.error === 'awaiting-statusline'
        ? t('header.usage.tooltipWaiting')
        : t('header.usage.tooltipNoData');

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={title}
        aria-label={title}
        className={`app-nodrag flex items-center justify-center rounded-md p-1 transition-colors duration-150 hover:bg-white/[0.08] ${tone}`}
      >
        <UsageRing pct={pct} />
      </button>

      {/* Header 의 backdrop-filter 가 fixed 자식의 containing block 이 되므로(§7.7 v1.99 ServerLogPopup
          와 동일한 함정) 팝업은 body 로 portal 해서 화면 전체를 덮게 한다. */}
      {open && createPortal(<UsagePopup onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}
