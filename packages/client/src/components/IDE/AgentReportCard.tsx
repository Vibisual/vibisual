import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentReport } from '@vibisual/shared';
import { FeedbackButtons } from './FeedbackButtons.js';

interface AgentReportCardProps {
  report: AgentReport;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
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
    return <p className="mb-2 text-[12.5px] leading-relaxed text-gray-300">{note}</p>;
  }
  return (
    <div className="mb-2">
      {parsed.intro && (
        <p className="mb-1.5 text-[12.5px] leading-relaxed text-gray-300">{parsed.intro}</p>
      )}
      <ol className="space-y-0.5">
        {parsed.items.map((it, i) => (
          <li key={i} className="flex items-start gap-2 text-[12.5px] leading-relaxed text-gray-300">
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
export const AgentReportCard = memo(function AgentReportCard({ report }: AgentReportCardProps): React.JSX.Element {
  const { t } = useTranslation();
  const hasUserActions = report.userActions.length > 0;

  return (
    <div className="mx-2 my-1.5 overflow-hidden rounded-md border border-gray-700/60 bg-gray-900/40">
      {/* 헤더 */}
      <div className="flex items-center gap-2 border-b border-gray-800/60 bg-gray-800/30 px-3 py-1.5">
        <svg className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6" />
          <path d="M9 15l2 2 4-4" />
        </svg>
        <span className="flex-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
          {t('ide.report.title')}
        </span>
        <span className="select-none text-[10px] text-gray-500">{formatTime(report.createdAt)}</span>
      </div>

      <div className="px-3 py-2">
        {report.note && <NoteBody note={report.note} />}

        {/* AI 가 한 일 */}
        {report.did.length > 0 && (
          <div className="mb-2">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-400/80">
              {t('ide.report.didTitle')}
            </div>
            <ul className="space-y-0.5">
              {report.did.map((item, i) => (
                <li key={i} className="flex items-start gap-1.5 text-[12.5px] leading-relaxed text-gray-300">
                  <span className="text-emerald-400/80"><CheckIcon /></span>
                  <span className="min-w-0 flex-1 break-words">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* 사용자가 할 일 — amber 강조 패널 */}
        {hasUserActions && (
          <div className="mb-2 rounded border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-amber-300/90">
              {t('ide.report.userActionsTitle')}
            </div>
            <ul className="space-y-0.5">
              {report.userActions.map((item, i) => (
                <li key={i} className="flex items-start gap-1.5 text-[12.5px] font-medium leading-relaxed text-amber-100/90">
                  <span className="text-amber-400/90"><HandIcon /></span>
                  <span className="min-w-0 flex-1 break-words">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* 다음 단계 */}
        {report.nextSteps && report.nextSteps.length > 0 && (
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400/80">
              {t('ide.report.nextStepsTitle')}
            </div>
            <ul className="space-y-0.5">
              {report.nextSteps.map((item, i) => (
                <li key={i} className="flex items-start gap-1.5 text-[12px] leading-relaxed text-gray-400">
                  <span className="text-slate-400/70"><NextIcon /></span>
                  <span className="min-w-0 flex-1 break-words">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* §4 v3.21 — 좋아요/싫어요 (규칙 되먹임 학습 재료). summary = did 우선 스냅샷. */}
        <div className="mt-1.5 border-t border-gray-800/60 pt-1.5">
          <FeedbackButtons
            agentId={report.agentId}
            subAgentId={report.subAgentId}
            targetType="report"
            targetId={report.id}
            summary={report.did.length > 0 ? report.did : report.userActions}
          />
        </div>
      </div>
    </div>
  );
});
