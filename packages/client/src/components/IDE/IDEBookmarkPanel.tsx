import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useGraphStore } from '../../stores/graphStore.js';
import type { IDEBookmark } from '../../stores/graphStore.js';

function formatStamp(ts: number): string {
  return new Date(ts).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** 북마크 한 장 — 본문 + 우상단 복사/이동/닫기. */
const BookmarkCard = memo(function BookmarkCard({
  bookmark,
  onJumped,
}: {
  bookmark: IDEBookmark;
  onJumped: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const removeBookmark = useGraphStore((s) => s.removeBookmark);
  const jumpToBookmark = useGraphStore((s) => s.jumpToBookmark);

  // 출처가 아직 살아있는지 — 에이전트(버블)가 존재하고, 세션 북마크면 그 세션도 남아 있어야 이동 가능.
  // nodeMap·subAgents 는 전체 그래프 스냅샷에서 전역으로 채워지므로(loadSnapshot) IDE 를 안 열어도 신뢰.
  // 없으면(삭제됨) "이동" 버튼을 비활성화하고 본문 복사·삭제만 남긴다.
  const sourceAlive = useGraphStore((s) => {
    if (!s.nodeMap[bookmark.agentId]) return false;
    if (bookmark.sessionId === null) return true;
    const subs = s.subAgents[bookmark.agentId];
    return !!subs && subs.some((x) => x.id === bookmark.sessionId);
  });

  const handleCopy = useCallback(() => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(bookmark.text).catch(() => {});
    }
  }, [bookmark.text]);

  const handleJump = useCallback(() => {
    if (!sourceAlive) return;
    // jumpToBookmark 가 (IDE 가 닫혀 있어도) openIDEOverlay 로 열고, 세션 선택 + 위치 스크롤까지 수행.
    jumpToBookmark(bookmark);
    onJumped();
  }, [sourceAlive, jumpToBookmark, bookmark, onJumped]);

  return (
    <div className="relative rounded-lg border border-gray-700 bg-gray-800/80 px-4 py-3 shadow-sm">
      {/* 우상단 액션 */}
      <div className="absolute right-2 top-2 flex items-center gap-0.5">
        <button
          type="button"
          onClick={handleCopy}
          title={t('ide.bookmarks.copy')}
          aria-label={t('ide.bookmarks.copy')}
          className="flex h-7 w-7 items-center justify-center rounded text-gray-400 transition-colors hover:bg-gray-700 hover:text-gray-200"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        </button>
        <button
          type="button"
          onClick={handleJump}
          disabled={!sourceAlive}
          title={sourceAlive ? t('ide.bookmarks.jump') : t('ide.bookmarks.sourceGone')}
          aria-label={sourceAlive ? t('ide.bookmarks.jump') : t('ide.bookmarks.sourceGone')}
          className={`flex h-7 w-7 items-center justify-center rounded transition-colors ${
            sourceAlive
              ? 'text-blue-400 hover:bg-blue-500/20 hover:text-blue-300'
              : 'cursor-not-allowed text-gray-600'
          }`}
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => removeBookmark(bookmark.id)}
          title={t('ide.bookmarks.remove')}
          aria-label={t('ide.bookmarks.remove')}
          className="flex h-7 w-7 items-center justify-center rounded text-gray-400 transition-colors hover:bg-red-600/80 hover:text-white"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* 본문 — 선택 텍스트 그대로 (길면 스크롤) */}
      <div className="mr-24 max-h-60 overflow-y-auto whitespace-pre-wrap break-words text-[13px] leading-relaxed text-gray-200 scrollbar-thin">
        {bookmark.text}
      </div>

      {/* 출처 메타 */}
      <div className="mt-2.5 flex items-center gap-1.5 text-[10px] text-gray-500">
        <span className="rounded bg-cyan-500/15 px-1.5 py-0.5 font-semibold text-cyan-400/80">{bookmark.agentLabel}</span>
        <span>{formatStamp(bookmark.createdAt)}</span>
        {!sourceAlive && (
          <span className="rounded bg-gray-700/50 px-1.5 py-0.5 font-medium text-gray-400">{t('ide.bookmarks.sourceGone')}</span>
        )}
      </div>
    </div>
  );
});

/**
 * 북마크 뷰 — 세션창(IDE 메인 영역) 전체를 덮는 패널. AgentIDEOverlay 가 활동바 우측 영역에
 * 절대배치로 띄운다. 작은 플라이아웃이 아니라 대화창 위에 별도 "세션창"처럼 열리는 구조.
 */
export const IDEBookmarkView = memo(function IDEBookmarkView({
  onClose,
}: {
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const bookmarks = useGraphStore((s) => s.ideBookmarks);

  return (
    <div className="flex h-full w-full flex-col bg-gray-950">
      {/* 헤더 */}
      <div className="flex h-10 flex-shrink-0 items-center justify-between border-b border-gray-700 bg-gray-900/80 px-4">
        <span className="flex items-center gap-2 text-[13px] font-semibold text-gray-200">
          <svg className="h-4 w-4 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
          </svg>
          {t('ide.bookmarks.title')}
          {bookmarks.length > 0 && <span className="text-gray-500">({bookmarks.length})</span>}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('ide.bookmarks.close')}
          title={t('ide.bookmarks.close')}
          className="flex h-7 w-7 items-center justify-center rounded text-gray-400 transition-colors hover:bg-gray-700 hover:text-gray-200"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* 본문 */}
      {bookmarks.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-[12px] leading-relaxed text-gray-500">
          {t('ide.bookmarks.empty')}
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4 scrollbar-thin">
          {bookmarks.map((b) => (
            <BookmarkCard key={b.id} bookmark={b} onJumped={onClose} />
          ))}
        </div>
      )}
    </div>
  );
});
