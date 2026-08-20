import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentReport, AgentReview } from '@vibisual/shared';
import { FeedbackButtons } from './FeedbackButtons.js';
import { CardSection, CardDetails, CardHoverControls, CardLiveBadge, CompactCardLine, compactSummary, useCompactCards } from './AgentCardParts.js';
import { ReviewIcon, InstructionIcon, ChangeIcon, VerifyIcon } from './AgentReviewCard.js';
import { useStreamToggle } from './streamToggle.js';

interface AgentReportCardProps {
  report: AgentReport;
  /** §5.5 #17-12 — 같은 턴에 온 검수 요청(있으면 이 카드 안쪽 구획으로 합쳐 한 장으로 보여준다). */
  review?: AgentReview;
  /** §5.5 #17-18 ⑦-2 — 이 카드가 속한 턴이 아직 도는 중(헤더에 `작업 중` 배지 — 끝난 줄 착각 방지). */
  live?: boolean;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** 작업 신고 카드의 식별 글리프(문서 + 체크) — 헤더와 간결 한 줄이 함께 쓴다. */
function ReportIcon(): React.JSX.Element {
  return (
    <svg className="h-3.5 w-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M9 15l2 2 4-4" />
    </svg>
  );
}

/** 완료 체크 (did 항목) */
function CheckIcon(): React.JSX.Element {
  return (
    <svg className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

/** 사용자 액션 (손/포인터) */
function HandIcon(): React.JSX.Element {
  return (
    <svg className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2" />
      <path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2" />
      <path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8" />
      <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
    </svg>
  );
}

/** §5.10 — 배운 것(learned) — 전구/불꽃 글리프 */
function LearnedIcon(): React.JSX.Element {
  return (
    <svg className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 18h6M10 21h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V17h6v-.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2Z" />
    </svg>
  );
}

/** 다음 단계 (화살표) */
function NextIcon(): React.JSX.Element {
  return (
    <svg className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

interface NumberedNote {
  /** 첫 번호 앞 도입 문단 (없으면 빈 문자열) */
  intro: string;
  items: { num: string; text: string }[];
}

/**
 * note 본문에서 "1. … 2. …" / "1) …" 형태의 번호 목록을 추출한다.
 * 줄바꿈으로 나뉘었든 한 줄에 인라인으로 붙었든 마커 기준으로 분해한다.
 * 번호 마커가 2개 미만이면 목록으로 보지 않고 null 반환(일반 문단으로 렌더).
 */
function parseNumberedNote(note: string): NumberedNote | null {
  const re = /(?:^|\s)(\d{1,3})[.)]\s+/g;
  const markers: { num: string; index: number; markerLen: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(note)) !== null) {
    markers.push({ num: m[1] ?? '', index: m.index, markerLen: m[0].length });
  }
  if (markers.length < 2) return null;
  const intro = note.slice(0, markers[0]!.index).trim();
  const items = markers.map((mk, i) => {
    const start = mk.index + mk.markerLen;
    const next = markers[i + 1];
    const end = next ? next.index : note.length;
    return { num: mk.num, text: note.slice(start, end).trim() };
  }).filter((it) => it.text.length > 0);
  if (items.length < 2) return null;
  return { intro, items };
}

/** note 본문: 번호 목록이면 번호 열을 맞춘 정렬 목록으로, 아니면 단일 문단으로 렌더. */
function NoteBody({ note }: { note: string }): React.JSX.Element {
  const parsed = parseNumberedNote(note);
  if (!parsed) {
    return <p className="mb-2 text-[13px] leading-relaxed text-gray-300">{note}</p>;
  }
  return (
    <div className="mb-2">
      {parsed.intro && (
        <p className="mb-1.5 text-[13px] leading-relaxed text-gray-300">{parsed.intro}</p>
      )}
      <ol className="space-y-0.5">
        {parsed.items.map((it, i) => (
          <li key={i} className="flex items-start gap-2 text-[13px] leading-relaxed text-gray-300">
            <span className="min-w-[1.5rem] flex-shrink-0 select-none text-right font-medium tabular-nums text-gray-500">
              {it.num}.
            </span>
            <span className="min-w-0 flex-1 break-words">{it.text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * §4 v2.52 — 에이전트 작업 신고 인라인 카드.
 *
 * 커스텀/스폰 에이전트가 `POST /api/agent-report` 로 보낸 did/userActions 를 색으로 구분해 렌더.
 * - did       : 중립(에메랄드 체크) — AI 가 한 일.
 * - userActions: amber 강조 — 사용자가 직접 해야 할 일.
 * - nextSteps : 보조(슬레이트) — 다음 단계.
 * 표시 전용 — 사용자가 긴 보고를 다 안 읽어도 "내가 할 일"을 한눈에 파악하게 한다.
 */
export const AgentReportCard = memo(function AgentReportCard({ report, review, live }: AgentReportCardProps): React.JSX.Element {
  const { t } = useTranslation();
  const hasUserActions = report.userActions.length > 0;
  // §5.5 #17-12 — 기본 노출은 "행동 구획"(사용자가 할 일 / 검수 포인트)뿐. 맥락(한 일·다음 단계·배운 것,
  //   흡수한 검수의 받은 지시·고친 내용)은 [자세히] 안으로 — 카드가 길어 무엇이 중요한지 묻히던 문제를 고친다.
  const detailCount =
    report.did.length + (report.nextSteps?.length ?? 0) + (report.learned?.length ?? 0)
    + (review ? review.changes.length + (review.instruction ? 1 : 0) : 0);

  // §5.5 #17-21 ④ — 간결에서는 **행동 구획**(사용자가 할 일 / 흡수한 검수 포인트)만 남긴다.
  //   행동이 하나도 없으면 카드 전체가 한 줄로 접히고, 클릭하면 원래 카드가 그대로 펼쳐진다.
  const compact = useCompactCards();
  const [expanded, toggleExpanded] = useStreamToggle(`card-${report.id}`, false);
  const hasAction = hasUserActions || (review?.checkpoints.length ?? 0) > 0;
  if (compact && !hasAction && !expanded) {
    return (
      <CompactCardLine
        icon={<ReportIcon />}
        label={t('ide.report.title')}
        labelClass="text-gray-400"
        summary={compactSummary([report.note, report.did[0], report.nextSteps?.[0]])}
        onExpand={toggleExpanded}
        live={live}
      />
    );
  }

  return (
    <div className="group/card mx-2 my-1.5 overflow-hidden rounded-md border border-gray-700/60 bg-gray-900/40">
      {/* 헤더 */}
      <div className="flex items-center gap-2 border-b border-gray-800/60 bg-gray-800/30 px-3 py-1.5">
        <span className="text-gray-400"><ReportIcon /></span>
        <span className="flex-1 text-[12px] font-semibold uppercase tracking-wide text-gray-400">
          {t('ide.report.title')}
        </span>
        {/* 검수를 흡수했으면 그 사실을 헤더 칩으로 알린다(카드 두 장이 한 장으로 합쳐졌음). */}
        {/* data-card-id 는 놓친 카드 pill 앵커 — 검수 포인트가 비어 있어도 이 칩은 항상 그려지므로
            병합된 검수 카드의 "봤다" 관측·점프가 끊기지 않는다(빈 구획에 앵커를 달면 높이 0 이라 관측 불가). */}
        {review && (
          <span data-card-id={review.id} className="flex flex-shrink-0 items-center gap-1 rounded bg-violet-500/15 px-1.5 py-0.5 text-[12px] font-semibold text-violet-300">
            <ReviewIcon />
            {t('ide.review.title')}
          </span>
        )}
        {live && <CardLiveBadge />}
        <span className="select-none text-[12px] text-gray-500">{formatTime(report.createdAt)}</span>
      </div>

      <div className="px-3 py-2">
        {/* §5.5 #17-21 ④ — 간결에서는 본문 note 를 접는다(사용자가 카드를 직접 펼쳤으면 그대로 보여준다). */}
        {(!compact || expanded) && report.note && <NoteBody note={report.note} />}

        {/* 사용자가 할 일 — amber 강조 패널 (행동 구획: 항상 노출) */}
        {hasUserActions && (
          <CardSection
            title={t('ide.report.userActionsTitle')}
            icon={<HandIcon />}
            items={report.userActions}
            titleClass="text-amber-300/90"
            textClass="text-amber-100/90 font-medium"
            glyphClass="text-amber-400/90"
            panelClass="border-amber-500/30 bg-amber-500/10"
          />
        )}

        {/* 흡수한 검수의 확인 포인트 — violet 강조 패널 (행동 구획: 항상 노출) */}
        {review && (
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

        {/* 맥락 구획 — 기본 접힘 */}
        <CardDetails count={detailCount}>
          <CardSection
            title={t('ide.report.didTitle')}
            icon={<CheckIcon />}
            items={report.did}
            titleClass="text-emerald-400/80"
            textClass="text-gray-300"
            glyphClass="text-emerald-400/80"
          />
          {review?.instruction && (
            <CardSection
              title={t('ide.review.instructionTitle')}
              icon={<InstructionIcon />}
              items={[review.instruction]}
              titleClass="text-violet-300/60"
              textClass="text-gray-500 italic"
              glyphClass="text-gray-600"
            />
          )}
          {review && (
            <CardSection
              title={t('ide.review.changesTitle')}
              icon={<ChangeIcon />}
              items={review.changes}
              titleClass="text-violet-300/80"
              textClass="text-gray-400"
              glyphClass="text-violet-400/50"
            />
          )}
          <CardSection
            title={t('ide.report.nextStepsTitle')}
            icon={<NextIcon />}
            items={report.nextSteps ?? []}
            titleClass="text-slate-400/80"
            textClass="text-gray-400"
            glyphClass="text-slate-400/70"
          />
          {/* §5.10 — 배운 것(learned). 두뇌 기억으로 저장되는 재료. */}
          <CardSection
            title={t('ide.report.learnedTitle')}
            icon={<LearnedIcon />}
            items={report.learned ?? []}
            titleClass="text-indigo-300/90"
            textClass="text-indigo-100/90"
            glyphClass="text-indigo-400/90"
            panelClass="border-indigo-500/30 bg-indigo-500/10"
          />
        </CardDetails>

        {/* §4 v3.21 — 좋아요/싫어요 (규칙 되먹임 학습 재료). §5.5 #17-12 — 호버 때만 노출(상시 잡음 제거). */}
        <CardHoverControls>
          <FeedbackButtons
            agentId={report.agentId}
            subAgentId={report.subAgentId}
            targetType="report"
            targetId={report.id}
            summary={report.did.length > 0 ? report.did : report.userActions}
          />
        </CardHoverControls>
      </div>
    </div>
  );
});
