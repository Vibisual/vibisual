import type { BubbleData } from '@vibisual/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useGraphStore } from '../../stores/graphStore.js';

/**
 * 뒤(깊은 쪽)에서부터 **항상 펼쳐 두는** 경로 조각 수. 경로는 폴더를 팔 때마다 가로로 늘어나는데
 * 이 줄은 캔버스 위에 `justify-center` 로 떠 있어서, 길어지면 양쪽으로 화면 밖까지 삐져나갔다.
 * 앞쪽은 `…` 하나로 접고(누르면 그 경로에 한해 펼침) 조각마다 폭 상한을 둔다 — 긴 폴더 이름
 * 하나가 줄 전체를 밀어내지 못하게.
 */
const CRUMB_TAIL = 3;
/** 조각 하나가 차지할 수 있는 최대 폭. 넘치면 이름 자체가 `…` 로 잘린다. */
const CRUMB_LABEL_CLASS = 'inline-block max-w-[9rem] truncate align-bottom';

/**
 * ID로 버블 찾기 — nodeMap(에이전트·topFolders·children·위성 전부) 우선.
 * nodeMap 에 아직 안 들어온 경우를 대비해 topFolders/children 직접 탐색 경로도 남긴다.
 */
function findBubble(
  id: string,
  nodeMap: Record<string, BubbleData>,
  topFolders: BubbleData[],
  children: Record<string, BubbleData[]>,
): BubbleData | undefined {
  const hit = nodeMap[id];
  if (hit) return hit;
  const top = topFolders.find((f) => f.id === id);
  if (top) return top;
  for (const items of Object.values(children)) {
    const found = items.find((f) => f.id === id);
    if (found) return found;
  }
  return undefined;
}

/**
 * "지금 어디 안에 들어와 있는지" 를 캔버스 상단 중앙에 띄우는 경로 표시.
 * 헤더(탭) 영역이 아니라 캔버스 위 오버레이이며, 각 조각 클릭 시 그 위치로 이동한다.
 *
 * §5.10 v3.73 — 대상은 폴더 드릴다운(`currentFolderId`/`navStack`)만이 아니라
 * **내부 뷰(`interiorView` — 휴지통)** 도 포함한다. 내부로 들어갔는데 경로가 사라지면
 * 사용자가 자기 위치를 잃는다("폴더처럼 안에 들어간 건데 왜 안 뜨냐").
 */
export function CanvasBreadcrumb(): React.JSX.Element | null {
  const { t } = useTranslation();
  const currentFolderId = useGraphStore((s) => s.currentFolderId);
  const navStack = useGraphStore((s) => s.navStack);
  const nodeMap = useGraphStore((s) => s.nodeMap);
  const topFolders = useGraphStore((s) => s.topFolders);
  const children = useGraphStore((s) => s.children);
  const interiorView = useGraphStore((s) => s.interiorView);
  const currentProject = useGraphStore((s) => s.currentProject);
  // 펼침은 **그 경로에 한해서만** 기억한다 — 키가 달라지면 자동으로 도로 접힌다(별도 정리 ❌).
  const [expandedFor, setExpandedFor] = useState<string | null>(null);

  // 경로 빌드: navStack 의 각 폴더 + 현재 폴더 + 내부 뷰(휴지통).
  // interior 는 폴더 계층과 독립 축이라 항상 맨 끝에 붙는다(폴더 안에서 열려도 순서가 맞다).
  const breadcrumbs: Array<{ id: string; label: string; interior?: boolean }> = [];
  for (const fId of navStack) {
    const f = findBubble(fId, nodeMap, topFolders, children);
    if (f) breadcrumbs.push({ id: f.id, label: f.label });
  }
  if (currentFolderId) {
    const cur = findBubble(currentFolderId, nodeMap, topFolders, children);
    if (cur) breadcrumbs.push({ id: cur.id, label: cur.label });
  }
  if (interiorView?.kind === 'trash') {
    breadcrumbs.push({
      id: '__trash__',
      label: t('brain.trashBubbleLabel', { defaultValue: '휴지통' }),
      interior: true,
    });
  }

  if (breadcrumbs.length === 0) return null;

  const rootLabel = currentProject?.name ?? t('header.breadcrumb.home');

  // 앞쪽 접기: 조각이 많으면 뒤에서 CRUMB_TAIL 개만 남기고 나머지는 `…` 한 조각으로 접는다.
  const pathKey = breadcrumbs.map((c) => c.id).join('>');
  const collapsed = expandedFor !== pathKey && breadcrumbs.length > CRUMB_TAIL + 1;
  const hiddenCount = collapsed ? breadcrumbs.length - CRUMB_TAIL : 0;
  const shown = collapsed ? breadcrumbs.slice(hiddenCount) : breadcrumbs;

  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center px-3">
      <nav className="pointer-events-auto flex max-w-full items-center gap-1 text-[12px]">
        <button
          type="button"
          onClick={() => useGraphStore.getState().goToMain()}
          className={`${CRUMB_LABEL_CLASS} text-blue-400/80 transition-colors hover:text-blue-300`}
          title={currentProject?.path}
        >
          {rootLabel}
        </button>
        {collapsed && (
          <span className="flex flex-shrink-0 items-center gap-1">
            <span className="text-white/20">{t('header.breadcrumb.separator')}</span>
            <button
              type="button"
              onClick={() => setExpandedFor(pathKey)}
              title={breadcrumbs.slice(0, hiddenCount).map((c) => c.label).join(' / ')}
              className="rounded px-1 text-white/40 transition-colors hover:bg-white/10 hover:text-white/80"
            >
              …
            </button>
          </span>
        )}
        {shown.map((crumb, i) => {
          const isLast = i === shown.length - 1;
          return (
            <span key={crumb.id} className="flex min-w-0 items-center gap-1">
              <span className="flex-shrink-0 text-white/20">{t('header.breadcrumb.separator')}</span>
              {isLast ? (
                <span className={`${CRUMB_LABEL_CLASS} font-medium text-white/70`} title={crumb.label}>{crumb.label}</span>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    // 내부 뷰가 열린 채로 앞쪽 폴더 조각을 누르면 내부부터 닫고 그 폴더로 간다.
                    useGraphStore.getState().exitInterior();
                    if (!crumb.interior) useGraphStore.getState().enterFolderDeep(crumb.id);
                  }}
                  title={crumb.label}
                  className={`${CRUMB_LABEL_CLASS} text-blue-400/80 transition-colors hover:text-blue-300`}
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
