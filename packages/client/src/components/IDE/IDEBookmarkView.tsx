import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useGraphStore, selectProjectBookmarks } from '../../stores/graphStore.js';
import type { IDEBookmark } from '../../stores/graphStore.js';
import { ScrollFade } from '../ScrollFade.js';

// §5.5 #17-7 v4.93 — 북마크 뷰.
//
// 스킬(#17-4)·목표(#17-17)·루프(#17-11 ⑨) 와 같은 자리(사이드바 `w-52`)에 뜬다 — 보관해 둔 조각은
// 대화를 가리고 볼 것이 아니라 **본문을 보면서 곁눈으로** 꺼내는 것이기 때문(v4.93 이전의 세션창
// 덮개 패널 `IDEBookmarkPanel` 은 폐지). 저장·이동 로직(`jumpToBookmark`/`removeBookmark`/생존 판정)은
// 종전 그대로고, 바뀐 것은 **어디에 어떻게 그리는가** 뿐이다.
//
// 좁은 폭에 맞춘 표시 규약: 본문 4줄 클램프 · 메타 한 줄(출처 칩 + 짧은 시각) · 액션 3종은 hover 노출.
// 카드 본문을 누르면 곧바로 원본으로 이동한다(좁은 칸에서 작은 버튼만 노리지 않아도 되게).

/** 목록용 짧은 시각 — 오늘이면 `HH:MM`, 그 전이면 `M/D`. 전체 시각은 툴팁이 말한다. */
function formatShort(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  return sameDay
    ? d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
    : `${d.getMonth() + 1}/${d.getDate()}`;
}

function formatFull(ts: number): string {
  return new Date(ts).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

/** 북마크 한 장 — 본문 클램프 + 출처/시각 + hover 액션(복사·이동·삭제). */
const BookmarkRow = memo(function BookmarkRow({ bookmark }: { bookmark: IDEBookmark }): React.JSX.Element {
  const { t } = useTranslation();
  const removeBookmark = useGraphStore((s) => s.removeBookmark);
  const jumpToBookmark = useGraphStore((s) => s.jumpToBookmark);

  // 출처가 아직 살아있는지 — 에이전트(버블)가 존재하고, 세션 북마크면 그 세션도 남아 있어야 이동 가능.
  // nodeMap·subAgents 는 전체 그래프 스냅샷에서 전역으로 채워지므로(loadSnapshot) IDE 를 안 열어도 신뢰.
  // 없으면(삭제됨) "이동"을 막고 본문 복사·삭제만 남긴다.
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
  }, [sourceAlive, jumpToBookmark, bookmark]);

  return (
    <li
      onClick={handleJump}
      title={sourceAlive ? t('ide.bookmarks.jump') : t('ide.bookmarks.sourceGone')}
      className={`group rounded border border-gray-700/70 bg-gray-800/40 px-2 py-1.5 transition-colors ${
        sourceAlive ? 'cursor-pointer hover:border-blue-500/40 hover:bg-gray-800' : 'cursor-default opacity-60'
      }`}
    >
      {/* 본문 — 좁은 칸이라 4줄까지만. 전체는 이동해서 원문으로 본다. */}
      <p className="line-clamp-4 whitespace-pre-wrap break-words text-[11px] leading-snug text-gray-300">
        {bookmark.text}
      </p>

      {/* 메타 + 액션 한 줄 */}
      <div className="mt-1 flex items-center gap-1">
        <span className="min-w-0 truncate rounded bg-cyan-500/15 px-1 py-px text-[9px] font-semibold text-cyan-400/80">
          {bookmark.agentLabel}
        </span>
        {!sourceAlive && (
          <svg
            className="h-3 w-3 flex-shrink-0 text-gray-500"
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
          >
            <path d="M9 17H7A5 5 0 0 1 7 7h2M15 7h2a5 5 0 0 1 3.5 8.5M8 12h3M3 3l18 18" />
          </svg>
        )}
        <span className="flex-shrink-0 text-[9px] tabular-nums text-gray-600" title={formatFull(bookmark.createdAt)}>
          {formatShort(bookmark.createdAt)}
        </span>
        <div className="ml-auto flex flex-shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); handleCopy(); }}
            title={t('ide.bookmarks.copy')}
            aria-label={t('ide.bookmarks.copy')}
            className="flex h-4 w-4 items-center justify-center rounded text-gray-500 transition-colors hover:bg-gray-700 hover:text-gray-200"
          >
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); handleJump(); }}
            disabled={!sourceAlive}
            title={sourceAlive ? t('ide.bookmarks.jump') : t('ide.bookmarks.sourceGone')}
            aria-label={sourceAlive ? t('ide.bookmarks.jump') : t('ide.bookmarks.sourceGone')}
            className={`flex h-4 w-4 items-center justify-center rounded transition-colors ${
              sourceAlive ? 'text-blue-400 hover:bg-blue-500/20 hover:text-blue-300' : 'cursor-not-allowed text-gray-600'
            }`}
          >
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); removeBookmark(bookmark.id); }}
            title={t('ide.bookmarks.remove')}
            aria-label={t('ide.bookmarks.remove')}
            className="flex h-4 w-4 items-center justify-center rounded text-gray-500 transition-colors hover:bg-red-600/80 hover:text-white"
          >
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>
    </li>
  );
});

/**
 * 북마크 뷰 — `IDESidebar` 의 `VIEW_MAP['bookmarks']`. 활동바 북마크 항목을 누르면 여기로 바뀌고,
 * 같은 항목을 다시 누르면 사이드바가 접힌다(다른 항목과 같은 규약).
 * 목록은 **지금 보고 있는 프로젝트 칸**만 보여 준다(§5.5 #17-7 프로젝트별로 갈라 담기) — 활동바 배지와
 * 같은 산식(`selectProjectBookmarks`)이라 둘이 어긋나지 않는다. 칸 안에서는 에이전트를 가리지 않으므로
 * `agentId` 는 여전히 쓰지 않는다(뷰 시그니처만 맞춘다).
 */
export const IDEBookmarkView = memo(function IDEBookmarkView(): React.JSX.Element {
  const { t } = useTranslation();
  // 선택자가 칸을 합칠 때 새 배열을 만들므로 store 구독은 원본 상태만 하고 합치기는 useMemo 로 감싼다.
  const store = useGraphStore((s) => s.ideBookmarks);
  const activeProject = useGraphStore((s) => s.activeProject);
  const projects = useGraphStore((s) => s.projects);
  const stubProjects = useGraphStore((s) => s.stubProjects);
  const bookmarks = useMemo(
    () => selectProjectBookmarks({ ideBookmarks: store, activeProject, projects, stubProjects }),
    [store, activeProject, projects, stubProjects],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1 p-2">
      <div className="flex items-center gap-1.5 px-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
          {t('ide.bookmarks.title')}
        </span>
        {bookmarks.length > 0 && (
          <span className="rounded bg-gray-700/60 px-1 text-[9px] font-semibold tabular-nums text-gray-300">
            {bookmarks.length}
          </span>
        )}
      </div>

      {bookmarks.length === 0 ? (
        <p className="px-2 py-4 text-center text-[11px] leading-relaxed text-gray-600">
          {t('ide.bookmarks.empty')}
        </p>
      ) : (
        <ScrollFade fill className="flex-1">
          <ul className="flex flex-col gap-1">
            {bookmarks.map((b) => (
              <BookmarkRow key={b.id} bookmark={b} />
            ))}
          </ul>
        </ScrollFade>
      )}
    </div>
  );
});
