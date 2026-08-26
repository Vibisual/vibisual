/**
 * DiffView — Edit 계열 도구의 "이전 코드 vs 고친 코드" side-by-side 비교 렌더.
 *
 * ToolBlock 이 parseEditToolInput 으로 얻은 ParsedEdit 를 받아, 라인 단위로 정렬된 좌(빨강=이전)/우(초록=이후)
 * 두 열을 그린다. 변경 라인은 단어 단위로 바뀐 토큰만 진하게 강조. MultiEdit 는 여러 hunk 를 순서대로 쌓는다.
 * 순수 diff 계산은 diffTool.ts, 여기선 표시만.
 *
 * §5.5 #17-30 — 여기서 **리뷰 코멘트**도 받는다. 행에 마우스를 올리면 [코멘트] 글리프가 뜨고,
 * 누르면 그 행 바로 아래가 입력창으로 펼쳐진다(모달 ❌). 적은 코멘트는 그 행 아래 남아 있다가
 * 상태바의 [리뷰 N건 보내기] 로 **한 명령에 모여** 나간다 — 조립은 `diffCommentPrompt.ts`.
 */
import { memo, useMemo, useCallback, useState, Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { shortcutLabel } from '../../utils/platform.js';
import { DIFF_COMMENT_MAX } from '@vibisual/shared';
import { ScrollFade } from '../ScrollFade.js';
import { useGraphStore } from '../../stores/graphStore.js';
import { computeLineDiff, type ParsedEdit, type DiffRow, type WordSpan } from './diffTool.js';
import { makeDiffCommentId, type DiffComment } from './diffCommentPrompt.js';

/** 긴 diff 방어 — hunk 당 이 줄 수까지만 렌더하고 나머지는 "… N줄 더" 로 접는다. */
const MAX_VISIBLE_ROWS = 600;
/** 스크롤 영역 최대 높이(px) — 초과 diff 는 ScrollFade 안에서 스크롤. */
const DIFF_MAX_HEIGHT = 440;

/** 서버 API로 에디터 열기 — 편집 위치로 이동 (FileEditList 와 동일 경로). */
function openInEditor(filePath: string | undefined, searchText?: string): void {
  if (!filePath) return;
  fetch(`/api/open-in-editor`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filePath, searchText }),
  }).catch(() => {});
}

/** 연필 아이콘 — FileEditList 와 동일 톤. */
function PencilIcon(): React.JSX.Element {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="m15 5 4 4" />
    </svg>
  );
}

/** 한 셀의 텍스트 — 단어 강조 조각이 있으면 바뀐 토큰만 배경 강조, 없으면 평문. 빈 라인은 폭 유지용 nbsp. */
function CellText({ spans, text, changedClass }: { spans: WordSpan[] | undefined; text: string; changedClass: string }): React.JSX.Element {
  if (spans && spans.length > 0) {
    return (
      <>
        {spans.map((s, i) =>
          s.changed
            ? <span key={i} className={changedClass}>{s.text}</span>
            : <span key={i}>{s.text}</span>,
        )}
      </>
    );
  }
  return <>{text === '' ? ' ' : text}</>;
}

/** §5.5 #17-30 — 말풍선 아이콘(코멘트 달기). lucide 톤 stroke SVG. */
function CommentIcon(): React.JSX.Element {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" />
    </svg>
  );
}

