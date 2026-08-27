import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WORKSPACE_DIR_ENTRY_MAX } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { ScrollFade } from '../ScrollFade.js';
import { flattenExplorerRows } from './explorerModel.js';
import { editorFileFromAbsPath, editorFileFromRelPath } from './editorModel.js';
import { useWorkspaceExplorer, openWorkspaceFile } from './useWorkspaceExplorer.js';
import { useIDEProjectRoot } from './useIDEProjectRoot.js';
import { useIDEPaneActions, useIDEPaneKey } from './idePane.js';
import { openWorkspaceTarget } from './openWorkspaceTarget.js';
import { IDEExplorerTree } from './IDEExplorerTree.js';
import { IDEExplorerEdited } from './IDEExplorerEdited.js';

/**
 * §5.5 #17-19 v4.71 — 활동바 **파일**이 여는 사이드바 = 워크스페이스 탐색기.
 *
 * 종전 파일 뷰는 이 에이전트가 만진 파일의 basename 만 나열해, 그 파일이 어디 있는지도
 * 아직 안 만진 파일이 무엇인지도 알 수 없었다. 이제 프로젝트 루트에서 시작하는 실제 디렉터리
 * 트리를 그리고, 경로는 세 곳에서 보인다 — 계층(들여쓰기) · 행 툴팁 · 바닥 경로 줄.
 */

