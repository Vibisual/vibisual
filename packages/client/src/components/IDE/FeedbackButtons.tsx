import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentFeedbackTargetType } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';

/**
 * §4 v3.21 — 좋아요/싫어요 피드백 버튼 (작업 신고/검수 카드 푸터 + 스트림 result 블록 공용).
 *
 * 클릭 즉시 서버로 upsert(같은 대상 재클릭 = 철회). 싫어요는 즉시 전송 후 사유 입력을 열어
 * 선택적으로 보강(재전송 = verdict 교체라 안전). 눌림 상태는 graph_snapshot 의 agentFeedbacks 가
 * SSOT — 로컬 낙관 상태를 두지 않아 창/새로고침을 넘어 일관된다.
 */
interface FeedbackButtonsProps {
  agentId: string;
  subAgentId?: string;
  targetType: AgentFeedbackTargetType;
  targetId: string;
  /** 평가 시점 대상 내용 스냅샷 — 서버가 함께 영속해 학습 재료로 쓴다. */
  summary: string[];
}

export function ThumbsUpIcon({ className = 'h-3.5 w-3.5' }: { className?: string }): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 10v12" />
      <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" />
    </svg>
  );
}

export function ThumbsDownIcon({ className = 'h-3.5 w-3.5' }: { className?: string }): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 14V2" />
      <path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z" />
    </svg>
  );
}

export const FeedbackButtons = memo(function FeedbackButtons({ agentId, subAgentId, targetType, targetId, summary }: FeedbackButtonsProps): React.JSX.Element {
  const { t } = useTranslation();
  const setFeedback = useGraphStore((s) => s.setFeedback);
  // zustand v5 — 파생 객체 반환 금지(매 스냅샷 새 참조). 피드백 객체 자체를 선택(없으면 undefined).
  const found = useGraphStore((s) =>
    s.agentFeedbacks[agentId]?.find((x) => x.targetType === targetType && x.targetId === targetId),
  );
  const current = found ? { verdict: found.verdict, reason: found.reason ?? '' } : null;
  const [reasonOpen, setReasonOpen] = useState(false);
  const [reasonText, setReasonText] = useState('');

  const send = (verdict: 'up' | 'down' | null, reason?: string): void => {
    setFeedback({ agentId, subAgentId: subAgentId ?? null, targetType, targetId, verdict, ...(reason ? { reason } : {}), summary });
  };

  const onUp = (): void => {
    setReasonOpen(false);
    send(current?.verdict === 'up' ? null : 'up');
  };

  const onDown = (): void => {
    if (current?.verdict === 'down') {
      setReasonOpen(false);
      send(null);
      return;
    }
    // 즉시 싫어요 기록 + 사유 입력 열기(사유 저장 = 같은 대상 upsert 재전송이라 안전).
    send('down');
    setReasonText(current?.reason ?? '');
    setReasonOpen(true);
  };

  const submitReason = (): void => {
    send('down', reasonText.trim() || undefined);
    setReasonOpen(false);
  };

  const baseBtn = 'flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors';

  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onUp}
          title={t('ide.feedback.upTitle')}
          className={`${baseBtn} ${current?.verdict === 'up' ? 'bg-emerald-500/15 text-emerald-400' : 'text-gray-500 hover:bg-gray-700/40 hover:text-gray-300'}`}
        >
          <ThumbsUpIcon />
        </button>
        <button
          type="button"
          onClick={onDown}
          title={t('ide.feedback.downTitle')}
          className={`${baseBtn} ${current?.verdict === 'down' ? 'bg-rose-500/15 text-rose-400' : 'text-gray-500 hover:bg-gray-700/40 hover:text-gray-300'}`}
        >
          <ThumbsDownIcon />
        </button>
        {current?.verdict === 'down' && !reasonOpen && (
          <button
            type="button"
            onClick={() => { setReasonText(current.reason); setReasonOpen(true); }}
            className="truncate text-[10.5px] text-rose-300/60 hover:text-rose-300"
            title={t('ide.feedback.editReason')}
          >
            {current.reason || t('ide.feedback.addReason')}
          </button>
        )}
      </div>
      {reasonOpen && (
        <div className="mt-1 flex items-center gap-1">
          <input
            type="text"
            value={reasonText}
            onChange={(e) => setReasonText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) submitReason();
              if (e.key === 'Escape') setReasonOpen(false);
            }}
            placeholder={t('ide.feedback.reasonPlaceholder')}
            autoFocus
            className="min-w-0 flex-1 rounded border border-rose-500/30 bg-gray-900/60 px-2 py-1 text-[11.5px] text-gray-200 placeholder-gray-500 outline-none focus:border-rose-400/50"
          />
          <button
            type="button"
            onClick={submitReason}
            className="rounded bg-rose-500/15 px-2 py-1 text-[11px] font-medium text-rose-300 hover:bg-rose-500/25"
          >
            {t('ide.feedback.reasonSave')}
          </button>
        </div>
      )}
    </div>
  );
});