/** §5.5 #17-30 — 코멘트 지우기(x). */
function XIcon(): React.JSX.Element {
  return (
    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

/** side-by-side 한 행: [번호][마커][이전]  [번호][마커][이후]. */
const DiffRowLine = memo(function DiffRowLine({ row, onComment, commentLabel }: {
  row: DiffRow;
  /** §5.5 #17-30 — 있으면 hover 시 [코멘트] 손잡이가 뜬다. 훅 버블(읽기 전용)에서는 넘기지 않는다. */
  onComment?: (() => void) | undefined;
  commentLabel?: string | undefined;
}): React.JSX.Element {
  const leftFilled = row.left !== null;
  const rightFilled = row.right !== null;
  const leftBg = row.type === 'equal' ? 'text-gray-500' : leftFilled ? 'bg-red-500/10 text-red-300' : 'bg-gray-900/40';
  const rightBg = row.type === 'equal' ? 'text-gray-500' : rightFilled ? 'bg-emerald-500/10 text-emerald-300' : 'bg-gray-900/40';
  const leftMark = row.type === 'delete' || row.type === 'replace' ? '-' : '';
  const rightMark = row.type === 'insert' || row.type === 'replace' ? '+' : '';

  return (
    <div className="group/diffrow relative grid grid-cols-2">
      {/* §5.5 #17-30 — 행 오른쪽 끝 [코멘트]. 평소엔 숨어 있다가 그 행에 마우스를 올릴 때만 뜬다. */}
      {onComment && (
        <button
          type="button"
          onClick={onComment}
          className="absolute right-0.5 top-0 z-10 hidden h-[18px] w-[18px] items-center justify-center rounded border border-gray-700/70 bg-gray-900/90 text-gray-400 transition-colors hover:border-blue-500/60 hover:text-blue-300 group-hover/diffrow:flex"
          aria-label={commentLabel}
          title={commentLabel}
        >
          <CommentIcon />
        </button>
      )}
      {/* 이전(좌) */}
      <div className={`flex gap-1.5 border-r border-gray-800/60 px-1.5 ${leftBg}`}>
        <span className="w-7 flex-shrink-0 select-none text-right text-gray-600">{row.left?.no ?? ''}</span>
        <span className="w-2 flex-shrink-0 select-none text-red-400/70">{leftMark}</span>
        <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">
          {leftFilled ? <CellText spans={row.leftSpans} text={row.left!.text} changedClass="rounded-sm bg-red-500/30 text-red-100" /> : ''}
        </span>
      </div>
      {/* 이후(우) */}
      <div className={`flex gap-1.5 px-1.5 ${rightBg}`}>
        <span className="w-7 flex-shrink-0 select-none text-right text-gray-600">{row.right?.no ?? ''}</span>
        <span className="w-2 flex-shrink-0 select-none text-emerald-400/70">{rightMark}</span>
        <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">
          {rightFilled ? <CellText spans={row.rightSpans} text={row.right!.text} changedClass="rounded-sm bg-emerald-500/40 text-emerald-50" /> : ''}
        </span>
      </div>
    </div>
  );
});

/**
 * §5.5 #17-30 — 이 diff 가 어느 세션의 것인가. 없으면(스트림 밖 미리보기 등) 코멘트 손잡이는 뜨지 않는다.
 */
export interface DiffReviewCtx {
  /** 코멘트를 담을 세션키(`에이전트::세션id`) — `followSessionKey` 규약과 같은 문자열. */
  sessionKey: string;
  /** 훅 버블이면 false(#17-29 읽기 전용 경계) — 손잡이도 입력창도 렌더하지 않는다. */
  canComment: boolean;
}

interface DiffViewProps {
  parsed: ParsedEdit;
  review?: DiffReviewCtx | undefined;
}

/** 그 행이 가리키는 코드 좌표 — 고친 쪽(우)이 있으면 그쪽, 없으면 지운 쪽(좌). */
function rowAnchor(row: DiffRow): { side: DiffComment['side']; lineNo: number | null; lineText: string } {
  if (row.right !== null) return { side: 'after', lineNo: row.right.no, lineText: row.right.text };
  if (row.left !== null) return { side: 'before', lineNo: row.left.no, lineText: row.left.text };
  return { side: 'after', lineNo: null, lineText: '' };
}

/** ParsedEdit → hunk 별 side-by-side diff. */
export const DiffView = memo(function DiffView({ parsed, review }: DiffViewProps): React.JSX.Element {
  const { t } = useTranslation();
  const hunks = useMemo(
    () => parsed.hunks.map((h) => computeLineDiff(h.oldText, h.newText)),
    [parsed.hunks],
  );
  const multi = hunks.length > 1;

  // ─── §5.5 #17-30 리뷰 코멘트 ───
  const sessionComments = useGraphStore((s) => (review ? s.diffComments[review.sessionKey] : undefined));
  const addDiffComment = useGraphStore((s) => s.addDiffComment);
  const removeDiffComment = useGraphStore((s) => s.removeDiffComment);
  const canComment = review?.canComment === true;
  /** 이 파일에 달린 코멘트만 — 같은 세션의 다른 파일 코멘트는 그 파일 diff 아래에 있다. */
  const fileComments = useMemo(
    () => (sessionComments ?? []).filter((c) => c.filePath === parsed.filePath),
    [sessionComments, parsed.filePath],
  );
  /** 지금 입력창이 열린 행(hunk 인덱스 + 행 인덱스). */
  const [draftAt, setDraftAt] = useState<{ hunk: number; row: number } | null>(null);
  const [draftText, setDraftText] = useState('');
  const atLimit = (sessionComments?.length ?? 0) >= DIFF_COMMENT_MAX;

  const closeDraft = useCallback(() => { setDraftAt(null); setDraftText(''); }, []);

  const submitDraft = useCallback((row: DiffRow) => {
    const body = draftText.trim();
    if (!review || body === '') { closeDraft(); return; }
    const anchor = rowAnchor(row);
    addDiffComment(review.sessionKey, {
      id: makeDiffCommentId(),
      filePath: parsed.filePath,
      side: anchor.side,
      lineNo: anchor.lineNo,
      lineText: anchor.lineText,
      comment: body,
      createdAt: Date.now(),
    });
    closeDraft();
  }, [draftText, review, addDiffComment, parsed.filePath, closeDraft]);

  // 편집 위치로 열기 — 마지막 hunk 의 이후 텍스트를 검색어로(가장 최근 변경 지점).
  const handleOpen = useCallback(() => {
    const searchText = parsed.hunks[parsed.hunks.length - 1]?.newText;
    openInEditor(parsed.filePath, searchText);
  }, [parsed.filePath, parsed.hunks]);

  return (
    <div className="relative">
      {/* 우측 상단 편집 버튼 — 등록된 에디터로 파일을 열고 편집 위치로 이동. */}
      <button
        type="button"
        onClick={handleOpen}
        className="absolute right-1.5 top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded border border-gray-700/70 bg-gray-900/80 text-violet-400 shadow-sm backdrop-blur-sm transition-colors hover:bg-violet-500/20 hover:text-violet-300"
        aria-label={t('panel.fileEdit.openInEditor')}
        title={t('panel.fileEdit.openInVSCode')}
      >
        <PencilIcon />
      </button>
      <ScrollFade maxHeight={DIFF_MAX_HEIGHT}>
        <div className="overflow-hidden rounded border border-gray-800/70 font-mono text-[12px] leading-relaxed">
        {hunks.map((rows, hi) => {
          const shown = rows.slice(0, MAX_VISIBLE_ROWS);
          const hidden = rows.length - shown.length;
          return (
            <div key={hi}>
              {multi && (
                <div className="border-b border-gray-800/60 bg-gray-800/40 px-2 py-0.5 text-[12px] font-semibold uppercase tracking-wide text-gray-400">
                  {t('ide.streamRenderer.diff.change', { index: hi + 1 })}
                </div>
              )}
              {shown.map((row, ri) => {
                const anchor = rowAnchor(row);
                // 그 줄에 이미 달린 코멘트 — 줄 번호가 없는 빈 칸에는 붙이지 않는다(어느 줄인지 못 가리킨다).
                const rowComments = anchor.lineNo === null
                  ? []
                  : fileComments.filter((c) => c.side === anchor.side && c.lineNo === anchor.lineNo);
                const drafting = draftAt !== null && draftAt.hunk === hi && draftAt.row === ri;
                return (
                  <Fragment key={ri}>
                    <DiffRowLine
                      row={row}
                      onComment={canComment && !atLimit && anchor.lineNo !== null
                        ? () => { setDraftAt({ hunk: hi, row: ri }); setDraftText(''); }
                        : undefined}
                      commentLabel={t('ide.diff.addComment')}
                    />
                    {rowComments.map((c) => (
                      <div key={c.id} className="flex items-start gap-1.5 border-l-2 border-blue-500/60 bg-blue-500/10 py-1 pl-2 pr-1 text-[12px] text-blue-100">
                        <span className="min-w-0 flex-1 whitespace-pre-wrap break-words font-sans">{c.comment}</span>
                        <button
                          type="button"
                          onClick={() => { if (review) removeDiffComment(review.sessionKey, c.id); }}
                          className="flex-shrink-0 rounded p-0.5 text-blue-300/70 transition-colors hover:bg-blue-500/20 hover:text-blue-100"
                          aria-label={t('ide.diff.removeComment')}
                          title={t('ide.diff.removeComment')}
                        >
                          <XIcon />
                        </button>
                      </div>
                    ))}
                    {drafting && (
                      <div className="border-l-2 border-blue-500/60 bg-gray-900/80 px-2 py-1.5">
                        <textarea
                          autoFocus
                          value={draftText}
                          onChange={(e) => setDraftText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') { e.stopPropagation(); closeDraft(); }
                            // Ctrl/Cmd+Enter 로 확정 — 그냥 Enter 는 줄바꿈(여러 줄 코멘트를 막지 않는다).
                            else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submitDraft(row); }
                          }}
                          rows={2}
                          placeholder={t('ide.diff.commentPlaceholder', { shortcut: shortcutLabel('Ctrl+Enter') })}
                          className="scrollbar-thin w-full resize-none rounded border border-gray-700 bg-gray-950/80 px-2 py-1 font-sans text-[12px] text-gray-200 outline-none focus:border-blue-500/70"
                        />
                        <div className="mt-1 flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={closeDraft}
                            className="rounded px-2 py-0.5 font-sans text-[12px] text-gray-400 transition-colors hover:bg-gray-800 hover:text-gray-200"
                          >
                            {t('ide.diff.commentCancel')}
                          </button>
                          <button
                            type="button"
                            onClick={() => submitDraft(row)}
                            disabled={draftText.trim() === ''}
                            className="rounded bg-blue-600/80 px-2 py-0.5 font-sans text-[12px] font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-500"
                          >
                            {t('ide.diff.commentSave')}
                          </button>
                        </div>
                      </div>
                    )}
                  </Fragment>
                );
              })}
              {hidden > 0 && (
                <div className="bg-gray-900/50 px-2 py-1 text-center text-[12px] italic text-gray-500">
                  {t('ide.streamRenderer.diff.moreLines', { count: hidden })}
                </div>
              )}
            </div>
          );
        })}
        {/* §5.5 #17-30 — 상한에 닿으면 조용히 버리지 않고 말한다(보내거나 지워서 자리를 만든다). */}
        {canComment && atLimit && (
          <div className="bg-amber-500/10 px-2 py-1 text-center font-sans text-[12px] text-amber-300">
            {t('ide.diff.commentLimit', { max: DIFF_COMMENT_MAX })}
          </div>
        )}
        </div>
      </ScrollFade>
    </div>
  );
});
