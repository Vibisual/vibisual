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
  /**
   * 이 루트/폴더의 **절대 경로**(스냅샷 값 그대로).
   *
   * 서버 노드 키는 프로젝트 루트 기준 **상대 경로**라 `docs` 처럼 흔한 이름은 어느 프로젝트
   * 것인지 알 수 없다 — 프로젝트를 여러 개 열어 두면 먼저 등록된 인스턴스가 답해 **남의
   * 프로젝트 파일 목록**이 그려졌다(`open-node-file` 이 `absolutePath` 를 함께 보내는 것과 같은
   * 이유). 이 값을 실어 보내면 서버가 인스턴스를 정확히 찍는다.
   */
  folderAbsPath?: string | undefined;
  /** 폴더 내부 Root인 경우: 폴더 노드 ID (children에서 visible 판단) */
  parentNodeId?: string;
}

/**
 * Root 패널 — 1단계 플랫 리스트, 체크 시 캔버스에 독립 버블 생성/삭제.
 *
 * 목록은 `FOLDER_FILES_PAGE_SIZE` 단위로 이어 받는다(§7.5). 종전에는 서버가 폴더를 통째로
 * 재귀해 보냈는데, **이 패널은 그중 최상위 한 겹만 그렸다** — 읽고·보내고·파싱한 나머지는
 * 전부 버려졌고, 사용자 홈이 외부 폴더 버블이면 그 헛일 하나가 창을 세웠다.
 */
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

  // 독립 버블 토글 → /api/root/toggle (폴더 내부면 parentPath 포함).
  //
  // ⚠ 토글 뒤에 목록을 **다시 읽지 않는다**. 체크 여부는 store(캔버스 렌더 집합)에서 오고 이
  //   토글은 디스크를 건드리지 않는다 — 종전의 재조회는 트리를 통째로 다시 걷는 헛일이었고,
  //   페이지 방식에서는 그때까지 스크롤해 받아 둔 장들까지 되돌린다(§7.5 · §7.6 같은 규율).
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
