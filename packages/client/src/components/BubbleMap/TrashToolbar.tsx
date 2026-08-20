import { useTranslation } from 'react-i18next';
import { useGraphStore } from '../../stores/graphStore.js';
import { useTrashedAgents } from '../../hooks/useTrashedAgents.js';

/**
 * §5.10 v4.84 — 휴지통 내부에서만 뜨는 툴바. 경로 표시(`CanvasBreadcrumb`) 바로 아래에 붙어
 * ① [모두 삭제] 버튼과 ② "선택 후 Delete · Shift 로 여러 개" 라는 조작 안내를 준다.
 *
 * 종전 휴지통은 버블 하나를 고른 뒤 우측 패널의 [영구 삭제]를 누르는 단 한 경로뿐이라, 버린
 * 에이전트가 쌓이면 같은 확인 절차를 개수만큼 반복해야 했다. 삭제 자체는 확인 팝업
 * (`TrashPurgeDialog`)이 받아 배치 REST 한 번으로 처리한다 — 여기서는 대상만 넘긴다.
 *
 * 대상 배열은 `useTrashedAgents` 하나에서 나온다(버블 배지·내부 목록과 같은 배열 — v3.73).
 */
export function TrashToolbar(): React.JSX.Element | null {
  const { t } = useTranslation();
  const interiorView = useGraphStore((s) => s.interiorView);
  const requestTrashPurge = useGraphStore((s) => s.requestTrashPurge);
  const trashedAgents = useTrashedAgents();

  // 휴지통 밖이거나 빈 휴지통이면 아무것도 그리지 않는다(지울 게 없는데 버튼만 떠 있으면 소음).
  if (interiorView?.kind !== 'trash' || trashedAgents.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 top-10 z-20 flex justify-center">
      <div className="pointer-events-auto flex items-center gap-2 rounded-md border border-gray-800 bg-gray-900/85 px-2 py-1 shadow-lg shadow-black/30 backdrop-blur-sm">
        <span className="text-[12px] text-white/45">
          {t('brain.trashCountLabel', { defaultValue: '버려진 에이전트 {{n}}개', n: trashedAgents.length })}
        </span>
        <span className="h-3 w-px bg-white/10" />
        <button
          type="button"
          onClick={() => requestTrashPurge(trashedAgents.map((a) => a.id))}
          className="flex items-center gap-1.5 rounded bg-red-900/40 px-2 py-1 text-[12px] font-medium text-red-300 transition-colors hover:bg-red-900/70 hover:text-red-200"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-3.5 w-3.5"
            aria-hidden="true"
          >
            <path d="M3 6h18" />
            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            <path d="M10 11v6M14 11v6" />
          </svg>
          {t('brain.purgeAll', { defaultValue: '모두 삭제' })}
        </button>
        <span className="hidden text-[12px] text-white/30 sm:inline">
          {t('brain.trashDeleteHint', { defaultValue: '선택 후 Delete · Shift 로 여러 개' })}
        </span>
      </div>
    </div>
  );
}
