import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { BubbleData, FolderFileEntry } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { ScrollFade } from '../ScrollFade.js';
import { clientPathKey } from '../../utils/platform.js';
import { visibleRowsFrom } from './rootFileRows.js';
import { FOLDER_ROW_HEIGHT, flattenFolderLevels, type FolderTreeRow } from './folderFileRows.js';
import { useFolderFilePages } from './useFolderFilePages.js';
import { PagedRowList } from './PagedRowList.js';

const API_BASE = '';

/** Visible 영역 최대 높이 (약 4행) */
const VISIBLE_MAX_HEIGHT = 104;
/** Files 영역 최대 높이 */
const MAX_LIST_HEIGHT = 400;

/** 루트 패널은 **1단계 플랫 리스트**다 — 폴더를 펼치지 않으므로 펼침 집합은 늘 비어 있다. */
const NO_EXPANDED: ReadonlySet<string> = new Set<string>();

interface RootFileListProps {
  /** 루트 노드의 path (서버 키, __root__:프로젝트명 또는 폴더 path) */
  folderPath: string;
  /** 프로젝트 이름 (API 호출용) */
  projectName: string;
  /** 절대 경로를 실어야 서버가 인스턴스를 찍는다(상대 키 `docs` 는 여러 프로젝트에서 남의 목록을 그린다). */
  folderAbsPath?: string | undefined;
  /** 폴더 내부 Root인 경우: 폴더 노드 ID (children에서 visible 판단) */
  parentNodeId?: string;
}

