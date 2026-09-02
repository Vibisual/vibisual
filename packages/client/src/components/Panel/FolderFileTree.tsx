import { useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { FolderFileEntry } from '@vibisual/shared';
import { DEFAULT_MAX_SATELLITES } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { ScrollFade } from '../ScrollFade.js';
import { SatelliteMaxPopup } from './SatelliteMaxPopup.js';
import { FOLDER_ROW_HEIGHT, flattenFolderLevels, type FolderTreeRow } from './folderFileRows.js';
import { useFolderFilePages } from './useFolderFilePages.js';
import { PagedRowList } from './PagedRowList.js';

const API_BASE = '';

/** Visible 영역 최대 높이 (약 4행) */
const VISIBLE_MAX_HEIGHT = 104;
/** All 파일 트리 최대 높이 */
const MAX_LIST_HEIGHT = 320;

interface FolderFileTreeProps {
  /** 폴더 노드의 path (서버 키) */
  folderPath: string;
  /**
   * 이 폴더의 **절대 경로**(스냅샷 값 그대로) — 서버 인스턴스 라우팅 힌트.
   * 노드 키는 프로젝트 루트 기준 상대 경로라 `docs` 같은 흔한 이름은 프로젝트를 여러 개 열면
   * 먼저 등록된 쪽이 답한다(`open-node-file` 이 `absolutePath` 를 함께 보내는 것과 같은 이유).
   */
  folderAbsPath?: string | undefined;
  /** 폴더 노드의 ID (store satellites 조회용) */
  nodeId: string;
  /** 메인 뷰 root면 true — 모든 위성을 Visible에 합산 */
  collectAll?: boolean;
  /** 폴더 노드의 위성 표시 상한 (서버 SSOT, undefined면 기본값) */
  maxSatellites?: number;
}

/**
 * 체크박스 + 계층 트리 — 위성 파일을 시각적으로 토글.
 *
 * 목록은 **한 겹씩·한 장씩** 온다(§7.5) — 폴더를 펼치는 순간 그 겹을 부르고, 접으면 그 아래를
 * 즉시 버린다. 종전에는 폴더 하나를 통째로 재귀해 받았고, 외부 폴더 버블이 사용자 홈이면
 * 그 요청 하나가 창을 통째로 세웠다.
 */
export function FolderFileTree({ folderPath, folderAbsPath, nodeId, collectAll, maxSatellites }: FolderFileTreeProps): React.JSX.Element {
  const { t } = useTranslation();
  const effectiveMax = maxSatellites ?? DEFAULT_MAX_SATELLITES;
  // Max 편집 팝업 — 펜 버튼 클릭 시 포인터 좌표에 표시 (서버가 SSOT)
  const [maxEditorAt, setMaxEditorAt] = useState<{ x: number; y: number } | null>(null);

  const commitMax = useCallback((next: number) => {
    fetch(`${API_BASE}/api/satellite/max`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderPath, max: next }),
    }).catch(() => {});
  }, [folderPath]);

  const { levels, expanded, rootLoading, toggleExpand, loadMore } = useFolderFilePages(folderPath, folderAbsPath);

  // store의 실시간 위성 데이터 — 삭제/추가 시 자동 반영
  const storeSatellites = useGraphStore((s) => s.satellites);
  const satellitePaths = useMemo(() => {
    if (collectAll) {
      // root 메인 뷰: 모든 위성을 합산
      const all = new Set<string>();
      for (const sats of Object.values(storeSatellites)) {
        for (const s of sats) all.add(s.path.toLowerCase());
      }
      return all;
    }
    const sats = storeSatellites[nodeId];
    if (!sats) return new Set<string>();
    return new Set(sats.map((s) => s.path.toLowerCase()));
  }, [storeSatellites, nodeId, collectAll]);

  // ⚠ 위성이 바뀌어도 **목록을 다시 부르지 않는다**. 체크 여부는 위 store 에서 오고 응답에는
  //   그 정보가 없다 — 종전에는 위성이 바뀔 때마다 트리를 통째로 다시 걸어 목록이 "불러오는 중"
  //   으로 깜빡였다(§7.6 이 루트 패널에서 먼저 없앤 것과 같은 헛일).

  // 위성 토글 → 서버 API → snapshot broadcast → store 자동 갱신
  const handleToggle = useCallback((filePath: string, show: boolean) => {
    fetch(`${API_BASE}/api/satellite/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderPath, filePath, show, absolutePath: folderAbsPath ?? null }),
    }).catch(() => {});
  }, [folderPath, folderAbsPath]);

  // Visible 엔트리 — store satellite 데이터에서 직접 생성 (맵과 동일 소스)
  const visibleEntries: FolderFileEntry[] = useMemo(() => {
    if (collectAll) {
      const seen = new Set<string>();
      const result: FolderFileEntry[] = [];
      for (const sats of Object.values(storeSatellites)) {
        for (const s of sats) {
          // ghost/disappearing 위성은 visible 아님
          if (s.bubbleType === 'ghost' || s.status === 'disappearing') continue;
          const key = s.path.toLowerCase();
          if (!seen.has(key)) {
            seen.add(key);
            result.push({ name: s.label, relativePath: key, isDirectory: false, isSatellite: true });
          }
        }
      }
      return result;
    }
    const sats = storeSatellites[nodeId];
    if (!sats) return [];
    return sats
      .filter((s) => s.bubbleType !== 'ghost' && s.status !== 'disappearing')
      .map((s) => ({
        name: s.label,
        relativePath: s.path.toLowerCase(),
        isDirectory: false,
        isSatellite: true,
      }));
  }, [storeSatellites, nodeId, collectAll]);

  const rows = useMemo(() => flattenFolderLevels(levels, expanded), [levels, expanded]);

  const renderEntry = useCallback((row: Extract<FolderTreeRow, { kind: 'entry' }>) => {
    const { entry, depth, expanded: isExpanded, childSubPath } = row;
    if (entry.isDirectory) {
      return (
        <button
          type="button"
          className="flex h-full w-full items-center gap-1 rounded px-1 text-[12px] text-gray-400 hover:bg-gray-800/50 hover:text-gray-200"
          style={{ paddingLeft: depth * 12 + 4 }}
          onClick={() => toggleExpand(childSubPath)}
        >
          <svg
            className="h-3 w-3 flex-shrink-0 transition-transform"
            style={{ transform: isExpanded ? 'rotate(90deg)' : undefined }}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
          <svg className="h-3 w-3 flex-shrink-0 text-amber-400" viewBox="0 0 24 24" fill="currentColor" fillOpacity={0.6} stroke="currentColor" strokeWidth={1}>
            <path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2z" />
          </svg>
          <span className="truncate">{entry.name}</span>
        </button>
      );
    }
    return (
      <FileRow
        entry={entry}
        isSatellite={satellitePaths.has(entry.relativePath.toLowerCase())}
        onToggle={handleToggle}
        depth={depth}
      />
    );
  }, [satellitePaths, handleToggle, toggleExpand]);

  if (rootLoading) {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-xs text-gray-500">{t('panel.folderFileTree.files')}</span>
        <span className="text-[12px] text-gray-600">{t('panel.folderFileTree.loading')}</span>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-xs text-gray-500">{t('panel.folderFileTree.files')}</span>
        <span className="text-[12px] text-gray-600">{t('panel.folderFileTree.empty')}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {/* 헤더: 위성 N / M (M = 폴더별 표시 상한, 편집 가능) */}
      <div className="mb-1 flex items-center gap-1 text-[12px]">
        <span className="font-semibold text-violet-400">
          {t('panel.folderFileTree.satellites', { count: visibleEntries.length })}
        </span>
        <span className="text-gray-600">/</span>
        <span className="font-semibold text-gray-500">{effectiveMax}</span>
        {!collectAll && (
          <button
            type="button"
            title={t('panel.folderFileTree.maxTitle')}
            aria-label={t('panel.folderFileTree.maxTitle')}
            onClick={(e) => setMaxEditorAt({ x: e.clientX, y: e.clientY })}
            className="ml-0.5 inline-flex items-center justify-center rounded p-0.5 text-gray-500 hover:bg-gray-800 hover:text-violet-400"
          >
            <svg
              className="h-3 w-3"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
          </button>
        )}
      </div>

      {maxEditorAt && !collectAll && (
        <SatelliteMaxPopup
          value={effectiveMax}
          screenX={maxEditorAt.x}
          screenY={maxEditorAt.y}
          onClose={() => setMaxEditorAt(null)}
          onCommit={commitMax}
        />
      )}

      {/* Visible + Files 붙은 박스 */}
      <div className="overflow-hidden rounded border border-gray-800 bg-gray-950/50">
        {/* Visible 영역 — 상한(maxSatellites)이 있어 길어지지 않으므로 창 자르기 없이 그린다 */}
        <div className="border-b border-gray-800">
          <ScrollFade maxHeight={VISIBLE_MAX_HEIGHT} className="px-2 py-1">
            {visibleEntries.length > 0 ? (
              visibleEntries.map((f) => (
                <div key={f.relativePath} style={{ height: FOLDER_ROW_HEIGHT }}>
                  <FileRow entry={f} isSatellite onToggle={handleToggle} />
                </div>
              ))
            ) : (
              <span className="text-[12px] text-gray-600">{t('panel.folderFileTree.noVisible')}</span>
            )}
          </ScrollFade>
        </div>

        {/* Files 영역 — 한 겹씩·한 장씩, 보이는 행만 DOM 에 */}
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

// ─── 파일 행 (체크박스) ───

interface FileRowProps {
  entry: FolderFileEntry;
  isSatellite: boolean;
  onToggle: (filePath: string, show: boolean) => void;
  depth?: number;
}

function FileRow({ entry, isSatellite, onToggle, depth = 0 }: FileRowProps): React.JSX.Element {
  return (
    <label
      className="flex h-full cursor-pointer items-center gap-1.5 rounded px-1 text-[12px] text-gray-400 hover:bg-gray-800/50 hover:text-gray-200"
      style={{ paddingLeft: depth * 12 + 4 }}
    >
      <input
        type="checkbox"
        className="checkbox-slate"
        checked={isSatellite}
        onChange={() => onToggle(entry.relativePath, !isSatellite)}
      />
      <svg className="h-3 w-3 flex-shrink-0 text-violet-400" viewBox="0 0 24 24" fill="currentColor" fillOpacity={0.3} stroke="currentColor" strokeWidth={1.5}>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM14 2v6h6" />
      </svg>
      <span className="truncate">{entry.name}</span>
    </label>
  );
}
