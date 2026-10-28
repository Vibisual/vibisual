import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useGraphStore } from '../../stores/graphStore.js';
import { clampUsagePct, usageTextToneClass } from '../../utils/usageLimits.js';
import { useCodexUsage } from '../../hooks/useCodexUsage.js';
import { UsagePopup } from '../Panel/UsagePopup.js';

// §4 — 헤더 사용량 필: 현재 세션(5시간 창) 사용률. 원 안 숫자만, 폭 20px 고정, 색만 임계에 따라. 엔진 글리프 없음(툴팁·팝업이 말한다).
// 값이 없어도 숨기지 않는다(수집기 입구) — dim 링 + `-`. 값은 서버가 `claude -p "/usage"`(0턴 = 과금 없음)로 주기적으로 받아, `-` 는 대개 "곧 들어온다"다.

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
  const main = useGraphStore(s => s.userDefaults?.engineChoice?.kind ?? 'claude');
  const codexAuth = useGraphStore(s => s.codexAuth);
  const codexLoggedIn = codexAuth?.loggedIn === true;
  const { usage: codexUsage } = useCodexUsage(main === 'codex' && codexLoggedIn, codexAuth);
  const claudeUsage = useGraphStore((s) => s.claudeUsage);
  const rateLimits = useGraphStore((s) => s.rateLimits);
  // §4 API 크레딧 — 새 실행이 크레딧으로 나가는 중이면 주황 점, Anthropic 이 크레딧을 거절 중이면 빨강 점. 필 폭은 그대로다.
  const creditOn = useGraphStore((s) => s.apiCredits?.settings.enabled === true);
  const creditRoute = useGraphStore((s) => s.apiCredits?.route);
  const creditBlocked = useGraphStore((s) => !!s.apiCredits?.block);
  const creditDot = main !== 'claude' || !creditOn ? null : creditBlocked ? 'blocked' : creditRoute === 'credits' ? 'active' : null;
  const [open, setOpen] = useState(false);

  // §4 — 1차 = 서버 조립 세션 한도(`/usage` probe 와 statusLine 중 최근 것), 없으면 statusLine 원본 값.
  const session = claudeUsage?.limits.find((l) => l.kind === 'session' || l.group === 'session');
  const raw = main === 'claude' ? session?.percent ?? rateLimits?.used5h : main === 'codex' && codexLoggedIn ? (codexUsage?.windows.find(w => w.id === 'codex:primary') ?? codexUsage?.windows[0])?.usedPercent : undefined;
  const pct = typeof raw === 'number' ? clampUsagePct(raw) : null;

  const tone = pct === null ? 'text-gray-500' : usageTextToneClass(pct);
  // 값이 없을 때 "켜라"와 "기다리는 중"을 가른다 — 켜진 수집기에 "켜기"라고 하면 켜진 스위치를 다시 누르게 된다.
  const title = `${t(`providers.${main}`)} · ` + (main === 'local' ? t('providers.localUsage') : main === 'codex' ? (pct !== null ? `${Math.round(pct)}%` : t(codexLoggedIn ? 'providers.noUsage' : 'providers.signIn')) : pct !== null
    ? t('header.usage.tooltip', { percent: Math.round(pct) })
    : claudeUsage?.error === 'cli-unavailable'
      ? t('header.usage.tooltipCliUnavailable')
      : claudeUsage?.error === 'awaiting-statusline'
        ? t('header.usage.tooltipWaiting')
        : t('header.usage.tooltipNoData'))
    + (creditDot === 'active' ? ` · ${t('header.usage.creditActive')}` : creditDot === 'blocked' ? ` · ${t('header.usage.creditBlocked')}` : '');

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={title}
        aria-label={title}
        className={`app-nodrag relative flex items-center justify-center rounded-md p-1 transition-colors duration-150 hover:bg-white/[0.08] ${tone}`}
      >
        <UsageRing pct={pct} />
        {creditDot && (
          <span
            aria-hidden="true"
            className={`absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full ring-1 ring-gray-950 ${creditDot === 'blocked' ? 'bg-red-400' : 'bg-amber-400'}`}
          />
        )}
      </button>

      {/* Header backdrop-filter 가 fixed 자식을 가두므로(§7.7 ServerLogPopup 과 같은 함정) 팝업은 body 로 portal 한다. */}
      {open && createPortal(<UsagePopup onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}
