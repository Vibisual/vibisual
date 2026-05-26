import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { FolderFileEntry } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { ScrollFade } from '../ScrollFade.js';

const API_BASE = '';

/** Visible 영역 최대 높이 (약 4행) */
const VISIBLE_MAX_HEIGHT = 104;
/** Files 영역 최대 높이 */
const MAX_LIST_HEIGHT = 400;

interface RootFileListProps {
  /** 루트 노드의 path (서버 키, __root__:프로젝트명 또는 폴더 path) */
  folderPath: string;
  /** 프로젝트 이름 (API 호출용) */
  projectName: string;
  /** 폴더 내부 Root인 경우: 폴더 노드 ID (children에서 visible 판단) */
  parentNodeId?: string;
}

/** Root 패널 — 1단계 플랫 리스트, 체크 시 캔버스에 독립 버블 생성/삭제 */
export function RootFileList({ folderPath, projectName, parentNodeId }: RootFileListProps): React.JSX.Element {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<FolderFileEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // "Visible" 판정 SSOT = 캔버스가 실제로 렌더 중인 집합 (canvasVisibleNodeIds).
  // topFolders 멤버십(에이전트가 한 번이라도 쓴 파일 전부 누적)으로 판정하면
  // 캔버스에서 사라진 버블도 계속 체크돼 보이는 버그가 생긴다 → BubbleMap.filteredFolders 와 일치시킴.
  const topFolders = useGraphStore((s) => s.topFolders);
  const storeChildren = useGraphStore((s) => s.children);
  const canvasVisibleNodeIds = useGraphStore((s) => s.canvasVisibleNodeIds);
  const visiblePaths = useMemo(() => {
    const set = new Set<string>();
    if (parentNodeId) {
      // 폴더 내부 Root → 캔버스가 그 폴더 드릴다운 시 렌더하는 children 그대로
      // (canvas 는 ghost/disappearing 자식도 페이드아웃으로 렌더하므로 제외하지 않음)
      const kids = storeChildren[parentNodeId] ?? [];
      for (const c of kids) set.add(c.path.toLowerCase());
    } else {
      // 프로젝트 Root → 캔버스 최상위 렌더 집합(filteredFolders) 그대로
      for (const f of topFolders) {
        if (canvasVisibleNodeIds[f.id]) set.add(f.path.toLowerCase());
      }
    }
    return set;
  }, [topFolders, storeChildren, canvasVisibleNodeIds, parentNodeId]);

  // 파일시스템에서 1단계 목록 로드
  const loadEntries = useCallback(() => {
    setLoading(true);
    fetch(`${API_BASE}/api/folder-files?nodePath=${encodeURIComponent(folderPath)}`)
      .then((r) => {
        if (!r.ok) return { files: [] };
        return r.json();
      })
      .then((data: { files: FolderFileEntry[] }) => {
        setEntries(data.files ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [folderPath]);

  // visible 상태 변경(ghost 전환 등) 시 파일 목록 재조회
  const visibleKey = useMemo(() => [...visiblePaths].sort().join('|'), [visiblePaths]);
  useEffect(() => { loadEntries(); }, [loadEntries, visibleKey]);

  // 독립 버블 토글 → /api/root/toggle (폴더 내부면 parentPath 포함)
  const handleToggle = useCallback((filePath: string, show: boolean) => {
    fetch(`${API_BASE}/api/root/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectName, filePath, show, parentPath: parentNodeId ? folderPath : undefined }),
    }).catch(() => {});
  }, [projectName, parentNodeId, folderPath]);

  if (loading) {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-xs text-gray-500">{t('panel.rootFileList.files')}</span>
        <span className="text-[10px] text-gray-600">{t('panel.rootFileList.loading')}</span>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-xs text-gray-500">{t('panel.rootFileList.files')}</span>
        <span className="text-[10px] text-gray-600">{t('panel.rootFileList.empty')}</span>
      </div>
    );
  }

  const visibleEntries = entries.filter((e) => visiblePaths.has(e.relativePath.toLowerCase()));

  return (
    <div className="flex flex-col">
      <div className="mb-1 flex items-center gap-1 text-[9px]">
        <span className="font-semibold text-violet-400">{t('panel.rootFileList.visible', { count: visibleEntries.length })}</span>
        <span className="text-gray-600">/</span>
        <span className="font-semibold text-gray-500">{t('panel.rootFileList.files')}</span>
      </div>

      <div className="overflow-hidden rounded border border-gray-800 bg-gray-950/50">
        {/* Visible 영역 */}
        <div className="border-b border-gray-800">
          <ScrollFade maxHeight={VISIBLE_MAX_HEIGHT} className="px-2 py-1">
            {visibleEntries.length > 0 ? (
              visibleEntries.map((entry) => (
                <RootFileRow key={entry.relativePath} entry={entry} isVisible onToggle={handleToggle} />
              ))
            ) : (
              <span className="text-[10px] text-gray-600">{t('panel.rootFileList.noVisible')}</span>
            )}
          </ScrollFade>
        </div>

        {/* Files 영역 */}
        <ScrollFade maxHeight={MAX_LIST_HEIGHT} className="px-2 py-1">
          {entries.map((entry) => {
            const isVisible = visiblePaths.has(entry.relativePath.toLowerCase());
            return (
              <RootFileRow
                key={entry.relativePath}
                entry={entry}
                isVisible={isVisible}
                onToggle={handleToggle}
              />
            );
          })}
        </ScrollFade>
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
    <label className="flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 text-[11px] text-gray-400 hover:bg-gray-800/50 hover:text-gray-200">
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
      {entry.isDirectory && entry.children && (
        <span className="ml-auto flex-shrink-0 text-[9px] text-gray-600">
          {entry.children.length}
        </span>
      )}
    </label>
  );
}
