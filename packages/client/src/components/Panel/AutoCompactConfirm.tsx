import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { AUTOCOMPACT_COST_SAMPLE } from '@vibisual/shared';
import { useBackdropDismiss } from '../../hooks/usePopupDismiss.js';

/**
 * §4 (CLI 사양 추종) — **압축을 켜기 전에 한 번 멈춰 세우는 확인 팝업** (2026-09-02 사용자 지시).
 *
 * 압축은 공짜 정리가 아니다. `/compact` 는 대화 전체를 모델에 다시 먹여 요약을 만드는 **별도의
 * 모델 호출 1회**라, 접을 때마다 입력·출력 토큰과 플랜 사용량을 쓴다. 그래서 기본을 꺼짐으로
 * 내리고(`DEFAULT_AUTOCOMPACT`), 켜는 것은 이 팝업을 거친 명시 선택으로만 되게 했다.
 *
 * 규약 넷:
 *  1. **켜는 방향에만 관문을 둔다.** 끄기는 확인 없이 즉시 — 돈이 나가는 쪽만 막는다.
 *  2. **끄고 다시 켤 때마다 매번 뜬다.** "봤음"을 기억하지 않는다 — 켤 때마다 비용이 나가는
 *     축이라 "언제 켜졌는지 몰랐다"가 생기면 안 된다.
 *  3. **켜진 값 사이의 이동(400k → 500k)에는 뜨지 않는다.** 이미 켜져 있다는 사실을 사용자가
 *     알고 있고, 매번 막으면 경고가 소음이 되어 읽히지 않는다.
 *  4. **양쪽을 다 적는다** — 켜면 무엇을 내는가 + 끄면 무엇을 잃는가. 한쪽만 적으면 그것은
 *     경고가 아니라 유도다.
 *
 * 설정 창(`OptionsWindow`)과 에이전트 설정 창(`AgentConfigPopup`)이 **같은 컴포넌트**를 쓴다 —
 * 두 벌로 두면 한쪽만 고쳐져 문구가 어긋난다.
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
      // 백드롭 닫기는 공통 규약(`useBackdropDismiss`)으로 — 누른 곳도 뗀 곳도 백드롭 자신일 때만
      //   닫히므로, 카드 안에서 시작한 드래그가 우연히 백드롭 위에서 끝나도 취소되지 않는다.
      //   `stopPropagation` 은 그 앞에 둔다: 뒤 창(설정 창·에이전트 창)의 백드롭까지 같은 클릭으로
      //   함께 닫히는 것을 막는다(TaskEdgePopup 의 중첩 팝업과 같은 형태).
      onMouseDown={(e) => { e.stopPropagation(); backdrop.onMouseDown(e); }}
      onClick={(e) => { e.stopPropagation(); backdrop.onClick(e); }}
      role="dialog"
      aria-modal="true"
    >
      <div className="w-[560px] max-w-full rounded-md border border-gray-700 bg-gray-900 p-4 shadow-2xl">
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

        {/* ② 끄면 무엇을 잃는가 — 사용자 지시: "안 접는 경우 설명도 적어둬". */}
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

        <div className="flex items-center justify-end gap-1.5">
          <button
            type="button"
            className="rounded px-3 py-1.5 text-xs text-gray-400 hover:bg-gray-800 hover:text-gray-200"
            onClick={onCancel}
          >
            {t('panel.agentConfig.autoCompact.confirm.cancel')}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className="rounded bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-400"
            onClick={onConfirm}
          >
            {t('panel.agentConfig.autoCompact.confirm.enable')}
          </button>
        </div>
      </div>
    </div>
  );
}