/** Root 패널 — 체크하면 독립 버블. 목록은 `FOLDER_FILES_PAGE_SIZE` 장씩(§7.5). */
export function RootFileList({ folderPath, projectName, folderAbsPath, parentNodeId }: RootFileListProps): React.JSX.Element {
  const { t } = useTranslation();
  const { levels, rootLoading, loadMore } = useFolderFilePages(folderPath, folderAbsPath);

  // "Visible" 판정 SSOT = 캔버스가 실제로 렌더 중인 집합 (canvasVisibleNodeIds).
  // topFolders 멤버십(에이전트가 한 번이라도 쓴 파일 전부 누적)으로 판정하면
  // 캔버스에서 사라진 버블도 계속 체크돼 보이는 버그가 생긴다 → BubbleMap.filteredFolders 와 일치시킴.
  const topFolders = useGraphStore((s) => s.topFolders);
  const storeChildren = useGraphStore((s) => s.children);
  const canvasVisibleNodeIds = useGraphStore((s) => s.canvasVisibleNodeIds);
  const visibleNodes = useMemo<BubbleData[]>(() => {
    if (parentNodeId) {
      // 폴더 내부 Root → 캔버스가 그 폴더 드릴다운 시 렌더하는 children 그대로
      // (canvas 는 ghost/disappearing 자식도 페이드아웃으로 렌더하므로 제외하지 않음)
      return storeChildren[parentNodeId] ?? [];
    }
    // 프로젝트 Root → 캔버스 최상위 렌더 집합(filteredFolders) 그대로
    return topFolders.filter((f) => canvasVisibleNodeIds[f.id]);
  }, [topFolders, storeChildren, canvasVisibleNodeIds, parentNodeId]);

  const visiblePaths = useMemo(() => {
    const set = new Set<string>();
    for (const n of visibleNodes) set.add(clientPathKey(n.path));
    return set;
  }, [visibleNodes]);

  /** 지금까지 받아 온 루트 겹의 항목들 — "표시됨" 행의 이름 보강에 쓴다. */
  const entries = useMemo(() => levels.get('')?.entries ?? [], [levels]);

  // ⚠ 토글 뒤 목록을 다시 읽지 않는다(체크는 store, 디스크 무관 — 재조회는 받아 둔 장까지 되돌린다).
  const handleToggle = useCallback((filePath: string, show: boolean) => {
    fetch(`${API_BASE}/api/root/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectName,
        filePath,
        show,
        parentPath: parentNodeId ? folderPath : undefined,
        absolutePath: folderAbsPath ?? null,
      }),
    }).catch(() => {});
  }, [projectName, parentNodeId, folderPath, folderAbsPath]);

  // "표시됨" 은 디스크 목록을 거르지 않고 **캔버스에 뜬 노드에서 직접** 만든다 —
  // 목록이 감추는 `.claude` / `node_modules` 버블도 여기 나와야 체크 해제할 수 있다.
  const visibleEntries = useMemo(
    () => visibleRowsFrom(visibleNodes, entries, clientPathKey),
    [visibleNodes, entries],
  );

  // 루트 겹 하나만 편다(펼침 ❌ — 이 패널은 1단계다).
  const rows = useMemo(() => flattenFolderLevels(levels, NO_EXPANDED), [levels]);

  const renderEntry = useCallback((row: Extract<FolderTreeRow, { kind: 'entry' }>) => (
    <RootFileRow
      entry={row.entry}
      isVisible={visiblePaths.has(clientPathKey(row.entry.relativePath))}
      onToggle={handleToggle}
    />
  ), [visiblePaths, handleToggle]);

  if (rootLoading) {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-xs text-gray-500">{t('panel.rootFileList.files')}</span>
        <span className="text-[12px] text-gray-600">{t('panel.rootFileList.loading')}</span>
      </div>
    );
  }

  if (rows.length === 0 && visibleEntries.length === 0) {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-xs text-gray-500">{t('panel.rootFileList.files')}</span>
        <span className="text-[12px] text-gray-600">{t('panel.rootFileList.empty')}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="mb-1 flex items-center gap-1 text-[12px]">
        <span className="font-semibold text-violet-400">{t('panel.rootFileList.visible', { count: visibleEntries.length })}</span>
        <span className="text-gray-600">/</span>
        <span className="font-semibold text-gray-500">{t('panel.rootFileList.files')}</span>
      </div>

      <div className="overflow-hidden rounded border border-gray-800 bg-gray-950/50">
        {/* Visible 영역 — 캔버스에 뜬 것만이라 길어지지 않는다 */}
        <div className="border-b border-gray-800">
          <ScrollFade maxHeight={VISIBLE_MAX_HEIGHT} className="px-2 py-1">
            {visibleEntries.length > 0 ? (
              visibleEntries.map((entry) => (
                <div key={entry.relativePath} style={{ height: FOLDER_ROW_HEIGHT }}>
                  <RootFileRow entry={entry} isVisible onToggle={handleToggle} />
                </div>
              ))
            ) : (
              <span className="text-[12px] text-gray-600">{t('panel.rootFileList.noVisible')}</span>
            )}
          </ScrollFade>
        </div>

        {/* Files 영역 — 한 장씩 이어 받고, 보이는 행만 DOM 에 */}
        <PagedRowList
          rows={rows}
          maxHeight={MAX_LIST_HEIGHT}
          onNeedMore={loadMore}
          renderEntry={renderEntry}
        />
      </div>
    </div>
  );
}

// ─── 행 컴포넌트 ───

interface RootFileRowProps {
  entry: FolderFileEntry;
  isVisible: boolean;
  onToggle: (filePath: string, show: boolean) => void;
}

function RootFileRow({ entry, isVisible, onToggle }: RootFileRowProps): React.JSX.Element {
  return (
    <label className="flex h-full cursor-pointer items-center gap-1.5 rounded px-1 text-[12px] text-gray-400 hover:bg-gray-800/50 hover:text-gray-200">
      <input
        type="checkbox"
        className="checkbox-slate"
        checked={isVisible}
        onChange={() => onToggle(entry.relativePath, !isVisible)}
      />
      {entry.isDirectory ? (
        <svg className="h-3 w-3 flex-shrink-0 text-amber-400" viewBox="0 0 24 24" fill="currentColor" fillOpacity={0.6} stroke="currentColor" strokeWidth={1}>
          <path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2z" />
        </svg>
      ) : (
        <svg className="h-3 w-3 flex-shrink-0 text-violet-400" viewBox="0 0 24 24" fill="currentColor" fillOpacity={0.3} stroke="currentColor" strokeWidth={1.5}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM14 2v6h6" />
        </svg>
      )}
      <span className="truncate">{entry.name}</span>
    </label>
  );
}
