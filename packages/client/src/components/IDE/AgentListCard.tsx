import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentList } from '@vibisual/shared';

interface AgentListCardProps {
  list: AgentList;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** 번호 목록(list-ordered) — 헤더 글리프 */
function ListOrderedIcon(): React.JSX.Element {
  return (
    <svg className="h-3.5 w-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="10" x2="21" y1="6" y2="6" />
      <line x1="10" x2="21" y1="12" y2="12" />
      <line x1="10" x2="21" y1="18" y2="18" />
      <path d="M4 6h1v4" />
      <path d="M4 10h2" />
      <path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1" />
    </svg>
  );
}

/**
 * §4 v2.84 — 에이전트 번호 목록 정렬 카드.
 *
 * 커스텀/스폰 에이전트가 `POST /api/agent-list` 로 보낸 title/items 를 렌더. 에이전트가 답변에 담는
 * 여러 항목의 번호/순서 목록을 본문 텍스트로 길게 나열하는 대신, 항목 배열만 보내면 IDE 가 번호를
 * 자동으로 매겨 **가지런히 정렬**해 보여준다(번호 열 고정폭 + 행잉 인덴트). teal 액센트로 구분.
 * 작업 신고(emerald)·질문(sky)·검수(violet)와 동일 골격.
 */
export const AgentListCard = memo(function AgentListCard({ list }: AgentListCardProps): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <div className="mx-2 my-1.5 overflow-hidden rounded-md border border-gray-700/40 bg-gray-900/25">
      {/* 헤더 — teal 식별 라벨. */}
      <div className="flex items-center gap-2 border-b border-gray-800/50 bg-gray-800/15 px-3 py-1.5">
        <span className="text-teal-300"><ListOrderedIcon /></span>
        <span className="flex-1 text-[11px] font-semibold uppercase tracking-wide text-teal-300">
          {t('ide.list.title')}
        </span>
        <span className="select-none text-[10px] text-gray-500">{formatTime(list.createdAt)}</span>
      </div>

      <div className="px-3 py-2">
        {list.note && (
          <p className="mb-2 text-[12.5px] leading-relaxed text-gray-300">{list.note}</p>
        )}

        {/* 목록 제목 / 머리말 */}
        {list.title && (
          <div className="mb-1.5 text-[12.5px] font-medium leading-relaxed text-gray-200">{list.title}</div>
        )}

        {/* 번호 목록 — 번호 열 고정폭(우측정렬·tabular-nums) + 본문 행잉 인덴트. */}
        <ol className="space-y-0.5">
          {list.items.map((item, i) => (
            <li key={i} className="flex items-start gap-2 text-[12.5px] leading-relaxed text-gray-300">
              <span className="min-w-[1.5rem] flex-shrink-0 select-none text-right font-medium tabular-nums text-teal-300/70">
                {i + 1}.
              </span>
              <span className="min-w-0 flex-1 break-words">{item}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
});
