import type { BubbleData } from '@vibisual/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useGraphStore } from '../../stores/graphStore.js';

/** 깊은 쪽부터 늘 펼쳐 두는 조각 수. 앞쪽은 `…` 로 접고 조각마다 폭 상한(`justify-center` 줄이 양쪽 화면 밖으로 나가지 않게). */
const CRUMB_TAIL = 3;
/**
 * 조각 하나가 차지할 수 있는 최대 폭. 넘치면 이름 자체가 `…` 로 잘린다.
 * 굵은 포인터에서는 위아래를 넓혀 손가락이 닿는 높이(28px)를 준다 — 16px 글줄 그대로는 누르기 어렵다.
 */
const CRUMB_LABEL_CLASS = 'inline-block max-w-[9rem] truncate align-bottom pointer-coarse:py-1.5';

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

/** 지금 어디 안에 있는지 캔버스 상단에 띄우는 경로. §5.10 — 폴더(`currentFolderId`/`navStack`)뿐 아니라 내부 뷰(`interiorView`)도 대상(경로가 없으면 위치를 잃는다). */
export function CanvasBreadcrumb(): React.JSX.Element | null {
  const { t } = useTranslation();
  const currentFolderId = useGraphStore((s) => s.currentFolderId);
  const navStack = useGraphStore((s) => s.navStack);
  const nodeMap = useGraphStore((s) => s.nodeMap);
  const topFolders = useGraphStore((s) => s.topFolders);
  const children = useGraphStore((s) => s.children);
  const interiorView = useGraphStore((s) => s.interiorView);
  const currentProject = useGraphStore((s) => s.currentProject);

  // 경로 빌드: navStack 의 각 폴더 + 현재 폴더 + 내부 뷰(휴지통).
  // interior 는 폴더 계층과 독립 축이라 항상 맨 끝에 붙는다(폴더 안에서 열려도 순서가 맞다).
  const breadcrumbs: BreadcrumbCrumb[] = [];
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
      label: t('trash.trashBubbleLabel', { defaultValue: '휴지통' }),
      interior: true,
    });
  }
  // §5.1 #2-1 (B) — 묶음 안. 묶음은 폴더 계층과 무관한 자리라 휴지통처럼 맨 끝에 붙는다.
  if (interiorView?.kind === 'bundle') {
    breadcrumbs.push({ id: interiorView.bundleId, label: t('canvas.bundle.crumb', { name: interiorView.label }), interior: true });
  }

  if (breadcrumbs.length === 0) return null;

  const rootLabel = currentProject?.name ?? t('header.breadcrumb.home');

  // `canvas-crumb` — 표식 클래스(스타일 없음). 같은 자리(`top-3`)에 뜨는 로딩 알약(`CanvasLoadingHint`)이 이 줄이
  //   있으면 그 아래로 비켜 선다 — 폴더를 오가며 불러오는 동안 경로가 알약에 가려졌다.
  return (
    <div className="canvas-crumb pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center px-3">
      <BreadcrumbTrail
        rootLabel={rootLabel}
        {...(currentProject?.path ? { rootTitle: currentProject.path } : {})}
        onRoot={() => useGraphStore.getState().goToMain()}
        crumbs={breadcrumbs}
        onCrumb={(crumb) => {
          // 내부 뷰가 열린 채로 앞쪽 폴더 조각을 누르면 내부부터 닫고 그 폴더로 간다.
          useGraphStore.getState().exitInterior();
          if (!crumb.interior) useGraphStore.getState().enterFolderDeep(crumb.id);
        }}
      />
    </div>
  );
}

/** 경로 한 조각. `interior` 는 폴더 계층이 아닌 자리(휴지통·묶음 안) — 누를 때 무엇을 할지는 부르는 쪽이 정한다. */
export interface BreadcrumbCrumb {
  readonly id: string;
  readonly label: string;
  readonly interior?: boolean;
}

interface BreadcrumbTrailProps {
  /** 맨 앞 조각(누르면 맨 위로) — 캔버스는 프로젝트 이름, IDE 세션 지도는 그 세션 이름. */
  rootLabel: string;
  rootTitle?: string;
  onRoot: () => void;
  /** 맨 앞 뒤로 이어지는 조각들. 마지막 것이 지금 자리다(누를 수 없다). */
  crumbs: readonly BreadcrumbCrumb[];
  onCrumb: (crumb: BreadcrumbCrumb) => void;
}

/** 경로 표시의 그림 한 벌 — 캔버스 경로와 IDE 세션 버블 지도(§5.5 #17-50)가 같이 쓴다. 자리 잡기는 부르는 쪽 몫. */
export function BreadcrumbTrail({ rootLabel, rootTitle, onRoot, crumbs, onCrumb }: BreadcrumbTrailProps): React.JSX.Element {
  const { t } = useTranslation();
  // 펼침은 **그 경로에 한해서만** 기억한다 — 키가 달라지면 자동으로 도로 접힌다(별도 정리 ❌).
  const [expandedFor, setExpandedFor] = useState<string | null>(null);

  // 앞쪽 접기: 조각이 많으면 뒤에서 CRUMB_TAIL 개만 남기고 나머지는 `…` 한 조각으로 접는다.
  const pathKey = crumbs.map((c) => c.id).join('>');
  const collapsed = expandedFor !== pathKey && crumbs.length > CRUMB_TAIL + 1;
  const hiddenCount = collapsed ? crumbs.length - CRUMB_TAIL : 0;
  const shown = collapsed ? crumbs.slice(hiddenCount) : crumbs;

  return (
    <nav className="pointer-events-auto flex max-w-full items-center gap-1 text-[12px]">
      <button
        type="button"
        onClick={onRoot}
        className={`${CRUMB_LABEL_CLASS} text-blue-400/80 transition-colors hover:text-blue-300`}
        title={rootTitle}
      >
        {rootLabel}
      </button>
      {collapsed && (
        <span className="flex flex-shrink-0 items-center gap-1">
          <span className="text-white/20">{t('header.breadcrumb.separator')}</span>
          <button
            type="button"
            onClick={() => setExpandedFor(pathKey)}
            title={crumbs.slice(0, hiddenCount).map((c) => c.label).join(' / ')}
            className="rounded px-1 text-white/40 transition-colors hover:bg-white/10 hover:text-white/80 pointer-coarse:px-2 pointer-coarse:py-1.5"
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
                onClick={() => onCrumb(crumb)}
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
  );
}
