import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { AUTOCOMPACT_COST_SAMPLE } from '@vibisual/shared';
import { useBackdropDismiss } from '../../hooks/usePopupDismiss.js';

/**
 * §4 — 압축을 켜기 전 확인. `/compact` 는 별도 모델 호출이라 접을 때마다 토큰을 쓴다 — 기본 꺼짐(`DEFAULT_AUTOCOMPACT`).
 * 규약: 켜는 방향에만 · 켤 때마다 매번(기억 ❌) · 켜진 값 사이 이동엔 안 뜬다 · 켜면 얻는 것과 끄면 잃는 것을 둘 다 적는다.
 * `OptionsWindow`·`AgentConfigPopup` 공용(두 벌이면 문구가 어긋난다).
 */
export type AutoCompactConfirmKind = 'window' | 'agentSelf';

interface AutoCompactConfirmProps {
  /** 무엇을 켜려는가 — 자동 압축 창 크기(`window`) / 에이전트 자율 요청(`agentSelf`). */
  kind: AutoCompactConfirmKind;
  /** 켜려는 값(창 크기일 때만 · 화면 표기용). */
  pendingLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
}

/** 천 단위 구분 — 로케일 숫자 표기를 그대로 따른다(한국어 `364,566`). */
function groupDigits(n: number): string {
  return n.toLocaleString();
}

export function AutoCompactConfirm({
  kind,
  pendingLabel,
  onCancel,
  onConfirm,
}: AutoCompactConfirmProps): React.JSX.Element {
  const { t } = useTranslation();
  const confirmRef = useRef<HTMLButtonElement>(null);
  // 백드롭을 눌러도 **취소**다 — 돈이 나가는 쪽(켜기)이 실수로 눌리는 기본 동작이 되면 안 된다.
  const backdrop = useBackdropDismiss<HTMLDivElement>(onCancel);

  // Esc 로 취소 — 확인을 기본 동작으로 두지 않는다(돈이 나가는 쪽이 기본이 되면 안 된다).
  //   capture 단계에서 잡아 뒤에 있는 설정 창이 같은 Esc 로 함께 닫히는 것을 막는다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onCancel]);

  useEffect(() => { confirmRef.current?.focus(); }, []);

  const isSelf = kind === 'agentSelf';

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4"
      // `stopPropagation` 을 먼저 — 뒤 창의 백드롭까지 같은 클릭으로 닫히지 않게. 닫기 판정은 `useBackdropDismiss`(카드 안에서 시작한 드래그 ❌).
      onMouseDown={(e) => { e.stopPropagation(); backdrop.onMouseDown(e); }}
      onClick={(e) => { e.stopPropagation(); backdrop.onClick(e); }}
      role="dialog"
      aria-modal="true"
    >
      {/* 낮은 화면(폰 가로·작은 창)에서는 확인 단추가 화면 밖으로 밀려나지 않게 안에서 구른다. */}
      <div className="max-h-[calc(100dvh-2rem)] w-[560px] max-w-full overflow-y-auto rounded-md border border-gray-700 bg-gray-900 p-4 shadow-2xl">
        <div className="mb-3 flex items-start gap-2.5">
          {/* §UI 아이콘 규칙 — 이모지 ❌, lucide 톤 stroke SVG 만. */}
          <svg
            className="mt-0.5 h-5 w-5 shrink-0 text-amber-400"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
            <path d="M12 9v4" />
            <path d="M12 17h.01" />
          </svg>
          <div className="min-w-0">
            <div className="text-sm font-medium text-gray-100">
              {isSelf
                ? t('panel.agentConfig.autoCompact.confirm.titleSelf')
                : t('panel.agentConfig.autoCompact.confirm.title', { value: pendingLabel ?? '' })}
            </div>
          </div>
        </div>

        {/* ① 켜면 무엇을 내는가 — 사용자가 물은 그 질문("토큰 비용이 발생하나")에 대한 답. */}
        <div className="mb-2.5 rounded border border-amber-900/60 bg-amber-950/30 p-2.5">
          <div className="mb-1 text-[12px] font-medium text-amber-300">
            {t('panel.agentConfig.autoCompact.confirm.costHeading')}
          </div>
          <div className="text-[12px] leading-relaxed text-gray-300">
            {isSelf
              ? t('panel.agentConfig.autoCompact.confirm.selfBody')
              : t('panel.agentConfig.autoCompact.confirm.costBody')}
          </div>
          <div className="mt-1.5 text-[12px] leading-relaxed text-gray-500">
            {t('panel.agentConfig.autoCompact.confirm.costSample', {
              runs: AUTOCOMPACT_COST_SAMPLE.runs,
              tokens: groupDigits(AUTOCOMPACT_COST_SAMPLE.avgInputTokens),
              seconds: AUTOCOMPACT_COST_SAMPLE.avgSeconds,
            })}
          </div>
        </div>

        {/* ② 끄면 무엇을 잃는가. */}
        <div className="mb-3 rounded border border-gray-700 bg-gray-950/60 p-2.5">
          <div className="mb-1 text-[12px] font-medium text-gray-300">
            {t('panel.agentConfig.autoCompact.confirm.offHeading')}
          </div>
          <div className="text-[12px] leading-relaxed text-gray-400">
            {t('panel.agentConfig.autoCompact.confirm.offBody')}
          </div>
        </div>

        <div className="mb-3 text-[12px] leading-snug text-gray-600">
          {t('panel.agentConfig.autoCompact.confirm.everyTime')}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <button
            type="button"
            className="rounded px-3 py-1.5 text-xs text-gray-400 hover:bg-gray-800 hover:text-gray-200 pointer-coarse:min-h-9"
            onClick={onCancel}
          >
            {t('panel.agentConfig.autoCompact.confirm.cancel')}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className="rounded bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-400 pointer-coarse:min-h-9"
            onClick={onConfirm}
          >
            {t('panel.agentConfig.autoCompact.confirm.enable')}
          </button>
        </div>
      </div>
    </div>
  );
}
