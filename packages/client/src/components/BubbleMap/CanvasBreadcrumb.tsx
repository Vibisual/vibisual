import type { BubbleData } from '@vibisual/shared';
import { useTranslation } from 'react-i18next';
import { useGraphStore } from '../../stores/graphStore.js';

/** ID로 폴더 버블 찾기 (topFolders + children 전체 탐색) */
function findFolder(
  id: string,
  topFolders: BubbleData[],
  children: Record<string, BubbleData[]>,
): BubbleData | undefined {
  const top = topFolders.find((f) => f.id === id);
  if (top) return top;
  for (const items of Object.values(children)) {
    const found = items.find((f) => f.id === id);
    if (found) return found;
  }
  return undefined;
}

/**
 * 폴더 버블 드릴다운 시 캔버스 상단 중앙에 떠 있는 경로 표시.
 * 헤더(탭) 영역이 아니라 캔버스 위 오버레이이며, 각 조각 클릭 시 해당 폴더로 이동한다.
 */
export function CanvasBreadcrumb(): React.JSX.Element | null {
  const { t } = useTranslation();
  const currentFolderId = useGraphStore((s) => s.currentFolderId);
  const navStack = useGraphStore((s) => s.navStack);
  const topFolders = useGraphStore((s) => s.topFolders);
  const children = useGraphStore((s) => s.children);
  const currentProject = useGraphStore((s) => s.currentProject);

  // 브레드크럼 경로 빌드: navStack의 각 폴더 + 현재 폴더
  const breadcrumbs: Array<{ id: string; label: string }> = [];
  for (const fId of navStack) {
    const f = findFolder(fId, topFolders, children);
    if (f) breadcrumbs.push({ id: f.id, label: f.label });
  }
  if (currentFolderId) {
    const cur = findFolder(currentFolderId, topFolders, children);
    if (cur) breadcrumbs.push({ id: cur.id, label: cur.label });
  }

  if (breadcrumbs.length === 0) return null;

  const rootLabel = currentProject?.name ?? t('header.breadcrumb.home');

  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center">
      <nav className="pointer-events-auto flex items-center gap-1 text-[12px]">
        <button
          type="button"
          onClick={() => useGraphStore.getState().goToMain()}
          className="text-blue-400/80 transition-colors hover:text-blue-300"
          title={currentProject?.path}
        >
          {rootLabel}
        </button>
        {breadcrumbs.map((crumb, i) => {
          const isLast = i === breadcrumbs.length - 1;
          return (
            <span key={crumb.id} className="flex items-center gap-1">
              <span className="text-white/20">{t('header.breadcrumb.separator')}</span>
              {isLast ? (
                <span className="font-medium text-white/70">{crumb.label}</span>
              ) : (
                <button
                  type="button"
                  onClick={() => useGraphStore.getState().enterFolderDeep(crumb.id)}
                  className="text-blue-400/80 transition-colors hover:text-blue-300"
                >
                  {crumb.label}
                </button>
              )}
            </span>
          );
        })}
      </nav>
    </div>
  );
}