export const IDEExplorerView = memo(function IDEExplorerView({ agentId }: { agentId: string }): React.JSX.Element {
  const { t } = useTranslation();
  // §5.5 #17-27 — 트리 루트 판정은 편집창과 같은 훅 하나를 쓴다(둘이 갈라지면 같은 상대 경로가 다른 파일이 된다).
  const rootPath = useIDEProjectRoot();
  // §5.5 #17-1 — 탐색기에서 연 파일은 **이 창의** 편집창에 뜬다.
  const paneKey = useIDEPaneKey();
  const { openEditorFile: openInEditor } = useIDEPaneActions();
  const { cache, expanded, loading, truncated, failed, rootError, toggleDir, collapseAll, refresh } = useWorkspaceExplorer(rootPath);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  /** §5.5 #17-19 ③(c) — 복사 표시는 **행 단위**다(바닥 줄 버튼 하나였을 때의 boolean 이 아니다). */
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  const rows = useMemo(() => flattenExplorerRows(cache, expanded), [cache, expanded]);
  const rootName = useMemo(() => {
    if (!rootPath) return '';
    const parts = rootPath.replace(/\\/g, '/').replace(/\/+$/, '').split('/');
    return parts[parts.length - 1] ?? rootPath;
  }, [rootPath]);

  /** 앱 밖 편집기로 열기 — ↗ 버튼과 더블클릭(종전 동작 그대로 병행). */
  const handleOpenFile = useCallback((relPath: string) => {
    if (!rootPath) return;
    setSelectedPath(relPath);
    openWorkspaceFile(rootPath, relPath);
  }, [rootPath]);

  /**
   * §5.5 #17-27 / §5.13 (R-7) — 한 번 클릭 = **그 파일이 열릴 곳**에서 열기(선택 표시도 함께).
   *
   * 종전에는 무조건 편집창으로 보냈다. 영상·음악·3D·압축이 전부 그리로 갔고, 그중 대부분은
   * "바이너리 파일" 한 줄로 끝났다. 이제 본문의 경로 손잡이와 **같은 판정**을 쓴다.
   */
  const handleSelectFile = useCallback(
    (relPath: string, executable?: boolean) => {
      setSelectedPath(relPath);
      if (!rootPath) return;
      const file = editorFileFromRelPath(relPath, rootPath);
      void openWorkspaceTarget(
        { relPath, absPath: file.absPath, kind: 'file', ...(executable === true ? { executable: true } : {}) },
        rootPath,
        t('ide.streamRenderer.pathLink.runFailed'),
        paneKey,
      );
    },
    [rootPath, t, paneKey],
  );

  /** §5.5 #17-27 — 편집한 파일 구역은 절대 경로를 이미 알고 있다(루트 밖 파일도 그대로 열린다). */
  const handleOpenEdited = useCallback((absPath: string, relPath: string) => {
    setSelectedPath(relPath);
    openInEditor(editorFileFromAbsPath(absPath, rootPath));
  }, [rootPath, openInEditor]);

  /**
   * §5.5 #17-19 ③(c) — 경로 복사는 **그 행의 손잡이**다(바닥 줄 ❌ — 고른 행 옆에서 바로 집는다).
   *
   * 되돌림 타이머는 "그 사이 다른 행을 복사했으면 건드리지 않는다" — 그러지 않으면 앞 행의
   * 타이머가 방금 복사한 뒷 행의 체크 표시를 지운다.
   */
  const handleCopyPath = useCallback((relPath: string) => {
    if (!relPath) return;
    void navigator.clipboard?.writeText(relPath).then(() => {
      setCopiedPath(relPath);
      window.setTimeout(() => setCopiedPath((prev) => (prev === relPath ? null : prev)), 1200);
    }).catch(() => { /* 클립보드 거부는 조용히 무시 */ });
  }, []);

  const rootLoading = loading.has('');

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 헤더 — 루트 이름(전체 경로는 툴팁) + 새로고침 / 모두 접기 */}
      <div className="flex items-center gap-1 border-b border-gray-800 px-1.5 py-1">
        <span
          className="min-w-0 flex-1 truncate text-[12px] font-semibold uppercase tracking-wider text-gray-400"
          title={rootPath ?? ''}
        >
          {rootName || t('ide.explorer.title')}
        </span>
        <button
          type="button"
          onClick={refresh}
          title={t('ide.explorer.refresh')}
          aria-label={t('ide.explorer.refresh')}
          className="rounded p-0.5 text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-200"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12a9 9 0 1 1-2.6-6.4" />
            <polyline points="21 3 21 9 15 9" />
          </svg>
        </button>
        <button
          type="button"
          onClick={collapseAll}
          title={t('ide.explorer.collapseAll')}
          aria-label={t('ide.explorer.collapseAll')}
          className="rounded p-0.5 text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-200"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="m7 4 5 5 5-5" />
            <path d="m7 20 5-5 5 5" />
          </svg>
        </button>
      </div>

      <IDEExplorerEdited
        agentId={agentId}
        rootPath={rootPath}
        selectedPath={selectedPath}
        onOpen={handleOpenEdited}
      />

      <ScrollFade fill className="flex-1">
        {!rootPath ? (
          <p className="px-3 py-4 text-center text-[12px] text-gray-600">{t('ide.explorer.noProject')}</p>
        ) : rootError ? (
          <p className="px-3 py-4 text-center text-[12px] text-gray-600">{t('ide.explorer.error')}</p>
        ) : rows.length === 0 ? (
          <p className="px-3 py-4 text-center text-[12px] text-gray-600">
            {rootLoading ? t('ide.explorer.loading') : t('ide.explorer.empty')}
          </p>
        ) : (
          <>
            {truncated.has('') && (
              <p className="px-3 py-1 text-[12px] italic text-gray-600">
                {t('ide.explorer.truncated', { count: WORKSPACE_DIR_ENTRY_MAX })}
              </p>
            )}
            <IDEExplorerTree
              rows={rows}
              cache={cache}
              expanded={expanded}
              loading={loading}
              truncated={truncated}
              failed={failed}
              selectedPath={selectedPath}
              copiedPath={copiedPath}
              onToggleDir={toggleDir}
              onSelectFile={handleSelectFile}
              onOpenFile={handleOpenFile}
              onCopyPath={handleCopyPath}
            />
          </>
        )}
      </ScrollFade>

      {/*
        바닥 경로 줄 — 고른 파일의 루트 기준 경로(없으면 루트 경로)를 **보여 주기만** 한다.
        복사 버튼은 여기 있지 않다 — 고른 행 옆으로 옮겼다(§5.5 #17-19 ③(c), 트리 행 손잡이).
      */}
      <div className="flex items-center gap-1 border-t border-gray-800 bg-gray-900/60 px-1.5 py-1">
        <span
          className={`min-w-0 flex-1 truncate text-[12px] ${selectedPath ? 'text-gray-300' : 'text-gray-600'}`}
          title={selectedPath ?? rootPath ?? ''}
        >
          {selectedPath ?? rootPath ?? ''}
        </span>
      </div>
    </div>
  );
});
