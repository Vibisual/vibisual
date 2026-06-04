import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentReview } from '@vibisual/shared';

interface AgentReviewCardProps {
  review: AgentReview;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** 검수(돋보기 + 체크) — 헤더 글리프 */
function ReviewIcon(): React.JSX.Element {
  return (
    <svg className="h-3.5 w-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
      <path d="m8 11 2 2 4-4" />
    </svg>
  );
}

/** 받은 지시 (말풍선) */
function InstructionIcon(): React.JSX.Element {
  return (
    <svg className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

/** 고친 내용 (렌치) */
function ChangeIcon(): React.JSX.Element {
  return (
    <svg className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}

/** 검수 포인트 (확인 — 눈) */
function VerifyIcon(): React.JSX.Element {
  return (
    <svg className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/**
 * §4 v2.70 — 에이전트 검수 요청 인라인 카드.
 *
 * 커스텀/스폰 에이전트가 `POST /api/agent-review` 로 보낸 instruction/changes/checkpoints 를 렌더.
 * 작업 신고(AgentReportCard, 에메랄드)·질문(AgentQuestionCard, sky)과 **성격이 다르다**: 사용자가 지시한
 * 작업을 AI 가 완료한 뒤, 사용자가 직접 할 일(userActions)이 아니라 **결과가 맞는지 확인(검수)**할 것을
 * 요청하는 카드. violet 액센트 + 돋보기 아이콘으로 구분.
 * - instruction : 받은 지시 한 줄 맥락 (있을 때만).
 * - changes     : 무슨 동작을 어떻게 고쳤는지 — AI 가 완료한 변경(violet 중립).
 * - checkpoints : 사용자가 확인할 검수 포인트 — violet 강조 패널.
 */
export const AgentReviewCard = memo(function AgentReviewCard({ review }: AgentReviewCardProps): React.JSX.Element {
  const { t } = useTranslation();
  const hasCheckpoints = review.checkpoints.length > 0;

  return (
    <div className="mx-2 my-1.5 overflow-hidden rounded-md border border-gray-700/40 bg-gray-900/25">
      {/* 헤더 — 카드 본체는 연하게(작업 신고 카드보다 더 다운). violet 은 식별 라벨·제목에만 대비로. */}
      <div className="flex items-center gap-2 border-b border-gray-800/50 bg-gray-800/15 px-3 py-1.5">
        <span className="text-violet-300"><ReviewIcon /></span>
        <span className="flex-1 text-[11px] font-semibold uppercase tracking-wide text-violet-300">
          {t('ide.review.title')}
        </span>
        <span className="select-none text-[10px] text-gray-500">{formatTime(review.createdAt)}</span>
      </div>

      <div className="px-3 py-2">
        {review.note && (
          <p className="mb-2 text-[12.5px] leading-relaxed text-gray-300">{review.note}</p>
        )}

        {/* 받은 지시 (맥락) — 가장 낮은 강조. 제목만 violet 대비, 본문은 매우 연하게. */}
        {review.instruction && (
          <div className="mb-2">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-violet-300/60">
              {t('ide.review.instructionTitle')}
            </div>
            <div className="flex items-start gap-1.5 text-[12.5px] leading-relaxed text-gray-500">
              <span className="text-gray-600"><InstructionIcon /></span>
              <span className="min-w-0 flex-1 break-words italic">{review.instruction}</span>
            </div>
          </div>
        )}

        {/* 고친 내용 — 제목은 violet 대비, 본문은 연하게 다운(검수 포인트가 더 도드라지게). */}
        {review.changes.length > 0 && (
          <div className="mb-2">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-violet-300/80">
              {t('ide.review.changesTitle')}
            </div>
            <ul className="space-y-0.5">
              {review.changes.map((item, i) => (
                <li key={i} className="flex items-start gap-1.5 text-[12.5px] leading-relaxed text-gray-400">
                  <span className="text-violet-400/50"><ChangeIcon /></span>
                  <span className="min-w-0 flex-1 break-words">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* 검수 포인트 — violet 강조 패널 */}
        {hasCheckpoints && (
          <div className="rounded border border-violet-500/30 bg-violet-500/10 px-2.5 py-1.5">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-violet-200">
              {t('ide.review.checkpointsTitle')}
            </div>
            <ul className="space-y-0.5">
              {review.checkpoints.map((item, i) => (
                <li key={i} className="flex items-start gap-1.5 text-[12.5px] font-medium leading-relaxed text-violet-100/90">
                  <span className="text-violet-300/90"><VerifyIcon /></span>
                  <span className="min-w-0 flex-1 break-words">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
});
