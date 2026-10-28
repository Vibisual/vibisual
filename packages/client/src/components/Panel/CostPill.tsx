import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { formatCostUsd } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { costTextToneClass, findCostMap, toneOf } from '../../utils/costMap.js';
import { CostMapPopup, EstimatedMark } from './CostMapPopup.js';

// SCENARIO.md §5.21 / §7.19 — 사용량 팝업 맨 아래 비용 줄(오늘 비용). 데이터가 없어도 숨기지 않는다 — 지도 입구라 dim `—`.
// 열림은 부모가 든다 — Esc 순서 때문이고, 전역 플래그면 다음에 사용량 팝업을 열 때 비용 창이 되살아난다.

interface CostPillProps {
  /** 비용·토큰 지도 팝업이 열려 있는가. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** 지폐 한 장 글리프 — lucide 톤 인라인 stroke SVG(이모지 ❌). */
function CostGlyph(): React.JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 2v20" />
      <path d="M17 7.5c0-1.9-2.2-3-5-3s-5 1-5 3 2.2 2.7 5 3.2 5 1.3 5 3.3-2.2 3-5 3-5-1.1-5-3" />
    </svg>
  );
}

export function CostPill({ open, onOpenChange }: CostPillProps): React.JSX.Element {
  const { t } = useTranslation();
  const costMaps = useGraphStore((s) => s.costMaps);
  const activeProject = useGraphStore((s) => s.activeProject);

  const map = findCostMap(costMaps, activeProject);
  // 측정된 적이 없으면 `$0.00` 대신 `—` 다 — 0 원은 "공짜로 일했다"는 거짓말이 된다.
  const today = map?.measured ? map.periods.today.costUsd : undefined;
  const tone = costTextToneClass(toneOf(today, map?.measured ?? false));
  const label = today === undefined ? '—' : formatCostUsd(today);
  // **오늘 몫**이 추정인지만 본다 — 지난달에 한 번 스친 미상 모델 때문에 오늘 금액에 표식이
  // 붙으면 그 표식은 "지금 뭔가 모르는 게 돌고 있다"는 뜻을 잃는다(날짜 버킷이 이걸 갈라 준다).
  const estimated = today !== undefined && (map?.periods.today.estimated ?? false);
  const title = today === undefined
    ? t('panel.cost.pillEmpty')
    : estimated
      ? `${t('panel.cost.pillLabel')}: ${label} — ${t('panel.cost.estimatedMarkHint')}`
      : `${t('panel.cost.pillLabel')}: ${label}`;

  return (
    <>
      {/* 팝업 본문 스크롤 **밖** 바닥에 고정되는 줄 — 아래로 내려야 보이는 입구는 없는 입구와 같다. */}
      <button
        type="button"
        onClick={() => onOpenChange(true)}
        title={title}
        aria-label={t('panel.cost.openMap')}
        className="flex w-full flex-shrink-0 items-center gap-2 rounded-b-lg border-t border-gray-700 px-4 py-3 text-left transition-colors duration-150 hover:bg-gray-800/60"
      >
        <span className="flex-shrink-0 text-gray-400">
          <CostGlyph />
        </span>
        <span className="text-xs font-semibold text-gray-200">{t('panel.cost.pillLabel')}</span>
        <span className="flex-1" />
        {estimated && <EstimatedMark models={map?.unseededModels} />}
        <span className={`font-mono text-sm font-bold tabular-nums ${tone}`}>{label}</span>
        <svg
          className="h-3.5 w-3.5 flex-shrink-0 text-gray-600"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
      </button>

      {/* 부모의 backdrop-blur 가 fixed 의 containing block 이 되므로 body 로 portal(§7.7 ServerLogPopup 과 같은 함정). */}
      {open && createPortal(<CostMapPopup onClose={() => onOpenChange(false)} />, document.body)}
    </>
  );
}
