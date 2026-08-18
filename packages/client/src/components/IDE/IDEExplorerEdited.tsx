import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useGraphStore } from '../../stores/graphStore.js';
import { ScrollFade } from '../ScrollFade.js';
import { agentTouchedFileIds } from './editorFollow.js';
import { splitRelPath, toRelativeFromRoot } from './explorerModel.js';
import { openFileByPath } from './useWorkspaceExplorer.js';

/**
 * §5.5 #17-19 ④ v4.71 — 트리 위의 "이 에이전트가 편집한 파일" 구역(VS Code 의 OPEN EDITORS 자리).
 *
 * v4.71 이전의 파일 뷰가 하던 일을 그대로 이어받되(엣지로 이어진 파일 노드 + `fileEdits` 횟수),
 * 표시만 `상위폴더/파일명` 으로 바꾼다 — basename 만 찍으면 같은 이름의 파일이 여럿일 때
 * 어느 것인지 알 수 없다는 것이 이번 개편의 출발점이다.
 */

/** 편집 목록이 트리를 밀어내지 않도록 잡는 상한(px). 넘으면 이 구역만 스크롤된다. */
const EDITED_MAX_HEIGHT = 160;

interface IDEExplorerEditedProps {
  agentId: string;
  /** 트리 루트 절대 경로. 없으면 절대 경로를 그대로 보여 준다. */
  rootPath: string | null;
  selectedPath: string | null;
  /** §5.5 #17-27 — 클릭 = 앱 안 편집창에서 열기(절대 경로까지 함께 넘긴다 — 루트 밖 파일도 있다). */
  onOpen: (absPath: string, relPath: string) => void;
}

export const IDEExplorerEdited = memo(function IDEExplorerEdited({
  agentId,
  rootPath,
  selectedPath,
  onOpen,
}: IDEExplorerEditedProps): React.JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const allFileEdits = useGraphStore((s) => s.fileEdits);
  const storeEdges = useGraphStore((s) => s.edges);

  // 이 에이전트와 엣지로 이어진 노드 = 이 에이전트가 만진 파일(서버가 이미 판단한 관계).
  //   §5.5 #17-27 ⑪ — [추종]도 **같은 함수**로 대상을 고른다(목록에 뜬 파일과 따라가는 파일이 어긋나면 안 된다).
  const touchedFiles = useMemo(() => agentTouchedFileIds(storeEdges, agentId), [storeEdges, agentId]);

  const files = useMemo(() => {
    const result: { id: string; absPath: string; relPath: string; count: number; at: number }[] = [];
    for (const id of touchedFiles) {
      const edits = allFileEdits[id];
      const lastEdit = edits?.[0];
      if (!edits || !lastEdit) continue;
      result.push({
        id,
        absPath: lastEdit.filePath,
        relPath: rootPath ? toRelativeFromRoot(lastEdit.filePath, rootPath) : lastEdit.filePath,
        count: edits.length,
        at: lastEdit.timestamp,
      });
    }
    result.sort((a, b) => b.at - a.at);
    return result;
  }, [touchedFiles, allFileEdits, rootPath]);

  return (
    <div className="border-b border-gray-800">
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className="flex w-full items-center gap-1 px-1.5 py-1 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-500 transition-colors hover:text-gray-300"
      >
        <svg
          className={`h-3 w-3 flex-shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <span className="truncate">{t('ide.explorer.edited', { count: files.length })}</span>
      </button>

      {open && (
        <ScrollFade maxHeight={EDITED_MAX_HEIGHT}>
        <ul className="flex flex-col pb-1">
          {files.map((f) => {
            const { dir, name } = splitRelPath(f.relPath);
            const isSelected = selectedPath === f.relPath;
            return (
              <li key={f.id}>
                <button
                  type="button"
                  onClick={() => onOpen(f.absPath, f.relPath)}
                  onDoubleClick={() => openFileByPath(f.absPath, f.relPath)}
                  title={f.relPath}
                  className={`flex w-full items-center gap-1.5 py-[3px] pl-4 pr-1.5 text-left text-[11px] transition-colors ${
                    isSelected ? 'bg-blue-500/20 text-blue-100' : 'text-gray-400 hover:bg-gray-700/50 hover:text-gray-200'
                  }`}
                >
                  <svg
                    className="h-3.5 w-3.5 flex-shrink-0 text-violet-400/80"
                    viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"
                  >
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM14 2v6h6" />
                  </svg>
                  <span className="truncate">{name}</span>
                  {dir && <span className="min-w-0 flex-1 truncate text-[9.5px] text-gray-600">{dir}</span>}
                  <span className="ml-auto flex-shrink-0 text-[9px] text-gray-600">{f.count}</span>
                </button>
              </li>
            );
          })}
          {files.length === 0 && (
            <li className="px-4 py-2 text-[10px] text-gray-600">{t('ide.explorer.noEdited')}</li>
          )}
        </ul>
        </ScrollFade>
      )}
    </div>
  );
});
