/**
 * §5.16 / §7.15 — 리뷰·승인 레인 구획.
 *
 * `AgentReviewCard` 안에서만 쓰인다(새 카드 계열 ❌). 서버가 격리(워크트리) 변경분을 붙잡아 만든
 * `ReviewRequest` 를 받아 ① 브랜치 줄 ② 변경 파일 목록 ③ diff 본문(기본 접힘) ④ 결정 줄
 * (**승인 / 반려 / 보류** + 반려 사유 인라인 입력창)을 그린다.
 *
 * 판정·상태 전이·병합은 전부 서버다(§3.1) — 여기서는 `POST /api/review-requests/:id/decision` 을
 * 부르고, 반려 명령 문장만 순수 모듈 `reviewRejectPrompt.ts` 로 조립해 함께 보낸다(서버가 언어를
 * 정하지 않기 위해 번역문은 클라이언트가 만든다).
 */
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ReviewRequest, ReviewDecision, ReviewFileChange } from '@vibisual/shared';
import { REVIEW_REASON_MAX } from '@vibisual/shared';
import { ScrollFade } from '../ScrollFade.js';
import { buildReviewRejectPrompt } from './reviewRejectPrompt.js';

/** diff 본문 스크롤 영역 최대 높이(px) — 넘치면 ScrollFade 안에서 스크롤. */
const DIFF_MAX_HEIGHT = 360;
/** 접힌 상태에서 보여 줄 변경 파일 줄 수. */
const FILES_COLLAPSED = 6;

interface ReviewLaneSectionProps {
  review: ReviewRequest;
}

/** 갈래(브랜치) — 합치는 방향을 한 줄로. */
function BranchIcon(): React.JSX.Element {
  return (
    <svg className="h-3.5 w-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  );
}

/** 승인 — 체크. */
function ApproveIcon(): React.JSX.Element {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

/** 반려 — 되돌림 화살표. */
function RejectIcon(): React.JSX.Element {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
    </svg>
  );
}

/** 보류 — 일시정지. */
function HoldIcon(): React.JSX.Element {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="9" y1="5" x2="9" y2="19" />
      <line x1="15" y1="5" x2="15" y2="19" />
    </svg>
  );
}

/** 변경 종류 한 글자 배지 — 색은 종류가 정한다(추가 초록 / 수정 노랑 / 삭제 빨강 / 이름변경 파랑). */
function ChangeTypeBadge({ file }: { file: ReviewFileChange }): React.JSX.Element {
  const { t } = useTranslation();
  const map: Record<ReviewFileChange['changeType'], { label: string; cls: string }> = {
    added: { label: 'A', cls: 'bg-emerald-500/15 text-emerald-300' },
    modified: { label: 'M', cls: 'bg-amber-500/15 text-amber-300' },
    deleted: { label: 'D', cls: 'bg-rose-500/15 text-rose-300' },
    renamed: { label: 'R', cls: 'bg-sky-500/15 text-sky-300' },
    unknown: { label: '?', cls: 'bg-gray-500/15 text-gray-400' },
  };
  const cfg = map[file.changeType];
  return (
    <span
      className={`inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded text-[12px] font-semibold ${cfg.cls}`}
      title={t(`ide.reviewLane.changeType.${file.changeType}`)}
    >
      {cfg.label}
    </span>
  );
}

/** diff 한 줄 — 추가/삭제/헤더만 색을 준다(나머지는 문맥). */
function DiffLine({ line }: { line: string }): React.JSX.Element {
  const head = line.charAt(0);
  const cls = line.startsWith('+++') || line.startsWith('---')
    ? 'text-gray-500'
    : line.startsWith('@@')
      ? 'text-violet-300/80'
      : line.startsWith('diff --git') || line.startsWith('index ')
        ? 'text-gray-500'
        : head === '+'
          ? 'text-emerald-300'
          : head === '-'
            ? 'text-rose-300'
            : 'text-gray-400';
  return <div className={`whitespace-pre ${cls}`}>{line === '' ? ' ' : line}</div>;
}

