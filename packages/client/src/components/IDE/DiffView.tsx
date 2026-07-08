/**
 * DiffView — Edit 계열 도구의 "이전 코드 vs 고친 코드" side-by-side 비교 렌더.
 *
 * ToolBlock 이 parseEditToolInput 으로 얻은 ParsedEdit 를 받아, 라인 단위로 정렬된 좌(빨강=이전)/우(초록=이후)
 * 두 열을 그린다. 변경 라인은 단어 단위로 바뀐 토큰만 진하게 강조. MultiEdit 는 여러 hunk 를 순서대로 쌓는다.
 * 순수 diff 계산은 diffTool.ts, 여기선 표시만.
 */
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollFade } from '../ScrollFade.js';
import { computeLineDiff, type ParsedEdit, type DiffRow, type WordSpan } from './diffTool.js';

/** 긴 diff 방어 — hunk 당 이 줄 수까지만 렌더하고 나머지는 "… N줄 더" 로 접는다. */
const MAX_VISIBLE_ROWS = 600;
/** 스크롤 영역 최대 높이(px) — 초과 diff 는 ScrollFade 안에서 스크롤. */
const DIFF_MAX_HEIGHT = 440;

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

/** side-by-side 한 행: [번호][마커][이전]  [번호][마커][이후]. */
const DiffRowLine = memo(function DiffRowLine({ row }: { row: DiffRow }): React.JSX.Element {
  const leftFilled = row.left !== null;
  const rightFilled = row.right !== null;
  const leftBg = row.type === 'equal' ? 'text-gray-500' : leftFilled ? 'bg-red-500/10 text-red-300' : 'bg-gray-900/40';
  const rightBg = row.type === 'equal' ? 'text-gray-500' : rightFilled ? 'bg-emerald-500/10 text-emerald-300' : 'bg-gray-900/40';
  const leftMark = row.type === 'delete' || row.type === 'replace' ? '-' : '';
  const rightMark = row.type === 'insert' || row.type === 'replace' ? '+' : '';

  return (
    <div className="grid grid-cols-2">
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

interface DiffViewProps {
  parsed: ParsedEdit;
}

/** ParsedEdit → hunk 별 side-by-side diff. */
export const DiffView = memo(function DiffView({ parsed }: DiffViewProps): React.JSX.Element {
  const { t } = useTranslation();
  const hunks = useMemo(
    () => parsed.hunks.map((h) => computeLineDiff(h.oldText, h.newText)),
    [parsed.hunks],
  );
  const multi = hunks.length > 1;

  return (
    <ScrollFade maxHeight={DIFF_MAX_HEIGHT}>
      <div className="overflow-hidden rounded border border-gray-800/70 font-mono text-[12px] leading-relaxed">
        {hunks.map((rows, hi) => {
          const shown = rows.slice(0, MAX_VISIBLE_ROWS);
          const hidden = rows.length - shown.length;
          return (
            <div key={hi}>
              {multi && (
                <div className="border-b border-gray-800/60 bg-gray-800/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                  {t('ide.streamRenderer.diff.change', { index: hi + 1 })}
                </div>
              )}
              {shown.map((row, ri) => <DiffRowLine key={ri} row={row} />)}
              {hidden > 0 && (
                <div className="bg-gray-900/50 px-2 py-1 text-center text-[11px] italic text-gray-500">
                  {t('ide.streamRenderer.diff.moreLines', { count: hidden })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </ScrollFade>
  );
});
