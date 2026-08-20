import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentReview } from '@vibisual/shared';
import { FeedbackButtons } from './FeedbackButtons.js';
import { CardSection, CardDetails, CardHoverControls, CardLiveBadge, CompactCardLine, compactSummary, useCompactCards } from './AgentCardParts.js';
import { useStreamToggle } from './streamToggle.js';
import { useGraphStore } from '../../stores/graphStore.js';
import { ReviewLaneSection } from './ReviewLaneSection.js';

interface AgentReviewCardProps {
  review: AgentReview;
  /** §5.5 #17-18 ⑦-2 — 이 카드가 속한 턴이 아직 도는 중(헤더에 `작업 중` 배지). */
  live?: boolean;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** 검수(돋보기 + 체크) — 헤더 글리프. 신고 카드가 검수를 흡수할 때도 같은 글리프를 쓴다(DRY). */
export function ReviewIcon(): React.JSX.Element {
  return (
    <svg className="h-3.5 w-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
      <path d="m8 11 2 2 4-4" />
    </svg>
  );
}

/** 받은 지시 (말풍선) */
export function InstructionIcon(): React.JSX.Element {
  return (
    <svg className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

/** 고친 내용 (렌치) */
export function ChangeIcon(): React.JSX.Element {
  return (
    <svg className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}

/** 검수 포인트 (확인 — 눈) */
export function VerifyIcon(): React.JSX.Element {
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
export const AgentReviewCard = memo(function AgentReviewCard({ review, live }: AgentReviewCardProps): React.JSX.Element {
  const { t } = useTranslation();
  // §5.16 — 서버가 격리 변경분을 붙잡아 만든 카드면 `reviewRequestId` 로 그 레코드를 찾아 레인 구획을
  //   함께 그린다. 에이전트가 스스로 보낸 종전 검수 카드에는 이 값이 없어 종전 그대로 렌더된다.
  const laneReview = useGraphStore((st) =>
    review.reviewRequestId === undefined
      ? undefined
      : st.reviewRequests.find((r) => r.id === review.reviewRequestId),
  );
  const hasCheckpoints = review.checkpoints.length > 0;
  // §5.5 #17-12 — 행동 구획(검수 포인트)만 기본 노출, 맥락(받은 지시·고친 내용)은 [자세히] 안으로.
  const detailCount = review.changes.length + (review.instruction ? 1 : 0);

  // §5.5 #17-21 ④ — 간결에서는 행동 구획(검수 포인트)만. 확인할 것이 없으면 카드 전체가 한 줄로 접힌다.
  const compact = useCompactCards();
  const [expanded, toggleExpanded] = useStreamToggle(`card-${review.id}`, false);
  if (compact && !hasCheckpoints && laneReview === undefined && !expanded) {
    return (
      <CompactCardLine
        icon={<ReviewIcon />}
        label={t('ide.review.title')}
        labelClass="text-violet-300"
        summary={compactSummary([review.note, review.instruction, review.changes[0]])}
        onExpand={toggleExpanded}
        live={live}
      />
    );
  }

  return (
    <div className="group/card mx-2 my-1.5 overflow-hidden rounded-md border border-gray-700/40 bg-gray-900/25">
      {/* 헤더 — 카드 본체는 연하게(작업 신고 카드보다 더 다운). violet 은 식별 라벨·제목에만 대비로. */}
      <div className="flex items-center gap-2 border-b border-gray-800/50 bg-gray-800/15 px-3 py-1.5">
        <span className="text-violet-300"><ReviewIcon /></span>
        <span className="flex-1 text-[12px] font-semibold uppercase tracking-wide text-violet-300">
          {t('ide.review.title')}
        </span>
        {live && <CardLiveBadge />}
        <span className="select-none text-[12px] text-gray-500">{formatTime(review.createdAt)}</span>
      </div>

      <div className="px-3 py-2">
        {/* §5.5 #17-21 ④ — 간결에서는 본문 note 를 접는다(사용자가 직접 펼쳤으면 그대로). */}
        {(!compact || expanded) && review.note && (
          <p className="mb-2 text-[13px] leading-relaxed text-gray-300">{review.note}</p>
        )}

        {/* 검수 포인트 — violet 강조 패널 (행동 구획: 항상 노출) */}
        {hasCheckpoints && (
          <CardSection
            title={t('ide.review.checkpointsTitle')}
            icon={<VerifyIcon />}
            items={review.checkpoints}
            titleClass="text-violet-200"
            textClass="text-violet-100/90 font-medium"
            glyphClass="text-violet-300/90"
            panelClass="border-violet-500/30 bg-violet-500/10"
          />
        )}

        {/* §5.16 / §7.15 — 리뷰·승인 레인 구획(브랜치·파일 목록·diff·결정) */}
        {laneReview !== undefined && <ReviewLaneSection review={laneReview} />}

        {/* 맥락 구획 — 기본 접힘(받은 지시·고친 내용) */}
        <CardDetails count={detailCount}>
          {review.instruction && (
            <CardSection
              title={t('ide.review.instructionTitle')}
              icon={<InstructionIcon />}
              items={[review.instruction]}
              titleClass="text-violet-300/60"
              textClass="text-gray-500 italic"
              glyphClass="text-gray-600"
            />
          )}
          <CardSection
            title={t('ide.review.changesTitle')}
            icon={<ChangeIcon />}
            items={review.changes}
            titleClass="text-violet-300/80"
            textClass="text-gray-400"
            glyphClass="text-violet-400/50"
          />
        </CardDetails>

        {/* §4 v3.21 — 좋아요/싫어요 (규칙 되먹임 학습 재료). §5.5 #17-12 — 호버 때만 노출. */}
        <CardHoverControls>
          <FeedbackButtons
            agentId={review.agentId}
            subAgentId={review.subAgentId}
            targetType="review"
            targetId={review.id}
            summary={review.changes}
          />
        </CardHoverControls>
      </div>
    </div>
  );
});