/** 결정 한 건 → 사람이 읽는 한 줄. */
function decisionLabel(d: ReviewDecision, t: (k: string, o?: Record<string, unknown>) => string): string {
  if (d.kind === 'approve') {
    if (d.mergeOk === true) return t('ide.reviewLane.result.approvedMerged');
    return t('ide.reviewLane.result.approvedMergeFailed', { error: d.mergeError ?? '' });
  }
  if (d.kind === 'reject') {
    return d.reworkDispatched === true
      ? t('ide.reviewLane.result.rejectedDispatched')
      : t('ide.reviewLane.result.rejected');
  }
  return t('ide.reviewLane.result.held');
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export const ReviewLaneSection = memo(function ReviewLaneSection({ review }: ReviewLaneSectionProps): React.JSX.Element {
  const { t } = useTranslation();
  const [showAllFiles, setShowAllFiles] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const diffLines = useMemo(() => (review.diff === '' ? [] : review.diff.split(/\r?\n/)), [review.diff]);
  const totals = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    for (const f of review.files) { additions += f.additions; deletions += f.deletions; }
    return { additions, deletions };
  }, [review.files]);
  const shownFiles = showAllFiles ? review.files : review.files.slice(0, FILES_COLLAPSED);
  const lastDecision = review.decisions.length > 0 ? review.decisions[review.decisions.length - 1] : undefined;
  // 보류는 다시 결정할 수 있고, 승인 실패는 서버가 상태를 pending 으로 되돌려 다시 누를 수 있다.
  const canDecide = review.status === 'pending' || review.status === 'held';

  const send = useCallback(async (kind: 'approve' | 'reject' | 'hold', rejectReason?: string): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const payload: { kind: string; reason?: string; reworkPrompt?: string } = { kind };
      if (kind === 'reject' && rejectReason !== undefined) {
        payload.reason = rejectReason;
        const prompt = buildReviewRejectPrompt(
          {
            reason: rejectReason,
            branch: review.branch,
            baseBranch: review.baseBranch,
            files: review.files.map((f) => f.path),
          },
          t('ide.reviewLane.rejectPromptHeader'),
        );
        if (prompt !== '') payload.reworkPrompt = prompt;
      }
      const res = await fetch(`/api/review-requests/${encodeURIComponent(review.id)}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; conflicts?: string[] };
      if (!res.ok || body.ok !== true) {
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      setRejectOpen(false);
      setReason('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'request failed');
    } finally {
      setBusy(false);
    }
  }, [busy, review.id, review.branch, review.baseBranch, review.files, t]);

  return (
    <div className="mt-2 rounded border border-violet-500/25 bg-violet-500/5 px-2.5 py-2">
      {/* ① 브랜치 줄 — 어디에서 어디로 합쳐지는지 */}
      <div className="flex items-center gap-1.5 text-[12px] text-violet-200/90">
        <span className="text-violet-300/80"><BranchIcon /></span>
        <span className="font-medium">{review.branch ?? t('ide.reviewLane.unknownBranch')}</span>
        {review.baseBranch !== undefined && (
          <>
            <span className="text-gray-500">&rarr;</span>
            <span className="font-medium">{review.baseBranch}</span>
          </>
        )}
        <span className="ml-auto text-gray-500">
          {t('ide.reviewLane.fileCount', { count: review.files.length })}
          <span className="ml-1.5 text-emerald-400">+{totals.additions}</span>
          <span className="ml-1 text-rose-400">-{totals.deletions}</span>
        </span>
      </div>

      {/* ② 변경 파일 목록 */}
      <ul className="mt-1.5 space-y-0.5">
        {shownFiles.map((f) => (
          <li key={f.path} className="flex items-center gap-1.5 text-[12px]">
            <ChangeTypeBadge file={f} />
            <span className="truncate text-gray-300" title={f.path}>{f.path}</span>
            {f.uncommitted === true && (
              <span
                className="flex-shrink-0 rounded bg-amber-500/10 px-1 text-[12px] text-amber-300/90"
                title={t('ide.reviewLane.uncommittedHint')}
              >
                {t('ide.reviewLane.uncommitted')}
              </span>
            )}
            <span className="ml-auto flex-shrink-0 tabular-nums text-gray-500">
              <span className="text-emerald-400/80">+{f.additions}</span>
              <span className="ml-1 text-rose-400/80">-{f.deletions}</span>
            </span>
          </li>
        ))}
      </ul>
      {review.files.length > FILES_COLLAPSED && (
        <button
          type="button"
          onClick={() => setShowAllFiles((v) => !v)}
          className="mt-1 text-[12px] text-violet-300/80 hover:text-violet-200"
        >
          {showAllFiles
            ? t('ide.reviewLane.showLessFiles')
            : t('ide.reviewLane.showMoreFiles', { count: review.files.length - FILES_COLLAPSED })}
        </button>
      )}
      {review.filesTruncated === true && (
        <p className="mt-1 text-[12px] text-gray-500">{t('ide.reviewLane.filesTruncated')}</p>
      )}

      {/* ③ diff 본문 — 기본 접힘 */}
      {diffLines.length > 0 && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setDiffOpen((v) => !v)}
            className="text-[12px] text-violet-300/80 hover:text-violet-200"
          >
            {diffOpen ? t('ide.reviewLane.hideDiff') : t('ide.reviewLane.showDiff', { count: diffLines.length })}
          </button>
          {diffOpen && (
            <ScrollFade maxHeight={DIFF_MAX_HEIGHT} className="mt-1 rounded bg-gray-950/60 p-2">
              <div className="font-mono text-[12px] leading-[1.45]">
                {diffLines.map((line, i) => <DiffLine key={i} line={line} />)}
              </div>
              {review.diffTruncated === true && (
                <p className="mt-1 text-[12px] text-gray-500">{t('ide.reviewLane.diffTruncated')}</p>
              )}
            </ScrollFade>
          )}
        </div>
      )}

      {/* ④ 결정 줄 */}
      {canDecide ? (
        <div className="mt-2 border-t border-violet-500/20 pt-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => { void send('approve'); }}
              className="inline-flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[12px] font-medium text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-40"
              title={t('ide.reviewLane.approveTitle')}
            >
              <ApproveIcon />
              {t('ide.reviewLane.approve')}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setRejectOpen((v) => !v)}
              className="inline-flex items-center gap-1 rounded border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-[12px] font-medium text-rose-200 hover:bg-rose-500/20 disabled:opacity-40"
              title={t('ide.reviewLane.rejectTitle')}
            >
              <RejectIcon />
              {t('ide.reviewLane.reject')}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => { void send('hold'); }}
              className="inline-flex items-center gap-1 rounded border border-gray-600/60 bg-gray-700/20 px-2 py-1 text-[12px] font-medium text-gray-300 hover:bg-gray-700/40 disabled:opacity-40"
              title={t('ide.reviewLane.holdTitle')}
            >
              <HoldIcon />
              {t('ide.reviewLane.hold')}
            </button>
          </div>

          {/* 반려 사유 — 그 자리에서 펼쳐지는 입력창(모달 ❌) */}
          {rejectOpen && (
            <div className="mt-1.5">
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value.slice(0, REVIEW_REASON_MAX))}
                placeholder={t('ide.reviewLane.reasonPlaceholder')}
                rows={3}
                className="w-full resize-y rounded border border-rose-500/30 bg-gray-950/60 px-2 py-1 text-[13px] text-gray-200 outline-none focus:border-rose-400/60"
              />
              <div className="mt-1 flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={busy || reason.trim() === ''}
                  onClick={() => { void send('reject', reason.trim()); }}
                  className="rounded border border-rose-500/40 bg-rose-500/15 px-2 py-1 text-[12px] font-medium text-rose-200 hover:bg-rose-500/25 disabled:opacity-40"
                >
                  {t('ide.reviewLane.sendReject')}
                </button>
                <button
                  type="button"
                  onClick={() => { setRejectOpen(false); setReason(''); }}
                  className="rounded px-2 py-1 text-[12px] text-gray-400 hover:text-gray-200"
                >
                  {t('ide.reviewLane.cancel')}
                </button>
                <span className="ml-auto text-[12px] text-gray-500">{t('ide.reviewLane.reasonHint')}</span>
              </div>
            </div>
          )}
        </div>
      ) : (
        lastDecision !== undefined && (
          <div className="mt-2 flex items-center gap-1.5 border-t border-violet-500/20 pt-2 text-[12px]">
            <span className={lastDecision.kind === 'approve' && lastDecision.mergeOk === true ? 'text-emerald-300' : lastDecision.kind === 'reject' ? 'text-rose-300' : 'text-gray-300'}>
              {decisionLabel(lastDecision, t)}
            </span>
            <span className="ml-auto text-gray-500">{formatTime(lastDecision.decidedAt)}</span>
          </div>
        )
      )}

      {/* 결정 이력 — 마지막 것 말고 남은 것들(있을 때만) */}
      {review.decisions.length > 1 && (
        <details className="mt-1">
          <summary className="cursor-pointer text-[12px] text-gray-500 hover:text-gray-300">
            {t('ide.reviewLane.historyTitle', { count: review.decisions.length })}
          </summary>
          <ul className="mt-1 space-y-0.5">
            {[...review.decisions].reverse().map((d) => (
              <li key={d.id} className="flex items-start gap-1.5 text-[12px] text-gray-400">
                <span className="flex-shrink-0 text-gray-500">{formatTime(d.decidedAt)}</span>
                <span className="flex-1">
                  {decisionLabel(d, t)}
                  {d.reason !== undefined && d.reason !== '' && (
                    <span className="ml-1 italic text-gray-500">{d.reason}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {error !== null && (
        <p className="mt-1.5 text-[12px] text-rose-300">{t('ide.reviewLane.decisionFailed', { error })}</p>
      )}
    </div>
  );
});
